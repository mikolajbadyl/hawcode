/**
 * Model resolution - matches CLI input to Model objects from the registry.
 *
 * --model accepts:
 *   - "provider/model-id" (exact, e.g. "anthropic/claude-opus-4-6")
 *   - "model-id"          (must be unique across providers)
 *
 * --models accepts comma-separated refs of the same format (no globs).
 */

import chalk from "chalk";
import type { ThinkingLevel } from "../agent-core/index.js";
import type { Api, Model } from "../ai/index.js";
import { DEFAULT_THINKING_LEVEL } from "./defaults.js";
import type { ModelRegistry } from "./model-registry.js";

export interface ScopedModel {
	model: Model<Api>;
}

export interface ResolveCliModelResult {
	model: Model<Api> | undefined;
	/** Error message for CLI display. When set, model is undefined. */
	error: string | undefined;
}

/**
 * Find a model by exact reference.
 * Supports "provider/model-id" or bare "model-id" (must be unique).
 */
function findModelByRef(ref: string, models: Model<Api>[]): Model<Api> | undefined {
	const normalized = ref.trim().toLowerCase();
	if (!normalized) return undefined;

	// Try "provider/model-id"
	const canonicalMatch = models.find((m) => `${m.provider}/${m.id}`.toLowerCase() === normalized);
	if (canonicalMatch) return canonicalMatch;

	// Try bare "model-id"
	const slashIndex = ref.indexOf("/");
	if (slashIndex !== -1) {
		const provider = ref.substring(0, slashIndex);
		const modelId = ref.substring(slashIndex + 1);
		if (provider && modelId) {
			const match = models.find(
				(m) => m.provider.toLowerCase() === provider.toLowerCase() && m.id.toLowerCase() === modelId.toLowerCase(),
			);
			if (match) return match;
		}
	}

	// Bare model-id match (must be unique)
	const idMatches = models.filter((m) => m.id.toLowerCase() === normalized);
	return idMatches.length === 1 ? idMatches[0] : undefined;
}

/**
 * Resolve --model from CLI flags.
 */
export function resolveCliModel(options: {
	cliProvider?: string;
	cliModel?: string;
	modelRegistry: ModelRegistry;
}): ResolveCliModelResult {
	const { cliProvider, cliModel, modelRegistry } = options;

	if (!cliModel) {
		return { model: undefined, error: undefined };
	}

	const allModels = modelRegistry.getAll();
	if (allModels.length === 0) {
		return {
			model: undefined,
			error: "No models available. Check your installation or add models to models.json.",
		};
	}

	// Try full --model as-is first
	let model = findModelByRef(cliModel, allModels);

	// If --provider given, try matching within that provider
	if (!model && cliProvider) {
		const providerModels = allModels.filter((m) => m.provider.toLowerCase() === cliProvider.toLowerCase());
		if (providerModels.length === 0) {
			return {
				model: undefined,
				error: `Unknown provider "${cliProvider}". Use --list-models to see available providers.`,
			};
		}
		model = findModelByRef(cliModel, providerModels);

		// If --model was "provider/model-id", strip provider prefix and retry
		if (!model) {
			const prefix = `${cliProvider}/`;
			if (cliModel.toLowerCase().startsWith(prefix.toLowerCase())) {
				model = findModelByRef(cliModel.slice(prefix.length), providerModels);
			}
		}
	}

	if (model) {
		return { model, error: undefined };
	}

	const display = cliProvider ? `${cliProvider}/${cliModel}` : cliModel;
	return {
		model: undefined,
		error: `Model "${display}" not found. Use --list-models to see available models.`,
	};
}

/**
 * Resolve --models patterns to Model objects for Ctrl+P cycling.
 * Accepts comma-separated exact refs (no globs).
 */
export async function resolveModelScope(patterns: string[], modelRegistry: ModelRegistry): Promise<ScopedModel[]> {
	const allModels = modelRegistry.getAll();
	const result: ScopedModel[] = [];

	for (const pattern of patterns) {
		const trimmed = pattern.trim();
		if (!trimmed) continue;

		const model = findModelByRef(trimmed, allModels);
		if (!model) {
			console.warn(chalk.yellow(`Warning: No model matches "${trimmed}".`));
			continue;
		}

		if (!result.find((sm) => sm.model.provider === model.provider && sm.model.id === model.id)) {
			result.push({ model });
		}
	}

	return result;
}

