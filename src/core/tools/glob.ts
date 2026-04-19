import { type Static, Type } from "@sinclair/typebox";
import fg from "fast-glob";
import { existsSync, readFileSync } from "fs";
import ignore from "ignore";
import path from "path";
import type { AgentTool } from "../../agent-core/index.js";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.js";
import { Text } from "../tui-stubs.js";
import { resolveToCwd } from "./path-utils.js";
import { invalidArgText, shortenPath, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import type { ToolDefinition, ToolRenderResultOptions } from "./tool-types.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const globSchema = Type.Object({
	pattern: Type.Union([Type.String(), Type.Array(Type.String())], {
		description:
			"Glob pattern(s) to match files. Supports negation (!pattern), brace expansion ({a,b}), extglob. Example: '**/*.ts' or ['src/**/*.ts', '!**/*.d.ts'].",
	}),
	path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
	type: Type.Optional(
		Type.Union([Type.Literal("files"), Type.Literal("directories"), Type.Literal("all")], {
			description: 'What to return: "files", "directories", or "all" (default: "files")',
		}),
	),
	sort: Type.Optional(
		Type.Union([Type.Literal("mtime"), Type.Literal("name"), Type.Literal("none")], {
			description:
				'Sort order: "mtime" = newest first, "name" = alphabetical, "none" = as-is (default: "mtime"). Limit is applied AFTER sort.',
		}),
	),
	dot: Type.Optional(Type.Boolean({ description: "Allow matching entries that begin with a dot (default: false)" })),
	deep: Type.Optional(
		Type.Union([Type.Number(), Type.Null()], {
			description: "Maximum directory depth. null = no limit (default: null)",
		}),
	),
	ignore: Type.Optional(
		Type.Array(Type.String(), {
			description: "Additional glob patterns to exclude (merged with defaults if ignoreDefaults is true)",
		}),
	),
	ignoreDefaults: Type.Optional(
		Type.Boolean({
			description:
				"Apply built-in exclusions: node_modules, .git, dist, build, .next, .venv, __pycache__, target, .turbo, coverage (default: true)",
		}),
	),
	respectGitignore: Type.Optional(
		Type.Boolean({ description: "Read .gitignore and auto-exclude matching paths (default: true)" }),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 100)" })),
});

export type GlobToolInput = Static<typeof globSchema>;

const DEFAULT_LIMIT = 100;

const DEFAULT_IGNORE_PATTERNS = [
	"**/node_modules/**",
	"**/.git/**",
	"**/dist/**",
	"**/build/**",
	"**/.next/**",
	"**/.venv/**",
	"**/__pycache__/**",
	"**/target/**",
	"**/.turbo/**",
	"**/coverage/**",
];

// ---------------------------------------------------------------------------
// Details (internal, for TUI rendering)
// ---------------------------------------------------------------------------

export interface GlobToolDetails {
	truncated: boolean;
	count: number;
}

// ---------------------------------------------------------------------------
// Pluggable operations
// ---------------------------------------------------------------------------

export interface GlobEntry {
	path: string;
	mtimeMs?: number;
}

export interface GlobRunOptions {
	dot: boolean;
	deep: number;
	onlyFiles: boolean;
	onlyDirectories: boolean;
	ignore: string[];
	withStats: boolean;
}

export interface GlobOperations {
	exists: (absolutePath: string) => Promise<boolean> | boolean;
	glob: (pattern: string | string[], cwd: string, options: GlobRunOptions) => Promise<GlobEntry[]> | GlobEntry[];
	readFile: (absolutePath: string) => Promise<string> | string;
}

