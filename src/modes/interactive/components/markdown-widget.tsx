/**
 * Simple markdown renderer for OpenTUI.
 * Only renders: headings (colored), code blocks (colored), inline code (colored).
 * Bold/italic shown as plain text.
 */

import { marked } from "marked";
import React from "react";

interface MarkdownWidgetProps {
	content: string;
	width?: number;
}

import { colors } from "./colors.js";

// Use centralized palette
const COLORS = {
	mdHeading: colors.mdHeading,
	mdCode: colors.mdCode,
	mdCodeBlock: colors.mdCodeBlock,
	mdQuoteBorder: colors.mdQuoteBorder,
	mdQuote: colors.mdQuote,
	mdListBullet: colors.mdListBullet,
	mdItalic: colors.mdItalic,
	mdHr: colors.mdHr,
};

// Inline markdown parse: `code`, ``code``, **bold**, *italic*
function parseInline(text: string): React.ReactNode {
	const parts: React.ReactNode[] = [];
	// Match patterns: ``code``, `code`, **bold**, *italic* (order matters)
	const pattern = /(``)(.+?)\1|(`)(.+?)\3|(\*\*)(.+?)\5|(\*)(.+?)\7/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	let key = 0;

	while ((match = pattern.exec(text)) !== null) {
		// Text before this match
		if (match.index > lastIndex) {
			parts.push(text.slice(lastIndex, match.index));
		}

		if (match[1]) {
			// ``code`` - match[2]
			parts.push(React.createElement("strong", { key: key++, fg: COLORS.mdCode }, match[2]));
		} else if (match[3]) {
			// `code` - match[4]
			parts.push(React.createElement("span", { key: key++, fg: COLORS.mdCode }, match[4]));
		} else if (match[5]) {
			// **bold** - match[6]
			parts.push(React.createElement("strong", { key: key++ }, match[6]));
		} else if (match[7]) {
			// *italic* - match[8]
			parts.push(React.createElement("span", { key: key++, fg: COLORS.mdItalic }, match[8]));
		}

		lastIndex = match.index + match[0].length;
	}

	// Remaining text after last match
	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}

	return parts.length === 1 ? parts[0] : parts;
}

export function MarkdownWidget({ content, width = 80 }: MarkdownWidgetProps): React.ReactNode {
	if (!content) return null;

	const tokens = marked.lexer(content);
	const elements: React.ReactNode[] = [];
	let key = 0;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const tok of tokens) {
		switch (tok.type) {
			case "heading": {
				const text = tok.tokens ? parseInline(tok.text) : tok.text;
				elements.push(React.createElement("text", { key: key++, fg: COLORS.mdHeading }, text));
				break;
			}

			case "paragraph": {
				elements.push(React.createElement("text", { key: key++ }, parseInline(tok.text)));
				break;
			}

			case "code": {
				const lang = tok.lang || "";
				elements.push(React.createElement("text", { key: key++, fg: COLORS.mdCodeBlock }, `\`\`\`${lang}`));
				for (const line of tok.text.split("\n")) {
					elements.push(React.createElement("text", { key: key++, fg: COLORS.mdCodeBlock }, `  ${line}`));
				}
				elements.push(React.createElement("text", { key: key++, fg: COLORS.mdCodeBlock }, "```"));
				break;
			}

			case "blockquote": {
				for (const line of tok.text.split("\n")) {
					elements.push(React.createElement("text", { key: key++, fg: COLORS.mdQuoteBorder }, `│ ${line}`));
				}
				break;
			}

			case "list": {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				for (let i = 0; i < tok.items.length; i++) {
					const item = tok.items[i] as any;
					const bullet = tok.ordered ? `${i + 1}.` : "•";
					const text = parseInline(item.text || "");
					elements.push(React.createElement("text", { key: key++ }, `${bullet} `, text));
				}
				break;
			}

			case "hr": {
				elements.push(React.createElement("text", { key: key++, fg: COLORS.mdHr }, "─".repeat(width)));
				break;
			}

			case "space": {
				elements.push(React.createElement("text", { key: key++ }, ""));
				break;
			}

			case "table": {
				// Render markdown table as aligned text columns
				const headerTexts = tok.header.map((h: any) => h.text ?? "");
				const rowTexts = tok.rows.map((row: any[]) => row.map((cell: any) => cell.text ?? ""));
				const allRows = [headerTexts, ...rowTexts];
				const colCount = headerTexts.length;

				// Calculate column widths
				const colWidths: number[] = [];
				for (let c = 0; c < colCount; c++) {
					colWidths.push(Math.max(...allRows.map((r: string[]) => (r[c] ?? "").length)));
				}

				// Render header row
				const headerLine = headerTexts.map((t: string, i: number) => t.padEnd(colWidths[i])).join(" │ ");
				elements.push(React.createElement("text", { key: key++, fg: COLORS.mdHeading }, headerLine));

				// Render separator
				const sepLine = colWidths.map((w: number) => "─".repeat(w)).join("─┼─");
				elements.push(React.createElement("text", { key: key++, fg: COLORS.mdHr }, sepLine));

				// Render data rows
				for (const row of rowTexts) {
					const line = row.map((t: string, i: number) => t.padEnd(colWidths[i])).join(" │ ");
					elements.push(React.createElement("text", { key: key++ }, parseInline(line)));
				}
				break;
			}

			case "html":
			case "text": {
				elements.push(React.createElement("text", { key: key++ }, tok.text || tok.raw || ""));
				break;
			}
		}
	}

	if (elements.length === 0) return null;
	return React.createElement(React.Fragment, null, ...elements);
}
