/**
 * Documentation search tool using the Context7 API.
 * Resolves library names to IDs and retrieves relevant documentation.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Context7 } from "@upstash/context7-sdk";
import type { AgentTool } from "../../agent-core/index.js";
import { getToolApiKey } from "../hawcode-config.js";
import { Text } from "../tui-stubs.js";
import { invalidArgText, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import type { ToolDefinition } from "./tool-types.js";

const docsFetchSchema = Type.Object({
	query: Type.String({ description: "Question or topic to search documentation for" }),
	libraryName: Type.String({ description: "Library or package name (e.g., 'react', 'express', 'nextjs')" }),
});

export type DocsFetchToolInput = Static<typeof docsFetchSchema>;

/**
 * Pluggable operations for the docs_search tool.
 * Override these to delegate to remote systems.
 */
export interface DocsFetchOperations {
	resolveLibrary: (libraryName: string, query: string) => Promise<DocsFetchLibrary | null>;
	getDocs: (libraryId: string, query: string) => Promise<string>;
}

export interface DocsFetchLibrary {
	id: string;
	name: string;
	description: string;
	totalSnippets: number;
}

const defaultDocsFetchOperations: DocsFetchOperations = {
	async resolveLibrary(libraryName, query): Promise<DocsFetchLibrary | null> {
		const apiKey = process.env.CONTEXT7_API_KEY || getToolApiKey("docsfetch");
		if (!apiKey) {
			throw new Error("CONTEXT7_API_KEY is not set. Run `hawcode --auth-tools` to configure.");
		}
		const client = new Context7({ apiKey });
		const libraries = await client.searchLibrary(query, libraryName);
		if (libraries.length === 0) return null;
		const lib = libraries[0];
		return {
			id: lib.id,
			name: lib.name,
			description: lib.description,
			totalSnippets: lib.totalSnippets,
		};
	},

	async getDocs(libraryId, query): Promise<string> {
		const apiKey = process.env.CONTEXT7_API_KEY || getToolApiKey("docsfetch");
		if (!apiKey) {
			throw new Error("CONTEXT7_API_KEY is not set. Run `hawcode --auth-tools` to configure.");
		}
		const client = new Context7({ apiKey });
		const docs = await client.getContext(query, libraryId, { type: "txt" });
		return docs;
	},
};

export function createDocsFetchToolDefinition(
	operations?: DocsFetchOperations,
): ToolDefinition<typeof docsFetchSchema, undefined> {
	const ops = operations ?? defaultDocsFetchOperations;
	return {
		name: "docsfetch",
		label: "docsfetch",
		description:
			"Search official documentation for any library, framework, or package. Returns relevant documentation snippets with code examples. Use this when you need up-to-date API references, configuration details, or usage patterns for specific libraries.",
		promptSnippet: "Search library documentation for up-to-date API references",
		promptGuidelines: [
			"Use docsfetch for library-specific questions (APIs, configuration, version-specific behavior).",
			"Always prefer docsfetch over websearch for library documentation queries.",
			"Provide the exact library name (e.g., 'nextjs' not 'next.js') for best results.",
		],
		parameters: docsFetchSchema,
		async execute(
			_toolCallId,
			{ query, libraryName }: { query: string; libraryName: string },
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			if (signal?.aborted) {
				throw new Error("Operation aborted");
			}

			const library = await ops.resolveLibrary(libraryName, query);
			if (!library) {
				return {
					content: [
						{ type: "text" as const, text: `No library found matching "${libraryName}". Try a different name.` },
					],
					details: undefined,
				};
			}

			const docs = await ops.getDocs(library.id, query);
			const header = `Library: ${library.name} (${library.id})\n${library.totalSnippets} snippets available\n`;
			return {
				content: [{ type: "text" as const, text: header + docs }],
				details: undefined,
			};
		},
		renderCall(args, theme, context) {
			const libraryName = str(args?.libraryName);
			const query = str(args?.query);
			const invalidArg = invalidArgText(theme);
			const libDisplay = libraryName ? theme.fg("accent", libraryName) : invalidArg;
			const queryDisplay = query ? theme.fg("accent", query) : "";
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(
				`${theme.fg("toolTitle", theme.bold("docsfetch"))} ${libDisplay}${queryDisplay ? ` ${queryDisplay}` : ""}`,
			);
			return text;
		},
		renderResult(result, _options, theme, context) {
			const output = result.content
				.filter((c) => c.type === "text")
				.map((c) => (c as { text?: string }).text || "")
				.join("\n");
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			if (context.isError) {
				text.setText(`\n${theme.fg("error", output)}`);
			} else {
				text.setText(
					`\n${output
						.split("\n")
						.map((line) => theme.fg("toolOutput", line))
						.join("\n")}`,
				);
			}
			return text;
		},
	};
}

export function createDocsFetchTool(operations?: DocsFetchOperations): AgentTool<typeof docsFetchSchema> {
	return wrapToolDefinition(createDocsFetchToolDefinition(operations));
}

/** Default docsfetch tool. */
export const docsFetchToolDefinition = createDocsFetchToolDefinition();
export const docsFetchTool = createDocsFetchTool();
