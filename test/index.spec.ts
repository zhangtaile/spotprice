import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { afterEach, describe, it, expect, vi } from "vitest";
import worker from "../src/index";

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

	it("serves the dashboard from the root route", async () => {
		const response = await SELF.fetch("https://example.com");
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain("SpotPrice Dashboard");
		expect(html).toContain("单GB价格");
		expect(html).toContain("USD / GB");
	});
});
