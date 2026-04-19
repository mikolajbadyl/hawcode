import { diffLines } from "diff";
import type React from "react";
import { getToolTuiMetaMap } from "../../../core/tools/tool-registry.js";
import { colors } from "./colors.js";
import { MarkdownWidget } from "./markdown-widget.js";

interface ToolExecutionProps {
	toolName: string;
	input: string;
	args?: any;
	output?: string;
	partialOutput?: string;
	isRunning?: boolean;
	isError?: boolean;
	expanded?: boolean;
	width?: number;
	cwd?: string;
	/** LSP/lint diagnostic summary for this tool call (edit/write). Empty means clean. */
	lspDiagnostics?: { errors: number; warnings: number; lines: string[] };
}

// All TUI metadata comes from the tool registry (built-in + dynamic tools like task_*).
const TUI_META = getToolTuiMetaMap();

const TOOL_COLORS: Record<string, string> = Object.fromEntries(
	[...TUI_META.entries()].map(([name, m]) => [name, m.color]),
);

const TOOL_ICONS: Record<string, string> = Object.fromEntries(
	[...TUI_META.entries()].map(([name, m]) => [name, m.icon]),
);

const TOOL_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
	[...TUI_META.entries()].map(([name, m]) => [name, m.displayName]),
);

const BASH_TAIL_LINES = 5;
const CONTENT_MAX_LINES = 15;
const CONTENT_MAX_LINES_EXPANDED = 100;

/**
 * Make an absolute path relative to cwd if it's within the project tree.
 */
function relativizePath(rawPath: string, cwd: string | undefined): string {
	if (!cwd || !rawPath) return rawPath;
	if (!rawPath.startsWith("/")) return rawPath;
	const normCwd = cwd.endsWith("/") ? cwd : `${cwd}/`;
	if (rawPath.startsWith(normCwd)) {
		return rawPath.slice(normCwd.length);
	}
	if (rawPath === cwd) return ".";
	return rawPath;
}

/**
 * Calculate the minimum indentation (leading tabs/spaces) across non-empty lines.
 */
function getMinIndent(lines: string[]): number {
	let min = Infinity;
	for (const line of lines) {
		if (line.trim().length === 0) continue;
		const indent = line.match(/^[\t ]*/)?.[0]?.length ?? 0;
		if (indent < min) min = indent;
	}
	return min === Infinity ? 0 : min;
}

/**
 * Remove common leading indentation so at least one line touches the left edge.
 */
function dedentLines(lines: string[]): string[] {
	const min = getMinIndent(lines);
	if (min === 0) return lines;
	return lines.map((line) => (line.trim().length === 0 ? line.trim() : line.slice(min)));
}

/**
 * Parse a line of text and render inline markdown formatting as OpenTUI React nodes.
 * Supports: `code`, **bold**, and combines both.
 */
