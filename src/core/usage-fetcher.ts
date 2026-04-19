/**
 * Usage fetcher for provider quota information.
 * Currently supports z.ai only.
 */

import { loadProviders } from "./hawcode-config.js";

// ============================================================================
// Types
// ============================================================================

interface UsageDetail {
	modelCode: string;
	usage: number;
}

interface UsageLimit {
	type: string;
	unit: number;
	number: number;
	usage?: number;
	currentValue?: number;
	remaining?: number;
	percentage: number;
	nextResetTime: number;
	usageDetails?: UsageDetail[];
}

interface UsageApiResponse {
	code: number;
	msg: string;
	data: {
		limits: UsageLimit[];
		level: string;
	};
	success: boolean;
}

export interface UsageInfo {
	provider: string;
	level: string;
	tokenLimit?: {
		usage: number;
		currentValue: number;
		remaining: number;
		percentage: number;
		nextResetTime: Date;
		usageDetails: UsageDetail[];
	};
}

// ============================================================================
// z.ai usage fetcher
// ============================================================================

async function fetchZaiUsage(apiKey: string): Promise<UsageInfo> {
	const response = await fetch("https://api.z.ai/api/monitor/usage/quota/limit", {
		headers: { Authorization: `Bearer ${apiKey}` },
	});

	if (!response.ok) {
		throw new Error(`z.ai API returned ${response.status}: ${response.statusText}`);
	}

	const json = (await response.json()) as UsageApiResponse;

	if (!json.success || json.code !== 200) {
		throw new Error(`z.ai API error: ${json.msg}`);
	}

	const info: UsageInfo = {
		provider: "z.ai",
		level: json.data.level,
	};

	const tokenLimit = json.data.limits.find((l) => l.type === "TOKENS_LIMIT");
	if (tokenLimit) {
		info.tokenLimit = {
			usage: tokenLimit.usage ?? 0,
			currentValue: tokenLimit.currentValue ?? 0,
			remaining: tokenLimit.remaining ?? 0,
			percentage: tokenLimit.percentage,
			nextResetTime: new Date(tokenLimit.nextResetTime),
			usageDetails: tokenLimit.usageDetails ?? [],
		};
	}

	return info;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch usage info for all configured providers that support it.
 */
export async function fetchUsage(): Promise<UsageInfo[]> {
	const config = loadProviders();
	const results: UsageInfo[] = [];

	for (const [name, provider] of Object.entries(config.providers)) {
		if (provider.baseUrl.includes("api.z.ai")) {
			try {
				const info = await fetchZaiUsage(provider.apiKey);
				results.push(info);
			} catch (_err) {
				results.push({
					provider: `z.ai (${name})`,
					level: "unknown",
					tokenLimit: undefined,
				});
			}
		}
	}

	return results;
}

/**
 * Format usage info as a human-readable string.
 */
export function formatUsage(infos: UsageInfo[]): string {
	if (infos.length === 0) {
		return "No configured providers support usage reporting.";
	}

	const lines: string[] = [];

	for (const info of infos) {
		lines.push(`${info.provider} (${info.level})`);

		if (info.tokenLimit) {
			const tl = info.tokenLimit;
			const resetStr = tl.nextResetTime.toLocaleString();
			const bar = renderBar(tl.percentage, 20);

			lines.push(`  Token limit: ${bar} ${tl.percentage}%`);
			lines.push(`  Resets:      ${resetStr}`);

			if (tl.usageDetails.length > 0) {
				const activeDetails = tl.usageDetails.filter((d) => d.usage > 0);
				if (activeDetails.length > 0) {
					lines.push("  Breakdown:");
					for (const d of activeDetails) {
						lines.push(`    ${d.modelCode}: ${d.usage}`);
					}
				}
			}
		} else {
			lines.push("  No token limit data available.");
		}
	}

	return lines.join("\n");
}

function renderBar(percentage: number, width: number): string {
	const filled = Math.round((percentage / 100) * width);
	const empty = width - filled;
	return `[${"\u2588".repeat(filled)}${"\u2591".repeat(empty)}]`;
}
