/**
 * Interactive CLI for configuring tool API keys.
 * Triggered by `hawcode --auth-tools`.
 *
 * Keys are stored in tools.json alongside models.json and providers.json.
 */

import { createInterface } from "node:readline";
import chalk from "chalk";
import { getToolApiKey, removeToolApiKey, setToolApiKey } from "../core/hawcode-config.js";

/** Registry of tools that require API keys. */
export interface ToolAuthEntry {
	/** Tool name used as storage key */
	name: string;
	/** Human-readable label */
	label: string;
	/** Environment variable that provides the key */
	envVar: string;
	/** Description shown in the prompt */
	description?: string;
}

/** All tools that need API key configuration. */
export const TOOL_AUTH_ENTRIES: ToolAuthEntry[] = [
	{
		name: "websearch",
		label: "Tavily Search",
		envVar: "TAVILY_API_KEY",
		description: "Web search via Tavily API (https://tavily.com)",
	},
	{
		name: "docsfetch",
		label: "Context7",
		envVar: "CONTEXT7_API_KEY",
		description: "Documentation fetch via Context7 API (https://context7.com)",
	},
];

function ask(question: string): Promise<string> {
	return new Promise((resolve) => {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

export async function runAuthTools(): Promise<void> {
	console.log(chalk.bold("\nConfiguring tool API keys\n"));
	console.log(chalk.dim("Keys are stored in tools.json. Leave blank to skip or remove a key.\n"));

	for (const entry of TOOL_AUTH_ENTRIES) {
		const existing = getToolApiKey(entry.name);
		const masked = existing
			? `${existing.slice(0, 4)}${"*".repeat(Math.max(0, existing.length - 4))}`
			: chalk.dim("not set");

		console.log(chalk.bold(`${entry.label}`) + chalk.dim(` (${entry.name})`));
		if (entry.description) {
			console.log(chalk.dim(`  ${entry.description}`));
		}
		console.log(chalk.dim(`  Env var: ${entry.envVar}`));
		console.log(`  Current: ${masked}`);

		const answer = await ask(chalk.cyan("  API key: "));

		if (answer) {
			setToolApiKey(entry.name, answer);
			console.log(chalk.green("  Saved.\n"));
		} else if (existing) {
			const remove = await ask(chalk.yellow("  Remove existing key? [y/N] "));
			if (remove.toLowerCase() === "y" || remove.toLowerCase() === "yes") {
				removeToolApiKey(entry.name);
				console.log(chalk.dim("  Removed.\n"));
			} else {
				console.log(chalk.dim("  Kept.\n"));
			}
		} else {
			console.log(chalk.dim("  Skipped.\n"));
		}
	}

	console.log(chalk.bold("Done."));
	console.log(chalk.dim("Keys can also be set via environment variables (see above).\n"));
}