function _renderMarkdownLine(text: string, keyPrefix: string, baseColor?: string): React.ReactNode[] {
	const nodes: React.ReactNode[] = [];
	// Match patterns: `code`, **bold**, ***bold italic*** (order matters)
	const pattern = /(`+)(.+?)\1|(\*\*\*)(.+?)\3|(\*\*)(.+?)\5/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(text)) !== null) {
		// Text before this match
		if (match.index > lastIndex) {
			const before = text.slice(lastIndex, match.index);
			nodes.push(
				<text key={`${keyPrefix}-t-${lastIndex}`} fg={baseColor}>
					{before}
				</text>,
			);
		}

		if (match[1]) {
			// `code` - match[2]
			nodes.push(
				<text key={`${keyPrefix}-c-${match.index}`} fg={colors.mdCode}>
					<strong>{match[2]}</strong>
				</text>,
			);
		} else if (match[3]) {
			// ***bold italic*** - match[4]
			nodes.push(
				<text key={`${keyPrefix}-bi-${match.index}`} fg={colors.syntaxKeyword}>
					<strong>{match[4]}</strong>
				</text>,
			);
		} else if (match[5]) {
			// **bold** - match[6]
			nodes.push(
				<text key={`${keyPrefix}-b-${match.index}`} fg={colors.syntaxKeyword}>
					<strong>{match[6]}</strong>
				</text>,
			);
		}

		lastIndex = match.index + match[0].length;
	}

	// Remaining text after last match
	if (lastIndex < text.length) {
		nodes.push(
			<text key={`${keyPrefix}-end-${lastIndex}`} fg={baseColor}>
				{text.slice(lastIndex)}
			</text>,
		);
	}

	return nodes.length > 0 ? nodes : [<text key={`${keyPrefix}-empty`}>{text}</text>];
}

/**
 * Build the inline argument summary shown next to the tool name on the title line.
 */
function formatInlineArgs(
	toolName: string,
	args: any | undefined,
	input: string,
	_maxLen: number,
	cwd: string | undefined,
): string {
	if (!args) return input;

	switch (toolName) {
		case "read": {
			if (args.path) {
				let s = relativizePath(String(args.path), cwd);
				if (args.offset || args.limit) {
					const parts: string[] = [];
					if (args.offset) parts.push(`offset=${args.offset}`);
					if (args.limit) parts.push(`limit=${args.limit}`);
					s += ` (${parts.join(", ")})`;
				}
				return s;
			}
			return input;
		}
		case "bash": {
			if (args.command) {
				let s = String(args.command);
				if (args.timeout) s += ` (timeout: ${args.timeout}s)`;
				return s;
			}
			return input;
		}
		case "write":
		case "edit": {
			if (args.path) return relativizePath(String(args.path), cwd);
			if (args.file_path) return relativizePath(String(args.file_path), cwd);
			return input;
		}
		case "search": {
			const parts: string[] = [];
			if (args.pattern) parts.push(`/${args.pattern}/`);
			const p = args.path ? relativizePath(String(args.path), cwd) : ".";
			parts.push(`in ${p}`);
			if (args.glob) parts.push(`(${args.glob})`);
			return parts.join(" ");
		}
		case "find": {
			const parts: string[] = [];
			if (args.pattern) parts.push(String(args.pattern));
			const p = args.path ? relativizePath(String(args.path), cwd) : ".";
			parts.push(`in ${p}`);
			return parts.join(" ");
		}
		case "glob": {
			const parts: string[] = [];
			const pat = args.pattern;
			const patStr = Array.isArray(pat) ? pat.map((x) => `'${x}'`).join(", ") : pat != null ? `'${pat}'` : "";
			if (patStr) parts.push(patStr);
			const p = args.path ? relativizePath(String(args.path), cwd) : ".";
			parts.push(`in ${p}`);
			const flags: string[] = [];
			if (args.type && args.type !== "files") flags.push(String(args.type));
			if (args.sort && args.sort !== "mtime") flags.push(`sort:${args.sort}`);
			if (args.dot) flags.push("dot");
			if (args.ignoreDefaults === false) flags.push("no-defaults");
			if (args.respectGitignore === false) flags.push("no-gitignore");
			if (args.limit) flags.push(`limit=${args.limit}`);
			if (flags.length) parts.push(`(${flags.join(", ")})`);
			return parts.join(" ");
		}
		case "ls": {
			return args.path ? relativizePath(String(args.path), cwd) : ".";
		}
		case "websearch": {
			if (args.query) return String(args.query);
			return input;
		}
		case "docsfetch": {
			const lib = args.libraryName ? String(args.libraryName) : "";
			const q = args.query ? String(args.query) : "";
			return `${lib}${q ? ` — ${q}` : ""}`;
		}
		case "task_create":
			return "";
		case "task_update":
			return "";
		case "task_get":
			return args.id !== undefined ? `#${args.id}` : input;
		case "task_list":
			return "";
		default:
			return input;
	}
}

/**
 * Count the number of visual lines a logical line will occupy
 * when rendered within a given content width, accounting for wrapping.
 * Empty string counts as 1 visual line.
 */
function countVisualLines(line: string, contentWidth: number): number {
	if (contentWidth <= 0) return 1;
	const len = line.length;
	if (len === 0) return 1;
	return Math.ceil(len / contentWidth);
}

/**
 * Build a tail preview of streaming output (last N visual lines including wrapping).
 * While running, the box reserves `tailLines` height so streaming output fills
 * the space in place; after completion the box shrinks to actual content size.
 */
