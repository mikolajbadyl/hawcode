export interface KnownProviderInfo {
	name: string;
	displayName: string;
	api: string;
	baseUrl: string;
	authType: "api-key" | "oauth" | "aws";
}

export const KNOWN_PROVIDERS: KnownProviderInfo[] = [
	{
		name: "anthropic",
		displayName: "Anthropic",
		api: "anthropic-messages",
		baseUrl: "https://api.anthropic.com",
		authType: "api-key",
	},
	{
		name: "openai",
		displayName: "OpenAI",
		api: "openai-responses",
		baseUrl: "https://api.openai.com",
		authType: "api-key",
	},
	{
		name: "mistral",
		displayName: "Mistral",
		api: "mistral-conversations",
		baseUrl: "https://api.mistral.ai",
		authType: "api-key",
	},
	{
		name: "openrouter",
		displayName: "OpenRouter",
		api: "openai-completions",
		baseUrl: "https://openrouter.ai/api/v1",
		authType: "api-key",
	},
	{
		name: "github-copilot",
		displayName: "GitHub Copilot",
		api: "openai-completions",
		baseUrl: "https://api.individual.githubcopilot.com",
		authType: "oauth",
	},
	{
		name: "zai",
		displayName: "ZAI",
		api: "openai-completions",
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
		authType: "api-key",
	},
	{
		name: "opencode",
		displayName: "OpenCode Zen",
		api: "openai-completions",
		baseUrl: "https://opencode.ai/zen/v1",
		authType: "api-key",
	},
	{
		name: "opencode-go",
		displayName: "OpenCode Go",
		api: "openai-completions",
		baseUrl: "https://opencode.ai/zen/go/v1",
		authType: "api-key",
	},
];

/**
 * Get a known provider by name.
 */
export function getKnownProvider(name: string): KnownProviderInfo | undefined {
	return KNOWN_PROVIDERS.find((p) => p.name === name);
}

/**
 * Check if a provider name is a known provider.
 */
export function isKnownProvider(name: string): boolean {
	return KNOWN_PROVIDERS.some((p) => p.name === name);
}

/**
 * Get all known provider names.
 */
export function getKnownProviderNames(): string[] {
	return KNOWN_PROVIDERS.map((p) => p.name);
}

/**
 * Get providers that require API key authentication.
 */
export function getApiKeyProviders(): KnownProviderInfo[] {
	return KNOWN_PROVIDERS.filter((p) => p.authType === "api-key");
}

/**
 * Get providers that use OAuth authentication.
 */
export function getOAuthProviders(): KnownProviderInfo[] {
	return KNOWN_PROVIDERS.filter((p) => p.authType === "oauth");
}

/**
 * Get providers that use AWS authentication.
 */
export function getAwsProviders(): KnownProviderInfo[] {
	return KNOWN_PROVIDERS.filter((p) => p.authType === "aws");
}
