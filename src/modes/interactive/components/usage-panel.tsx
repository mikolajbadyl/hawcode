import type React from "react";
import type { UsageInfo } from "../../../core/usage-fetcher.js";
import { colors } from "./colors.js";

interface UsagePanelProps {
	usageInfos: UsageInfo[];
	onClose: () => void;
	width: number;
	height: number;
}

export function UsagePanel({ usageInfos, width }: UsagePanelProps): React.ReactNode {
	if (usageInfos.length === 0) {
		return (
			<box style={{ paddingLeft: 2 }}>
				<text fg={colors.muted}>{"No providers support usage reporting."}</text>
			</box>
		);
	}

	const lines: string[] = [];

	for (const info of usageInfos) {
		if (!info.tokenLimit) continue;
		const tl = info.tokenLimit;
		const barW = Math.min(20, width - 30);
		const filled = Math.round((tl.percentage / 100) * barW);
		const bar = "\u2588".repeat(filled) + "\u2591".repeat(barW - filled);
		const reset = formatReset(tl.nextResetTime);

		lines.push(`${info.provider} (${info.level})  [${bar}] ${tl.percentage}%  resets ${reset}`);
	}

	if (lines.length === 0) {
		return (
			<box style={{ paddingLeft: 2 }}>
				<text fg={colors.muted}>{"No usage data."}</text>
			</box>
		);
	}

	return (
		<box style={{ flexDirection: "column", paddingLeft: 2 }}>
			{lines.map((line, i) => (
				<text key={i} fg={colors.muted}>
					{line}
				</text>
			))}
		</box>
	);
}

function formatReset(date: Date): string {
	const diffMs = date.getTime() - Date.now();
	if (diffMs <= 0) return "now";
	const h = Math.floor(diffMs / 3600000);
	const m = Math.floor((diffMs % 3600000) / 60000);
	if (h > 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
	if (h > 0) return `in ${h}h ${m}m`;
	return `in ${m}m`;
}
