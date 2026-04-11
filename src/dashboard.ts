export function renderDashboard() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SpotPrice Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        :root { --bg-color: #0f172a; --card-bg: #1e293b; --text-color: #f1f5f9; --primary: #38bdf8; --danger: #ef4444; --success: #22c55e; }
        body { font-family: system-ui, -apple-system, sans-serif; background-color: var(--bg-color); color: var(--text-color); margin: 0; padding: 20px; }
        .container { max-width: 1000px; margin: 0 auto; }
        header { margin-bottom: 30px; border-bottom: 1px solid #334155; padding-bottom: 10px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; margin-bottom: 30px; }
        .card { background: var(--card-bg); padding: 15px; border-radius: 12px; border: 1px solid #334155; }
        .card .title { font-size: 13px; color: #94a3b8; margin-bottom: 5px; }
        .change.down { color: var(--danger); font-size: 13px; font-weight: 500; }
        .change.up { color: var(--success); font-size: 13px; font-weight: 500; }
        .chart-container { background: var(--card-bg); border-radius: 12px; padding: 20px; border: 1px solid #334155; height: 350px; margin-bottom: 20px; }
        footer { text-align: center; font-size: 11px; color: #64748b; margin-top: 40px; }
    </style>
</head>
<body>
    <div class="container">
        <header><h1>SpotPrice Dashboard 📊</h1></header>
        <div id="latest-grid" class="grid"></div>
        <div class="chart-container"><div id="chart-nand" style="width:100%;height:100%;"></div></div>
        <div class="chart-container"><div id="chart-8g" style="width:100%;height:100%;"></div></div>
        <div class="chart-container"><div id="chart-16g" style="width:100%;height:100%;"></div></div>
        <footer>DRAMeXchange | Cloudflare Workers + D1</footer>
    </div>
    <script>
        const ITEMS = ["DDR5 16Gb (2Gx8) 4800/5600", "DDR4 16Gb (2Gx8) 3200", "DDR4 8Gb (1Gx8) 3200", "512Gb TLC"];
        const ITEM_CAPACITY_GB = {
            "DDR5 16Gb (2Gx8) 4800/5600": 2,
            "DDR4 16Gb (2Gx8) 3200": 2,
            "DDR4 8Gb (1Gx8) 3200": 1,
            "512Gb TLC": 64
        };
        function formatUsd(value) {
            return '$' + value.toFixed(3);
        }
        function getPricePerGb(itemName, price) {
            const capacityGb = ITEM_CAPACITY_GB[itemName];
            return typeof capacityGb === 'number' && capacityGb > 0 ? price / capacityGb : null;
        }
        function createOption(title, series, xData, yAxisName) {
            return {
                title: { text: title, textStyle: { color: '#94a3b8', fontSize: 14 } },
                backgroundColor: 'transparent', tooltip: { trigger: 'axis' },
                legend: { top: 0, right: 0, textStyle: { color: '#ccc' } },
                xAxis: { type: 'category', data: xData, axisLabel: { color: '#64748b' } },
                yAxis: {
                    type: 'value',
                    min: 0,
                    name: yAxisName || '',
                    nameTextStyle: { color: '#64748b' },
                    axisLabel: { color: '#64748b' },
                    splitLine: { lineStyle: { color: '#334155' } }
                },
                grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
                series
            };
        }
        async function init() {
            const data = await (await fetch('/api/dashboard')).json();
            const { latest, history } = data;
            
            const grid = document.getElementById('latest-grid');
            latest.forEach(item => {
                const div = document.createElement('div');
                div.className = 'card';
                const dispTime = item.ref_time.includes('-') ? item.ref_time.substring(5) : item.ref_time.split(' 202')[0];
                const pricePerGb = getPricePerGb(item.item_name, item.session_average);
                const perGbMarkup = pricePerGb === null
                    ? ''
                    : '<div style="font-size:10px; color:#64748b; margin-top:4px;">单GB价格</div>' +
                      '<div style="font-size:13px; color:#cbd5e1;">' + formatUsd(pricePerGb) + ' / GB</div>';
                div.innerHTML = '<div class="title">' + item.item_name + '</div>' +
                    '<div style="display:flex; flex-direction:column; gap:4px;">' +
                        '<div style="font-size:10px; color:#64748b;">AVG</div>' +
                        '<div style="font-size:18px; font-weight:bold; color:var(--primary);">' + formatUsd(item.session_average) + '</div>' +
                        perGbMarkup +
                        '<div style="font-size:10px; color:#64748b; margin-top:4px;">HIGH</div>' +
                        '<div style="font-size:14px; color:#94a3b8; border-bottom:1px solid #334155; padding-bottom:8px;">' + formatUsd(item.session_high) + '</div>' +
                    '</div>' +
                    '<div style="display:flex; justify-content:space-between; margin-top:12px;">' +
                        '<div class="change ' + (item.session_change.includes('-')?'down':'up') + '">' + item.session_change + '</div>' +
                        '<div style="font-size:9px; color:#475569;">' + dispTime + '</div>' +
                    '</div>';
                grid.appendChild(div);
            });

            const formatX = (d) => d.ref_time.includes('-') ? d.ref_time.substring(5) : d.ref_time.split(' 202')[0];

            // 图表 1: NAND (最上方)
            const nand = history["512Gb TLC"] || [];
            const c3 = echarts.init(document.getElementById('chart-nand'), 'dark');
            c3.setOption(createOption('NAND Wafer Trend', [
                { name: '512Gb TLC ($/GB)', type: 'line', smooth: true, data: nand.map(d => getPricePerGb("512Gb TLC", d.session_average)), itemStyle: { color: '#f59e0b' } }
            ], nand.map(formatX), 'USD / GB'));

            // 图表 2: 8G DRAM (中间)
            const d4_8 = history["DDR4 8Gb (1Gx8) 3200"] || [];
            const c2 = echarts.init(document.getElementById('chart-8g'), 'dark');
            c2.setOption(createOption('DRAM 8G Trend', [
                { name: 'DDR4 8G', type: 'line', smooth: true, data: d4_8.map(d => d.session_average), itemStyle: { color: '#22c55e' } }
            ], d4_8.map(formatX)));

            // 图表 3: 16G DRAM (最下方)
            const d5_16 = history["DDR5 16Gb (2Gx8) 4800/5600"] || [];
            const d4_16 = history["DDR4 16Gb (2Gx8) 3200"] || [];
            const c1 = echarts.init(document.getElementById('chart-16g'), 'dark');
            c1.setOption(createOption('DRAM 16G Trend', [
                { name: 'DDR5 16G', type: 'line', smooth: true, data: d5_16.map(d => d.session_average) },
                { name: 'DDR4 16G', type: 'line', smooth: true, data: d4_16.map(d => d.session_average) }
            ], d5_16.map(formatX)));

            window.addEventListener('resize', () => { [c1, c2, c3].forEach(c => c.resize()); });
        }
        init();
    </script>
</body>
</html>
  `;
}