function buildStreamingPreview(
	displayOutput: string,
	expanded: boolean,
	width: number | undefined,
	isRunning: boolean | undefined,
	tailLines: number,
	borderColor: string,
): React.ReactNode {
	const hasOutput = displayOutput.length > 0;
	const lines = hasOutput ? displayOutput.trimEnd().split("\n") : [];
	const maxVisualLines = expanded ? 50 : tailLines;
	// Content area: width minus left border (1) and left padding (2)
	const contentWidth = width ? Math.max(width - 3, 20) : Infinity;

	// Count visual lines from the bottom up to find how many logical lines to keep
	let visualCount = 0;
	let cutIndex = lines.length;
	for (let i = lines.length - 1; i >= 0; i--) {
		const vl = countVisualLines(lines[i]!, contentWidth);
		if (visualCount + vl > maxVisualLines) {
			break;
		}
		visualCount += vl;
		cutIndex = i;
	}

	const tailLinesArr = lines.slice(cutIndex);
	const skippedVisual = lines.slice(0, cutIndex).reduce((sum, l) => sum + countVisualLines(l, contentWidth), 0);

	const reserve = isRunning && !expanded;

	return (
		<box
			style={{
				flexDirection: "column",
				paddingLeft: 1,
				borderColor,
				borderStyle: "single",
				border: ["left"],
				...(reserve ? { minHeight: tailLines } : {}),
			}}
		>
			{skippedVisual > 0 ? <text fg={colors.muted}>... ({String(skippedVisual)} earlier lines)</text> : undefined}
			{reserve && !hasOutput ? (
				<text fg={colors.muted}>
					<em>running...</em>
				</text>
			) : undefined}
			{tailLinesArr.map((line, idx) => (
				<text key={`sl-${idx}`} fg={colors.text}>
					{line}
				</text>
			))}
		</box>
	);
}

/**
 * Build the write tool content preview with dedentation.
 */
function buildWritePreview(args: any, expanded: boolean): React.ReactNode {
	const content = typeof args.content === "string" ? args.content : "";
	const allLines = content.split("\n");
	if (allLines.length > 0 && allLines[allLines.length - 1] === "") allLines.pop();
	if (allLines.length === 0) return null;

	const maxLines = expanded ? CONTENT_MAX_LINES_EXPANDED : CONTENT_MAX_LINES;
	const dedented = dedentLines(allLines);
	const visibleLines = dedented.slice(0, maxLines);
	const remaining = dedented.length - maxLines;

	return (
		<box
			style={{
				flexDirection: "column",
				paddingLeft: 1,
				borderColor: colors.green,
				borderStyle: "single",
				border: ["left"],
			}}
		>
			{visibleLines.map((line, idx) => (
				<text key={`w-${idx}`} fg={colors.text} bg={colors.toolDiffAdded}>
					{line}
				</text>
			))}
			{remaining > 0 ? (
				<text fg={colors.muted}>
					... ({String(remaining)} more lines, {String(dedented.length)} total)
				</text>
			) : undefined}
		</box>
	);
}

/**
 * Build the edit tool diff preview with dedentation per edit chunk.
 */
function buildEditPreview(args: any, expanded: boolean): React.ReactNode {
	const diffElements: React.ReactNode[] = [];
	let linesCount = 0;
	const maxLines = expanded ? CONTENT_MAX_LINES_EXPANDED : CONTENT_MAX_LINES;

	outer: for (let i = 0; i < args.edits.length; i++) {
		const edit = args.edits[i];
		const chunks = diffLines(edit.oldText || "", edit.newText || "");
		for (let j = 0; j < chunks.length; j++) {
			const chunk = chunks[j];
			if (!chunk) continue;
			let lines = chunk.value.split("\n");
			if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
			if (lines.length === 0) continue;

			// Dedent the chunk lines
			lines = dedentLines(lines);

			const bgColor = chunk.added ? colors.toolDiffAdded : chunk.removed ? colors.toolDiffRemoved : undefined;
			const fgColor = chunk.added || chunk.removed ? colors.text : colors.gray;

			let visibleLines = lines;
			let truncated = false;
			if (linesCount + lines.length > maxLines) {
				visibleLines = lines.slice(0, Math.max(0, maxLines - linesCount));
				truncated = true;
			}

			if (visibleLines.length > 0) {
				diffElements.push(
					<text key={`${i}-${j}`} fg={fgColor} bg={bgColor}>
						{visibleLines.join("\n")}
					</text>,
				);
			}

			linesCount += visibleLines.length;
			if (truncated || linesCount >= maxLines) {
				diffElements.push(
					<text key={`trunc-${i}-${j}`} fg={colors.muted}>
						...
					</text>,
				);
				break outer;
			}
		}
	}

	if (diffElements.length === 0) return null;

	return (
		<box
			style={{
				flexDirection: "column",
				paddingLeft: 1,
				borderColor: colors.yellow,
				borderStyle: "single",
				border: ["left"],
			}}
		>
			{diffElements}
		</box>
	);
}

/**
 * Extract a one-line result summary for tools that shouldn't show full output.
 * Search: counts match lines (file:line: content) and unique files
 * Websearch: "Found X results" or "No results found."
 */
