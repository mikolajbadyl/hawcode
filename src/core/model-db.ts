/**
 * Model metadata database — fetches LiteLLM's model_prices_and_context_window.json
 * in the background and provides context window / max tokens / cost lookups.
 *
 * Cached at ~/.config/hawcode/model-db.json, refreshed every 24h.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.js";

const DB_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const DB_FILENAME = "model-db.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============================================================================
// Types
// ============================================================================

export interface ModelDbEntry {
	maxInputTokens: number;
	maxOutputTokens: number;
	inputCostPerToken: number;
	outputCostPerToken: number;
	litellmProvider: string;
	supportsVision: boolean;
	supportsFunctionCalling: boolean;
	supportsReasoning: boolean;
	mode: string;
}

export interface ModelDb {
	/** ISO timestamp of when the DB was fetched */
	fetchedAt: string;
	/** Map of litellm model key → entry */
	models: Record<string, ModelDbEntry>;
}

// ============================================================================
// Persistence
// ============================================================================

function getDbPath(): string {
	return join(getAgentDir(), DB_FILENAME);
}

function readCachedDb(): ModelDb | null {
	const path = getDbPath();
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf-8");
		return JSON.parse(raw) as ModelDb;
	} catch {
		return null;
	}
}

function writeDb(db: ModelDb): void {
	const path = getDbPath();
	const dir = join(path, "..");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(path, JSON.stringify(db), "utf-8");
}

// ============================================================================
// Fetch & transform
// ============================================================================

interface LiteLLMModelEntry {
	litellm_provider: string;
	mode: string;
	max_input_tokens?: number;
	max_output_tokens?: number;
	max_tokens?: number;
	input_cost_per_token?: number;
	output_cost_per_token?: number;
	supports_vision?: boolean;
	supports_function_calling?: boolean;
	supports_reasoning?: boolean;
}

function transformEntry(raw: LiteLLMModelEntry): ModelDbEntry | null {
	// Skip non-chat models
	if (raw.mode !== "chat") return null;
	// Skip entries without token info
	if (!raw.max_input_tokens && !raw.max_tokens) return null;

	return {
		maxInputTokens: raw.max_input_tokens ?? raw.max_tokens ?? 0,
		maxOutputTokens: raw.max_output_tokens ?? raw.max_tokens ?? 0,
		inputCostPerToken: raw.input_cost_per_token ?? 0,
		outputCostPerToken: raw.output_cost_per_token ?? 0,
		litellmProvider: raw.litellm_provider ?? "",
		supportsVision: raw.supports_vision ?? false,
		supportsFunctionCalling: raw.supports_function_calling ?? false,
		supportsReasoning: raw.supports_reasoning ?? false,
		mode: raw.mode,
	};
}

async function fetchDb(): Promise<ModelDb> {
	const response = await fetch(DB_URL);
	if (!response.ok) {
		throw new Error(`Failed to fetch model DB: ${response.status} ${response.statusText}`);
	}
	const raw = (await response.json()) as Record<string, LiteLLMModelEntry>;

	const models: Record<string, ModelDbEntry> = {};
	for (const [key, entry] of Object.entries(raw)) {
		// Skip the sample spec entry
		if (key === "sample_spec") continue;
		const transformed = transformEntry(entry);
		if (transformed) {
			models[key] = transformed;
		}
	}

	return {
		fetchedAt: new Date().toISOString(),
		models,
	};
}

/**
 * Synchronous version of fetchDb using Node.js APIs.
 * Used on first run when no cache exists.
 */
function fetchDbSync(): ModelDb {
	const raw = execSync(`curl -sL "${DB_URL}"`, { encoding: "utf-8", timeout: 10000 });
	const parsed = JSON.parse(raw) as Record<string, LiteLLMModelEntry>;

	const models: Record<string, ModelDbEntry> = {};
	for (const [key, entry] of Object.entries(parsed)) {
		if (key === "sample_spec") continue;
		const transformed = transformEntry(entry);
		if (transformed) {
			models[key] = transformed;
		}
	}

	return {
		fetchedAt: new Date().toISOString(),
		models,
	};
}

// ============================================================================
// Public API
// ============================================================================

let dbInstance: ModelDb | null = null;
let fetchPromise: Promise<ModelDb> | null = null;

/**
 * Load model DB from cache (synchronous). Returns null if not cached yet.
 */
export function getModelDb(): ModelDb | null {
	if (dbInstance) return dbInstance;
	const cached = readCachedDb();
	if (cached) {
		dbInstance = cached;
	}
	return dbInstance;
}

/**
 * Initialize model DB. Loads from local cache immediately if available,
 * then synchronizes in the background.
 *
 * - If cache exists (even stale): load instantly, refresh in background.
 * - If no cache: synchronously fetch from GitHub (slow but necessary).
 * - If forced (--reload-cache): load from cache if available, refresh in background.
 *
 * @param force - Skip cache freshness check, always trigger background refresh.
 */
