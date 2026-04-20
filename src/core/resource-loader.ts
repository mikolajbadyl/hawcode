import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import chalk from "chalk";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.js";
import type { ResourceDiagnostic } from "./diagnostics.js";

export type { ResourceCollision, ResourceDiagnostic } from "./diagnostics.js";

import { DefaultPackageManager, type PathMetadata } from "./package-manager.js";
import type { PromptTemplate } from "./prompt-templates.js";
import { loadPromptTemplates } from "./prompt-templates.js";
import { SettingsManager } from "./settings-manager.js";
import { createSourceInfo, type SourceInfo } from "./source-info.js";

function resolvePromptInput(input: string | undefined, description: string): string | undefined {
	if (!input) {
		return undefined;
	}

	if (existsSync(input)) {
		try {
			return readFileSync(input, "utf-8");
		} catch (error) {
			console.error(chalk.yellow(`Warning: Could not read ${description} file ${input}: ${error}`));
			return input;
		}
	}

	return input;
}

function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
	const candidates = ["AGENTS.md", "CLAUDE.md"];
	for (const filename of candidates) {
		const filePath = join(dir, filename);
		if (existsSync(filePath)) {
			try {
				return {
					path: filePath,
					content: readFileSync(filePath, "utf-8"),
				};
			} catch (error) {
				console.error(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`));
			}
		}
	}
	return null;
}

function loadProjectContextFiles(
	options: { cwd?: string; agentDir?: string } = {},
): Array<{ path: string; content: string }> {
	const resolvedCwd = options.cwd ?? process.cwd();
	const resolvedAgentDir = options.agentDir ?? getAgentDir();

	const contextFiles: Array<{ path: string; content: string }> = [];
	const seenPaths = new Set<string>();

	const globalContext = loadContextFileFromDir(resolvedAgentDir);
	if (globalContext) {
		contextFiles.push(globalContext);
		seenPaths.add(globalContext.path);
	}

	const ancestorContextFiles: Array<{ path: string; content: string }> = [];

	let currentDir = resolvedCwd;
	const root = resolve("/");

	while (true) {
		const contextFile = loadContextFileFromDir(currentDir);
		if (contextFile && !seenPaths.has(contextFile.path)) {
			ancestorContextFiles.unshift(contextFile);
			seenPaths.add(contextFile.path);
		}

		if (currentDir === root) break;

		const parentDir = resolve(currentDir, "..");
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}

	contextFiles.push(...ancestorContextFiles);

	return contextFiles;
}

export interface ResourceExtensionPaths {
	promptPaths?: Array<{ path: string; metadata: PathMetadata }>;
}

export interface ResourceLoader {
	getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
	getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
	getSystemPrompt(): string | undefined;
	getAppendSystemPrompt(): string[];
	extendResources(paths: ResourceExtensionPaths): void;
	reload(): Promise<void>;
}

export interface DefaultResourceLoaderOptions {
	cwd?: string;
	agentDir?: string;
	settingsManager?: SettingsManager;
	noPromptTemplates?: boolean;
	additionalPromptTemplatePaths?: string[];
	systemPromptSource?: string;
	appendSystemPromptSource?: string[];
	systemPromptOverride?: (base: string | undefined) => string | undefined;
	appendSystemPromptOverride?: (base: string[]) => string[];
	agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
		agentsFiles: Array<{ path: string; content: string }>;
	};
	promptsOverride?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
		prompts: PromptTemplate[];
		diagnostics: ResourceDiagnostic[];
	};
}

export class DefaultResourceLoader implements ResourceLoader {
	private cwd: string;
	private agentDir: string;
	private settingsManager: SettingsManager;
	private packageManager: DefaultPackageManager;
	private additionalPromptTemplatePaths: string[];
	private noPromptTemplates: boolean;
	private systemPromptSource?: string;
	private appendSystemPromptSource?: string[];
	private systemPromptOverride?: (base: string | undefined) => string | undefined;
	private appendSystemPromptOverride?: (base: string[]) => string[];
	private agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
		agentsFiles: Array<{ path: string; content: string }>;
	};
	private promptsOverride?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
		prompts: PromptTemplate[];
		diagnostics: ResourceDiagnostic[];
	};

	private prompts: PromptTemplate[];
	private promptDiagnostics: ResourceDiagnostic[];
	private agentsFiles: Array<{ path: string; content: string }>;
	private systemPrompt?: string;
	private appendSystemPrompt: string[];
	private extensionPromptSourceInfos: Map<string, SourceInfo>;
	private lastPromptPaths: string[];

	constructor(options: DefaultResourceLoaderOptions) {
		this.cwd = options.cwd ?? process.cwd();
		this.agentDir = options.agentDir ?? getAgentDir();
		this.settingsManager = options.settingsManager ?? SettingsManager.create(this.cwd, this.agentDir);
		this.packageManager = new DefaultPackageManager({
			cwd: this.cwd,
			agentDir: this.agentDir,
			settingsManager: this.settingsManager,
		});
		this.additionalPromptTemplatePaths = options.additionalPromptTemplatePaths ?? [];
		this.noPromptTemplates = options.noPromptTemplates ?? false;
		this.systemPromptSource = options.systemPromptSource;
		this.appendSystemPromptSource = options.appendSystemPromptSource;
		this.systemPromptOverride = options.systemPromptOverride;
		this.appendSystemPromptOverride = options.appendSystemPromptOverride;
		this.agentsFilesOverride = options.agentsFilesOverride;
		this.promptsOverride = options.promptsOverride;

		this.prompts = [];
		this.promptDiagnostics = [];
		this.agentsFiles = [];
		this.appendSystemPrompt = [];
		this.extensionPromptSourceInfos = new Map();
		this.lastPromptPaths = [];
	}

	getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
		return { prompts: this.prompts, diagnostics: this.promptDiagnostics };
	}

	getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> } {
		return { agentsFiles: this.agentsFiles };
	}

	getSystemPrompt(): string | undefined {
		return this.systemPrompt;
	}

	getAppendSystemPrompt(): string[] {
		return this.appendSystemPrompt;
	}

	extendResources(paths: ResourceExtensionPaths): void {
		const promptPaths = this.normalizeExtensionPaths(paths.promptPaths ?? []);

		for (const entry of promptPaths) {
			this.extensionPromptSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
		}

		if (promptPaths.length > 0) {
			this.lastPromptPaths = this.mergePaths(
				this.lastPromptPaths,
				promptPaths.map((entry) => entry.path),
			);
			this.updatePromptsFromPaths(this.lastPromptPaths);
		}
	}

	async reload(): Promise<void> {
		await this.settingsManager.reload();
		const resolvedPaths = await this.packageManager.resolve();
		const metadataByPath = new Map<string, PathMetadata>();

		this.extensionPromptSourceInfos = new Map();

		// Helper to extract enabled paths and store metadata
		const getEnabledResources = (
			resources: Array<{ path: string; enabled: boolean; metadata: PathMetadata }>,
		): Array<{ path: string; enabled: boolean; metadata: PathMetadata }> => {
			for (const r of resources) {
				if (!metadataByPath.has(r.path)) {
					metadataByPath.set(r.path, r.metadata);
				}
			}
			return resources.filter((r) => r.enabled);
		};

		const getEnabledPaths = (
			resources: Array<{ path: string; enabled: boolean; metadata: PathMetadata }>,
		): string[] => getEnabledResources(resources).map((r) => r.path);

		const enabledPrompts = getEnabledPaths(resolvedPaths.prompts);

		const promptPaths = this.noPromptTemplates
			? [...this.additionalPromptTemplatePaths]
			: this.mergePaths([...enabledPrompts], this.additionalPromptTemplatePaths);

		this.lastPromptPaths = promptPaths;
		this.updatePromptsFromPaths(promptPaths, metadataByPath);
		for (const p of this.additionalPromptTemplatePaths) {
			if (existsSync(p) === false && !this.promptDiagnostics.some((d) => d.path === p)) {
				this.promptDiagnostics.push({ type: "error", message: "Prompt template path does not exist", path: p });
			}
		}

		const agentsFiles = { agentsFiles: loadProjectContextFiles({ cwd: this.cwd, agentDir: this.agentDir }) };
		const resolvedAgentsFiles = this.agentsFilesOverride ? this.agentsFilesOverride(agentsFiles) : agentsFiles;
		this.agentsFiles = resolvedAgentsFiles.agentsFiles;

		const baseSystemPrompt = resolvePromptInput(
			this.systemPromptSource ?? this.discoverSystemPromptFile(),
			"system prompt",
		);
		this.systemPrompt = this.systemPromptOverride ? this.systemPromptOverride(baseSystemPrompt) : baseSystemPrompt;

		const appendSources =
			this.appendSystemPromptSource ??
			(this.discoverAppendSystemPromptFile() ? [this.discoverAppendSystemPromptFile()!] : []);
		const baseAppend = appendSources
			.map((s) => resolvePromptInput(s, "append system prompt"))
			.filter((s): s is string => s !== undefined);
		this.appendSystemPrompt = this.appendSystemPromptOverride
			? this.appendSystemPromptOverride(baseAppend)
			: baseAppend;
	}

	private normalizeExtensionPaths(
		entries: Array<{ path: string; metadata: PathMetadata }>,
	): Array<{ path: string; metadata: PathMetadata }> {
		return entries.map((entry) => ({
			path: this.resolveResourcePath(entry.path),
			metadata: entry.metadata,
		}));
	}

	private updatePromptsFromPaths(promptPaths: string[], metadataByPath?: Map<string, PathMetadata>): void {
		let promptsResult: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
		if (this.noPromptTemplates && promptPaths.length === 0) {
			promptsResult = { prompts: [], diagnostics: [] };
		} else {
			const allPrompts = loadPromptTemplates({
				cwd: this.cwd,
				agentDir: this.agentDir,
				promptPaths,
				includeDefaults: false,
			});
			promptsResult = this.dedupePrompts(allPrompts);
		}
		const resolvedPrompts = this.promptsOverride ? this.promptsOverride(promptsResult) : promptsResult;
		this.prompts = resolvedPrompts.prompts.map((prompt) => ({
			...prompt,
			sourceInfo:
				this.findSourceInfoForPath(prompt.filePath, this.extensionPromptSourceInfos, metadataByPath) ??
				prompt.sourceInfo ??
				this.getDefaultSourceInfoForPath(prompt.filePath),
		}));
		this.promptDiagnostics = resolvedPrompts.diagnostics;
	}

	private findSourceInfoForPath(
		resourcePath: string,
		extraSourceInfos?: Map<string, SourceInfo>,
		metadataByPath?: Map<string, PathMetadata>,
	): SourceInfo | undefined {
		if (!resourcePath) {
			return undefined;
		}

		if (resourcePath.startsWith("<")) {
			return this.getDefaultSourceInfoForPath(resourcePath);
		}

		const normalizedResourcePath = resolve(resourcePath);
		if (extraSourceInfos) {
			for (const [sourcePath, sourceInfo] of extraSourceInfos.entries()) {
				const normalizedSourcePath = resolve(sourcePath);
				if (
					normalizedResourcePath === normalizedSourcePath ||
					normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
				) {
					return { ...sourceInfo, path: resourcePath };
				}
			}
		}

		if (metadataByPath) {
			const exact = metadataByPath.get(normalizedResourcePath) ?? metadataByPath.get(resourcePath);
			if (exact) {
				return createSourceInfo(resourcePath, exact);
			}

			for (const [sourcePath, metadata] of metadataByPath.entries()) {
				const normalizedSourcePath = resolve(sourcePath);
				if (
					normalizedResourcePath === normalizedSourcePath ||
					normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
				) {
					return createSourceInfo(resourcePath, metadata);
				}
			}
		}

		return undefined;
	}

	private getDefaultSourceInfoForPath(filePath: string): SourceInfo {
		if (filePath.startsWith("<") && filePath.endsWith(">")) {
			return {
				path: filePath,
				source: filePath.slice(1, -1).split(":")[0] || "temporary",
				scope: "temporary",
				origin: "top-level",
			};
		}

		const normalizedPath = resolve(filePath);
		const agentRoots = [join(this.agentDir, "prompts")];
		const projectRoots = [join(this.cwd, CONFIG_DIR_NAME, "prompts")];

		for (const root of agentRoots) {
			if (this.isUnderPath(normalizedPath, root)) {
				return { path: filePath, source: "local", scope: "user", origin: "top-level", baseDir: root };
			}
		}

		for (const root of projectRoots) {
			if (this.isUnderPath(normalizedPath, root)) {
				return { path: filePath, source: "local", scope: "project", origin: "top-level", baseDir: root };
			}
		}

		return {
			path: filePath,
			source: "local",
			scope: "temporary",
			origin: "top-level",
			baseDir: statSync(normalizedPath).isDirectory() ? normalizedPath : resolve(normalizedPath, ".."),
		};
	}

	private mergePaths(primary: string[], additional: string[]): string[] {
		const merged: string[] = [];
		const seen = new Set<string>();

		for (const p of [...primary, ...additional]) {
			const resolved = this.resolveResourcePath(p);
			if (seen.has(resolved)) continue;
			seen.add(resolved);
			merged.push(resolved);
		}

		return merged;
	}

	private resolveResourcePath(p: string): string {
		const trimmed = p.trim();
		let expanded = trimmed;
		if (trimmed === "~") {
			expanded = homedir();
		} else if (trimmed.startsWith("~/")) {
			expanded = join(homedir(), trimmed.slice(2));
		} else if (trimmed.startsWith("~")) {
			expanded = join(homedir(), trimmed.slice(1));
		}
		return resolve(this.cwd, expanded);
	}

	private dedupePrompts(prompts: PromptTemplate[]): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
		const seen = new Map<string, PromptTemplate>();
		const diagnostics: ResourceDiagnostic[] = [];

		for (const prompt of prompts) {
			const existing = seen.get(prompt.name);
			if (existing) {
				diagnostics.push({
					type: "collision",
					message: `name "/${prompt.name}" collision`,
					path: prompt.filePath,
					collision: {
						resourceType: "prompt",
						name: prompt.name,
						winnerPath: existing.filePath,
						loserPath: prompt.filePath,
					},
				});
			} else {
				seen.set(prompt.name, prompt);
			}
		}

		return { prompts: Array.from(seen.values()), diagnostics };
	}

	private discoverSystemPromptFile(): string | undefined {
		const projectPath = join(this.cwd, CONFIG_DIR_NAME, "SYSTEM.md");
		if (existsSync(projectPath)) {
			return projectPath;
		}

		const globalPath = join(this.agentDir, "SYSTEM.md");
		if (existsSync(globalPath)) {
			return globalPath;
		}

		return undefined;
	}

	private discoverAppendSystemPromptFile(): string | undefined {
		const projectPath = join(this.cwd, CONFIG_DIR_NAME, "APPEND_SYSTEM.md");
		if (existsSync(projectPath)) {
			return projectPath;
		}

		const globalPath = join(this.agentDir, "APPEND_SYSTEM.md");
		if (existsSync(globalPath)) {
			return globalPath;
		}

		return undefined;
	}

	private isUnderPath(target: string, root: string): boolean {
		const normalizedRoot = resolve(root);
		if (target === normalizedRoot) {
			return true;
		}
		const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
		return target.startsWith(prefix);
	}
}
