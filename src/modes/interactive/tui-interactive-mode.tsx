/**
 * OpenTUI-based interactive mode for the coding agent.
 * Uses @opentui/core + @opentui/react for native terminal UI.
 */

/// <reference path="../../opentui-jsx.d.ts" />

import { type CliRenderer, createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
	AssistantMessage as AssistantMessageType,
	ImageContent,
	Model,
	TextContent,
	ToolCall,
} from "../../ai/index.js";
import { APP_NAME, VERSION } from "../../config.js";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.js";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.js";
import type { ReadonlyFooterDataProvider } from "../../core/footer-data-provider.js";
import { FooterDataProvider } from "../../core/footer-data-provider.js";
import { LspManager, prettyDiagnostic } from "../../core/lsp/index.js";
import type { SessionMessageEntry } from "../../core/session-manager.js";
import { BUILTIN_SLASH_COMMANDS, type BuiltinSlashCommand } from "../../core/slash-commands.js";
import { getTextOutput } from "../../core/tools/render-utils.js";
import { fetchUsage, type UsageInfo } from "../../core/usage-fetcher.js";
import { AssistantMessage } from "./components/assistant-message.js";
import { colors } from "./components/colors.js";
import { ExportDialog, type ExportFormat } from "./components/export-dialog.js";
import { Footer } from "./components/footer.js";
import { ModelPicker } from "./components/model-picker.js";
import { ToolExecution } from "./components/tool-execution.js";
import { UserMessage } from "./components/user-message.js";
import { WaveSpinner } from "./components/wave-spinner.js";
import { extractMentionQuery, type FileEntry, listFileEntries } from "./utils/file-mentions.js";
import { fuzzyFilter } from "./utils/fuzzy.js";

// ============================================================================
// Types
// ============================================================================

interface ChatEntry {
	id: string;
	type: "user" | "assistant" | "tool" | "spacer" | "status";
	content?: string;
	message?: AssistantMessageType;
	toolName?: string;
	toolCallId?: string;
	toolInput?: string;
	toolArgs?: unknown;
	toolOutput?: string;
	toolPartialOutput?: string;
	toolRunning?: boolean;
	toolError?: boolean;
	/** Post-edit/write diagnostics summary. Undefined = not computed yet; present = final result (may be clean). */
	toolLspDiagnostics?: { errors: number; warnings: number; lines: string[] };
	isComplete?: boolean;
}

export interface TuiInteractiveModeOptions {
	verbose?: boolean;
	initialMessage?: string;
	initialImages?: ImageContent[];
	initialMessages?: string[];
	modelFallbackMessage?: string;
}

const HELP_TEXT = `Available commands:
  /models    - Switch model
  /compact   - Compact conversation context
  /export    - Export session to HTML or JSONL
  /session   - Show session info and stats
  /new       - Start a new session
  /reload    - Reload config and resources
  /usage     - Show API usage and quota information
  /quit      - Exit the application
  /help      - Show this help message

Keybindings:
  Ctrl+C       - Abort current operation (double-tap while idle to exit)
  Ctrl+P       - Cycle model forward
  Ctrl+Shift+P - Cycle model backward
  Ctrl+T       - Cycle thinking level
  Ctrl+E       - Toggle tool output expansion
  Ctrl+Z       - Suspend process
  Ctrl+L       - Clear screen
  Escape       - Abort while loading`;

function formatUsageStatus(infos: UsageInfo[]): string {
	if (infos.length === 0) return "No providers support usage reporting.";

	const parts: string[] = [];
	for (const info of infos) {
		if (!info.tokenLimit) {
			parts.push(`${info.provider}: no usage data`);
			continue;
		}
		const tl = info.tokenLimit;
		const bar = renderUsageBar(tl.percentage, 20);
		const reset = formatResetTime(tl.nextResetTime);
		parts.push(`${info.provider} (${info.level})`);
		parts.push(`  ${bar} ${tl.percentage}%`);
		parts.push(`  Resets: ${reset}`);
	}
	return parts.join("\n");
}

function renderUsageBar(pct: number, w: number): string {
	const f = Math.round((pct / 100) * w);
	return `[${"\u2588".repeat(f)}${"\u2591".repeat(w - f)}]`;
}

