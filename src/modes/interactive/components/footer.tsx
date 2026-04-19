import { useTerminalDimensions } from "@opentui/react";
import type React from "react";
import { useEffect, useState } from "react";
import type { AgentSession } from "../../../core/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.js";
import type { LspStatusPart } from "../../../core/lsp/lsp-manager.js";
import { colors, contextColor } from "./colors.js";
import { WaveSpinner } from "./wave-spinner.js";

export interface StatusHeaderProps {
	session: AgentSession;
	footerData: ReadonlyFooterDataProvider;
	width?: number;
	isLoading?: boolean;
}

function formatTokens(count: number): string {
	if (count < 1000) return String(count);
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function StatusHeader({ session, footerData, width, isLoading }: StatusHeaderProps): React.ReactNode {
	const { width: termWidth } = useTerminalDimensions();
	const effectiveWidth = width ?? termWidth;
	const state = session.state;
	const modelName = state.model?.id ?? "no-model";

	let thinkingInfo = "";
	if (state.model?.reasoning) {
		const level = state.thinkingLevel ?? "off";
		thinkingInfo = level === "off" ? "thinking off" : level;
	}

	const providerPart = state.model && footerData.getAvailableProviderCount() > 1 ? `(${state.model.provider}) ` : "";
	const thinkingPart = thinkingInfo ? ` | ${thinkingInfo}` : "";

	return (
		<box justifyContent="space-between" width={effectiveWidth} paddingLeft={1} paddingRight={1}>
			<box flexDirection="row" gap={1}>
				{isLoading ? <WaveSpinner /> : null}
				<text fg={colors.muted}>{`${providerPart}${modelName}${thinkingPart}`}</text>
			</box>
		</box>
	);
}

export interface FooterProps {
	session: AgentSession;
	footerData: ReadonlyFooterDataProvider;
	autoCompactEnabled: boolean;
	width?: number;
}

function formatLspChip(part: LspStatusPart): string {
	const label = part.category === "lint" ? "lint" : "lsp";
	return `${label}:${part.id}`;
}

export function Footer({ session, footerData, autoCompactEnabled, width }: FooterProps): React.ReactNode {
	const { width: termWidth } = useTerminalDimensions();
	const effectiveWidth = width ?? termWidth;
	const state = session.state;

	const [lspParts, setLspParts] = useState<readonly LspStatusPart[]>(footerData.getLspStatusParts());
	const [lspEnabled, setLspEnabled] = useState(footerData.isLspEnabled());

	useEffect(() => {
		setLspParts(footerData.getLspStatusParts());
		setLspEnabled(footerData.isLspEnabled());
		return footerData.onLspStatusChange(() => {
			setLspParts(footerData.getLspStatusParts());
			setLspEnabled(footerData.isLspEnabled());
		});
	}, [footerData]);

	let pwd = session.sessionManager.getCwd();
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	if (home && pwd.startsWith(home)) {
		pwd = `~${pwd.slice(home.length)}`;
	}

	const branch = footerData.getGitBranch();
	if (branch) pwd = `${pwd} (${branch})`;

	const sessionName = session.sessionManager.getSessionName();
	if (sessionName) pwd = `${pwd} \u2022 ${sessionName}`;

	const contextUsage = session.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
	const contextPercentValue = contextUsage?.percent ?? 0;
	const contextPercent =
		contextUsage?.percent !== null && contextUsage?.percent !== undefined ? contextPercentValue.toFixed(1) : "?";

	const autoIndicator = autoCompactEnabled ? " (auto)" : "";
	const contextDisplay =
		contextPercent === "?"
			? `?/${formatTokens(contextWindow)}${autoIndicator}`
			: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;

	const ctxColor = contextColor(contextPercentValue);

	// Left side: pwd immediately followed by LSP/lint name chips (names only, no counts —
	// per-file error/warning counts appear under the edit/write tool widget instead).
	const leftChildren: React.ReactNode[] = [
		<text key="pwd" fg={colors.muted}>
			{pwd}
		</text>,
	];
	if (!lspEnabled) {
		leftChildren.push(
			<text key="lsp-off" fg={colors.muted}>
				lsp:off
			</text>,
		);
	} else {
		for (const part of lspParts) {
			leftChildren.push(
				<text key={`lsp-${part.id}`} fg={colors.accent}>
					{formatLspChip(part)}
				</text>,
			);
		}
	}

	return (
		<box justifyContent="space-between" width={effectiveWidth} paddingLeft={1} paddingRight={1}>
			<box flexDirection="row" gap={2}>
				{leftChildren}
			</box>
			<text fg={ctxColor ?? colors.muted}>{contextDisplay}</text>
		</box>
	);
}
