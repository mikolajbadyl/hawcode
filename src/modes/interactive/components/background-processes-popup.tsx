/// <reference path="../../../opentui-jsx.d.ts" />

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BackgroundProcess, BackgroundProcessManager } from "../../../core/background-processes.js";
import { colors } from "./colors.js";

// ============================================================================
// Types
// ============================================================================

interface BackgroundProcessesPopupProps {
	bgManager: BackgroundProcessManager;
	onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

// Sort processes: running first, then completed/killed
function sortProcesses(processes: BackgroundProcess[]): BackgroundProcess[] {
	const statusOrder: Record<string, number> = { running: 0, completed: 1, killed: 2 };
	return [...processes].sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3));
}

function statusIcon(status: string): string {
	switch (status) {
		case "running":
			return "\u25B6";
		case "completed":
			return "\u2714";
		case "killed":
			return "\u2716";
		default:
			return "?";
	}
}

function statusColor(status: string): string {
	switch (status) {
		case "running":
			return colors.green;
		case "completed":
			return colors.muted;
		case "killed":
			return colors.red;
		default:
			return colors.muted;
	}
}

function truncate(text: string, maxWidth: number): string {
	if (text.length <= maxWidth) return text;
	return `${text.slice(0, maxWidth - 1)}\u2026`;
}

// ============================================================================
// Process List View
// ============================================================================

function ProcessList({
	processes,
	selectedIdx,
	scrollOffset,
	listHeight,
	contentWidth,
}: {
	processes: BackgroundProcess[];
	selectedIdx: number;
	scrollOffset: number;
	listHeight: number;
	contentWidth: number;
}): React.ReactNode {
	const visible = processes.slice(scrollOffset, scrollOffset + listHeight);
	const visBase = scrollOffset;

	return (
		<box style={{ height: listHeight, width: contentWidth, flexDirection: "column", overflow: "hidden" }}>
			{processes.length === 0 ? (
				<text fg={colors.muted}>{"No background processes."}</text>
			) : (
				visible.map((proc, i) => {
					const idx = visBase + i;
					const isSelected = idx === selectedIdx;
					const prefix = isSelected ? "> " : "  ";
					const icon = statusIcon(proc.status);
					const line = truncate(`${prefix}${icon} ${proc.id}  ${proc.command}`, contentWidth);
					return (
						<box key={proc.id} style={{ flexDirection: "row", height: 1 }}>
							<text
								fg={isSelected ? colors.text : statusColor(proc.status)}
								bg={isSelected ? colors.selectionBg : undefined}
							>
								{line}
							</text>
						</box>
					);
				})
			)}
		</box>
	);
}

// ============================================================================
// Process Output View
// ============================================================================

function ProcessOutput({
	proc,
	contentWidth,
	outputScroll,
	outputHeight,
}: {
	proc: BackgroundProcess;
	contentWidth: number;
	outputScroll: number;
	outputHeight: number;
}): React.ReactNode {
	const lines = proc.output.split("\n");
	const header = `${statusIcon(proc.status)} ${proc.id} | ${proc.status}${proc.exitCode !== null ? ` (exit: ${proc.exitCode})` : ""} | ${proc.command}`;
	const visibleLines = lines.slice(outputScroll, outputScroll + outputHeight);
	const lineNumWidth = String(lines.length).length;

	return (
		<box style={{ flexDirection: "column", width: contentWidth }}>
			<text fg={colors.accent}>{truncate(header, contentWidth)}</text>
			<text fg={colors.darkGray}>{"─".repeat(contentWidth)}</text>
			<box style={{ height: outputHeight, flexDirection: "column", overflow: "hidden" }}>
				{visibleLines.map((line, i) => {
					const num = outputScroll + i + 1;
					const numStr = String(num).padStart(lineNumWidth);
					return (
						<box key={`l-${i}`} style={{ flexDirection: "row", height: 1 }}>
							<text fg={colors.dimGray}>{`${numStr} `}</text>
							<text fg={colors.muted}>{truncate(line, contentWidth - lineNumWidth - 1)}</text>
						</box>
					);
				})}
			</box>
		</box>
	);
}

// ============================================================================
// Main Popup Component
// ============================================================================