export interface InitialModelResult {
	model: Model<Api> | undefined;
	thinkingLevel: ThinkingLevel;
	fallbackMessage: string | undefined;
}

/**
 * Find the initial model to use.
 * Priority:
 * 1. CLI args (--provider + --model)
 * 2. Scoped models (--models, first entry)
 * 3. Settings default
 * 4. First model from models.json with auth
 */
export async function findInitialModel(options: {
	cliProvider?: string;
	cliModel?: string;
	scopedModels: ScopedModel[];
	isContinuing: boolean;
	defaultProvider?: string;
	defaultModelId?: string;
	defaultThinkingLevel?: ThinkingLevel;
	modelRegistry: ModelRegistry;
}): Promise<InitialModelResult> {
	const {
		cliProvider,
		cliModel,
		scopedModels,
		isContinuing,
		defaultProvider,
		defaultModelId,
		defaultThinkingLevel,
		modelRegistry,
	} = options;

	// 1. CLI args
	if (cliModel) {
		const resolved = resolveCliModel({ cliProvider, cliModel, modelRegistry });
		if (resolved.model) {
			return { model: resolved.model, thinkingLevel: DEFAULT_THINKING_LEVEL, fallbackMessage: undefined };
		}
	}

	// 2. First scoped model (skip if continuing)
	if (scopedModels.length > 0 && !isContinuing) {
		return {
			model: scopedModels[0].model,
			thinkingLevel: defaultThinkingLevel ?? DEFAULT_THINKING_LEVEL,
			fallbackMessage: undefined,
		};
	}

	// 3. Settings default
	if (defaultProvider && defaultModelId) {
		const found = modelRegistry.find(defaultProvider, defaultModelId);
		if (found) {
			return {
				model: found,
				thinkingLevel: defaultThinkingLevel ?? DEFAULT_THINKING_LEVEL,
				fallbackMessage: undefined,
			};
		}
	}

	// 4. First model from models.json with auth
	const available = await modelRegistry.getAvailable();
	if (available.length > 0) {
		return { model: available[0], thinkingLevel: DEFAULT_THINKING_LEVEL, fallbackMessage: undefined };
	}

	return { model: undefined, thinkingLevel: DEFAULT_THINKING_LEVEL, fallbackMessage: undefined };
}

/**
 * Restore model from saved session data.
 */
export async function restoreModelFromSession(
	savedProvider: string,
	savedModelId: string,
	currentModel: Model<Api> | undefined,
	shouldPrintMessages: boolean,
	modelRegistry: ModelRegistry,
): Promise<{ model: Model<Api> | undefined; fallbackMessage: string | undefined }> {
	const restored = modelRegistry.find(savedProvider, savedModelId);
	const hasAuth = restored ? modelRegistry.hasConfiguredAuth(restored) : false;

	if (restored && hasAuth) {
		if (shouldPrintMessages) {
			console.log(chalk.dim(`Restored model: ${savedProvider}/${savedModelId}`));
		}
		return { model: restored, fallbackMessage: undefined };
	}

	const reason = !restored ? "model no longer exists" : "no auth configured";
	if (shouldPrintMessages) {
		console.error(chalk.yellow(`Warning: Could not restore model ${savedProvider}/${savedModelId} (${reason}).`));
	}

	if (currentModel) {
		if (shouldPrintMessages) {
			console.log(chalk.dim(`Falling back to: ${currentModel.provider}/${currentModel.id}`));
		}
		return {
			model: currentModel,
			fallbackMessage: `Could not restore ${savedProvider}/${savedModelId} (${reason}). Using ${currentModel.provider}/${currentModel.id}.`,
		};
	}

	const available = await modelRegistry.getAvailable();
	if (available.length > 0) {
		if (shouldPrintMessages) {
			console.log(chalk.dim(`Falling back to: ${available[0].provider}/${available[0].id}`));
		}
		return {
			model: available[0],
			fallbackMessage: `Could not restore ${savedProvider}/${savedModelId} (${reason}). Using ${available[0].provider}/${available[0].id}.`,
		};
	}

	return { model: undefined, fallbackMessage: undefined };
}
