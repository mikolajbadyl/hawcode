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
	createFindTool,
	createFindToolDefinition,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
	findTool,
	findToolDefinition,
} from "./find.js";
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
	createLsTool,
	createLsToolDefinition,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
	lsTool,
	lsToolDefinition,
} from "./ls.js";
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
import {
	type BashToolOptions,
	bashTool,
	bashToolDefinition,
	createBashTool,
	createBashToolDefinition,
} from "./bash.js";
import {
	createDocsFetchTool,
	createDocsFetchToolDefinition,
	docsFetchTool,
	docsFetchToolDefinition,
} from "./docsfetch.js";
import { createEditTool, createEditToolDefinition, editTool, editToolDefinition } from "./edit.js";
import { createFindTool, createFindToolDefinition, findTool, findToolDefinition } from "./find.js";
import { createGlobTool, createGlobToolDefinition, globTool, globToolDefinition } from "./glob.js";
import { createLsTool, createLsToolDefinition, lsTool, lsToolDefinition } from "./ls.js";
import {
	createReadTool,
	createReadToolDefinition,
	type ReadToolOptions,
	readTool,
	readToolDefinition,
} from "./read.js";
import { createSearchTool, createSearchToolDefinition, searchTool, searchToolDefinition } from "./search.js";
import type { ToolDefinition } from "./tool-types.js";
import {
	createWebsearchTool,
	createWebsearchToolDefinition,
	websearchTool,
	websearchToolDefinition,
} from "./websearch.js";
import { createWriteTool, createWriteToolDefinition, writeTool, writeToolDefinition } from "./write.js";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;

export const allTools = {
	read: readTool,
	bash: bashTool,
	edit: editTool,
	write: writeTool,
	search: searchTool,
	find: findTool,
	glob: globTool,
	ls: lsTool,
	websearch: websearchTool,
	docsfetch: docsFetchTool,
};

export const allToolDefinitions = {
	read: readToolDefinition,
	bash: bashToolDefinition,
	edit: editToolDefinition,
	write: writeToolDefinition,
	search: searchToolDefinition,
	find: findToolDefinition,
	glob: globToolDefinition,
	ls: lsToolDefinition,
	websearch: websearchToolDefinition,
	docsfetch: docsFetchToolDefinition,
};

export type ToolName = keyof typeof allTools;

export interface ToolsOptions {
	read?: ReadToolOptions;
	bash?: BashToolOptions;
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef> {
	return {
		read: createReadToolDefinition(cwd, options?.read),
		bash: createBashToolDefinition(cwd, options?.bash),
		edit: createEditToolDefinition(cwd),
		write: createWriteToolDefinition(cwd),
		search: createSearchToolDefinition(cwd),
		find: createFindToolDefinition(cwd),
		glob: createGlobToolDefinition(cwd),
		ls: createLsToolDefinition(cwd),
		websearch: createWebsearchToolDefinition(),
		docsfetch: createDocsFetchToolDefinition(),
	};
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return {
		read: createReadTool(cwd, options?.read),
		bash: createBashTool(cwd, options?.bash),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		search: createSearchTool(cwd),
		find: createFindTool(cwd),
		glob: createGlobTool(cwd),
		ls: createLsTool(cwd),
		websearch: createWebsearchTool(),
		docsfetch: createDocsFetchTool(),
	};
}