function extractResultSummary(toolName: string, displayOutput: string): string | null {
	if (!displayOutput) return null;

	if (toolName === "search" || toolName === "find") {
		if (displayOutput.trim() === "No matches found") return "No matches found";

		const lines = displayOutput.split("\n");
		// Match lines have format "path:lineNumber: content" or "path-lineNumber- content"
		const matchLines = lines.filter((l) => /^\S+:\d+[: -]/.test(l));
		const files = new Set<string>();
		for (const line of matchLines) {
			const colonIdx = line.indexOf(":");
			if (colonIdx > 0) files.add(line.slice(0, colonIdx));
		}
		const matchCount = matchLines.length;
		const fileCount = files.size;
		if (matchCount === 0) return null;
		return `${matchCount} match${matchCount !== 1 ? "es" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""}`;
	}

	if (toolName === "websearch") {
		const lines = displayOutput.split("\n");
		const summary = lines.find((l) => l.includes("Found") && l.includes("result"));
		return summary ?? null;
	}

	if (toolName === "glob") {
		try {
			const parsed = JSON.parse(displayOutput);
			const count: number = typeof parsed.count === "number" ? parsed.count : (parsed.paths?.length ?? 0);
			if (count === 0) return "No files found";
			const suffix = parsed.truncated ? " (truncated)" : "";
			return `${count} file${count !== 1 ? "s" : ""}${suffix}`;
		} catch {
			return null;
		}
	}

	return null;
}

/**
 * Build generic output using <markdown> component (for docsfetch, read, etc).
 */
function buildFormattedOutput(
	displayOutput: string,
	expanded: boolean,
	isError: boolean,
	width?: number,
): React.ReactNode {
	if (isError) {
		const lines = displayOutput.split("\n");
		const maxLines = expanded ? 50 : 8;
		const visibleLines = lines.slice(0, maxLines);
		const remaining = lines.length - maxLines;
		return (
			<box style={{ flexDirection: "column", paddingLeft: 1 }}>
				{visibleLines.map((line, idx) => (
					<text key={`o-${idx}`} fg={colors.error}>
						{line}
					</text>
				))}
				{remaining > 0 ? (
					<text fg={colors.muted}>{String(remaining)} more lines (Ctrl+E to expand)</text>
				) : undefined}
			</box>
		);
	}

	const lines = displayOutput.split("\n");
	const maxLines = expanded ? 50 : 15;
	const truncatedOutput =
		lines.length > maxLines
			? `${lines.slice(0, maxLines).join("\n")}\n\n... (${String(lines.length - maxLines)} more lines, Ctrl+E to expand)`
			: displayOutput;

	return (
		<box style={{ paddingLeft: 1 }}>
			<MarkdownWidget content={truncatedOutput} width={width ? width - 4 : undefined} />
		</box>
	);
}

interface ParsedTask {
	status: "pending" | "in_progress" | "completed";
	id: string;
	title: string;
}

function parseTaskLine(line: string): ParsedTask | null {
	const match = line.match(/^\s*\[([ >x])\]\s+(\d+)\.\s+(.+?)(?:\s+\(\w+\))?$/);
	if (!match) return null;
	const statusChar = match[1];
	const status = statusChar === "x" ? "completed" : statusChar === ">" ? "in_progress" : "pending";
	return { status, id: match[2]!, title: match[3]! };
}

function TaskRow({ task }: { task: ParsedTask }): React.ReactNode {
	const icon = task.status === "completed" ? "\u2713" : task.status === "in_progress" ? "\u25B6" : "\u25A1"; // ✓ ▶ □
	const fg =
		task.status === "completed" ? colors.dimGray : task.status === "in_progress" ? colors.yellow : colors.muted;
	const titleFg = task.status === "completed" ? colors.dimGray : colors.text;
	return (
		<box style={{ flexDirection: "row", gap: 1 }}>
			<text fg={fg}>{icon}</text>
			<text fg={colors.dimGray}>{task.id}.</text>
			<text fg={titleFg}>{task.title}</text>
		</box>
	);
}

function buildTaskWidget(output: string, toolName?: string): React.ReactNode {
	const tasks = output
		.split("\n")
		.map(parseTaskLine)
		.filter((t): t is ParsedTask => t !== null);
	if (tasks.length === 0) return null;

	// For task_update, show only the single updated task
	if (toolName === "task_update") {
		const task = tasks[0];
		if (!task) return null;
		return <TaskRow task={task} />;
	}

	return (
		<box
			style={{
				flexDirection: "column",
				paddingLeft: 1,
				borderColor: colors.accent,
				borderStyle: "single",
				border: ["left"],
			}}
		>
			{tasks.map((task) => (
				<TaskRow key={task.id} task={task} />
			))}
		</box>
	);
}