const defaultGlobOperations: GlobOperations = {
	exists: existsSync,
	glob(pattern, cwd, options) {
		const fgOptions: fg.Options = {
			cwd,
			dot: options.dot,
			deep: options.deep,
			onlyFiles: options.onlyFiles,
			onlyDirectories: options.onlyDirectories,
			ignore: options.ignore,
			unique: true,
		};
		if (options.withStats) {
			const entries = fg.sync(pattern, {
				...fgOptions,
				objectMode: true,
				stats: true,
			}) as fg.Entry[];
			return entries.map((e) => ({ path: e.path, mtimeMs: e.stats?.mtimeMs ?? 0 }));
		}
		const paths = fg.sync(pattern, fgOptions) as string[];
		return paths.map((p) => ({ path: p }));
	},
	readFile(p) {
		return readFileSync(p, "utf-8");
	},
};

export interface GlobToolOptions {
	operations?: GlobOperations;
}

// ---------------------------------------------------------------------------
// TUI formatting helpers
// ---------------------------------------------------------------------------

function formatGlobCall(
	args: GlobToolInput | undefined,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): string {
	const pattern = args?.pattern;
	const rawPath = str(args?.path);
	const dir = rawPath !== null ? shortenPath(rawPath || ".") : null;
	const limit = args?.limit;
	const sort = args?.sort;
	const type = args?.type;
	const invalidArg = invalidArgText(theme);

	const patternStr = Array.isArray(pattern)
		? pattern.map((p) => theme.fg("accent", p)).join(", ")
		: pattern != null
			? theme.fg("accent", pattern)
			: invalidArg;

	let text = `${theme.fg("toolTitle", theme.bold("glob"))} ${patternStr}${theme.fg("toolOutput", ` in ${dir === null ? invalidArg : dir}`)}`;
	if (type && type !== "files") text += theme.fg("toolOutput", ` (${type})`);
	if (sort && sort !== "mtime") text += theme.fg("toolOutput", ` sort:${sort}`);
	if (limit !== undefined) text += theme.fg("toolOutput", ` limit:${limit}`);
	return text;
}