export function refreshModelDb(force = false): void {
	if (fetchPromise) return;

	const forced = force || process.env.HAWCODE_RELOAD_CACHE === "1";

	// Try to load from local cache first
	const cached = readCachedDb();

	if (cached) {
		// Cache exists: use it immediately (even if stale)
		dbInstance = cached;

		const age = Date.now() - new Date(cached.fetchedAt).getTime();
		if (age >= CACHE_TTL_MS || forced) {
			// Stale or forced: refresh in background
			startBackgroundRefresh();
		}

		return;
	}

	// No cache at all: must fetch synchronously (slow but unavoidable)
	try {
		const db = fetchDbSync();
		writeDb(db);
		dbInstance = db;
		return;
	} catch {
		// Sync fetch failed, try async
	}

	// No network, no cache: async retry
	startBackgroundRefresh();
}

/**
 * Fetch the model DB in the background (non-blocking).
 * Updates dbInstance and writes to disk on success.
 */
function startBackgroundRefresh(): void {
	if (fetchPromise) return;

	fetchPromise = fetchDb()
		.then((db) => {
			writeDb(db);
			dbInstance = db;
			fetchPromise = null;
			return db;
		})
		.catch(() => {
			fetchPromise = null;
			return null as unknown as ModelDb;
		});
}

/**
 * Look up model metadata by provider and model ID.
 * Tries exact matches first, then fuzzy search across all DB entries.
 */
export function lookupModelMeta(provider: string, modelId: string): ModelDbEntry | null {
	const db = getModelDb();
	if (!db) return null;

	const providerAliases = getProviderAliases(provider);

	// 1. Exact matches: provider/id and bare id
	for (const prov of providerAliases) {
		const entry = db.models[`${prov}/${modelId}`];
		if (entry) return entry;
	}
	const bare = db.models[modelId];
	if (bare) return bare;

	// 2. Fuzzy: normalize and search all entries, pick best match
	const needle = normalizeModelId(modelId);

	let bestMatch: { entry: ModelDbEntry; score: number } | null = null;
	for (const [key, entry] of Object.entries(db.models)) {
		const slashIdx = key.indexOf("/");
		const id = slashIdx >= 0 ? key.slice(slashIdx + 1) : key;
		const normalizedId = normalizeModelId(id);

		// Must share a common prefix (base model name)
		const commonLen = commonPrefixLen(normalizedId, needle);
		if (commonLen < Math.min(3, Math.min(normalizedId.length, needle.length))) continue;

		// Score: lower is better. Prefer: provider match > longer common prefix > shorter diff
		const keyProvider = slashIdx >= 0 ? key.slice(0, slashIdx) : "";
		const providerMatch = providerAliases.includes(keyProvider) ? 0 : 10;
		const diff = Math.abs(normalizedId.length - needle.length);
		const score = providerMatch + diff - commonLen;

		if (!bestMatch || score < bestMatch.score) {
			bestMatch = { entry, score };
		}
	}

	return bestMatch?.entry ?? null;
}

/**
 * Normalize a model ID for fuzzy comparison.
 * Strips date suffixes, dashes, dots.
 * e.g. "glm-5.1" → "glm51", "claude-sonnet-4-20250514" → "claudesonnet4"
 */
function normalizeModelId(id: string): string {
	let s = id.replace(/-?\d{4}-?\d{2}-?\d{2}$/, "");
	s = s.replace(/[.-]/g, "");
	return s.toLowerCase();
}

function commonPrefixLen(a: string, b: string): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a[i] !== b[i]) return i;
	}
	return len;
}

/**
 * Map hawcode provider names to LiteLLM provider names.
 */
function getProviderAliases(provider: string): string[] {
	const aliases: string[] = [provider];

	const mapping: Record<string, string[]> = {
		anthropic: ["anthropic"],
		openai: ["openai"],
		google: ["google", "vertex_ai"],
		gemini: ["google", "vertex_ai"],
		glm: ["zai"],
		zai: ["zai"],
		mistral: ["mistral"],
		deepseek: ["deepseek"],
		xai: ["xai"],
		cohere: ["cohere"],
		meta: ["meta_llama", "together_ai"],
		together: ["together_ai"],
		fireworks: ["fireworks_ai"],
		openrouter: ["openrouter"],
		groq: ["groq"],
		perplexity: ["perplexity"],
		azure: ["azure"],
		bedrock: ["bedrock"],
		vertex: ["vertex_ai"],
	};

	if (mapping[provider]) {
		aliases.push(...mapping[provider]);
	}

	// Deduplicate
	return [...new Set(aliases)];
}
