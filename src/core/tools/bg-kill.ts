/**
 * bg-kill tool — kill a background process by ID.
 */

import { type Static, Type } from "@sinclair/typebox";
import type { AgentTool } from "../../agent-core/index.js";
import { theme } from "../../modes/interactive/theme/theme.js";
import type { BackgroundProcessManager } from "../background-processes.js";
import { Text } from "../tui-stubs.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import type { ToolDefinition } from "./tool-types.js";

const bgKillSchema = Type.Object({
	id: Type.String({ description: "Background process ID to kill (e.g. 'bg1')" }),
});

export type BgKillToolInput = Static<typeof bgKillSchema>;

export function createBgKillToolDefinition(bgManager: BackgroundProcessManager): ToolDefinition<typeof bgKillSchema> {
	return {
		name: "bg-kill",
		label: "bg-kill",
		description:
			"Kill a background process by ID. Returns success or error if the process was not found or already stopped.",
		promptSnippet: "Kill a background process",
		parameters: bgKillSchema,
		async execute(_toolCallId, { id }: { id: string }, _signal?, _onUpdate?, _ctx?) {
			const proc = bgManager.get(id);
			if (!proc) {
				throw new Error(`No background process found with ID: ${id}`);
			}
			if (proc.status !== "running") {
				return {
					content: [
						{
							type: "text",
							text: `Process ${id} is already ${proc.status} (exit code: ${proc.exitCode ?? "unknown"})`,
						},
					],
					details: {},
				};
			}
			const killed = bgManager.kill(id);
			if (killed) {
				return {
					content: [{ type: "text", text: `Process ${id} killed successfully.` }],
					details: {},
				};
			}
			throw new Error(`Failed to kill process ${id}`);
		},
		renderCall(args, _theme, _context) {
			const id = (args as { id?: string })?.id ?? "?";
			return new Text(theme.fg("toolTitle", `bg-kill(${id})`), 0, 0);
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

export function createBgKillTool(bgManager: BackgroundProcessManager): AgentTool<typeof bgKillSchema> {
	return wrapToolDefinition(createBgKillToolDefinition(bgManager));
}
