/**
 * Runtime API key overrides.
 * Not persisted to disk - providers.json is the source of truth for API keys.
 */

/**
 * Runtime API key storage (in-memory only, not persisted).
 */
export class AuthStorage {
	private runtimeOverrides: Map<string, string> = new Map();

	/**
	 * Set a runtime API key override (not persisted to disk).
	 */
	setRuntimeApiKey(provider: string, apiKey: string): void {
		this.runtimeOverrides.set(provider, apiKey);
	}

	/**
	 * Remove a runtime API key override.
	 */
	removeRuntimeApiKey(provider: string): void {
		this.runtimeOverrides.delete(provider);
	}

	/**
	 * Get API key for a provider from runtime overrides.
	 */
	async getApiKey(providerId: string): Promise<string | undefined> {
		return this.runtimeOverrides.get(providerId);
	}

	/**
	 * Check if a runtime override is configured for a provider.
	 */
	hasAuth(provider: string): boolean {
		return this.runtimeOverrides.has(provider);
	}

	/**
	 * Check if using a runtime override (subscription display).
	 */
	isUsingOAuth(_provider: string): boolean {
		return false;
	}
}