export function BackgroundProcessesPopup({ bgManager, onClose }: BackgroundProcessesPopupProps): React.ReactNode {
	const { width: termWidth, height: termHeight } = useTerminalDimensions();
	const [processes, setProcesses] = useState<BackgroundProcess[]>(() => sortProcesses(bgManager.getAll()));
	const [selectedIdx, setSelectedIdx] = useState(0);
	const [scrollOffset, setScrollOffset] = useState(0);
	const [viewingOutput, setViewingOutput] = useState<string | null>(null);
	const [outputScroll, setOutputScroll] = useState(0);
	const outputScrollRef = useRef(0);
	outputScrollRef.current = outputScroll;

	const popupWidth = Math.min(termWidth - 4, 70);
	const popupHeight = viewingOutput ? Math.min(termHeight - 4, 30) : Math.min(termHeight - 4, 20);
	const contentWidth = popupWidth - 4;
	const listHeight = popupHeight - 6;
	const outputHeight = popupHeight - 6;

	// Refresh process list on change and periodically
	useEffect(() => {
		const refresh = (): void => {
			setProcesses(sortProcesses(bgManager.getAll()));
			// Auto-scroll output to bottom if viewing a running process
			if (viewingOutput) {
				const proc = bgManager.get(viewingOutput);
				if (proc && proc.status === "running") {
					const lines = proc.output.split("\n").length;
					setOutputScroll(Math.max(0, lines - outputHeight));
				}
			}
		};
		bgManager.on("change", refresh);
		const interval = setInterval(refresh, 1000);
		return () => {
			bgManager.off("change", refresh);
			clearInterval(interval);
		};
	}, [bgManager, viewingOutput, outputHeight]);

	// Reset selection when processes shrink
	useEffect(() => {
		if (selectedIdx >= processes.length && processes.length > 0) {
			setSelectedIdx(processes.length - 1);
			setScrollOffset(Math.max(0, processes.length - 10));
		}
	}, [processes.length, selectedIdx]);

	const viewingProc = viewingOutput ? bgManager.get(viewingOutput) : null;

	useKeyboard(
		useCallback(
			(event) => {
				if (event.name === "escape" || (event.ctrl && event.name === "c")) {
					if (viewingOutput) {
						setViewingOutput(null);
						setOutputScroll(0);
					} else {
						onClose();
					}
					return;
				}

				if (viewingOutput) {
					// Output view: scroll with arrows/page keys
					const outputLines = bgManager.get(viewingOutput)?.output.split("\n").length ?? 0;
					const maxScroll = Math.max(0, outputLines - outputHeight);
					if (event.name === "up") {
						setOutputScroll(Math.max(0, outputScrollRef.current - 1));
					} else if (event.name === "down") {
						setOutputScroll(Math.min(maxScroll, outputScrollRef.current + 1));
					} else if (event.name === "pageup") {
						setOutputScroll(Math.max(0, outputScrollRef.current - outputHeight));
					} else if (event.name === "pagedown") {
						setOutputScroll(Math.min(maxScroll, outputScrollRef.current + outputHeight));
					}
					return;
				}

				// Kill selected process with 'k' key
				if (event.name === "k") {
					const proc = processes[selectedIdx];
					if (proc && proc.status === "running") {
						bgManager.kill(proc.id);
						setProcesses(sortProcesses(bgManager.getAll()));
					}
					return;
				}

				// List view navigation
				if (event.name === "up") {
					const next = Math.max(0, selectedIdx - 1);
					setSelectedIdx(next);
					if (next < scrollOffset) setScrollOffset(next);
					return;
				}
				if (event.name === "down") {
					const next = Math.min(processes.length - 1, selectedIdx + 1);
					setSelectedIdx(next);
					if (next >= scrollOffset + listHeight) setScrollOffset(next - listHeight + 1);
					return;
				}
				if (event.name === "pageup") {
					const next = Math.max(0, selectedIdx - listHeight);
					setSelectedIdx(next);
					if (next < scrollOffset) setScrollOffset(next);
					return;
				}
				if (event.name === "pagedown") {
					const next = Math.min(processes.length - 1, selectedIdx + listHeight);
					setSelectedIdx(next);
					if (next >= scrollOffset + listHeight) setScrollOffset(next - listHeight + 1);
					return;
				}
				if (event.name === "return" || event.name === "enter") {
					const proc = processes[selectedIdx];
					if (proc) {
						setViewingOutput(proc.id);
						setOutputScroll(0);
					}
					return;
				}
			},
			[selectedIdx, scrollOffset, processes, listHeight, outputHeight, viewingOutput, onClose, bgManager],
		),
	);

	return (
		<box
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				width: "100%",
				height: termHeight,
				flexDirection: "column",
				zIndex: 100,
			}}
		>
			{/* Dimmed backdrop */}
			<box
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: "100%",
					height: termHeight,
					backgroundColor: "black",
					opacity: 0.6,
				}}
			/>

			{/* Panel */}
			<box
				style={{
					position: "absolute",
					top: 0,
					left: Math.max(0, Math.floor((termWidth - popupWidth) / 2)),
					flexDirection: "column",
					paddingLeft: 1,
					paddingRight: 1,
					paddingTop: 1,
					paddingBottom: 1,
					border: true,
					borderStyle: "single",
					borderColor: colors.borderAccent,
					backgroundColor: "black",
					width: popupWidth,
					height: popupHeight,
					zIndex: 101,
				}}
			>
				{/* Title */}
				<text fg={colors.accent}>
					<strong>{viewingOutput ? `Output: ${viewingOutput}` : "Background Processes"}</strong>
				</text>
				<text fg={colors.darkGray}>{"─".repeat(contentWidth)}</text>

				{viewingProc ? (
					<ProcessOutput
						proc={viewingProc}
						contentWidth={contentWidth}
						outputScroll={outputScroll}
						outputHeight={outputHeight}
					/>
				) : (
					<ProcessList
						processes={processes}
						selectedIdx={selectedIdx}
						scrollOffset={scrollOffset}
						listHeight={listHeight}
						contentWidth={contentWidth}
					/>
				)}

				{/* Footer hint */}
				<text fg={colors.muted}>
					{viewingOutput
						? "Esc back \u00B7 \u2191\u2193 PgUp/PgDn scroll"
						: "Enter view \u00B7 k kill \u00B7 Esc close \u00B7 \u2191\u2193 PgUp/PgDn"}
				</text>
			</box>
		</box>
	);
}
