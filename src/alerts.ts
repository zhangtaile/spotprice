import { Env, ScrapeIssue } from "./types";

export async function sendScrapeFailureAlert(env: Env, issues: ScrapeIssue[], context: string) {
	if (!env.ALERT_EMAIL || !env.ADMIN_EMAIL || !env.ALERT_FROM_EMAIL) {
		const missing = [
			!env.ALERT_EMAIL ? "ALERT_EMAIL binding" : null,
			!env.ADMIN_EMAIL ? "ADMIN_EMAIL" : null,
			!env.ALERT_FROM_EMAIL ? "ALERT_FROM_EMAIL" : null,
		].filter(Boolean).join(", ");
		throw new Error(`Alert email is not configured: missing ${missing}`);
	}

	const timestamp = new Date().toISOString();
	const body = [
		"SpotPrice scrape failure detected.",
		`Time: ${timestamp}`,
		`Context: ${context}`,
		"",
		"Issues:",
		...issues.map((issue, index) => `${index + 1}. [${issue.code}] ${issue.message}`),
	].join("\n");

	await env.ALERT_EMAIL.send({
		from: env.ALERT_FROM_EMAIL,
		to: env.ADMIN_EMAIL,
		subject: `[SpotPrice] Scrape failure (${issues.length} issue${issues.length === 1 ? "" : "s"})`,
		text: body,
	});
}
