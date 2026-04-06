/**
 * Cloudflare Worker: SpotPrice Scraper & Dashboard
 */

export interface Env {
	spotprice_db: D1Database;
}

export interface SpotPrice {
	item_name: string;
	item_group: string;
	session_average: number;
	session_high: number;
	session_low: number;
	session_change: string;
	ref_time: string;
}

export default {
	// 处理 HTTP 请求 (用于手动触发和后续的 Dashboard)
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// 路由 1: 仅抓取不存库 (测试用)
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

		// 路由 2: 抓取并存入数据库 (手动触发验证)
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

		return new Response("SpotPrice Worker is running. Visit /test-scrape or /scrape-and-save");
	},

	// 处理定时任务 (Cron Triggers)
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		console.log(`Running scheduled scrape at ${new Date().toISOString()}`);
		ctx.waitUntil(
			scrapePrices().then(prices => savePricesToDB(env, prices))
		);
	},
};

/**
 * 抓取 DRAMeXchange 价格逻辑
 */
async function scrapePrices(): Promise<SpotPrice[]> {
	const response = await fetch("https://www.dramexchange.com/", {
		headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		},
	});

	if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

	const html = await response.text();
	const results: SpotPrice[] = [];

	// 1. 提取时间 - 使用更精确的逻辑
	// 匹配格式如: Apr.3 2026 18:10 或 Mar.30 2026 14:40
	const timeRegex = /Last Update:\s*([A-Za-z]{3}\.?\s*\d{1,2}\s+\d{4}\s+\d{1,2}:\d{2})/g;
	
	// 分段寻找，避免交叉匹配
	const dramSection = html.split("Wafer Spot Price")[0];
	const waferSection = html.includes("Wafer Spot Price") ? html.split("Wafer Spot Price")[1] : "";

	const dramUpdateTime = (dramSection.match(/DRAM Spot Price.*?Last Update:\s*([A-Za-z]{3}\.?\s*\d{1,2}\s+\d{4}\s+\d{1,2}:\d{2})/s)?.[1] || "Unknown").trim();
	const waferUpdateTime = (waferSection.match(/Last Update:\s*([A-Za-z]{3}\.?\s*\d{1,2}\s+\d{4}\s+\d{1,2}:\d{2})/s)?.[1] || "Unknown").trim();

	const targets = [
		{ name: "DDR5 16Gb (2Gx8) 4800/5600", group: "DRAM", refTime: dramUpdateTime, regex: /DDR5 16Gb \(2Gx8\) 4800\/5600.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>(.*?)<\/td>/s },
		{ name: "DDR4 16Gb (2Gx8) 3200", group: "DRAM", refTime: dramUpdateTime, regex: /DDR4 16Gb \(2Gx8\) 3200.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>(.*?)<\/td>/s },
		{ name: "DDR4 8Gb (1Gx8) 3200", group: "DRAM", refTime: dramUpdateTime, regex: /DDR4 8Gb \(1Gx8\) 3200.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>(.*?)<\/td>/s },
		{ name: "512Gb TLC", group: "NAND", refTime: waferUpdateTime, regex: /512Gb TLC.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>(.*?)<\/td>/s },
	];

	for (const t of targets) {
		const m = html.match(t.regex);
		if (m) {
			results.push({
				item_name: t.name,
				item_group: t.group,
				session_high: parseFloat(m[3]),
				session_low: parseFloat(m[4]),
				session_average: parseFloat(m[5]),
				session_change: m[6].replace(/<[^>]*>/g, "").trim(),
				ref_time: t.refTime,
			});
		}
	}
	return results;
}

/**
 * 将数据存入 D1 数据库
 */
async function savePricesToDB(env: Env, prices: SpotPrice[]) {
	const stmt = env.spotprice_db.prepare(`
		INSERT OR IGNORE INTO spot_prices 
		(item_name, item_group, session_average, session_high, session_low, session_change, ref_time)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`);

	const batch = prices.map(p => 
		stmt.bind(p.item_name, p.item_group, p.session_average, p.session_high, p.session_low, p.session_change, p.ref_time)
	);

	const results = await env.spotprice_db.batch(batch);
	const rowsInserted = results.reduce((acc, r) => acc + (r.meta.changes || 0), 0);
	
	console.log(`Saved ${rowsInserted} new records to D1.`);
	return { rowsInserted };
}