function formatResetTime(date: Date): string {
	const d = date.getTime() - Date.now();
	if (d <= 0) return "now";
	const h = Math.floor(d / 3600000);
	const m = Math.floor((d % 3600000) / 60000);
	if (h > 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
	if (h > 0) return `in ${h}h ${m}m`;
	return `in ${m}m`;
}

// ============================================================================
// Prompt Input with history and / command menu
// ============================================================================

const TEXTAREA_KEY_BINDINGS = [
	{ name: "enter", action: "submit" as const },
	{ name: "enter", shift: true, action: "newline" as const },
];

const MAX_VISIBLE_LINES = 5;
const DOUBLE_ESC_MS = 500;
const MAX_VISIBLE_COMMANDS = 6;
const _COMMAND_MENU_HEIGHT = MAX_VISIBLE_COMMANDS + 2; // +2 for border

interface PromptInputProps {
	commands: ReadonlyArray<BuiltinSlashCommand>;
	onSubmit: (text: string) => void;
	onCommandSelect: (command: string) => void;
	placeholder?: string;
	width?: number;
	isFocused?: boolean;
	cwd?: string;
}

function PromptInput({
	commands,
	onSubmit,
	onCommandSelect,
	placeholder = "Type a message... (/ for commands)",
	width,
	isFocused = true,
	cwd,
}: PromptInputProps): React.ReactNode {
	const [inputText, setInputText] = useState("");
	const textareaRef = useRef<any>(null);
	const lastEscRef = useRef(0);
	const historyRef = useRef<string[]>([]);
	const historyIndexRef = useRef(-1);
	const savedInputRef = useRef("");
	const [menuIndex, setMenuIndex] = useState(0);

	// Use a ref to track menu state so handleSubmit always reads current value
	const menuRef = useRef<{ filtered: ReadonlyArray<BuiltinSlashCommand>; index: number }>({
		filtered: [],
		index: 0,
	});

	// File mention state
	const [mentionIndex, setMentionIndex] = useState(0);
	const mentionRef = useRef<{ entries: FileEntry[]; index: number; atOffset: number }>({
		entries: [],
		index: 0,
		atOffset: 0,
	});

	// Compute filtered commands when input starts with /
	const commandQuery = inputText.startsWith("/") ? (inputText.slice(1).split(/\s/)[0]?.toLowerCase() ?? "") : null;

	const filteredCommands =
		commandQuery !== null
			? commands.filter(
					(cmd) =>
						cmd.name.toLowerCase().startsWith(commandQuery) || cmd.name.toLowerCase().includes(commandQuery),
				)
			: [];

	const showCommandMenu = commandQuery !== null && filteredCommands.length > 0;

	// Compute file mention entries
	const cursorOffset =
		textareaRef.current?.cursorCharacterOffset ?? textareaRef.current?.cursorOffset ?? inputText.length;
	const mentionInfo = cwd ? extractMentionQuery(inputText, cursorOffset) : null;
	const mentionEntries = React.useMemo(() => {
		if (!mentionInfo || !cwd) return [];
		const raw = listFileEntries(cwd, mentionInfo.query);
		if (!mentionInfo.query) return raw;
		return fuzzyFilter(raw, mentionInfo.query, (e) => e.label);
	}, [mentionInfo?.atOffset, mentionInfo?.query, cwd, mentionInfo]);
	const showMentionMenu = mentionInfo !== null && mentionEntries.length > 0;

	// Keep ref in sync
	menuRef.current = { filtered: filteredCommands, index: menuIndex };
	mentionRef.current = { entries: mentionEntries, index: mentionIndex, atOffset: mentionInfo?.atOffset ?? 0 };

	// Reset menu index when filter changes
	useEffect(() => {
		setMenuIndex(0);
	}, []);

	useEffect(() => {
		setMentionIndex(0);
	}, []);

	const clearInput = useCallback(() => {
		setInputText("");
		if (textareaRef.current) {
			textareaRef.current.clear();
		}
	}, []);

	const setTextInput = useCallback((text: string) => {
		setInputText(text);
		if (textareaRef.current) {
			textareaRef.current.clear();
			textareaRef.current.insertText(text);
		}
	}, []);

	const handleSubmit = useCallback(
		(_event: any) => {
			const value = textareaRef.current?.plainText ?? inputText;
			const trimmed = value.trim();
			if (!trimmed) return;

			// Read current menu state from ref (avoids stale closure)
			const { filtered, index } = menuRef.current;
			if (trimmed.startsWith("/") && filtered.length > 0 && filtered[index]) {
				const cmd = filtered[index]!;
				if (trimmed === `/${cmd.name}`) {
					// Already fully matched — execute the command
					onCommandSelect(cmd.name);
					clearInput();
					return;
				}
				// Autocomplete the command name into the input
				setTextInput(`/${cmd.name} `);
				return;
			}

			// Add to history (skip / commands from history)
			if (!trimmed.startsWith("/")) {
				const history = historyRef.current;
				if (history.length === 0 || history[0] !== trimmed) {
					history.unshift(trimmed);
					if (history.length > 100) history.pop();
				}
			}
			historyIndexRef.current = -1;
			savedInputRef.current = "";
			onSubmit(trimmed);
			clearInput();
		},
		[
			onSubmit,
			inputText,
			clearInput,
			setTextInput, // Already fully matched — execute the command
			onCommandSelect,
		],
	);

	useKeyboard((event) => {
		// When command menu is open, intercept up/down/enter/tab
		if (showCommandMenu) {
			if (event.name === "up") {
				setMenuIndex((prev) => Math.max(0, prev - 1));
				return;
			}
			if (event.name === "down") {
				setMenuIndex((prev) => Math.min(filteredCommands.length - 1, prev + 1));
				return;
			}
			if (event.name === "tab") {
				// Auto-complete to selected command
				const cmd = filteredCommands[menuIndex];
				if (cmd) {
					setTextInput(`/${cmd.name} `);
				}
				return;
			}
			if (event.name === "escape") {
				clearInput();
				return;
			}
		}

		// When file mention menu is open, intercept up/down/tab/enter
		if (showMentionMenu) {
			if (event.name === "up") {
				setMentionIndex((prev) => Math.max(0, prev - 1));
				return;
			}
			if (event.name === "down") {
				setMentionIndex((prev) => Math.min(mentionEntries.length - 1, prev + 1));
				return;
			}
			if (event.name === "tab" || (event.name === "enter" && !event.shift)) {
				const entry = mentionEntries[mentionIndex];
				if (entry && mentionInfo) {
					// Replace @query with the file path
					const before = inputText.slice(0, mentionInfo.atOffset);
					const after = inputText.slice(cursorOffset);
					const suffix = entry.isDirectory ? "/" : " ";
					const newText = `${before}${entry.label}${suffix}${after}`;
					setTextInput(newText);
				}
				return;
			}
			if (event.name === "escape") {
				// Dismiss mention menu by swallowing escape
				return;
			}
		}

		// Escape when no menu is open
		if (!showCommandMenu && !showMentionMenu && event.name === "escape") {
			const now = Date.now();
			if (now - lastEscRef.current < DOUBLE_ESC_MS) {
				clearInput();
				historyIndexRef.current = -1;
				savedInputRef.current = "";
				lastEscRef.current = 0;
			} else {
				lastEscRef.current = now;
			}
			return;
		}

		// History navigation: up/down when at end of input (only when no menu is open)
		if (!showCommandMenu && !showMentionMenu && event.name === "up") {
			const value = textareaRef.current?.plainText ?? inputText;
			const textarea = textareaRef.current;
			if (textarea) {
				const co = textarea.cursorCharacterOffset ?? textarea.cursorOffset;
				if (co !== undefined && co < value.length) return;
			}

			const history = historyRef.current;
			if (history.length === 0) return;

			if (historyIndexRef.current === -1) {
				savedInputRef.current = value;
			}

			const newIndex = Math.min(historyIndexRef.current + 1, history.length - 1);
			if (newIndex === historyIndexRef.current) return;
			historyIndexRef.current = newIndex;

			const historyText = history[newIndex]!;
			setInputText(historyText);
			if (textareaRef.current) {
				textareaRef.current.clear();
				textareaRef.current.insertText(historyText);
			}
			return;
		}

		if (!showCommandMenu && !showMentionMenu && event.name === "down") {
			if (historyIndexRef.current === -1) return;

			const newIndex = historyIndexRef.current - 1;
			historyIndexRef.current = newIndex;

			let text: string;
			if (newIndex === -1) {
				text = savedInputRef.current;
			} else {
				text = historyRef.current[newIndex] ?? "";
			}

			setInputText(text);
			if (textareaRef.current) {
				textareaRef.current.clear();
				textareaRef.current.insertText(text);
			}
			return;
		}
	});

	const handleContentChange = useCallback(() => {
		const value = textareaRef.current?.plainText ?? "";
		setInputText(value);
		if (historyIndexRef.current !== -1) {
			historyIndexRef.current = -1;
			savedInputRef.current = "";
		}
	}, []);

	// Manual viewport windowing for command menu
	const totalCommands = filteredCommands.length;
	const maxVisibleCmds = Math.min(MAX_VISIBLE_COMMANDS, totalCommands);

	let cmdScrollOffset = 0;
	if (totalCommands > MAX_VISIBLE_COMMANDS) {
		if (menuIndex >= MAX_VISIBLE_COMMANDS) {
			cmdScrollOffset = menuIndex - MAX_VISIBLE_COMMANDS + 1;
		}
		if (cmdScrollOffset + MAX_VISIBLE_COMMANDS > totalCommands) {
			cmdScrollOffset = totalCommands - MAX_VISIBLE_COMMANDS;
		}
	}
	const visibleCommands = filteredCommands.slice(cmdScrollOffset, cmdScrollOffset + maxVisibleCmds);

	// Manual viewport windowing for mention menu
	const totalMentions = mentionEntries.length;
	const maxVisibleMentions = Math.min(MAX_VISIBLE_COMMANDS, totalMentions);

	let mentionScrollOffset = 0;
	if (totalMentions > MAX_VISIBLE_COMMANDS) {
		if (mentionIndex >= MAX_VISIBLE_COMMANDS) {
			mentionScrollOffset = mentionIndex - MAX_VISIBLE_COMMANDS + 1;
		}
		if (mentionScrollOffset + MAX_VISIBLE_COMMANDS > totalMentions) {
			mentionScrollOffset = totalMentions - MAX_VISIBLE_COMMANDS;
		}
	}
	const visibleMentions = mentionEntries.slice(mentionScrollOffset, mentionScrollOffset + maxVisibleMentions);

	return (
		<box style={{ flexDirection: "column", width }}>
			{/* Command menu */}
			{showCommandMenu ? (
				<box
					style={{
						flexDirection: "column",
						border: true,
						borderStyle: "rounded",
						borderColor: colors.darkGray,
						paddingLeft: 1,
						paddingRight: 1,
						paddingTop: 1,
						paddingBottom: 1,
						overflow: "hidden",
					}}
				>
					{visibleCommands.map((cmd, idx) => {
						const realIdx = cmdScrollOffset + idx;
						const isSelected = realIdx === menuIndex;
						return (
							<box key={cmd.name} style={{ flexDirection: "row", gap: 2, height: 1 }}>
								<text
									fg={isSelected ? colors.text : colors.accent}
									bg={isSelected ? colors.selectionBg : undefined}
									style={{ width: 12, flexShrink: 0 }}
								>
									{isSelected ? "> " : "  "}/{cmd.name}
								</text>
								<text
									fg={isSelected ? colors.text : colors.muted}
									bg={isSelected ? colors.selectionBg : undefined}
									style={{ flexGrow: 1, flexShrink: 1 }}
								>
									{cmd.description}
								</text>
							</box>
						);
					})}
				</box>
			) : null}

			{/* File mention menu */}
			{showMentionMenu ? (
				<box
					style={{
						flexDirection: "column",
						border: true,
						borderStyle: "rounded",
						borderColor: colors.darkGray,
						paddingLeft: 1,
						paddingRight: 1,
						paddingTop: 1,
						paddingBottom: 1,
						overflow: "hidden",
					}}
				>
					{visibleMentions.map((entry, idx) => {
						const realIdx = mentionScrollOffset + idx;
						const isSelected = realIdx === mentionIndex;
						const icon = entry.isDirectory ? "\uD83D\uDCC1" : "\uD83D\uDCC4";
						return (
							<box key={entry.absolutePath} style={{ flexDirection: "row", gap: 1, height: 1 }}>
								<text
									fg={isSelected ? colors.text : colors.muted}
									bg={isSelected ? colors.selectionBg : undefined}
								>
									{isSelected ? "> " : "  "}
								</text>
								<text
									fg={isSelected ? colors.text : entry.isDirectory ? colors.accent : colors.muted}
									bg={isSelected ? colors.selectionBg : undefined}
								>
									{icon}
								</text>
								<text
									fg={isSelected ? colors.text : colors.text}
									bg={isSelected ? colors.selectionBg : undefined}
									style={{ flexGrow: 1, flexShrink: 1 }}
								>
									{entry.label}
									{entry.isDirectory ? "/" : ""}
								</text>
							</box>
						);
					})}
				</box>
			) : null}

			{/* Input row */}
			<box
				style={{
					flexDirection: "row",
					border: true,
					borderStyle: "rounded",
					borderColor: colors.border,
					paddingLeft: 1,
					paddingRight: 2,
					height: MAX_VISIBLE_LINES,
				}}
			>
				<text fg={colors.accent}>{">"}</text>
				<textarea
					ref={textareaRef}
					initialValue={inputText}
					placeholder={placeholder}
					placeholderColor={colors.dimGray}
					onContentChange={handleContentChange}
					onSubmit={handleSubmit}
					focused={isFocused}
					keyBindings={TEXTAREA_KEY_BINDINGS}
					wrapMode="word"
					style={{ flexGrow: 1, flexShrink: 1 }}
				/>
			</box>
		</box>
	);
}

// ============================================================================
// Main App Component
// ============================================================================

function TuiApp({
	session: initialSession,
	runtimeHost: _runtimeHost,
	footerData,
	lspManager,
	options,
	onNewSession,
}: {
	session: AgentSession;
	runtimeHost: AgentSessionRuntime;
	footerData: ReadonlyFooterDataProvider;
	lspManager: LspManager;
	options: TuiInteractiveModeOptions;
	onNewSession: () => Promise<void>;
}): React.ReactNode {
	const renderer = useRenderer();
	const { width: termWidth, height: termHeight } = useTerminalDimensions();

	const [session, _setSession] = useState<AgentSession>(initialSession);
	const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [isWorking, setIsWorking] = useState(false);

	const [autoCompactEnabled] = useState(true);
	const [toolOutputExpanded, setToolOutputExpanded] = useState(false);
	const [queuedMessages, setQueuedMessages] = useState<readonly string[]>([]);
	const [showStartup, setShowStartup] = useState(true);
	const [showModelPicker, setShowModelPicker] = useState(false);
	const [showExportDialog, setShowExportDialog] = useState(false);
	const [thinkingLevel, setThinkingLevel] = useState<string | undefined>(session.state.thinkingLevel);
	const [currentModelId, setCurrentModelId] = useState<string>(session.state.model?.id ?? "");
	const entryIdRef = useRef(0);
	const lastCtrlCRef = useRef(0);
	const scrollRef = useRef<any>(null);

	// Restore session history on mount
	useEffect(() => {
		const entries = session.sessionManager.getEntries();
		const restored: ChatEntry[] = [];
		let idx = 0;
		for (const entry of entries) {
			if (entry.type !== "message") continue;
			const msg = (entry as SessionMessageEntry).message;
			if (msg.role === "user") {
				const content =
					typeof msg.content === "string"
						? msg.content
						: msg.content
								.filter((b): b is TextContent => b.type === "text")
								.map((b) => b.text)
								.join("");
				restored.push({ id: `restored-${idx++}`, type: "user", content, isComplete: true });
			} else if (msg.role === "assistant") {
				const assistantMsg = msg as AssistantMessageType;
				restored.push({ id: `restored-${idx++}`, type: "assistant", message: assistantMsg, isComplete: true });
				for (const block of assistantMsg.content) {
					if (block.type === "toolCall") {
						const tc = block as ToolCall;
						const formattedArgs = Object.entries(tc.arguments)
							.map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : JSON.stringify(v)}`)
							.join(" ");
						restored.push({
							id: `restored-${idx++}`,
							type: "tool",
							toolName: tc.name,
							toolCallId: tc.id,
							toolInput: formattedArgs,
							toolArgs: tc.arguments,
							toolRunning: false,
							isComplete: true,
						});
					}
				}
			} else if (msg.role === "toolResult") {
				for (let i = restored.length - 1; i >= 0; i--) {
					const re = restored[i];
					if (re && re.type === "tool" && re.toolCallId === msg.toolCallId) {
						const output = msg.content
							.filter((b): b is TextContent => b.type === "text")
							.map((b) => b.text)
							.join("");
						restored[i] = { ...re, toolOutput: output, toolError: msg.isError };
						break;
					}
				}
			}
		}
		if (restored.length > 0) {
			entryIdRef.current = idx;
			setChatEntries(restored);
			setShowStartup(false);
		}
	}, [session]);

	const nextId = useCallback(() => {
		entryIdRef.current += 1;
		return `entry-${entryIdRef.current}`;
	}, []);

	const addEntry = useCallback(
		(entry: Omit<ChatEntry, "id">) => {
			setChatEntries((prev) => [...prev, { isComplete: entry.isComplete ?? true, ...entry, id: nextId() }]);
		},
		[nextId],
	);

	const dismissStartup = useCallback(() => {
		if (showStartup) setShowStartup(false);
	}, [showStartup]);

	useEffect(() => {
		const sessionName = session.sessionManager.getSessionName();
		process.stdout.write(`\x1b]0;${APP_NAME}${sessionName ? ` - ${sessionName}` : ""}\x07`);
	}, [session]);

	const scrollToBottom = useCallback(() => {
		const sb = scrollRef.current as any;
		if (!sb) return;
		// Reset manual scroll flag so stickyScroll kicks in on next layout
		sb._hasManualScroll = false;
		sb._stickyScrollBottom = true;
		sb._stickyScrollTop = false;
		sb.scrollTop = Math.max(0, sb.scrollHeight - sb.viewport.height);
	}, []);

	useEffect(() => {
		scrollToBottom();
	}, [scrollToBottom]);

	const handleSlashCommand = useCallback(
		(command: string, _rest: string): boolean => {
			switch (command) {
				case "models":
					setShowModelPicker(true);
					return true;
				case "compact":
					session.compact().catch((err: unknown) => {
						addEntry({ type: "status", content: `Compact error: ${String(err)}` });
					});
					return true;
				case "quit":
					renderer.destroy();
					return true;
				case "help":
					addEntry({ type: "status", content: HELP_TEXT });
					return true;
				case "usage":
					fetchUsage()
						.then((infos) => {
							addEntry({ type: "status", content: formatUsageStatus(infos) });
						})
						.catch((err: unknown) => {
							addEntry({ type: "status", content: `Usage error: ${String(err)}` });
						});
					return true;
				case "export": {
					setShowExportDialog(true);
					return true;
				}
				case "session": {
					const stats = session.getSessionStats();
					const lines: string[] = [
						`Session: ${stats.sessionId}`,
						`Model: ${session.state.model?.id ?? "unknown"}`,
						`Messages: ${stats.userMessages} user, ${stats.assistantMessages} assistant, ${stats.toolCalls} tool calls`,
						`Tokens: ${stats.tokens.total.toLocaleString()} total (${stats.tokens.input.toLocaleString()} in / ${stats.tokens.output.toLocaleString()} out)`,
					];
					if (stats.tokens.cacheRead > 0 || stats.tokens.cacheWrite > 0) {
						lines.push(
							`Cache: ${stats.tokens.cacheRead.toLocaleString()} read / ${stats.tokens.cacheWrite.toLocaleString()} write`,
						);
					}
					if (stats.cost > 0) {
						lines.push(`Cost: $${stats.cost.toFixed(4)}`);
					}
					if (stats.contextUsage) {
						const pct = stats.contextUsage.percent?.toFixed(1) ?? "?";
						const tok = stats.contextUsage.tokens?.toLocaleString() ?? "?";
						lines.push(`Context: ${tok} tokens (${pct}%)`);
					}
					if (stats.sessionFile) {
						lines.push(`File: ${stats.sessionFile}`);
					}
					addEntry({ type: "status", content: lines.join("\n") });
					return true;
				}
				case "new": {
					onNewSession().catch((err: unknown) => {
						addEntry({ type: "status", content: `New session error: ${String(err)}` });
					});
					return true;
				}
				case "reload": {
					session.settingsManager
						.reload()
						.then(() => {
							addEntry({ type: "status", content: "Config reloaded." });
						})
						.catch((err: unknown) => {
							addEntry({ type: "status", content: `Reload error: ${String(err)}` });
						});
					return true;
				}
				case "lsp": {
					const newState = lspManager.toggle();
					addEntry({
						type: "status",
						content: newState ? "LSP diagnostics enabled." : "LSP diagnostics disabled.",
					});
					return true;
				}
				default:
					return false;
			}
		},
		[session, addEntry, renderer, lspManager, onNewSession],
	);

	const handleCommandSelect = useCallback(
		(commandName: string) => {
			dismissStartup();
			handleSlashCommand(commandName, "");
		},
		[dismissStartup, handleSlashCommand],
	);

	const handleSubmit = useCallback(
		(text: string) => {
			dismissStartup();

			if (text.startsWith("/")) {
				const parts = text.split(/\s+/);
				const command = parts[0]?.slice(1) ?? "";
				const rest = parts.slice(1).join(" ");
				if (handleSlashCommand(command, rest)) return;
			}

			if (isWorking) {
				session.prompt(text).catch((err: unknown) => {
					addEntry({ type: "status", content: `Error: ${String(err)}` });
				});
				return;
			}

			addEntry({ type: "user", content: text });
			scrollToBottom();
			setIsLoading(true);
			setIsWorking(true);

			session.prompt(text).catch((err: unknown) => {
				addEntry({ type: "status", content: `Error: ${String(err)}` });
				setIsLoading(false);
				setIsWorking(false);
			});
		},
		[session, addEntry, dismissStartup, handleSlashCommand, isWorking, scrollToBottom],
	);

	// Subscribe to agent session events
	useEffect(() => {
		const handler = (event: AgentSessionEvent): void => {
			switch (event.type) {
				case "message_start": {
					if (event.message.role === "assistant") {
						const hasText = event.message.content.some((c: any) => c.type === "text" && c.text);
						const hasThinking = event.message.content.some((c: any) => c.type === "thinking" && c.thinking);
						const isError = event.message.stopReason === "error";
						if (hasText || hasThinking || isError) {
							addEntry({
								type: "assistant",
								message: event.message as AssistantMessageType,
								isComplete: false,
							});
						}
					}
					setIsLoading(false);
					break;
				}
				case "message_update": {
					if (event.message.role === "assistant") {
						setChatEntries((prev) => {
							let found = false;
							const updated = [...prev];
							for (let i = updated.length - 1; i >= 0; i--) {
								if (updated[i]?.type === "assistant" && !updated[i]?.isComplete) {
									updated[i] = { ...updated[i]!, message: event.message as AssistantMessageType };
									found = true;
									break;
								}
							}
							if (!found) {
								const msg = event.message as AssistantMessageType;
								const hasText = msg.content.some((c: any) => c.type === "text" && c.text);
								const hasThinking = msg.content.some((c: any) => c.type === "thinking" && c.thinking);
								const isError = msg.stopReason === "error";
								if (hasText || hasThinking || isError) {
									updated.push({ id: nextId(), type: "assistant", message: msg, isComplete: false });
								}
							}
							return updated;
						});
					}
					break;
				}
				case "message_end": {
					if (event.message.role === "assistant") {
						const msg = structuredClone(event.message as AssistantMessageType);
						setChatEntries((prev) => {
							let found = false;
							const updated = [...prev];
							for (let i = updated.length - 1; i >= 0; i--) {
								if (updated[i]?.type === "assistant" && !updated[i]?.isComplete) {
									updated[i] = { ...updated[i]!, message: msg, isComplete: true };
									found = true;
									break;
								}
							}
							if (!found) {
								const hasText = msg.content.some((c: any) => c.type === "text" && c.text);
								const hasThinking = msg.content.some((c: any) => c.type === "thinking" && c.thinking);
								const isError = msg.stopReason === "error";
								if (hasText || hasThinking || isError) {
									updated.push({ id: nextId(), type: "assistant", message: msg, isComplete: true });
								}
							}
							return updated;
						});
					}
					break;
				}
				case "tool_execution_start": {
					let formattedArgs = "";
					if (event.args && typeof event.args === "object") {
						formattedArgs = Object.entries(event.args as Record<string, unknown>)
							.map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : JSON.stringify(v)}`)
							.join(" ");
					} else if (event.args) {
						formattedArgs = String(event.args);
					}
					addEntry({
						type: "tool",
						toolName: event.toolName,
						toolCallId: event.toolCallId,
						toolInput: formattedArgs,
						toolArgs: event.args,
						toolRunning: true,
						isComplete: false,
					});
					break;
				}
				case "tool_execution_update": {
					setChatEntries((prev) => {
						const updated = [...prev];
						for (let i = updated.length - 1; i >= 0; i--) {
							if (updated[i]?.type === "tool" && updated[i]?.toolCallId === event.toolCallId) {
								let partial: string | undefined;
								if (event.partialResult) {
									partial =
										typeof event.partialResult === "string"
											? event.partialResult
											: getTextOutput(event.partialResult as never, false);
								}
								updated[i] = { ...updated[i]!, toolPartialOutput: partial };
								break;
							}
						}
						return updated;
					});
					break;
				}
				case "tool_execution_end": {
					setChatEntries((prev) => {
						const updated = [...prev];
						for (let i = updated.length - 1; i >= 0; i--) {
							const current = updated[i];
							if (current?.type === "tool" && current?.toolCallId === event.toolCallId) {
								let output: string | undefined;
								if (event.result) {
									output =
										typeof event.result === "string"
											? event.result
											: getTextOutput(event.result as never, false);
								}
								// For edit/write tools, read the current LSP diagnostics. The
								// afterToolCall hook has already touched the file and awaited
								// publishDiagnostics, so counts are up-to-date here.
								let lspDiagnostics: { errors: number; warnings: number; lines: string[] } | undefined;
								if (!event.isError && (event.toolName === "edit" || event.toolName === "write")) {
									const toolArgs = current.toolArgs as { path?: string; file_path?: string } | undefined;
									const filePath = toolArgs?.path ?? toolArgs?.file_path;
									if (filePath && typeof filePath === "string") {
										const diags = lspManager.getDiagnosticsForFile(filePath);
										const errorDiags = diags.filter((d) => d.severity === 1);
										const warningDiags = diags.filter((d) => d.severity === 2);
										const errors = errorDiags.length;
										const warnings = warningDiags.length;
										const lines = [...errorDiags, ...warningDiags].slice(0, 3).map(prettyDiagnostic);
										lspDiagnostics = { errors, warnings, lines };
									}
								}
								updated[i] = {
									...current,
									toolRunning: false,
									toolOutput: output,
									toolPartialOutput: undefined,
									toolError: event.isError,
									toolLspDiagnostics: lspDiagnostics,
									isComplete: true,
								};
								break;
							}
						}
						return updated;
					});
					if (event.isError && event.result) {
						const errorMsg = typeof event.result === "string" ? event.result : "Tool execution failed";
						addEntry({ type: "status", content: `Error: ${errorMsg}` });
					}
					break;
				}
				case "agent_end": {
					setIsWorking(false);
					setIsLoading(false);
					break;
				}
				case "queue_update": {
					setQueuedMessages(event.steering);
					break;
				}
				case "compaction_start": {
					setIsLoading(true);
					break;
				}
				case "compaction_end": {
					setIsLoading(false);
					break;
				}
				case "auto_retry_start": {
					setIsLoading(true);
					break;
				}
				case "auto_retry_end": {
					setIsLoading(false);
					break;
				}
			}
		};

		const unsubscribe = session.subscribe(handler);
		return () => {
			unsubscribe();
		};
	}, [session, addEntry, nextId, lspManager]);

	// Global key handlers
	useKeyboard((event) => {
		if (event.ctrl && event.shift && event.name === "c") {
			const selection = renderer.getSelection();
			if (selection?.isActive) {
				const text = selection.getSelectedText();
				if (text) {
					renderer.copyToClipboardOSC52(text);
				}
			}
			return;
		}

		if (event.ctrl && event.shift && event.name === "v") {
			import("node:child_process").then(({ execSync }) => {
				const getClipboard = (): string => {
					if (process.platform === "darwin") {
						return execSync("pbpaste", {
							encoding: "utf8",
							timeout: 500,
							stdio: ["ignore", "pipe", "ignore"],
						});
					}
					if (process.platform === "win32") {
						return execSync("powershell -command Get-Clipboard", {
							encoding: "utf8",
							timeout: 500,
							stdio: ["ignore", "pipe", "ignore"],
						});
					}
					try {
						return execSync("wl-paste", {
							encoding: "utf8",
							timeout: 500,
							stdio: ["ignore", "pipe", "ignore"],
						});
					} catch {
						return execSync("xclip -selection clipboard -o", {
							encoding: "utf8",
							timeout: 500,
							stdio: ["ignore", "pipe", "ignore"],
						});
					}
				};
				try {
					const text = getClipboard();
					if (text) {
						process.stdin.write(text.replace(/\r?\n/g, "\n"));
					}
				} catch {
					// clipboard empty or command not found
				}
			});
			return;
		}

		if (event.ctrl && event.name === "c") {
			if (isLoading || isWorking) {
				session.abort();
				setIsLoading(false);
				setIsWorking(false);
			} else {
				const now = Date.now();
				if (now - lastCtrlCRef.current < 500) {
					renderer.destroy();
				} else {
					lastCtrlCRef.current = now;
					addEntry({ type: "status", content: "Press Ctrl+C again to exit" });
				}
			}
			return;
		}

		// Ctrl+P: cycle model forward
		if (event.ctrl && !event.shift && event.name === "p") {
			session
				.cycleModel("forward")
				.then(() => setCurrentModelId(session.state.model?.id ?? ""))
				.catch(() => {});
			addEntry({ type: "status", content: `Model: ${session.state.model?.id ?? "unknown"}` });
			return;
		}

		// Ctrl+Shift+P: cycle model backward
		if (event.ctrl && event.shift && event.name === "p") {
			session
				.cycleModel("backward")
				.then(() => setCurrentModelId(session.state.model?.id ?? ""))
				.catch(() => {});
			addEntry({ type: "status", content: `Model: ${session.state.model?.id ?? "unknown"}` });
			return;
		}

		// Tab: cycle thinking level
		if (!event.ctrl && !event.shift && event.name === "tab") {
			const level = session.cycleThinkingLevel();
			setThinkingLevel(level ?? undefined);
			addEntry({ type: "status", content: `Thinking level: ${level ?? "unknown"}` });
			return;
		}

		// Ctrl+T: cycle thinking level
		if (event.ctrl && event.name === "t") {
			const level = session.cycleThinkingLevel();
			setThinkingLevel(level ?? undefined);
			addEntry({ type: "status", content: `Thinking level: ${level ?? "unknown"}` });
			return;
		}

		if (event.ctrl && event.name === "e") {
			setToolOutputExpanded((prev) => !prev);
			return;
		}

		if (event.name === "escape") {
			if (isLoading || isWorking) {
				session.abort();
				setIsLoading(false);
				setIsWorking(false);
			} else if (showExportDialog) {
				setShowExportDialog(false);
			} else if (showModelPicker) {
				setShowModelPicker(false);
			}
			return;
		}

		if (event.ctrl && event.name === "z") {
			process.kill(process.pid, "SIGTSTP");
			return;
		}

		if (event.ctrl && event.name === "l") {
			setChatEntries([]);
			setShowStartup(false);
			return;
		}
	});

	const renderEntry = (entry: ChatEntry, index: number, entries: ChatEntry[]): React.ReactNode => {
		const prev = index > 0 ? entries[index - 1] : undefined;

		switch (entry.type) {
			case "user":
				return <UserMessage key={entry.id} text={entry.content ?? ""} width={termWidth} />;
			case "assistant": {
				const needsMargin = prev?.type === "tool" || prev?.type === "user";
				return (
					<box key={entry.id} style={needsMargin ? { marginTop: 1 } : undefined}>
						<AssistantMessage message={entry.message} width={termWidth} />
					</box>
				);
			}
			case "tool":
				return (
					<ToolExecution
						key={entry.id}
						toolName={entry.toolName ?? ""}
						input={entry.toolInput ?? ""}
						args={entry.toolArgs}
						output={entry.toolOutput}
						partialOutput={entry.toolPartialOutput}
						isRunning={entry.toolRunning}
						isError={entry.toolError}
						expanded={toolOutputExpanded}
						width={termWidth}
						cwd={session.sessionManager.getCwd()}
						lspDiagnostics={entry.toolLspDiagnostics}
					/>
				);
			case "status":
				return (
					<box key={entry.id} style={{ paddingLeft: 1, paddingTop: 1 }}>
						<text fg={colors.muted}>{entry.content ?? ""}</text>
					</box>
				);
			case "spacer":
				return <box key={entry.id} style={{ height: 1 }} />;
			default:
				return null;
		}
	};

	const inputHeight = 7;
	const statusHeight = 1;
	const footerHeight = 1;
	const spacerHeight = 1;
	const activeTask = (() => {
		try {
			return session.taskManager?.loadTasks().find((t) => t.status === "in_progress") ?? null;
		} catch {
			return null;
		}
	})();
	const taskLineHeight = activeTask ? 1 : 0;
	const scrollHeight = termHeight - spacerHeight - statusHeight - inputHeight - footerHeight - taskLineHeight;

	return (
		<box style={{ flexDirection: "column", width: termWidth, height: termHeight }}>
			{/* Chat area */}
			<scrollbox
				ref={scrollRef}
				focusable={false}
				style={{ height: scrollHeight, flexDirection: "column" }}
				stickyScroll
				stickyStart="bottom"
				scrollY
				scrollbarOptions={{ visible: false }}
			>
				{showStartup && chatEntries.length === 0 ? (
					<box style={{ paddingLeft: 1, paddingTop: 1, flexDirection: "column", gap: 1 }}>
						<text fg={colors.accent}>{`${APP_NAME} v${VERSION}`}</text>
						<text fg={colors.muted}>{"Type a message to get started. Type / for commands, @ for files."}</text>
						{options.modelFallbackMessage ? (
							<text fg={colors.warning}>{options.modelFallbackMessage}</text>
						) : null}
					</box>
				) : null}

				{chatEntries.map((entry, index) => renderEntry(entry, index, chatEntries))}
			</scrollbox>

			{/* Model picker overlay — absolutely centered */}
			{showModelPicker && !isLoading ? (
				<ModelPicker
					models={session.modelRegistry
						.getAvailable()
						.map((m: Model<any>) => ({ provider: m.provider, id: m.id, label: m.name }))}
					currentModelId={session.state.model?.id ?? ""}
					width={Math.min(termWidth - 4, 60)}
					maxHeight={Math.floor(termHeight * 0.6)}
					onSelect={(provider: string, modelId: string) => {
						const model = session.modelRegistry.find(provider, modelId);
						if (model) {
							session.setModel(model);
							setCurrentModelId(modelId);
							addEntry({ type: "status", content: `Switched to model: ${provider}/${modelId}` });
						}
						setShowModelPicker(false);
					}}
					onCancel={() => setShowModelPicker(false)}
				/>
			) : null}

			{showExportDialog && !isLoading ? (
				<ExportDialog
					onExport={(format: ExportFormat, path: string) => {
						setShowExportDialog(false);
						const doExport = async (): Promise<void> => {
							try {
								let outputPath: string;
								if (format === "jsonl") {
									outputPath = session.exportToJsonl(path);
								} else if (format === "md") {
									outputPath = session.exportToMd(path);
								} else {
									outputPath = await session.exportToHtml(path);
								}
								addEntry({ type: "status", content: `Session exported to ${outputPath}` });
							} catch (err: unknown) {
								addEntry({ type: "status", content: `Export error: ${String(err)}` });
							}
						};
						doExport();
					}}
					onCancel={() => setShowExportDialog(false)}
				/>
			) : null}

			<text fg={colors.darkGray}>{"─".repeat(termWidth)}</text>

			{/* Queued messages */}
			{queuedMessages.length > 0 && !showModelPicker && !showExportDialog ? (
				<box style={{ paddingLeft: 2, flexDirection: "column" }}>
					{queuedMessages.map((msg, idx) => (
						<box key={`q-${idx}`} style={{ flexDirection: "row", gap: 1 }}>
							<text fg={colors.muted}>{"\u29D7"}</text>
							<text fg={colors.dimGray}>{msg}</text>
						</box>
					))}
				</box>
			) : null}

			{/* Active task line */}
			{!showModelPicker && !showExportDialog
				? (() => {
						try {
							const tasks = session.taskManager?.loadTasks();
							const active = tasks?.find((t) => t.status === "in_progress");
							return active ? (
								<box style={{ paddingLeft: 2, paddingRight: 1, flexDirection: "row", gap: 1 }}>
									<text fg={colors.yellow}>{"\u25B6"}</text>
									<text fg={colors.muted}>{active.title}</text>
								</box>
							) : null;
						} catch {
							return null;
						}
					})()
				: null}

			{/* Status line */}
			{!showModelPicker && !showExportDialog ? (
				<box
					style={{
						paddingLeft: 2,
						paddingRight: 1,
						flexDirection: "row",
						justifyContent: "space-between",
					}}
				>
					<box style={{ flexDirection: "row", gap: 1 }}>
						{isLoading || isWorking ? <WaveSpinner /> : <text fg={colors.muted}>{"○"}</text>}
						{options.verbose ? <text fg={colors.dimGray}>{`${APP_NAME} v${VERSION}`}</text> : null}
					</box>
					<box style={{ flexDirection: "row", gap: 1 }}>
						<text fg={colors.muted}>{currentModelId || "no-model"}</text>
						{thinkingLevel ? <text fg={colors.dimGray}>{`thinking: ${thinkingLevel}`}</text> : null}
					</box>
				</box>
			) : null}

			{/* Input area */}
			{!showModelPicker && !showExportDialog ? (
				<PromptInput
					commands={BUILTIN_SLASH_COMMANDS}
					onSubmit={handleSubmit}
					onCommandSelect={handleCommandSelect}
					placeholder="Type a message... (/ for commands, @ for files)"
					width={termWidth}
					isFocused={!isLoading}
					cwd={session.sessionManager.getCwd()}
				/>
			) : null}

			{/* Footer */}
			<Footer session={session} footerData={footerData} autoCompactEnabled={autoCompactEnabled} width={termWidth} />
		</box>
	);
}

