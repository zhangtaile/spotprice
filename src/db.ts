import { Env, SpotPrice } from "./types";

export async function savePricesToDB(env: Env, prices: SpotPrice[]) {
	const stmt = env.spotprice_db.prepare(`
		INSERT OR IGNORE INTO spot_prices 
		(item_name, item_group, session_average, session_high, session_low, session_change, ref_time)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`);
	const batch = prices.map(p => stmt.bind(p.item_name, p.item_group, p.session_average, p.session_high, p.session_low, p.session_change, p.ref_time));
	const results = await env.spotprice_db.batch(batch);
	return { rowsInserted: results.reduce((acc, r) => acc + (r.meta.changes || 0), 0) };
}

export async function getLatestPrices(env: Env): Promise<SpotPrice[]> {
	const { results } = await env.spotprice_db.prepare(`
		SELECT * FROM (
			SELECT *, ROW_NUMBER() OVER (PARTITION BY item_name ORDER BY ref_time DESC) as rn
			FROM spot_prices
		) WHERE rn = 1
	`).all();
	return results as unknown as SpotPrice[];
}

export async function getPriceHistory(env: Env, itemName: string, limit: number = 30): Promise<SpotPrice[]> {
	const { results } = await env.spotprice_db.prepare(`
		SELECT * FROM (
			SELECT *, ROW_NUMBER() OVER (ORDER BY ref_time DESC) as seq
			FROM spot_prices 
			WHERE item_name = ?
		) 
		WHERE seq <= ?
		ORDER BY ref_time ASC
	`).bind(itemName, limit).all();
	return results as unknown as SpotPrice[];
}
