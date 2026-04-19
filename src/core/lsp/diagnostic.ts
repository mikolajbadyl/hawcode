import type { Diagnostic } from "./lsp-client.js";

const MAX_PER_FILE = 20;

export function prettyDiagnostic(diagnostic: Diagnostic): string {
	const severityMap: Record<number, string> = {
		1: "ERROR",
		2: "WARN",
		3: "INFO",
		4: "HINT",
	};
	const severity = severityMap[diagnostic.severity ?? 1] ?? "ERROR";
	const line = diagnostic.range.start.line + 1;
	const col = diagnostic.range.start.character + 1;
	return `${severity} [${line}:${col}] ${diagnostic.message}`;
}

export function formatDiagnosticReport(file: string, issues: Diagnostic[]): string {
	const errors = issues.filter((item) => item.severity === 1);
	if (errors.length === 0) return "";
	const limited = errors.slice(0, MAX_PER_FILE);
	const more = errors.length - MAX_PER_FILE;
	const suffix = more > 0 ? `\n... and ${more} more` : "";
	return `<diagnostics file="${file}">\n${limited.map(prettyDiagnostic).join("\n")}${suffix}\n</diagnostics>`;
}

export function countErrors(diagnostics: Diagnostic[]): number {
	return diagnostics.filter((d) => d.severity === 1).length;
}

export function countWarnings(diagnostics: Diagnostic[]): number {
	return diagnostics.filter((d) => d.severity === 2).length;
}
