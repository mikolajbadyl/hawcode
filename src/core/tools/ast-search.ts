import { findInFiles, parse } from "@ast-grep/napi";
import { type Static, Type } from "@sinclair/typebox";
import { statSync } from "fs";
import path from "path";
import type { AgentTool } from "../../agent-core/index.js";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.js";
import { Text } from "../tui-stubs.js";
import { resolveToCwd } from "./path-utils.js";
import { getTextOutput, invalidArgText, shortenPath, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import type { ToolDefinition, ToolRenderResultOptions } from "./tool-types.js";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from "./truncate.js";

const astSearchSchema = Type.Object({
	pattern: Type.String({
		description:
			"AST pattern to search for, e.g. 'console.log($$$)' or 'function $NAME($$$) { $$$ }'. Use $NAME for single nodes, $$$ for multiple.",
	}),
	language: Type.String({
		description:
			"Programming language: TypeScript, Tsx, JavaScript, Python, Rust, Go, Java, C, Cpp, CSharp, Kotlin, Swift, Html, Css, Lua, etc.",
	}),
	path: Type.Optional(Type.String({ description: "File or directory to search in (default: current directory)" })),
	strictness: Type.Optional(
		Type.Union(
			[
				Type.Literal("cst", { description: "All nodes must match (most strict)" }),
				Type.Literal("smart", { description: "Skip unnamed nodes in target (default)" }),
				Type.Literal("ast", { description: "Skip unnamed nodes in both pattern and target" }),
				Type.Literal("relaxed", { description: "Skip comments and unnamed nodes" }),
				Type.Literal("signature", { description: "Only match node kinds, ignore text (least strict)" }),
			],
			{ description: "Match strictness (default: smart)" },
		),
	),
});

export type AstSearchToolInput = Static<typeof astSearchSchema>;
const DEFAULT_MATCH_LIMIT = 50;

export interface AstSearchToolDetails {
	truncation?: TruncationResult;
	matchLimitReached?: boolean;
}

function formatAstSearchCall(
	args: { pattern: string; language: string; path?: string; strictness?: string } | undefined,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): string {
	const pattern = str(args?.pattern);
	const language = str(args?.language);
	const rawPath = str(args?.path);
	const pathStr = rawPath !== null ? shortenPath(rawPath || ".") : null;
	const strictness = str(args?.strictness);
	const invalidArg = invalidArgText(theme);
	let text =
		theme.fg("toolTitle", theme.bold("ast_search")) +
		" " +
		(pattern === null ? invalidArg : theme.fg("accent", pattern ?? "")) +
		" " +
		(language === null ? invalidArg : theme.fg("toolOutput", language)) +
		theme.fg("toolOutput", ` in ${pathStr === null ? invalidArg : pathStr}`);
	if (strictness) text += theme.fg("toolOutput", ` (${strictness})`);
	return text;
}

function formatAstSearchResult(
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: AstSearchToolDetails;
	},
	options: ToolRenderResultOptions,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
	showImages: boolean,
): string {
	const output = getTextOutput(result, showImages).trim();
	let text = "";
	if (output) {
		const lines = output.split("\n");
		const maxLines = options.expanded ? lines.length : 15;
		const displayLines = lines.slice(0, maxLines);
		const remaining = lines.length - maxLines;
		text += `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
		if (remaining > 0) {
			text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
		}
	}

	const matchLimit = result.details?.matchLimitReached;
	const truncation = result.details?.truncation;
	if (matchLimit || truncation?.truncated) {
		const warnings: string[] = [];
		if (matchLimit) warnings.push(`${DEFAULT_MATCH_LIMIT} matches limit`);
		if (truncation?.truncated) warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
		text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
	}
	return text;
}

export function createAstSearchToolDefinition(
	cwd: string,
): ToolDefinition<typeof astSearchSchema, AstSearchToolDetails | undefined> {
	return {
		name: "ast_search",
		label: "ast_search",
		description: `Search code using AST pattern matching via ast-grep. Unlike text search, this understands code structure. Supports meta-variables: $NAME matches a single node, $$$ matches multiple nodes. Output is truncated to ${DEFAULT_MATCH_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
		promptSnippet: "Search code by AST structure (structural code search)",
		parameters: astSearchSchema,
		async execute(
			_toolCallId,
			{
				pattern,
				language,
				path: searchDir,
				strictness,
			}: {
				pattern: string;
				language: string;
				path?: string;
				strictness?: "cst" | "smart" | "ast" | "relaxed" | "signature";
			},
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			const searchPath = resolveToCwd(searchDir || ".", cwd);
			const effectiveStrictness = strictness ?? "smart";

			// Build the NapiConfig rule.
			const ruleConfig =
				effectiveStrictness !== "smart"
					? { rule: { pattern: { context: pattern, strictness: effectiveStrictness } } }
					: { rule: { pattern } };

			let isDirectory: boolean;
			try {
				isDirectory = statSync(searchPath).isDirectory();
			} catch {
				throw new Error(`Path not found: ${searchPath}`);
			}

			if (isDirectory) {
				// Search directory using findInFiles
				return await searchDirectory(searchPath, language, ruleConfig, cwd, signal);
			} else {
				// Search single file
				return await searchFile(searchPath, language, ruleConfig, cwd, signal);
			}
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatAstSearchCall(args, theme));
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatAstSearchResult(result as any, options, theme, context.showImages));
			return text;
		},
	};
}