// ============================================================================
// TuiInteractiveMode class
// ============================================================================

export class TuiInteractiveMode {
	private options: TuiInteractiveModeOptions;
	private session: AgentSession;
	private runtimeHost: AgentSessionRuntime;
	private footerDataProvider: FooterDataProvider;
	private lspManager: LspManager;
	private renderer: CliRenderer | undefined;
	private root: ReturnType<typeof createRoot> | undefined;
	private isInitialized = false;
	private sessionVersion = 0;

	constructor(runtimeHost: AgentSessionRuntime, options: TuiInteractiveModeOptions = {}) {
		this.options = options;
		this.runtimeHost = runtimeHost;
		this.session = runtimeHost.session;
		this.footerDataProvider = new FooterDataProvider(this.session.sessionManager.getCwd());
		this.lspManager = new LspManager(this.session.sessionManager.getCwd(), this.session.settingsManager);
		this.footerDataProvider.setLspManager(this.lspManager);
		this.setupAfterToolCall();
	}

	private setupAfterToolCall(): void {
		this.session.agent.afterToolCall = async (ctx, _signal) => {
			const toolName = ctx.toolCall.name;
			if (ctx.isError) return undefined;

			const args = ctx.args as { path?: string; file_path?: string };
			const filePath = args?.path ?? args?.file_path;
			if (!filePath || typeof filePath !== "string") return undefined;

			if (toolName === "read") {
				void this.lspManager.touchFile(filePath, false).catch(() => {});
				return undefined;
			}

			if (toolName !== "edit" && toolName !== "write") return undefined;

			await this.lspManager.touchFile(filePath, true);

			const summary = this.lspManager.buildDiagnosticSummary(filePath);
			if (!summary) return undefined;

			const existingText = ctx.result.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("");

			const diagReport = this.lspManager.buildDiagnosticReport(filePath);
			return { content: [{ type: "text", text: `${existingText}\n\n${summary}${diagReport}` }] };
		};
	}

