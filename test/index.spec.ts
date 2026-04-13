import {
	env,
	createExecutionContext,
	createScheduledController,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { afterEach, describe, it, expect, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("SpotPrice worker", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns 404 for admin routes when disabled", async () => {
		const request = new IncomingRequest("http://example.com/debug-html");
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Not Found");
	});

	it("allows admin routes when enabled", async () => {
		const html = "<html>debug</html>";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(html, {
				headers: { "Content-Type": "text/html" },
			}),
		);

		const request = new IncomingRequest("http://example.com/debug-html");
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, ENABLE_ADMIN_ROUTES: "true" },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe(html);
	});

	it("returns 404 for injected error route when admin routes are disabled", async () => {
		const request = new IncomingRequest("http://example.com/insert_grep_error");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Not Found");
	});

	it("rejects GET requests to /insert_grep_error", async () => {
		const request = new IncomingRequest("http://example.com/insert_grep_error");
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, ENABLE_ADMIN_ROUTES: "true" },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(405);
		expect(response.headers.get("Allow")).toBe("POST");
		expect(await response.text()).toBe("Method Not Allowed");
	});

	it("serves the dashboard from the root route", async () => {
		const response = await SELF.fetch("https://example.com");
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain("SpotPrice Dashboard");
		expect(html).toContain("单GB价格");
		expect(html).toContain("USD / GB");
	});

	it("sends an alert and skips database writes when scheduled scrape validation fails", async () => {
		const scheduled = createScheduledController();
		const ctx = createExecutionContext();
		const send = vi.fn().mockResolvedValue({ id: "msg-1" });
		const saveSpy = vi.spyOn(env.spotprice_db, "batch");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>broken</html>"));

		await worker.scheduled(
			scheduled,
			{
				...(env as Env),
				ADMIN_EMAIL: "admin@example.com",
				ALERT_FROM_EMAIL: "alerts@example.com",
				ALERT_EMAIL: { send } as SendEmail,
			},
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(saveSpy).not.toHaveBeenCalled();
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0]?.[0]).toMatchObject({
			to: "admin@example.com",
			from: "alerts@example.com",
		});
	});

	it("writes to the database and does not send an alert when scheduled scrape succeeds", async () => {
		const scheduled = createScheduledController();
		const ctx = createExecutionContext();
		const send = vi.fn().mockResolvedValue({ id: "msg-1" });
		const batchSpy = vi.spyOn(env.spotprice_db, "batch");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(createValidHtml()));

		await worker.scheduled(
			scheduled,
			{
				...(env as Env),
				ADMIN_EMAIL: "admin@example.com",
				ALERT_FROM_EMAIL: "alerts@example.com",
				ALERT_EMAIL: { send } as SendEmail,
			},
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(batchSpy).toHaveBeenCalledTimes(1);
		expect(send).not.toHaveBeenCalled();
	});

	it("returns scrape errors from manual routes without sending alerts", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>broken</html>"));

		const request = new IncomingRequest("http://example.com/test-scrape");
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{
				...(env as Env),
				ENABLE_ADMIN_ROUTES: "true",
				ADMIN_EMAIL: "admin@example.com",
				ALERT_FROM_EMAIL: "alerts@example.com",
				ALERT_EMAIL: { send: vi.fn() } as SendEmail,
			},
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({
			error: "Scrape validation failed",
		});
	});

	it("sends an injected test alert from /insert_grep_error", async () => {
		const send = vi.fn().mockResolvedValue({ id: "msg-1" });
		const request = new IncomingRequest("http://example.com/insert_grep_error", {
			method: "POST",
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{
				...(env as Env),
				ENABLE_ADMIN_ROUTES: "true",
				ADMIN_EMAIL: "admin@example.com",
				ALERT_FROM_EMAIL: "alerts@example.com",
				ALERT_EMAIL: { send } as SendEmail,
			},
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0]?.[0]).toMatchObject({
			to: "admin@example.com",
			from: "alerts@example.com",
			subject: "[SpotPrice] Scrape failure (2 issues)",
		});
		expect(await response.json()).toMatchObject({
			success: true,
			adminEmail: "admin@example.com",
		});
	});
});

function createValidHtml() {
	const items = [
		"DDR5 16Gb (2Gx8) 4800/5600",
		"DDR4 16Gb (2Gx8) 3200",
		"DDR4 8Gb (1Gx8) 3200",
		"512Gb TLC",
	];

	return `
		<div>DRAM Spot Price<div class="tab_time">Last Update : Apr. 08 2026 12:34</div></div>
		<div>Wafer Spot Price<div class="tab_time">Last Update : Apr. 08 2026 12:34</div></div>
		${items.map((item, index) => `
			<tr>
				<td>${item}</td>
				<td>${1 + index}.00</td>
				<td>${2 + index}.00</td>
				<td>${3 + index}.00</td>
				<td>${4 + index}.00</td>
				<td>${5 + index}.00</td>
				<td>+0.${index}</td>
			</tr>
		`).join("")}
	`;
}
