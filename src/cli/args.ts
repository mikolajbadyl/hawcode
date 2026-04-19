/**
 * CLI argument parsing and help display
 */

import chalk from "chalk";
import { APP_NAME, CONFIG_DIR_NAME, ENV_AGENT_DIR } from "../config.js";
import { allTools, type ToolName } from "../core/tools/index.js";

export interface Args {
	model?: string;
	continue?: boolean;
	resume?: boolean;
	help?: boolean;
	version?: boolean;
	login?: boolean;
	tools?: ToolName[];
	export?: string;
	authTools?: boolean;
	reloadCache?: boolean;
	messages: string[];
	fileArgs: string[];
	/** Unknown flags (potentially extension flags) - map of flag name to value */
	unknownFlags: Map<string, boolean | string>;
	diagnostics: Array<{ type: "warning" | "error"; message: string }>;
}

export function parseArgs(args: string[]): Args {
	const result: Args = {
		messages: [],
		fileArgs: [],
		unknownFlags: new Map(),
		diagnostics: [],
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg === "--version" || arg === "-v") {
			result.version = true;
		} else if (arg === "--login") {
			result.login = true;
		} else if (arg === "--continue" || arg === "-c") {
			result.continue = true;
		} else if (arg === "--resume" || arg === "-r") {
			result.resume = true;
		} else if (arg === "--model" && i + 1 < args.length) {
			result.model = args[++i];
		} else if (arg === "--tools" && i + 1 < args.length) {
			const toolNames = args[++i].split(",").map((s) => s.trim());
			const validTools: ToolName[] = [];
			for (const name of toolNames) {
				if (name in allTools) {
					validTools.push(name as ToolName);
				} else {
					result.diagnostics.push({
						type: "warning",
						message: `Unknown tool "${name}". Valid tools: ${Object.keys(allTools).join(", ")}`,
					});
				}
			}
			result.tools = validTools;
		} else if (arg === "--export" && i + 1 < args.length) {
			result.export = args[++i];
		} else if (arg === "--auth-tools") {
			result.authTools = true;
		} else if (arg === "--reload-cache") {
			result.reloadCache = true;
		} else if (arg.startsWith("@")) {
			result.fileArgs.push(arg.slice(1)); // Remove @ prefix
		} else if (arg.startsWith("--")) {
			const eqIndex = arg.indexOf("=");
			if (eqIndex !== -1) {
				result.unknownFlags.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1));
			} else {
				const flagName = arg.slice(2);
				const next = args[i + 1];
				if (next !== undefined && !next.startsWith("-") && !next.startsWith("@")) {
					result.unknownFlags.set(flagName, next);
					i++;
				} else {
					result.unknownFlags.set(flagName, true);
				}
			}
		} else if (arg.startsWith("-") && !arg.startsWith("--")) {
			result.diagnostics.push({ type: "error", message: `Unknown option: ${arg}` });
		} else if (!arg.startsWith("-")) {
			result.messages.push(arg);
		}
	}

	return result;
}

export function printHelp(): void {
	console.log(`${chalk.bold(APP_NAME)} - AI coding assistant

${chalk.bold("Usage:")}
  ${APP_NAME} [options] [@files...] [messages...]

${chalk.bold("Commands:")}
  ${APP_NAME} --login                   Interactive setup wizard for providers and models
  ${APP_NAME} --auth-tools              Configure API keys for built-in tools
  ${APP_NAME} <command> --help          Show help for install/remove/uninstall/update/list

${chalk.bold("Options:")}
  --model <pattern>              Model pattern or ID (supports "provider/id" and optional ":<thinking>")
  --continue, -c                 Continue previous session
  --resume, -r                   Select a session to resume
  --tools <tools>                Comma-separated list of tools to enable (default: read,bash,edit,write)
  --export <file>                Export session file to HTML and exit
  --reload-cache                 Force refresh model metadata cache from GitHub
  --auth-tools                   Configure API keys for built-in tools
  --help, -h                     Show this help
  --version, -v                  Show version number


${chalk.bold("Environment Variables:")}
  ${ENV_AGENT_DIR.padEnd(32)} Session storage directory (default: ~/${CONFIG_DIR_NAME}/agent)
  TAVILY_API_KEY                   Tavily Search API key for websearch tool
  CONTEXT7_API_KEY                 Context7 API key for docsfetch tool
`);
}
