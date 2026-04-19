/**
 * Web search tool using the Tavily Search API.
 * Searches the web and returns results with titles, URLs, and content.
 */

import { type Static, Type } from "@sinclair/typebox";
import { tavily } from "@tavily/core";
import type { AgentTool } from "../../agent-core/index.js";
import { getToolApiKey } from "../hawcode-config.js";
import { Text } from "../tui-stubs.js";
import { invalidArgText, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import type { ToolDefinition } from "./tool-types.js";

const websearchSchema = Type.Object({
	query: Type.String({ description: "Natural language search query" }),
	numResults: Type.Optional(Type.Number({ description: "Number of results to return (default: 5, max: 10)" })),
});

export type WebsearchToolInput = Static<typeof websearchSchema>;

/**
 * Pluggable operations for the websearch tool.
 * Override these to delegate search to remote systems.
 */
export interface WebsearchOperations {
	search: (query: string, options: { numResults?: number }) => Promise<WebsearchResult[]>;
}

export interface WebsearchResult {
	title: string;
	url: string;
	text?: string;
	publishedDate?: string;
}

const defaultWebsearchOperations: WebsearchOperations = {
	async search(query, options): Promise<WebsearchResult[]> {
		const apiKey = process.env.TAVILY_API_KEY || getToolApiKey("websearch");
		if (!apiKey) {
			throw new Error("TAVILY_API_KEY is not set. Run `hawcode --auth-tools` to configure.");
		}
		const client = tavily({ apiKey });
		const maxResults = Math.min(options.numResults ?? 5, 10);
		const response = await client.search(query, {
			maxResults,
			searchDepth: "advanced",
		});
		return response.results.map((r) => ({
			title: r.title,
			url: r.url,
			text: r.content ?? undefined,
			publishedDate: r.publishedDate ?? undefined,
		}));
	},
};

function formatResults(results: WebsearchResult[]): string {
	if (results.length === 0) {
		return "No results found.";
	}
	const header = `Found ${results.length} result${results.length === 1 ? "" : "s"}\n`;
	return (
		header +
		results
			.map((r, i) => {
				const parts: string[] = [];
				parts.push(`[${i + 1}] ${r.title}`);
				parts.push(`    ${r.url}`);
				if (r.publishedDate) {
					parts.push(`    Published: ${r.publishedDate}`);
				}
				if (r.text) {
					const lines = r.text.split("\n").filter((l) => l.trim());
					const preview = lines.slice(0, 10).join("\n    ");
					parts.push(`    ${preview}`);
				}
				return parts.join("\n");
			})
			.join("\n\n")
	);
}

export function createWebsearchToolDefinition(
	operations?: WebsearchOperations,
): ToolDefinition<typeof websearchSchema, undefined> {
	const ops = operations ?? defaultWebsearchOperations;
	return {
		name: "websearch",
		label: "websearch",
		description:
			"Search the web using natural language queries. Returns results with titles, URLs, and content previews. Useful for finding current information, documentation, and examples.",
		promptSnippet: "Search the web for information",
		promptGuidelines: [
			"Use websearch when you need current information beyond your training data.",
			"Prefer websearch for API docs, error messages, and library updates.",
		],
		parameters: websearchSchema,
		async execute(
			_toolCallId,
			{ query, numResults }: { query: string; numResults?: number },
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			if (signal?.aborted) {
				throw new Error("Operation aborted");
			}
			const results = await ops.search(query, { numResults });
			const text = formatResults(results);
			return {
				content: [{ type: "text" as const, text }],
				details: undefined,
			};
		},
		renderCall(args, theme, context) {
			const query = str(args?.query);
			const invalidArg = invalidArgText(theme);
			const display =
				query === null ? invalidArg : query ? theme.fg("accent", query) : theme.fg("toolOutput", "...");
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(`${theme.fg("toolTitle", theme.bold("websearch"))} ${display}`);
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

export function createWebsearchTool(operations?: WebsearchOperations): AgentTool<typeof websearchSchema> {
	return wrapToolDefinition(createWebsearchToolDefinition(operations));
}

/** Default websearch tool. */
export const websearchToolDefinition = createWebsearchToolDefinition();
export const websearchTool = createWebsearchTool();
