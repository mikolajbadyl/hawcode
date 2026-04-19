/**
 * Tool registry — single source of truth for built-in tool definitions.
 * Adding a new tool only requires appending an entry to TOOL_REGISTRY below.
 */

import type { AgentTool } from "../../agent-core/index.js";
import type { ToolDefinition } from "./tool-types.js";

// -- Tool factories & defaults ------------------------------------------------

import { bashTool, bashToolDefinition, createBashTool, createBashToolDefinition } from "./bash.js";
import {
	createDocsFetchTool,
	createDocsFetchToolDefinition,
	docsFetchTool,
	docsFetchToolDefinition,
} from "./docsfetch.js";
import { createEditTool, createEditToolDefinition, editTool, editToolDefinition } from "./edit.js";
import { createGlobTool, createGlobToolDefinition, globTool, globToolDefinition } from "./glob.js";
import { createReadTool, createReadToolDefinition, readTool, readToolDefinition } from "./read.js";
import { createSearchTool, createSearchToolDefinition, searchTool, searchToolDefinition } from "./search.js";
import {
	createWebsearchTool,
	createWebsearchToolDefinition,
	websearchTool,
	websearchToolDefinition,
} from "./websearch.js";
import { createWriteTool, createWriteToolDefinition, writeTool, writeToolDefinition } from "./write.js";

// -- Types --------------------------------------------------------------------

/** TUI display metadata for a tool. */
export interface ToolTuiMeta {
	/** Hex color string for the tool in the TUI */
	color: string;
	/** Unicode icon character */
	icon: string;
	/** Human-readable display name */
	displayName: string;
}

/**
 * Describes a built-in tool for the registry.
 *
 * Factory and default field types use `any` to avoid covariance issues
 * with the generic ToolDefinition / AgentTool type parameters.
 * Callers get proper typing through the wrapper functions (createAllTools,
 * createAllToolDefinitions, etc.) which cast back to concrete types.
 */
export interface ToolDescriptor {
	/** Machine name — must match the tool's `name` field */
	name: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createDefinition: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createTool: (...args: any[]) => any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	defaultDefinition: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	defaultTool: any;
	/** TUI display metadata */
	tui: ToolTuiMeta;
}

// -- Registry -----------------------------------------------------------------
// Append a new entry here when adding a tool. Everything else is derived.

export const TOOL_REGISTRY: readonly ToolDescriptor[] = [
	{
		name: "read",
		createDefinition: createReadToolDefinition,
		createTool: createReadTool,
		defaultDefinition: readToolDefinition,
		defaultTool: readTool,
		tui: { color: "#9ECBE0", icon: "\u25C9", displayName: "Read" },
	},
	{
		name: "bash",
		createDefinition: createBashToolDefinition,
		createTool: createBashTool,
		defaultDefinition: bashToolDefinition,
		defaultTool: bashTool,
		tui: { color: "#C678DD", icon: "\u25B6", displayName: "Bash" },
	},
	{
		name: "edit",
		createDefinition: createEditToolDefinition,
		createTool: createEditTool,
		defaultDefinition: editToolDefinition,
		defaultTool: editTool,
		tui: { color: "#E8B07A", icon: "\u270E", displayName: "Edit" },
	},
	{
		name: "write",
		createDefinition: createWriteToolDefinition,
		createTool: createWriteTool,
		defaultDefinition: writeToolDefinition,
		defaultTool: writeTool,
		tui: { color: "#A4D494", icon: "\u270D", displayName: "Write" },
	},
	{
		name: "search",
		createDefinition: createSearchToolDefinition,
		createTool: createSearchTool,
		defaultDefinition: searchToolDefinition,
		defaultTool: searchTool,
		tui: { color: "#9ECBE0", icon: "\u2299", displayName: "Search" },
	},
	{
		name: "glob",
		createDefinition: createGlobToolDefinition,
		createTool: createGlobTool,
		defaultDefinition: globToolDefinition,
		defaultTool: globTool,
		tui: { color: "#9ECBE0", icon: "\u2756", displayName: "Glob" },
	},
	{
		name: "websearch",
		createDefinition: createWebsearchToolDefinition,
		createTool: createWebsearchTool,
		defaultDefinition: websearchToolDefinition,
		defaultTool: websearchTool,
		tui: { color: "#8BC4DB", icon: "\u2298", displayName: "Web Search" },
	},
	{
		name: "docsfetch",
		createDefinition: createDocsFetchToolDefinition,
		createTool: createDocsFetchTool,
		defaultDefinition: docsFetchToolDefinition,
		defaultTool: docsFetchTool,
		tui: { color: "#9ECBE0", icon: "\u25C8", displayName: "Docs" },
	},
];

// -- Dynamic tool TUI metadata -----------------------------------------------
// Task tools are created dynamically with a TaskManager dependency.
// Their TUI metadata lives here so tool-execution.tsx doesn't need manual maps.

export const DYNAMIC_TOOL_TUI: ReadonlyMap<string, ToolTuiMeta> = new Map([
	["task_create", { color: "#8BC4DB", icon: "\u2610", displayName: "Task Create" }],
	["task_update", { color: "#8BC4DB", icon: "\u2610", displayName: "Task Update" }],
	["task_list", { color: "#8BC4DB", icon: "\u2610", displayName: "Tasks" }],
	["task_get", { color: "#8BC4DB", icon: "\u2610", displayName: "Task" }],
]);

// -- Derived helpers ----------------------------------------------------------

/** All built-in tool names — used as the default active tool list. */
export const ALL_TOOL_NAMES: readonly string[] = TOOL_REGISTRY.map((d) => d.name);

export type ToolName = (typeof TOOL_REGISTRY)[number]["name"];

/** Pre-built tools using process.cwd(), keyed by name. */
export function getAllTools(): Record<ToolName, AgentTool> {
	return Object.fromEntries(TOOL_REGISTRY.map((d) => [d.name, d.defaultTool])) as Record<ToolName, AgentTool>;
}

/** Pre-built tool definitions using process.cwd(), keyed by name. */
export function getAllToolDefinitions(): Record<ToolName, ToolDefinition> {
	return Object.fromEntries(TOOL_REGISTRY.map((d) => [d.name, d.defaultDefinition])) as Record<
		ToolName,
		ToolDefinition
	>;
}

/** Create tools for a given cwd, keyed by name. */
export function createAllTools(cwd: string, options?: Record<string, unknown>): Record<ToolName, AgentTool> {
	return Object.fromEntries(TOOL_REGISTRY.map((d) => [d.name, d.createTool(cwd, options?.[d.name])])) as Record<
		ToolName,
		AgentTool
	>;
}

/** Create tool definitions for a given cwd, keyed by name. */
export function createAllToolDefinitions(
	cwd: string,
	options?: Record<string, unknown>,
): Record<ToolName, ToolDefinition> {
	return Object.fromEntries(TOOL_REGISTRY.map((d) => [d.name, d.createDefinition(cwd, options?.[d.name])])) as Record<
		ToolName,
		ToolDefinition
	>;
}

/** Get TUI metadata for a tool by name, or undefined. Checks registry then dynamic tools. */
export function getToolTuiMeta(name: string): ToolTuiMeta | undefined {
	return TOOL_REGISTRY.find((d) => d.name === name)?.tui ?? DYNAMIC_TOOL_TUI.get(name);
}

/** All TUI metadata as a map (registry + dynamic). */
export function getToolTuiMetaMap(): ReadonlyMap<string, ToolTuiMeta> {
	return new Map([...TOOL_REGISTRY.map((d) => [d.name, d.tui] as const), ...DYNAMIC_TOOL_TUI]);
}
