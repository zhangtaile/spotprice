import { SpotPrice, Target } from "./types";

export async function scrapePrices(): Promise<SpotPrice[]> {
	const response = await fetch("https://www.dramexchange.com/", {
		headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		},
	});
	if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
	const html = await response.text();
	const results: SpotPrice[] = [];

	const dramUpdateTime = extractTime(html, "DRAM Spot Price");
	const waferUpdateTime = extractTime(html, "Wafer Spot Price");

	const targets: Omit<Target, "refTime">[] = [
		{ name: "DDR5 16Gb (2Gx8) 4800/5600", group: "DRAM", regex: createPriceRegex("DDR5 16Gb \\(2Gx8\\) 4800/5600") },
		{ name: "DDR4 16Gb (2Gx8) 3200", group: "DRAM", regex: createPriceRegex("DDR4 16Gb \\(2Gx8\\) 3200") },
		{ name: "DDR4 8Gb (1Gx8) 3200", group: "DRAM", regex: createPriceRegex("DDR4 8Gb \\(1Gx8\\) 3200") },
		{ name: "512Gb TLC", group: "NAND", regex: createPriceRegex("512Gb TLC") },
	];

	for (const t of targets) {
		const refTime = t.group === "DRAM" ? dramUpdateTime : waferUpdateTime;
		const m = html.match(t.regex);
		if (m) {
			results.push({
				item_name: t.name,
				item_group: t.group,
				session_high: parseFloat(m[3]),
				session_low: parseFloat(m[4]),
				session_average: parseFloat(m[5]),
				session_change: m[6].replace(/<[^>]*>/g, "").trim(),
				ref_time: formatRefTime(refTime),
			});
		} else {
			console.error(`Failed to match target: ${t.name}`);
		}
	}
	return results;
}

function createPriceRegex(name: string): RegExp {
	// Matches: Name ... <td>Val1</td> <td>Val2</td> <td>High</td> <td>Low</td> <td>Average</td> <td>Change</td>
	// The original site structure has multiple columns before High/Low/Average.
	return new RegExp(`${name}.*?<td[^>]*>([\\d.]+)<\\/td>.*?<td[^>]*>([\\d.]+)<\\/td>.*?<td[^>]*>([\\d.]+)<\\/td>.*?<td[^>]*>([\\d.]+)<\\/td>.*?<td[^>]*>([\\d.]+)<\\/td>.*?<td[^>]*>(.*?)<\\/td>`, "s");
}

export function extractTime(fullHtml: string, title: string): string {
	const parts = fullHtml.split(title);
	for (let i = 1; i < parts.length; i++) {
		const segment = parts[i].substring(0, 1000);
		const match = segment.match(/class="tab_time">Last\s*Update\s*:\s*([^<\(]+)/i);
		if (match) return match[1].replace(/\s+/g, " ").trim();
	}
	return "Unknown";
}

export function formatRefTime(raw: string): string {
	if (raw === "Unknown") return raw;
	const months: Record<string, string> = {
		'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
		'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
	};
	const m = raw.match(/([A-Za-z]{3})\.?\s*(\d{1,2})\s+(\d{4})\s+(\d{1,2}:\d{2})/);
	if (m) return `${m[3]}-${months[m[1]] || '01'}-${m[2].padStart(2, '0')} ${m[4]}`;
	return raw;
}
