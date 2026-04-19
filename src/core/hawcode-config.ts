import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getModelsPath, getProvidersPath, getToolsConfigPath } from "../config.js";

export interface ProviderConfig {
	api: string; // e.g., "openai-completions", "anthropic-messages"
	baseUrl: string; // e.g., "https://api.openai.com"
	apiKey: string; // the actual key
}

export interface ProvidersConfig {
	providers: Record<string, ProviderConfig>;
}

/**
 * Parse models.json content handling both formats:
 * - Old format: { "models": ["provider/model-id", ...] }
 * - New format: ["provider/model-id", ...]
 */
function parseModelsJson(content: string): string[] {
	const parsed = JSON.parse(content);

	// New format: flat array
	if (Array.isArray(parsed)) {
		return parsed;
	}

	// Old format: { models: [...] }
	if (parsed && typeof parsed === "object" && Array.isArray(parsed.models)) {
		return parsed.models;
	}

	return [];
}

/**
 * Load providers.json from the config directory.
 * Returns empty defaults if the file doesn't exist.
 */
export function loadProviders(): ProvidersConfig {
	const path = getProvidersPath();
	if (!existsSync(path)) {
		return { providers: {} };
	}

	try {
		const content = readFileSync(path, "utf-8");
		return JSON.parse(content) as ProvidersConfig;
	} catch {
		return { providers: {} };
	}
}

/**
 * Save providers.json to the config directory.
 * Creates the directory if it doesn't exist.
 */
export function saveProviders(config: ProvidersConfig): void {
	const path = getProvidersPath();
	const dir = dirname(path);

	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Load models.json from the config directory.
 * Returns empty array if the file doesn't exist.
 * Handles both old format { models: [...] } and new format [...].
 */
export function loadModels(): string[] {
	const path = getModelsPath();
	if (!existsSync(path)) {
		return [];
	}

	try {
		const content = readFileSync(path, "utf-8");
		return parseModelsJson(content);
	} catch {
		return [];
	}
}

/**
 * Save models.json to the config directory.
 * Creates the directory if it doesn't exist.
 * Saves in the new flat array format.
 */
export function saveModels(models: string[]): void {
	const path = getModelsPath();
	const dir = dirname(path);

	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	writeFileSync(path, JSON.stringify(models, null, 2), "utf-8");
}

/**
 * Check if a provider is configured.
 */
export function hasProvider(providerName: string): boolean {
	const config = loadProviders();
	return providerName in config.providers;
}

/**
 * Get a provider's configuration.
 */
export function getProvider(providerName: string): ProviderConfig | undefined {
	const config = loadProviders();
	return config.providers[providerName];
}

/**
 * Add or update a provider in the configuration.
 */
export function setProvider(providerName: string, providerConfig: ProviderConfig): void {
	const config = loadProviders();
	config.providers[providerName] = providerConfig;
	saveProviders(config);
}

/**
 * Remove a provider from the configuration.
 */
export function removeProvider(providerName: string): boolean {
	const config = loadProviders();
	if (!(providerName in config.providers)) {
		return false;
	}
	delete config.providers[providerName];
	saveProviders(config);
	return true;
}

/**
 * Get all configured provider names.
 */
export function getConfiguredProviders(): string[] {
	const config = loadProviders();
	return Object.keys(config.providers);
}

/**
 * Add models to the configuration.
 * Models are stored as "provider/model-id" strings.
 */
export function addModels(modelIds: string[]): void {
	const existing = new Set(loadModels());
	for (const id of modelIds) {
		existing.add(id);
	}
	saveModels(Array.from(existing));
}

/**
 * Remove models from the configuration.
 */
export function removeModels(modelIds: string[]): void {
	const toRemove = new Set(modelIds);
	const models = loadModels().filter((id) => !toRemove.has(id));
	saveModels(models);
}

/**
 * Get all configured models for a specific provider.
 */
export function getModelsForProvider(providerName: string): string[] {
	return loadModels().filter((id) => id.startsWith(`${providerName}/`));
}

/**
 * Clear all configuration (providers and models).
 */
export function clearConfig(): void {
	saveProviders({ providers: {} });
	saveModels([]);
}

// =============================================================================
// Tools Config (tools.json)
// =============================================================================

export interface ToolConfig {
	apiKey: string;
}

export interface ToolsConfig {
	tools: Record<string, ToolConfig>;
}

/**
 * Load tools.json from the config directory.
 * Returns empty defaults if the file doesn't exist.
 */
export function loadTools(): ToolsConfig {
	const path = getToolsConfigPath();
	if (!existsSync(path)) {
		return { tools: {} };
	}

	try {
		const content = readFileSync(path, "utf-8");
		return JSON.parse(content) as ToolsConfig;
	} catch {
		return { tools: {} };
	}
}

/**
 * Save tools.json to the config directory.
 * Creates the directory if it doesn't exist.
 */
export function saveTools(config: ToolsConfig): void {
	const path = getToolsConfigPath();
	const dir = dirname(path);

	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Get a tool's API key from tools.json.
 */
export function getToolApiKey(toolName: string): string | undefined {
	const config = loadTools();
	return config.tools[toolName]?.apiKey;
}

/**
 * Set a tool's API key in tools.json.
 */
export function setToolApiKey(toolName: string, apiKey: string): void {
	const config = loadTools();
	config.tools[toolName] = { apiKey };
	saveTools(config);
}

/**
 * Remove a tool's config from tools.json.
 */
export function removeToolApiKey(toolName: string): boolean {
	const config = loadTools();
	if (!(toolName in config.tools)) {
		return false;
	}
	delete config.tools[toolName];
	saveTools(config);
	return true;
}

/**
 * Get all configured tool names.
 */
export function getConfiguredTools(): string[] {
	const config = loadTools();
	return Object.keys(config.tools);
}
