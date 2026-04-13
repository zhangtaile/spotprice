export interface Env {
	spotprice_db: D1Database;
	ENABLE_ADMIN_ROUTES?: string;
	ADMIN_EMAIL?: string;
	ALERT_FROM_EMAIL?: string;
	ALERT_EMAIL?: SendEmail;
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

export interface Target {
	name: string;
	group: string;
	refTime: string;
	regex: RegExp;
}

export interface ScrapeIssue {
	code: string;
	message: string;
	itemName?: string;
}
