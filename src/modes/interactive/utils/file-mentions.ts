import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { globSync } from "glob";

export interface FileEntry {
	/** Display label (relative path from cwd) */
	label: string;
	/** Full absolute path */
	absolutePath: string;
	/** Whether this is a directory */
	isDirectory: boolean;
}

const IGNORE_PATTERNS = ["**/node_modules/**", "**/.git/**"];

/**
 * List files and directories matching a query, relative to cwd.
 * Recursively scans the project tree respecting .gitignore.
 * Returns entries sorted: directories first, then files, alphabetically.
 */
export function listFileEntries(cwd: string, query: string, limit = 50): FileEntry[] {
	const normalizedQuery = query.replace(/\\/g, "/");
	const showHidden = normalizedQuery.startsWith(".");

	// Build glob pattern: if query has path segments, search under that prefix
	const parts = normalizedQuery.split("/");
	const fileNamePart = parts.length > 1 ? (parts[parts.length - 1] ?? "") : normalizedQuery;
	const dirPrefix = parts.length > 1 ? parts.slice(0, -1).join("/") : "";

	// If there's a dir prefix, check that it exists before globbing
	if (dirPrefix) {
		const prefixPath = join(cwd, dirPrefix);
		if (!existsSync(prefixPath)) return [];
	}

	// Glob pattern: match everything under the prefix (or cwd), recursively
	const globBase = dirPrefix ? `${dirPrefix}/**/*` : "**/*";
	// Also match entries directly at the prefix level
	const globFlat = dirPrefix ? `${dirPrefix}/*` : "*";

	try {
		const results = globSync([globBase, globFlat], {
			cwd,
			dot: showHidden,
			ignore: IGNORE_PATTERNS,
			nodir: false,
			mark: true,
			absolute: true,
		});

		const entries: FileEntry[] = [];

		for (const fullPath of results) {
			if (entries.length >= limit * 2) break; // over-collect before filtering

			const isDir = fullPath.endsWith("/");
			const cleanPath = fullPath.replace(/\/$/, "");
			const relPath = relative(cwd, cleanPath).replace(/\\/g, "/");
			const basename = relPath.split("/").pop() ?? relPath;

			// Filter by query
			if (fileNamePart) {
				const lowerFile = fileNamePart.toLowerCase();
				if (!basename.toLowerCase().includes(lowerFile)) continue;
			}

			entries.push({
				label: relPath,
				absolutePath: cleanPath,
				isDirectory: isDir,
			});
		}

		// Sort: directories first, then alphabetically
		entries.sort((a, b) => {
			if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
			return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
		});

		return entries.slice(0, limit);
	} catch {
		return [];
	}
}

/**
 * Extract the `@query` from the input text at the current cursor position.
 * Returns the start offset of `@` and the query text (without `@`), or null if not in a mention.
 */
export function extractMentionQuery(text: string, cursorOffset: number): { atOffset: number; query: string } | null {
	// Find the last `@` before cursor that isn't preceded by a non-whitespace char
	// We scan backwards from cursor to find `@`
	let i = cursorOffset;
	while (i > 0) {
		i--;
		const ch = text[i];
		if (ch === "@") {
			// Check that char before @ is whitespace or start of string
			if (i > 0 && !/\s/.test(text[i - 1]!)) {
				// Could be part of an email or something, skip
				continue;
			}
			const query = text.slice(i + 1, cursorOffset);
			// Query should not contain spaces
			if (/\s/.test(query)) return null;
			return { atOffset: i, query };
		}
		if (/\s/.test(ch!)) {
			break;
		}
	}
	return null;
}