interface RawMatch {
	filePath: string;
	line: number;
	column: number;
	text: string;
}

async function searchDirectory(
	searchPath: string,
	language: string,
	ruleConfig: { rule: any },
	_cwd: string,
	signal?: AbortSignal,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: AstSearchToolDetails | undefined }> {
	const matches: RawMatch[] = [];
	let matchLimitReached = false;

	const findConfig = {
		paths: [searchPath],
		matcher: ruleConfig,
	};

	await findInFiles(language as any, findConfig, (_err, nodes) => {
		if (signal?.aborted) return;
		for (const node of nodes) {
			if (matches.length >= DEFAULT_MATCH_LIMIT) {
				matchLimitReached = true;
				break;
			}
			const range = node.range();
			const filePath = node.getRoot().filename();
			matches.push({
				filePath,
				line: range.start.line + 1, // 1-indexed
				column: range.start.column + 1, // 1-indexed
				text: node.text(),
			});
		}
	});

	if (signal?.aborted) throw new Error("Operation aborted");

	if (matches.length === 0) {
		return { content: [{ type: "text", text: "No matches found" }], details: undefined };
	}

	const outputLines = matches.map((m) => {
		const relativePath = formatRelativePath(m.filePath, searchPath);
		return `${relativePath}:${m.line}:${m.column}: ${m.text}`;
	});

	return buildOutput(outputLines, matchLimitReached);
}

async function searchFile(
	filePath: string,
	language: string,
	ruleConfig: { rule: any },
	_cwd: string,
	signal?: AbortSignal,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: AstSearchToolDetails | undefined }> {
	if (signal?.aborted) throw new Error("Operation aborted");

	const { readFileSync } = await import("fs");
	let source: string;
	try {
		source = readFileSync(filePath, "utf-8");
	} catch {
		throw new Error(`Cannot read file: ${filePath}`);
	}

	let root: any;
	try {
		root = parse(language as any, source);
	} catch (e: any) {
		throw new Error(`Failed to parse ${filePath} as ${language}: ${e.message}`);
	}

	const nodes = root.findAll(ruleConfig as any);
	const matches: RawMatch[] = [];
	let matchLimitReached = false;

	for (const node of nodes) {
		if (matches.length >= DEFAULT_MATCH_LIMIT) {
			matchLimitReached = true;
			break;
		}
		const range = node.range();
		matches.push({
			filePath,
			line: range.start.line + 1,
			column: range.start.column + 1,
			text: node.text(),
		});
	}

	if (matches.length === 0) {
		return { content: [{ type: "text", text: "No matches found" }], details: undefined };
	}

	const outputLines = matches.map((m) => {
		const relativePath = path.basename(m.filePath);
		return `${relativePath}:${m.line}:${m.column}: ${m.text}`;
	});

	return buildOutput(outputLines, matchLimitReached);
}

function formatRelativePath(filePath: string, searchPath: string): string {
	const relative = path.relative(searchPath, filePath);
	if (relative && !relative.startsWith("..")) {
		return relative.replace(/\\/g, "/");
	}
	return path.basename(filePath);
}

function buildOutput(
	outputLines: string[],
	matchLimitReached: boolean,
): { content: Array<{ type: "text"; text: string }>; details: AstSearchToolDetails | undefined } {
	const rawOutput = outputLines.join("\n");
	const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
	let output = truncation.content;
	const details: AstSearchToolDetails = {};
	const notices: string[] = [];

	if (matchLimitReached) {
		notices.push(`${DEFAULT_MATCH_LIMIT} matches limit reached. Refine pattern for more specific results`);
		details.matchLimitReached = true;
	}
	if (truncation.truncated) {
		notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
		details.truncation = truncation;
	}
	if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;

	return {
		content: [{ type: "text", text: output }],
		details: Object.keys(details).length > 0 ? details : undefined,
	};
}

export function createAstSearchTool(cwd: string): AgentTool<typeof astSearchSchema> {
	return wrapToolDefinition(createAstSearchToolDefinition(cwd));
}

/** Default AST search tool using process.cwd(). */
export const astSearchToolDefinition = createAstSearchToolDefinition(process.cwd());
export const astSearchTool = createAstSearchTool(process.cwd());
