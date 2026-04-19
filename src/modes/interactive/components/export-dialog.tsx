/// <reference path="../../../opentui-jsx.d.ts" />

import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import { colors } from "./colors.js";

export type ExportFormat = "md" | "html" | "jsonl";

interface ExportDialogProps {
	onExport: (format: ExportFormat, path: string) => void;
	onCancel: () => void;
}

const FORMAT_OPTIONS: { value: ExportFormat; label: string; description: string }[] = [
	{ value: "md", label: "Markdown (.md)", description: "Plain text with formatting" },
	{ value: "html", label: "HTML (.html)", description: "Styled, self-contained web page" },
	{ value: "jsonl", label: "JSONL (.jsonl)", description: "Raw session data" },
];

function FormatSelection({ selectedIdx }: { selectedIdx: number }): React.ReactNode {
	return (
		<box style={{ flexDirection: "column" }}>
			<text fg={colors.accent}>
				<strong>{"Export session"}</strong>
			</text>
			<text fg={colors.muted}>{"Choose format:"}</text>
			<box style={{ height: 1 }} />
			{FORMAT_OPTIONS.map((opt, i) => (
				<box key={opt.value} style={{ flexDirection: "row", gap: 1 }}>
					<text fg={i === selectedIdx ? colors.accent : colors.dimGray}>{i === selectedIdx ? " > " : "   "}</text>
					<text fg={i === selectedIdx ? colors.text : colors.muted}>{opt.label}</text>
					{i === selectedIdx ? <text fg={colors.dimGray}>{` - ${opt.description}`}</text> : null}
				</box>
			))}
			<box style={{ height: 1 }} />
			<text fg={colors.darkGray}>{"Enter to select, Esc to cancel"}</text>
		</box>
	);
}

function PathInput({
	formatLabel,
	pathValue,
	onPathChange,
}: {
	formatLabel: string;
	pathValue: string;
	onPathChange: (val: string) => void;
}): React.ReactNode {
	return (
		<box style={{ flexDirection: "column" }}>
			<text fg={colors.accent}>
				<strong>{`Export as ${formatLabel}`}</strong>
			</text>
			<box style={{ height: 1 }} />
			<box style={{ flexDirection: "row", gap: 1 }}>
				<text fg={colors.muted}>{"Path:"}</text>
				<input
					focused={true}
					value={pathValue}
					placeholder="output file path..."
					onInput={onPathChange}
					style={{ width: 42 }}
				/>
			</box>
			<box style={{ height: 1 }} />
			<text fg={colors.darkGray}>{"Enter to export, Esc to go back"}</text>
		</box>
	);
}

export function ExportDialog({ onExport, onCancel }: ExportDialogProps): React.ReactNode {
	const [phase, setPhase] = useState<"format" | "path">("format");
	const [selectedIdx, setSelectedIdx] = useState(0);
	const [pathValue, setPathValue] = useState("");
	const phaseRef = useRef(phase);
	const selectedIdxRef = useRef(selectedIdx);
	const pathRef = useRef(pathValue);

	phaseRef.current = phase;
	selectedIdxRef.current = selectedIdx;
	pathRef.current = pathValue;

	const switchToPath = useCallback(() => {
		const format = FORMAT_OPTIONS[selectedIdxRef.current].value;
		const ext = format === "md" ? ".md" : format === "html" ? ".html" : ".jsonl";
		setPathValue(`hawcode-export${ext}`);
		setPhase("path");
	}, []);

	useKeyboard((key: KeyEvent) => {
		if (phaseRef.current === "format") {
			switch (key.name) {
				case "escape":
					onCancel();
					return;
				case "up":
					setSelectedIdx((i) => Math.max(0, i - 1));
					return;
				case "down":
					setSelectedIdx((i) => Math.min(FORMAT_OPTIONS.length - 1, i + 1));
					return;
				case "return":
				case "enter":
					switchToPath();
					return;
			}
		} else {
			switch (key.name) {
				case "escape":
					setPhase("format");
					return;
				case "return":
				case "enter": {
					const format = FORMAT_OPTIONS[selectedIdxRef.current].value;
					const path = pathRef.current.trim();
					if (path) {
						onExport(format, path);
					}
					return;
				}
			}
		}
	});

	const width = 56;

	return (
		<box
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				width: "100%",
				height: "100%",
				flexDirection: "column",
				zIndex: 200,
			}}
		>
			{/* Dimmed backdrop */}
			<box
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: "100%",
					height: "100%",
					backgroundColor: "black",
					opacity: 0.6,
				}}
			/>

			{/* Dialog panel — centered */}
			<box
				style={{
					position: "absolute",
					top: Math.floor((process.stdout.rows ?? 24) / 2) - 6,
					left: Math.max(0, Math.floor(((process.stdout.columns ?? 80) - width) / 2)),
					width,
					flexDirection: "column",
					paddingLeft: 1,
					paddingRight: 1,
					paddingTop: 1,
					paddingBottom: 1,
					border: true,
					borderStyle: "rounded",
					borderColor: colors.borderAccent,
					backgroundColor: "black",
					zIndex: 201,
				}}
			>
				{phase === "format" ? (
					<FormatSelection selectedIdx={selectedIdx} />
				) : (
					<PathInput
						formatLabel={FORMAT_OPTIONS[selectedIdx].label}
						pathValue={pathValue}
						onPathChange={(val: string) => setPathValue(val)}
					/>
				)}
			</box>
		</box>
	);
}
