export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	bashTool,
	bashToolDefinition,
	createBashTool,
	createBashToolDefinition,
	createLocalBashOperations,
} from "./bash.js";
export {
	createDocsFetchTool,
	createDocsFetchToolDefinition,
	type DocsFetchLibrary,
	type DocsFetchOperations,
	type DocsFetchToolInput,
	docsFetchTool,
	docsFetchToolDefinition,
} from "./docsfetch.js";
export {
	createEditTool,
	createEditToolDefinition,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
	editTool,
	editToolDefinition,
} from "./edit.js";
export { withFileMutationQueue } from "./file-mutation-queue.js";
export {
	createGlobTool,
	createGlobToolDefinition,
	type GlobOperations,
	type GlobToolDetails,
	type GlobToolInput,
	type GlobToolOptions,
	globTool,
	globToolDefinition,
} from "./glob.js";
export {
	createReadTool,
	createReadToolDefinition,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
	readTool,
	readToolDefinition,
} from "./read.js";
export {
	createSearchTool,
	createSearchToolDefinition,
	type SearchOperations,
	type SearchToolDetails,
	type SearchToolInput,
	type SearchToolOptions,
	searchTool,
	searchToolDefinition,
} from "./search.js";
export {
	createTaskToolDefinitions,
	createTaskTools,
	type Task,
	TaskManager,
	type TaskStatus,
} from "./task.js";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate.js";
export {
	createWebsearchTool,
	createWebsearchToolDefinition,
	type WebsearchOperations,
	type WebsearchResult,
	type WebsearchToolInput,
	websearchTool,
	websearchToolDefinition,
} from "./websearch.js";
export {
	createWriteTool,
	createWriteToolDefinition,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
	writeTool,
	writeToolDefinition,
} from "./write.js";

import type { AgentTool } from "../../agent-core/index.js";
import type { BashToolOptions } from "./bash.js";
import type { ReadToolOptions } from "./read.js";
import {
	ALL_TOOL_NAMES,
	type ToolName as RegistryToolName,
	createAllToolDefinitions as registryCreateAllToolDefinitions,
	createAllTools as registryCreateAllTools,
	getAllToolDefinitions as registryGetAllToolDefinitions,
	getAllTools as registryGetAllTools,
} from "./tool-registry.js";
import type { ToolDefinition } from "./tool-types.js";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;

export { getToolTuiMeta, getToolTuiMetaMap, TOOL_REGISTRY, type ToolTuiMeta } from "./tool-registry.js";

/** All built-in tool names — single source of truth. */
export const allToolNames = ALL_TOOL_NAMES;

export type ToolName = RegistryToolName;

/** Pre-built tools using process.cwd() */
export const allTools = registryGetAllTools();

/** Pre-built tool definitions using process.cwd() */
export const allToolDefinitions = registryGetAllToolDefinitions();

export interface ToolsOptions {
	read?: ReadToolOptions;
	bash?: BashToolOptions;
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef> {
	return registryCreateAllToolDefinitions(cwd, options as Record<string, unknown>);
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return registryCreateAllTools(cwd, options as Record<string, unknown>);
}