function formatGlobResult(
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: GlobToolDetails;
	},
	options: ToolRenderResultOptions,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): string {
	const details = result.details;
	if (!details) return "";

	// Parse JSON output to extract paths for display.
	let paths: string[] = [];
	const rawText = result.content.find((c) => c.type === "text")?.text ?? "";
	try {
		const parsed = JSON.parse(rawText);
		paths = parsed.paths ?? [];
	} catch {
		paths = rawText
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
	}

	if (paths.length === 0) {
		return theme.fg("muted", "No files found matching pattern");
	}

	const maxLines = options.expanded ? paths.length : 20;
	const displayPaths = paths.slice(0, maxLines);
	const remaining = paths.length - maxLines;

	const summary = theme.fg("muted", `${details.count} result${details.count !== 1 ? "s" : ""}`);
	let text = `\n${summary}`;
	text += `\n${displayPaths.map((p) => theme.fg("toolOutput", p)).join("\n")}`;
	if (remaining > 0) {
		text += `${theme.fg("muted", `\n... (${remaining} more,`)} ${keyHint("app.tools.expand", "to expand")})`;
	}

	if (details.truncated) {
		text += `\n${theme.fg("warning", `[Truncated: results limit reached]`)}`;
	}
	return text;
}

// ---------------------------------------------------------------------------
// Tool definition factory
// ---------------------------------------------------------------------------

export function createGlobToolDefinition(
	cwd: string,
	options?: GlobToolOptions,
): ToolDefinition<typeof globSchema, GlobToolDetails | undefined> {
	const customOps = options?.operations;

	return {
		name: "glob",
		label: "glob",
		description: `Fast file globbing using fast-glob. Supports multiple patterns, negation, and filtering. Respects .gitignore and excludes common build dirs (node_modules, .git, dist, build, .next, .venv, __pycache__, target, .turbo, coverage) by default — set \`ignoreDefaults: false\` or \`respectGitignore: false\` to disable. Returns JSON: {"paths":[...],"truncated":bool,"count":number}. Default limit: ${DEFAULT_LIMIT}. Sorted by mtime (newest first) by default. Limit applied after sort.`,
		promptSnippet: "Glob files (multi-pattern, negation, sort by mtime; respects .gitignore)",
		parameters: globSchema,
		async execute(
			_toolCallId,
			{
				pattern,
				path: searchDir,
				type: entryType,
				sort,
				dot,
				deep,
				ignore: userIgnore,
				ignoreDefaults,
				respectGitignore,
				limit,
			}: GlobToolInput,
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			return new Promise((resolve, reject) => {
				if (signal?.aborted) {
					reject(new Error("Operation aborted"));
					return;
				}

				const onAbort = () => reject(new Error("Operation aborted"));
				signal?.addEventListener("abort", onAbort, { once: true });

				(async () => {
					try {
						const searchPath = resolveToCwd(searchDir || ".", cwd);
						const effectiveLimit = limit ?? DEFAULT_LIMIT;
						const effectiveSort = sort ?? "mtime";
						const ops = customOps ?? defaultGlobOperations;

						if (!(await ops.exists(searchPath))) {
							reject(new Error(`Path not found: ${searchPath}`));
							return;
						}

						// Build ignore list.
						const ignorePatterns: string[] = [];
						if (ignoreDefaults !== false) {
							ignorePatterns.push(...DEFAULT_IGNORE_PATTERNS);
						}
						if (userIgnore && userIgnore.length > 0) {
							ignorePatterns.push(...userIgnore);
						}

						// Map type param to fast-glob options.
						const resolvedType = entryType ?? "files";
						const onlyFiles = resolvedType === "files";
						const onlyDirectories = resolvedType === "directories";

						// Run glob.
						const entries = await ops.glob(pattern, searchPath, {
							dot: dot ?? false,
							deep: deep ?? Infinity,
							onlyFiles,
							onlyDirectories,
							ignore: ignorePatterns,
							withStats: effectiveSort === "mtime",
						});

						// Apply gitignore filter.
						let filtered = entries;
						if (respectGitignore !== false) {
							const gitignorePatterns = await loadGitignore(searchPath, ops);
							if (gitignorePatterns.length > 0) {
								const ig = ignore().add(gitignorePatterns);
								filtered = entries.filter((e) => !ig.ignores(e.path));
							}
						}

						// Sort.
						if (effectiveSort === "mtime") {
							filtered.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0));
						} else if (effectiveSort === "name") {
							filtered.sort((a, b) => a.path.localeCompare(b.path));
						}
						// "none" → keep traversal order.

						// Apply limit AFTER sort.
						const truncated = filtered.length > effectiveLimit;
						const limited = filtered.slice(0, effectiveLimit);
						const paths = limited.map((e) => e.path);

						signal?.removeEventListener("abort", onAbort);

						const resultText = JSON.stringify({
							paths,
							truncated,
							count: paths.length,
						});

						resolve({
							content: [{ type: "text", text: resultText }],
							details: { truncated, count: paths.length },
						});
					} catch (e: any) {
						signal?.removeEventListener("abort", onAbort);
						reject(e);
					}
				})();
			});
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatGlobCall(args, theme));
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatGlobResult(result as any, options, theme));
			return text;
		},
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadGitignore(searchPath: string, ops: GlobOperations): Promise<string[]> {
	const gitignorePath = path.join(searchPath, ".gitignore");
	try {
		if (!(await ops.exists(gitignorePath))) return [];
		const content = await ops.readFile(gitignorePath);
		return content
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("#"));
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Convenience exports
// ---------------------------------------------------------------------------

export function createGlobTool(cwd: string, options?: GlobToolOptions): AgentTool<typeof globSchema> {
	return wrapToolDefinition(createGlobToolDefinition(cwd, options));
}

/** Default glob tool using process.cwd() for backwards compatibility. */
export const globToolDefinition = createGlobToolDefinition(process.cwd());
export const globTool = createGlobTool(process.cwd());