export function ToolExecution({
	toolName,
	input,
	args,
	output,
	partialOutput,
	isRunning = false,
	isError = false,
	expanded = false,
	width,
	cwd,
	lspDiagnostics,
}: ToolExecutionProps): React.ReactNode {
	const toolIcon = TOOL_ICONS[toolName] ?? "\u25CF"; // ● fallback

	let prefixIcon: string;
	let titleColor: string;
	if (isRunning) {
		prefixIcon = toolIcon;
		titleColor = colors.muted;
	} else if (isError) {
		prefixIcon = "\u2717"; // ✗
		titleColor = colors.error;
	} else {
		prefixIcon = toolIcon;
		titleColor = TOOL_COLORS[toolName] ?? colors.text;
	}

	const displayName = TOOL_DISPLAY_NAMES[toolName] || toolName;

	// For task_update, append the target status to the display name
	let effectiveDisplayName = displayName;
	if (toolName === "task_update" && args?.status) {
		effectiveDisplayName = `${displayName} ${args.status}`;
	}

	// Calculate available width for inline args (accounting for prefix + displayName)
	const availableWidth = Math.max((width ?? 80) - 10 - effectiveDisplayName.length, 20);

	const displayOutput = partialOutput ?? output;
	const inlineArgs = formatInlineArgs(toolName, args, input, availableWidth, cwd);

	// Build the appropriate content element based on tool type.
	let contentElement: React.ReactNode = null;

	const isTaskTool =
		toolName === "task_create" || toolName === "task_update" || toolName === "task_list" || toolName === "task_get";

	if (!isError && isTaskTool && displayOutput) {
		contentElement = buildTaskWidget(displayOutput, toolName);
	} else if (!isError && toolName === "write" && args?.path) {
		contentElement = buildWritePreview(args, expanded);
	} else if (!isError && toolName === "edit" && args?.edits && Array.isArray(args.edits)) {
		contentElement = buildEditPreview(args, expanded);
	} else if (toolName === "bash" && (isRunning || displayOutput)) {
		contentElement = buildStreamingPreview(
			displayOutput ?? "",
			expanded,
			width,
			isRunning,
			BASH_TAIL_LINES,
			colors.syntaxKeyword,
		);
	} else if (
		(toolName === "search" || toolName === "find" || toolName === "glob" || toolName === "websearch") &&
		displayOutput
	) {
		// Show only result count summary, no full output
		const summary = isError ? null : extractResultSummary(toolName, displayOutput);
		contentElement = summary ? <text fg={colors.muted}>{summary}</text> : null;
	} else if (
		displayOutput &&
		(isError ||
			expanded ||
			isRunning ||
			!(toolName === "read" || toolName === "write" || toolName === "websearch" || toolName === "docsfetch"))
	) {
		contentElement = buildFormattedOutput(displayOutput, expanded, isError, width);
	}

	return (
		<box style={{ flexDirection: "column", paddingLeft: 1, marginTop: 1 }}>
			{/* Title line: icon (colored on completion, gray while running) + display name + inline args */}
			<box style={{ gap: 1, flexDirection: "row", width: width ? width - 2 : undefined }}>
				<text fg={titleColor}>
					<strong>
						{prefixIcon} {effectiveDisplayName}
					</strong>
				</text>
				<text fg={colors.text} style={{ flexGrow: 1, width: availableWidth }}>
					{inlineArgs}
				</text>
			</box>

			{/* Content preview */}
			{contentElement ? <box style={{ paddingLeft: 2 }}>{contentElement}</box> : undefined}

			{isRunning && !displayOutput && !contentElement ? (
				<box style={{ paddingLeft: 2 }}>
					<text fg={colors.muted}>
						<em>running...</em>
					</text>
				</box>
			) : undefined}

			{/* LSP/lint diagnostic summary (edit/write only; shown only when there are issues) */}
			{lspDiagnostics && (lspDiagnostics.errors > 0 || lspDiagnostics.warnings > 0) ? (
				<box style={{ paddingLeft: 2, flexDirection: "column" }}>
					<text fg={lspDiagnostics.errors > 0 ? colors.error : colors.warning}>
						{lspDiagnostics.errors > 0
							? `${lspDiagnostics.errors} error${lspDiagnostics.errors > 1 ? "s" : ""}`
							: ""}
						{lspDiagnostics.errors > 0 && lspDiagnostics.warnings > 0 ? ", " : ""}
						{lspDiagnostics.warnings > 0
							? `${lspDiagnostics.warnings} warning${lspDiagnostics.warnings > 1 ? "s" : ""}`
							: ""}
					</text>
					{lspDiagnostics.lines.map((line, idx) => (
						<text key={idx} fg={colors.muted}>
							{line}
						</text>
					))}
				</box>
			) : undefined}
		</box>
	);
}
