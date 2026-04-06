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
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// 路由: 测试抓取逻辑
		if (url.pathname === "/test-scrape") {
			try {
				console.log("Starting scrape...");
				const data = await scrapePrices();
				console.log("Scrape successful, items found:", data.length);
				return new Response(JSON.stringify(data, null, 2), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (error: any) {
				console.error("Scrape error:", error.message);
				return new Response(JSON.stringify({ error: error.message, stack: error.stack }), { 
					status: 500,
					headers: { "Content-Type": "application/json" }
				});
			}
		}

		return new Response("Hello! Visit /test-scrape to see current prices.");
	},
};

/**
 * 抓取 DRAMeXchange 价格逻辑
 */
async function scrapePrices(): Promise<SpotPrice[]> {
	console.log("Fetching DRAMeXchange homepage...");
	const response = await fetch("https://www.dramexchange.com/", {
		headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch DRAMeXchange: ${response.status} ${response.statusText}`);
	}

	const html = await response.text();
	console.log("HTML received, length:", html.length);
	
	const results: SpotPrice[] = [];

	// 1. 提取 Last Update 时间
	// DRAM Update (优化正则，更宽松)
	const dramUpdateMatch = html.match(/DRAM Spot Price.*?Last Update:\s*([A-Za-z]+\.\d+\s+\d+\s+\d+:\d+)/s);
	const dramUpdateTime = dramUpdateMatch ? dramUpdateMatch[1].trim() : "Unknown";
	console.log("DRAM Update Time:", dramUpdateTime);

	// Wafer Update
	const waferUpdateMatch = html.match(/Wafer Spot Price.*?Last Update:\s*([A-Za-z]+\.\d+\s+\d+\s+\d+:\d+)/s);
	const waferUpdateTime = waferUpdateMatch ? waferUpdateMatch[1].trim() : "Unknown";
	console.log("Wafer Update Time:", waferUpdateTime);

	// 2. 定义目标项
	const targets = [
		{
			name: "DDR5 16Gb (2Gx8) 4800/5600",
			group: "DRAM",
			refTime: dramUpdateTime,
			// 允许更多的标签干扰
			regex: /DDR5 16Gb \(2Gx8\) 4800\/5600.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>(.*?)<\/td>/s,
		},
		{
			name: "DDR4 16Gb (2Gx8) 3200",
			group: "DRAM",
			refTime: dramUpdateTime,
			regex: /DDR4 16Gb \(2Gx8\) 3200.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>(.*?)<\/td>/s,
		},
		{
			name: "DDR4 8Gb (1Gx8) 3200",
			group: "DRAM",
			refTime: dramUpdateTime,
			regex: /DDR4 8Gb \(1Gx8\) 3200.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>(.*?)<\/td>/s,
		},
		{
			name: "512Gb TLC",
			group: "NAND",
			refTime: waferUpdateTime,
			regex: /512Gb TLC.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>([\d.]+)<\/td>.*?<td[^>]*>(.*?)<\/td>/s,
		},
	];

	for (const target of targets) {
		const match = html.match(target.regex);
		if (match) {
			results.push({
				item_name: target.name,
				item_group: target.group,
				session_high: parseFloat(match[3]), // Session High 是第 3 个数值 (对应 td)
				session_low: parseFloat(match[4]),  // Session Low 是第 4 个数值
				session_average: parseFloat(match[5]), // Session Average 是第 5 个数值
				session_change: match[6].replace(/<[^>]*>/g, "").trim(), // 去掉可能的内部 span 标签
				ref_time: target.refTime,
			});
		} else {
			console.warn(`Failed to match target: ${target.name}`);
		}
	}

	if (results.length === 0) {
		// 如果一个都没匹配到，可能是结构大改
		console.log("Sample HTML around DRAM:", html.substring(html.indexOf("DRAM Spot Price"), html.indexOf("DRAM Spot Price") + 500));
	}

	return results;
}
