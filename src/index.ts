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

		// 路由: 调试原始 HTML (找出正则失效的原因)
		if (url.pathname === "/debug-html") {
			const response = await fetch("https://www.dramexchange.com/", {
				headers: { "User-Agent": "Mozilla/5.0" },
			});
			const html = await response.text();
			return new Response(html, { headers: { "Content-Type": "text/html" } });
		}

		// 路由 0: Dashboard 可视化界面 (根路径)
		if (url.pathname === "/" || url.pathname === "/dashboard") {
			return new Response(renderDashboard(), { headers: { "Content-Type": "text/html" } });
		}

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

		// 路由 3: 获取最新报价 (API)
		if (url.pathname === "/api/latest") {
			const { results } = await env.spotprice_db.prepare(`
				SELECT * FROM (
					SELECT *, ROW_NUMBER() OVER (PARTITION BY item_name ORDER BY ref_time DESC) as rn
					FROM spot_prices
				) WHERE rn = 1
			`).all();
			return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
		}

		// 路由 4: 获取历史走势 (API)
		if (url.pathname === "/api/history") {
			const itemName = url.searchParams.get("item");
			if (!itemName) return new Response("Missing item parameter", { status: 400 });

			const { results } = await env.spotprice_db.prepare(`
				SELECT * FROM (
					SELECT *, ROW_NUMBER() OVER (ORDER BY ref_time DESC) as seq
					FROM spot_prices 
					WHERE item_name = ?
				) 
				WHERE seq <= 30
				ORDER BY ref_time ASC
			`).bind(itemName).all();
			return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
		}

		return new Response("SpotPrice Worker is running.");
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

	// 1. 提取时间 - 先找标题，再找附近的 Last Update
	const extractTime = (fullHtml: string, title: string) => {
		const parts = fullHtml.split(title);
		for (let i = 1; i < parts.length; i++) {
			const segment = parts[i].substring(0, 1000); 
			const match = segment.match(/class="tab_time">Last\s*Update\s*:\s*([^<\(]+)/i);
			if (match) {
				return match[1].replace(/\s+/g, " ").trim();
			}
		}
		return "Unknown";
	};
	
	const dramUpdateTime = extractTime(html, "DRAM Spot Price");
	const waferUpdateTime = extractTime(html, "Wafer Spot Price");

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
	return { rowsInserted };
}

/**
 * 渲染 Dashboard HTML 页面
 */
function renderDashboard() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SpotPrice Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        :root {
            --bg-color: #0f172a;
            --card-bg: #1e293b;
            --text-color: #f1f5f9;
            --primary: #38bdf8;
            --danger: #ef4444;
            --success: #22c55e;
        }
        body {
            font-family: system-ui, -apple-system, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            margin: 0; padding: 20px;
        }
        .container { max-width: 1000px; margin: 0 auto; }
        header { margin-bottom: 30px; border-bottom: 1px solid #334155; padding-bottom: 10px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; margin-bottom: 30px; }
        .card { background: var(--card-bg); padding: 15px; border-radius: 12px; border: 1px solid #334155; }
        .card .title { font-size: 13px; color: #94a3b8; margin-bottom: 5px; }
        .card .price { font-size: 24px; font-weight: bold; }
        .change.down { color: var(--danger); }
        .change.up { color: var(--success); }
        .chart-container { background: var(--card-bg); border-radius: 12px; padding: 20px; border: 1px solid #334155; height: 450px; }
        footer { text-align: center; font-size: 11px; color: #64748b; margin-top: 40px; }
    </style>
</head>
<body>
    <div class="container">
        <header><h1>SpotPrice Dashboard 📊</h1></header>
        <div id="latest-grid" class="grid"></div>
        <div class="chart-container"><div id="main-chart" style="width:100%;height:100%;"></div></div>
        <footer>DRAMeXchange | Cloudflare Workers + D1</footer>
    </div>
    <script>
        const ITEMS = ["DDR5 16Gb (2Gx8) 4800/5600", "DDR4 16Gb (2Gx8) 3200", "DDR4 8Gb (1Gx8) 3200", "512Gb TLC"];
        async function init() {
            const latest = await (await fetch('/api/latest')).json();
            const grid = document.getElementById('latest-grid');
            latest.forEach(item => {
                const div = document.createElement('div');
                div.className = 'card';
                div.innerHTML = '<div class="title">' + item.item_name + '</div>' +
                    '<div style="display:flex; flex-direction:column; gap:4px;">' +
                        '<div style="font-size:10px; color:#64748b;">AVG</div>' +
                        '<div style="font-size:18px; font-weight:bold; color:var(--primary);">$' + item.session_average.toFixed(3) + '</div>' +
                        '<div style="font-size:10px; color:#64748b; margin-top:4px;">HIGH</div>' +
                        '<div style="font-size:14px; color:#94a3b8; border-bottom:1px solid #334155; padding-bottom:8px;">$' + item.session_high.toFixed(3) + '</div>' +
                    '</div>' +
                    '<div style="display:flex; justify-content:space-between; margin-top:12px;">' +
                        '<div class="change ' + (item.session_change.includes('-')?'down':'up') + '">' + item.session_change + '</div>' +
                        '<div style="font-size:9px; color:#475569;">' + item.ref_time.split(' 202')[0] + '</div>' +
                    '</div>';
                grid.appendChild(div);
            });
            const myChart = echarts.init(document.getElementById('main-chart'), 'dark');
            const series = []; let xData = [];
            for (const name of ITEMS) {
                const data = await (await fetch('/api/history?item=' + encodeURIComponent(name))).json();
                if (xData.length === 0) xData = data.map(d => d.ref_time.split(' 202')[0]);
                series.push({ name, type: 'line', smooth: true, data: data.map(d => d.session_average) });
            }
            myChart.setOption({
                backgroundColor: 'transparent', tooltip: { trigger: 'axis' },
                legend: { top: 0, textStyle: { color: '#ccc' } },
                xAxis: { type: 'category', data: xData },
                yAxis: { type: 'value', scale: true },
                series
            });
        }
        init();
    </script>
</body>
</html>
  `;
}