	private renderApp(): void {
		this.root!.render(
			<TuiApp
				key={this.sessionVersion}
				session={this.session}
				runtimeHost={this.runtimeHost}
				footerData={this.footerDataProvider}
				lspManager={this.lspManager}
				options={this.options}
				onNewSession={() => this.handleNewSession()}
			/>,
		);
	}

	async handleNewSession(): Promise<void> {
		const result = await this.runtimeHost.newSession();
		if (result.cancelled) return;
		this.session = this.runtimeHost.session;
		this.setupAfterToolCall();
		this.sessionVersion++;
		this.renderApp();
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;
		this.isInitialized = true;
	}

	async run(): Promise<void> {
		await this.init();

		this.renderer = await createCliRenderer({
			screenMode: "alternate-screen",
			exitOnCtrlC: false,
			useMouse: true,
		});

		this.root = createRoot(this.renderer);
		this.renderApp();

		await new Promise<void>((resolve) => {
			this.renderer?.on("destroy", () => resolve());
		});
		process.exit(0);
	}

	stop(): void {
		this.root?.unmount();
		this.renderer?.destroy();
		this.renderer = undefined;
		this.root = undefined;
	}

	dispose(): void {
		this.stop();
		this.footerDataProvider.dispose();
		this.lspManager.dispose().catch(() => {});
	}
}
