/// <reference path="../../../opentui-jsx.d.ts" />

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fuzzyFilter } from "../utils/fuzzy.js";
import { colors } from "./colors.js";

// ============================================================================
// Types
// ============================================================================

interface ModelOption {
	provider: string;
	id: string;
	label: string;
}

interface ModelPickerProps {
	models: ModelOption[];
	currentModelId: string;
	onSelect: (provider: string, modelId: string) => void;
	onCancel: () => void;
	width?: number;
	maxHeight?: number;
}

// ============================================================================
// Grouped model list with fuzzy search
// ============================================================================

interface Group {
	provider: string;
	models: ModelOption[];
}

function groupModels(models: ModelOption[]): Group[] {
	const map = new Map<string, ModelOption[]>();
	for (const m of models) {
		let list = map.get(m.provider);
		if (!list) {
			list = [];
			map.set(m.provider, list);
		}
		list.push(m);
	}
	const groups: Group[] = [];
	for (const [provider, list] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		list.sort((x, y) => x.id.localeCompare(y.id));
		groups.push({ provider, models: list });
	}
	return groups;
}

interface HeaderRow {
	kind: "header";
	provider: string;
}

interface ModelRow {
	kind: "model";
	provider: string;
	modelId: string;
	label: string;
	isCurrent: boolean;
}

type Row = HeaderRow | ModelRow;

function buildRows(groups: Group[], currentModelId: string): Row[] {
	const rows: Row[] = [];
	for (const g of groups) {
		rows.push({ kind: "header", provider: g.provider });
		for (const m of g.models) {
			rows.push({
				kind: "model",
				provider: m.provider,
				modelId: m.id,
				label: m.label,
				isCurrent: m.id === currentModelId,
			});
		}
	}
	return rows;
}

function truncate(text: string, maxWidth: number): string {
	if (text.length <= maxWidth) return text;
	return `${text.slice(0, maxWidth - 1)}\u2026`;
}

// ============================================================================
// Model Picker Component
// ============================================================================

