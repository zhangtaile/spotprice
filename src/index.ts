import { Env, SpotPrice } from "./types";
import { sendScrapeFailureAlert } from "./alerts";
import { scrapePrices } from "./scraper";
import { savePricesToDB, getLatestPrices, getPriceHistory } from "./db";
import { renderDashboard } from "./dashboard";

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		// Admin Routes Check
		if (isAdminRoute(url.pathname) && !adminRoutesEnabled(env)) {
			return new Response("Not Found", { status: 404 });
		}

		// Routing
		if (url.pathname === "/") {
			return new Response(renderDashboard(), { headers: { "Content-Type": "text/html" } });
		}

		if (url.pathname === "/debug-html") {
			const response = await fetch("https://www.dramexchange.com/", {
				headers: { "User-Agent": "Mozilla/5.0" },
			});
			const html = await response.text();
			return new Response(html, { headers: { "Content-Type": "text/html" } });
		}

		if (url.pathname === "/test-scrape") {
			try {
				const data = await scrapePrices();
				return new Response(JSON.stringify(data, null, 2), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (error: any) {
				return new Response(JSON.stringify({
					error: error.message,
					issues: Array.isArray(error?.issues) ? error.issues : undefined,
				}), { status: 500, headers: { "Content-Type": "application/json" } });
			}
		}

		if (url.pathname === "/scrape-and-save") {
			try {
				const prices = await scrapePrices();
				const result = await savePricesToDB(env, prices);
				return new Response(JSON.stringify({ success: true, result, prices }, null, 2), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (error: any) {
				return new Response(JSON.stringify({
					error: error.message,
					issues: Array.isArray(error?.issues) ? error.issues : undefined,
				}), { status: 500, headers: { "Content-Type": "application/json" } });
			}
		}

		if (url.pathname === "/insert_grep_error") {
			if (request.method !== "POST") {
				return new Response("Method Not Allowed", {
					status: 405,
					headers: {
						"Allow": "POST",
					},
				});
			}

			try {
				const issues = createInjectedGrepIssues();
				await sendScrapeFailureAlert(env, issues, "manual:/insert_grep_error");
				return new Response(JSON.stringify({
					success: true,
					message: "Injected scrape alert email sent.",
					adminEmail: env.ADMIN_EMAIL ?? null,
					issues,
				}, null, 2), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (error: any) {
				return new Response(JSON.stringify({
					error: error.message,
				}), { status: 500, headers: { "Content-Type": "application/json" } });
			}
		}

		if (url.pathname === "/api/dashboard") {
			try {
				const latest = await getLatestPrices(env);
				const itemNames = Array.from(new Set(latest.map(p => p.item_name)));
				const historyPromises = itemNames.map(name => getPriceHistory(env, name));
				const histories = await Promise.all(historyPromises);
				
				const historyMap: Record<string, SpotPrice[]> = {};
				itemNames.forEach((name, i) => {
					historyMap[name] = histories[i];
				});

				return new Response(JSON.stringify({ latest, history: historyMap }), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (error: any) {
				return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
			}
		}

		// Backward compatibility or direct API access
		if (url.pathname === "/api/latest") {
			const results = await getLatestPrices(env);
			return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
		}

		return new Response("SpotPrice Worker is running.");
	},

	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(
			runScheduledScrape(env)
		);
	},
};

const ADMIN_ROUTES = new Set(["/debug-html", "/scrape-and-save", "/insert_grep_error"]);

function isAdminRoute(pathname: string): boolean {
	return ADMIN_ROUTES.has(pathname);
}

function adminRoutesEnabled(env: Env): boolean {
	return env.ENABLE_ADMIN_ROUTES === "true";
}

async function runScheduledScrape(env: Env) {
	try {
		const prices = await scrapePrices();
		await savePricesToDB(env, prices);
	} catch (error: any) {
		console.error("Scheduled scrape failed", error);

		const issues = Array.isArray(error?.issues)
			? error.issues
			: [{ code: "SCRAPE_ERROR", message: error?.message || "Unknown scrape error" }];

		try {
			await sendScrapeFailureAlert(env, issues, "scheduled");
		} catch (alertError) {
			console.error("Failed to send scrape alert", alertError);
		}
	}
}

function createInjectedGrepIssues() {
	return [
		{
			code: "INJECTED_GREP_ERROR",
			message: "Manual error injection triggered from /insert_grep_error",
		},
		{
			code: "TARGET_NOT_FOUND",
			message: "Injected missing target for email alert verification: DDR5 16Gb (2Gx8) 4800/5600",
			itemName: "DDR5 16Gb (2Gx8) 4800/5600",
		},
	];
}
