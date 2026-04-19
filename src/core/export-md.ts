import { existsSync, mkdirSync, writeFileSync } from "fs";
import { basename, dirname, resolve } from "path";
import type { AgentMessage } from "../agent-core/index.js";
import type { TextContent, ToolCall } from "../ai/index.js";
import { APP_NAME } from "../config.js";
import type { SessionEntry, SessionManager, SessionMessageEntry } from "./session-manager.js";

/**
 * Escape text for Markdown rendering.
 */
function mdEscape(text: string): string {
	return text;
}

/**
 * Extract text content from a message content block.
 */
function extractText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content
		.filter((block): block is TextContent => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

/**
 * Render tool calls from an assistant message to Markdown.
 */
function renderToolCalls(toolCalls: ToolCall[]): string {
	const lines: string[] = [];
	for (const tc of toolCalls) {
		lines.push(`**Tool: \`${tc.name}\`**`);
		// Show key arguments in a code block
		const argsStr = JSON.stringify(tc.arguments, null, 2);
		lines.push("```json");
		lines.push(argsStr);
		lines.push("```");
		lines.push("");
	}
	return lines.join("\n");
}

/**
 * Render a tool result message to Markdown.
 */
function renderToolResult(msg: {
	toolName: string;
	content: Array<{ type: string; text?: string }>;
	isError: boolean;
}): string {
	const text = extractText(msg.content);
	const prefix = msg.isError ? "**Error** " : "";
	const lines: string[] = [];
	lines.push(`${prefix}**Result (\`${msg.toolName}\`):**`);
	lines.push("```");
	lines.push(text);
	lines.push("```");
	lines.push("");
	return lines.join("\n");
}

/**
 * Render a single AgentMessage to Markdown.
 */
function renderMessage(msg: AgentMessage): string {
	switch (msg.role) {
		case "user": {
			const text = extractText(msg.content);
			return `## User\n\n${mdEscape(text)}\n`;
		}
		case "assistant": {
			const parts: string[] = [];
			parts.push("## Assistant\n");

			const textBlocks: string[] = [];
			const toolCalls: ToolCall[] = [];

			if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "text") {
						textBlocks.push((block as TextContent).text);
					} else if (block.type === "toolCall") {
						toolCalls.push(block as ToolCall);
					}
					// Skip thinking blocks in markdown export
				}
			}

			if (textBlocks.length > 0) {
				parts.push(textBlocks.join("\n"));
				parts.push("");
			}

			if (toolCalls.length > 0) {
				parts.push(renderToolCalls(toolCalls));
			}

			return parts.join("\n");
		}
		case "toolResult": {
			return renderToolResult(msg);
		}
		case "bashExecution": {
			const lines: string[] = [];
			lines.push(`**Bash (\`${msg.command}\`):**`);
			if (msg.exitCode !== undefined) {
				lines.push(`Exit code: ${msg.exitCode}`);
			}
			lines.push("```");
			lines.push(msg.output);
			lines.push("```");
			lines.push("");
			return lines.join("\n");
		}
		case "compactionSummary": {
			return `> *Context compacted (${msg.tokensBefore} tokens before)*\n`;
		}
		case "branchSummary": {
			return `> *Branch summary: ${msg.summary}*\n`;
		}
		case "custom": {
			if (!msg.display) return "";
			const text = typeof msg.content === "string" ? msg.content : extractText(msg.content);
			return `## ${msg.customType}\n\n${text}\n`;
		}
		default:
			return "";
	}
}

/**
 * Export session entries to a Markdown string.
 */
export function sessionEntriesToMarkdown(
	header: ReturnType<SessionManager["getHeader"]>,
	entries: SessionEntry[],
	sessionName?: string,
): string {
	const parts: string[] = [];

	// Title
	const title = sessionName || header?.id || "session";
	parts.push(`# ${title}\n`);
	parts.push(`**Session:** ${header?.id ?? "unknown"}`);
	parts.push(`**Date:** ${header?.timestamp ?? new Date().toISOString()}`);
	parts.push(`---\n`);

	// Walk entries in tree order (current branch)
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msgEntry = entry as SessionMessageEntry;
		const rendered = renderMessage(msgEntry.message);
		if (rendered) {
			parts.push(rendered);
		}
	}

	return parts.join("\n");
}

/**
 * Export session to Markdown file.
 */
export function exportSessionToMd(sm: SessionManager, outputPath?: string): string {
	const header = sm.getHeader();
	const entries = sm.getEntries();
	const sessionName = sm.getSessionName();

	const md = sessionEntriesToMarkdown(header, entries, sessionName);

	let outPath = outputPath;
	if (!outPath) {
		const sessionBasename = header?.id ? header.id.slice(0, 8) : basename(sm.getSessionFile() ?? "session", ".jsonl");
		outPath = `${APP_NAME}-session-${sessionBasename}.md`;
	}

	outPath = resolve(outPath);
	const dir = dirname(outPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	writeFileSync(outPath, md, "utf8");
	return outPath;
}