export function ModelPicker({
	models,
	currentModelId,
	onSelect,
	onCancel: _onCancel,
	width = 60,
	maxHeight = 20,
}: ModelPickerProps): React.ReactNode {
	const { height: termHeight } = useTerminalDimensions();
	const [query, setQuery] = useState("");
	const [selectedIdx, setSelectedIdx] = useState(0);
	const inputRef = useRef<any>(null);
	const [scrollOffset, setScrollOffset] = useState(0);

	// Filter models by fuzzy search
	const filteredModels = useMemo(() => {
		if (!query.trim()) return models;
		return fuzzyFilter(models, query, (m) => `${m.provider}/${m.id} ${m.label}`);
	}, [models, query]);

	// Group filtered models
	const groups = useMemo(() => groupModels(filteredModels), [filteredModels]);

	// Build flat rows
	const rows = useMemo(() => buildRows(groups, currentModelId), [groups, currentModelId]);

	// Find initial selection: current model, or first model row
	const initialModelIdx = useMemo(() => {
		const cur = rows.findIndex((r) => r.kind === "model" && r.modelId === currentModelId);
		if (cur >= 0) return cur;
		const first = rows.findIndex((r) => r.kind === "model");
		return first >= 0 ? first : 0;
	}, [rows, currentModelId]);

	// On mount, set initial selection
	useEffect(() => {
		setSelectedIdx(initialModelIdx);
	}, [initialModelIdx]);

	// Reset selection and scroll when query changes
	useEffect(() => {
		const first = rows.findIndex((r) => r.kind === "model");
		setSelectedIdx(first >= 0 ? first : 0);
		setScrollOffset(0);
	}, [rows.findIndex]);

	// Find next/prev model row from current position
	const findNextModel = useCallback(
		(from: number, direction: 1 | -1): number => {
			let i = from + direction;
			while (i >= 0 && i < rows.length) {
				if (rows[i]?.kind === "model") return i;
				i += direction;
			}
			return from;
		},
		[rows],
	);

	// Keyboard navigation for model list.
	// Note: escape and ctrl+c are handled by the parent's useKeyboard.
	useKeyboard((event) => {
		switch (event.name) {
			case "up": {
				const next = findNextModel(selectedIdx, -1);
				setSelectedIdx(next);
				if (next < scrollOffset) {
					setScrollOffset(next);
				}
				return;
			}
			case "down": {
				const next = findNextModel(selectedIdx, 1);
				setSelectedIdx(next);
				const bottomEdge = scrollOffset + listHeight - 1;
				if (next > bottomEdge) {
					setScrollOffset(next - listHeight + 1);
				}
				return;
			}
			case "return":
			case "enter": {
				const row = rows[selectedIdx];
				if (row && row.kind === "model") {
					onSelect(row.provider, row.modelId);
				}
				return;
			}
		}
	});

	const listHeight = Math.min(rows.length, maxHeight - 6);
	const contentWidth = width - 4; // padding + border

	// Only show rows visible in the current scroll viewport
	const visibleRows = useMemo(() => {
		return rows.slice(scrollOffset, scrollOffset + listHeight);
	}, [rows, scrollOffset, listHeight]);

	// Compute visible offset relative to full rows array
	const visBase = scrollOffset;

	// Keep input focused for search typing
	useEffect(() => {
		if (inputRef.current) {
			inputRef.current.focus();
		}
	}, []);

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

			{/* Picker panel at the top */}
			<box
				style={{
					position: "absolute",
					top: 0,
					left: Math.max(0, Math.floor((process.stdout.columns - width) / 2)),
					flexDirection: "column",
					paddingLeft: 1,
					paddingRight: 1,
					paddingTop: 1,
					paddingBottom: 1,
					border: true,
					borderStyle: "single",
					borderColor: colors.borderAccent,
					backgroundColor: "black",
					width,
					zIndex: 101,
				}}
			>
				{/* Title */}
				<text fg={colors.accent}>
					<strong>Select a model</strong>
				</text>

				{/* Search input */}
				<box style={{ flexDirection: "row", marginTop: 1, gap: 1 }}>
					<text fg={colors.muted}>{"Search:"}</text>
					<input
						ref={inputRef}
						focused={true}
						value={query}
						placeholder="Type to filter..."
						onInput={(val: string) => {
							setQuery(val);
						}}
						style={{ width: contentWidth - 9 }}
					/>
				</box>

				{/* Divider */}
				<text fg={colors.darkGray}>{"─".repeat(contentWidth)}</text>

				{/* Model list — plain box, manual scroll window */}
				<box
					style={{
						height: listHeight,
						width: contentWidth,
						flexDirection: "column",
						overflow: "hidden",
					}}
				>
					{rows.length === 0 ? (
						<text fg={colors.muted}>{"No models match your search."}</text>
					) : (
						visibleRows.map((row, i) => {
							const idx = visBase + i;
							if (row.kind === "header") {
								return (
									<box key={`h-${row.provider}`} style={{ flexDirection: "row", height: 1 }}>
										<text fg={colors.accent}>
											<strong>{row.provider}</strong>
										</text>
									</box>
								);
							}

							const isSelected = idx === selectedIdx;
							const prefix = isSelected ? "> " : "  ";
							const badges: string[] = [];
							if (row.isCurrent) badges.push("current");
							const suffix = badges.length > 0 ? ` (${badges.join(", ")})` : "";
							const label = truncate(`${prefix}${row.modelId}${suffix}`, contentWidth);

							return (
								<box key={`m-${row.provider}-${row.modelId}`} style={{ flexDirection: "row", height: 1 }}>
									<text
										fg={isSelected ? colors.text : colors.muted}
										bg={isSelected ? colors.selectionBg : undefined}
									>
										{label}
									</text>
								</box>
							);
						})
					)}
				</box>

				{/* Footer hint */}
				<text fg={colors.muted}>{"Enter to select · Esc to cancel · ↑↓ navigate"}</text>
			</box>
		</box>
	);
}
