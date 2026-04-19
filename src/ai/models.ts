import type { Api, Model } from "./types.js";

/**
 * No built-in models. All models come from models.json/providers.json config.
 */

export function getProviders(): string[] {
	return [];
}

export function getModels(_provider: string): Model<Api>[] {
	return [];
}

/**
 * Check if a model supports xhigh thinking level.
 */
export function supportsXhigh<TApi extends Api>(model: Model<TApi>): boolean {
	if (model.id.includes("gpt-5.2") || model.id.includes("gpt-5.3") || model.id.includes("gpt-5.4")) {
		return true;
	}
	if (model.id.includes("opus-4-6") || model.id.includes("opus-4.6")) {
		return true;
	}
	return false;
}

/**
 * Check if two models are equal by comparing both their id and provider.
 */
export function modelsAreEqual<TApi extends Api>(
	a: Model<TApi> | null | undefined,
	b: Model<TApi> | null | undefined,
): boolean {
	if (!a || !b) return false;
	return a.id === b.id && a.provider === b.provider;
}
