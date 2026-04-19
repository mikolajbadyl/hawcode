import type { ProviderConfig } from "./hawcode-config.js";
import { loadModels } from "./hawcode-config.js";

export interface FetchedModel {
	id: string; // e.g., "gpt-4.1"
	provider: string; // e.g., "openai"
}

interface OpenAIModelsResponse {
	data: Array<{ id: string }>;
}

interface GoogleModelsResponse {
	models: Array<{ name: string; supportedGenerationMethods?: string[] }>;
}

interface MistralModelsResponse {
	data: Array<{ id: string }>;
}

/**
 * Fetch available models from a provider's API.
 */
export async function fetchModels(providerConfig: ProviderConfig, providerName: string): Promise<FetchedModel[]> {
	// First, get any already configured models for this provider
	const existingModels = getExistingModels(providerName);

	// Fetch from API based on API type
	const apiModels = await fetchFromApi(providerConfig, providerName);

	// Merge: API models + existing models (deduplicated)
	const allModels = new Map<string, FetchedModel>();

	for (const model of apiModels) {
		allModels.set(model.id, model);
	}

	for (const model of existingModels) {
		if (!allModels.has(model.id)) {
			allModels.set(model.id, model);
		}
	}

	return Array.from(allModels.values());
}

/**
 * Get models that are already configured in models.json for this provider.
 * Returns models in "provider/model-id" format.
 */
function getExistingModels(providerName: string): FetchedModel[] {
	const models = loadModels();
	return models
		.filter((id: string) => id.startsWith(`${providerName}/`))
		.map((id: string) => ({
			id: id.slice(providerName.length + 1),
			provider: providerName,
		}));
}

/**
 * Fetch models from the provider's API based on the API type.
 */
async function fetchFromApi(providerConfig: ProviderConfig, providerName: string): Promise<FetchedModel[]> {
	switch (providerConfig.api) {
		case "openai-completions":
		case "openai-responses":
			return fetchOpenAIModels(providerConfig, providerName);
		case "anthropic-messages":
			return fetchAnthropicModels(providerConfig, providerName);
		case "google-generative-ai":
			return fetchGoogleModels(providerConfig, providerName);
		case "mistral-conversations":
			return fetchMistralModels(providerConfig, providerName);
		default:
			// Other APIs don't have a list endpoint or aren't supported
			return [];
	}
}

/**
 * Fetch models from OpenAI-compatible API.
 */
async function fetchOpenAIModels(providerConfig: ProviderConfig, providerName: string): Promise<FetchedModel[]> {
	try {
		const url = `${providerConfig.baseUrl}/models`.replace(/\/+$/, "");
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${providerConfig.apiKey}`,
			},
		});

		if (!response.ok) {
			return [];
		}

		const data = (await response.json()) as OpenAIModelsResponse;
		return data.data.map((model) => ({
			id: model.id,
			provider: providerName,
		}));
	} catch {
		return [];
	}
}

/**
 * Return hardcoded Anthropic models (no list endpoint available).
 */
async function fetchAnthropicModels(_providerConfig: ProviderConfig, providerName: string): Promise<FetchedModel[]> {
	// Anthropic doesn't have a models list endpoint
	// Return the known models
	const anthropicModels = [
		"claude-sonnet-4-20250514",
		"claude-opus-4-20250514",
		"claude-3.7-sonnet-20250219",
		"claude-3.5-haiku-20241022",
	];

	return anthropicModels.map((id) => ({
		id,
		provider: providerName,
	}));
}

/**
 * Fetch models from Google Generative AI API.
 */
async function fetchGoogleModels(providerConfig: ProviderConfig, providerName: string): Promise<FetchedModel[]> {
	try {
		const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
		url.searchParams.set("key", providerConfig.apiKey);

		const response = await fetch(url.toString());

		if (!response.ok) {
			return [];
		}

		const data = (await response.json()) as GoogleModelsResponse;

		return data.models
			.filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
			.map((model) => ({
				id: model.name.replace(/^models\//, ""), // Strip "models/" prefix
				provider: providerName,
			}));
	} catch {
		return [];
	}
}

/**
 * Fetch models from Mistral API.
 */
async function fetchMistralModels(providerConfig: ProviderConfig, providerName: string): Promise<FetchedModel[]> {
	try {
		const url = "https://api.mistral.ai/v1/models";
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${providerConfig.apiKey}`,
			},
		});

		if (!response.ok) {
			return [];
		}

		const data = (await response.json()) as MistralModelsResponse;
		return data.data.map((model) => ({
			id: model.id,
			provider: providerName,
		}));
	} catch {
		return [];
	}
}
