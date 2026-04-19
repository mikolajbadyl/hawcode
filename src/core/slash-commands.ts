import type { SourceInfo } from "./source-info.js";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "models", description: "Switch model" },
	{ name: "export", description: "Export session to HTML or JSONL" },
	{ name: "session", description: "Show session info and stats" },
	{ name: "new", description: "Start a new session" },
	{ name: "compact", description: "Compact session context" },
	{ name: "reload", description: "Reload config and resources" },
	{ name: "usage", description: "Show API usage info" },
	{ name: "lsp", description: "Toggle LSP diagnostics on/off" },
	{ name: "quit", description: "Quit hawcode" },
];
