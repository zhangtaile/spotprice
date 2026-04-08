import { Env, SpotPrice } from "./types";
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
				return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
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
				return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
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
			scrapePrices().then(prices => savePricesToDB(env, prices))
		);
	},
};

const ADMIN_ROUTES = new Set(["/debug-html", "/scrape-and-save"]);

function isAdminRoute(pathname: string): boolean {
	return ADMIN_ROUTES.has(pathname);
}

function adminRoutesEnabled(env: Env): boolean {
	return env.ENABLE_ADMIN_ROUTES === "true";
}
