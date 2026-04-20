/**
 * bg-output tool — check status and output of a background process.
 */

import { type Static, Type } from "@sinclair/typebox";
import type { AgentTool } from "../../agent-core/index.js";
import { theme } from "../../modes/interactive/theme/theme.js";
import type { BackgroundProcessManager } from "../background-processes.js";
import { Text } from "../tui-stubs.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import type { ToolDefinition } from "./tool-types.js";
import { DEFAULT_MAX_LINES, truncateTail } from "./truncate.js";

const bgOutputSchema = Type.Object({
	id: Type.String({ description: "Background process ID (e.g. 'bg1')" }),
});

export type BgOutputToolInput = Static<typeof bgOutputSchema>;

export function createBgOutputToolDefinition(
	bgManager: BackgroundProcessManager,
): ToolDefinition<typeof bgOutputSchema> {
	return {
		name: "bg-output",
		label: "bg-output",
		description: `Check the status and output of a background process started with bash run_in_background=true. Returns the process status (running/completed/killed), exit code, and accumulated output (truncated to last ${DEFAULT_MAX_LINES} lines).`,
		promptSnippet: "Check background process output and status",
		parameters: bgOutputSchema,
		async execute(_toolCallId, { id }: { id: string }, _signal?, _onUpdate?, _ctx?) {
			const result = bgManager.getOutput(id);
			if (!result) {
				throw new Error(`No background process found with ID: ${id}`);
			}
			const truncation = truncateTail(result.output);
			let output = truncation.content || "(no output yet)";
			if (truncation.truncated) {
				output += `\n\n[Truncated: showing last ${truncation.outputLines} of ${truncation.totalLines} lines]`;
			}
			const statusLine =
				result.status === "running"
					? `Status: running`
					: `Status: ${result.status} (exit code: ${result.exitCode ?? "unknown"})`;
			return {
				content: [{ type: "text", text: `${statusLine}\n\n${output}` }],
				details: {},
			};
		},
		renderCall(args, _theme, _context) {
			const id = (args as { id?: string })?.id ?? "?";
			return new Text(theme.fg("toolTitle", `bg-output(${id})`), 0, 0);
		},
		renderResult(result, _options, _theme, _context) {
			const text = (result.content as Array<{ type: string; text?: string }>)
				.filter((c) => c.type === "text")
				.map((c) => c.text ?? "")
				.join("\n");
			return new Text(`\n${theme.fg("toolOutput", text)}`, 0, 0);
		},
	};
}

export function createBgOutputTool(bgManager: BackgroundProcessManager): AgentTool<typeof bgOutputSchema> {
	return wrapToolDefinition(createBgOutputToolDefinition(bgManager));
}
