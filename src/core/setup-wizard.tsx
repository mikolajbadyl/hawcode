/// <reference path="../opentui-jsx.d.ts" />

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import "@opentui/react/jsx-runtime";
import { colors } from "../modes/interactive/components/colors.js";
import { addModels, loadModels, loadProviders, type ProviderConfig, saveProviders } from "./hawcode-config.js";
import { type FetchedModel, fetchModels } from "./model-fetcher.js";
import { getKnownProvider, KNOWN_PROVIDERS, type KnownProviderInfo } from "./provider-registry.js";

// Wizard state types
type WizardStep =
	| "provider"
	| "customApi"
	| "customBaseUrl"
	| "apiKey"
	| "fetching"
	| "models"
	| "customModel"
	| "save";

interface WizardState {
	step: WizardStep;
	selectedProvider?: KnownProviderInfo;
	customProviderName?: string;
	customApi?: string;
	customBaseUrl?: string;
	apiKey?: string;
	fetchedModels: FetchedModel[];
	selectedModels: Set<string>;
	fetchError?: string;
	isFetching: boolean;
	showAddAnother: boolean;
}

interface SetupWizardProps {
	onComplete: () => void;
	onCancel: () => void;
}

// Provider selection component
function ProviderSelection({
	onSelect,
	onCustom,
}: {
	onSelect: (provider: KnownProviderInfo) => void;
	onCustom: (name: string) => void;
}) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [customInput, setCustomInput] = useState("");
	const [isCustomMode, setIsCustomMode] = useState(false);

	// Load existing providers to show which are configured
	const configuredProviders = useMemo(() => {
		const existing = loadProviders();
		return new Set(Object.keys(existing.providers));
	}, []);

	useKeyboard((event) => {
		if (isCustomMode) {
			if (event.name === "return" && customInput.trim()) {
				onCustom(customInput.trim());
			} else if (event.name === "escape") {
				setIsCustomMode(false);
				setCustomInput("");
			} else if (event.name === "backspace" || event.name === "delete") {
				setCustomInput((prev) => prev.slice(0, -1));
			} else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
				setCustomInput((prev) => prev + event.name);
			}
		} else {
			if (event.name === "up") {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : KNOWN_PROVIDERS.length));
			} else if (event.name === "down") {
				setSelectedIndex((prev) => (prev < KNOWN_PROVIDERS.length ? prev + 1 : 0));
			} else if (event.name === "return") {
				if (selectedIndex === KNOWN_PROVIDERS.length) {
					setIsCustomMode(true);
				} else {
					onSelect(KNOWN_PROVIDERS[selectedIndex]);
				}
			}
		}
	});

	if (isCustomMode) {
		const cursor = "\u2588";
		const inputStr = String(customInput ?? "");
		return (
			<box style={{ flexDirection: "column" }}>
				<text>
					<strong>Enter custom provider name:</strong>
				</text>
				<text fg={colors.accent}>
					{"> "}
					{inputStr}
					{cursor}
				</text>
				<text fg={colors.muted}>Press Enter to confirm, Escape to cancel</text>
			</box>
		);
	}

	return (
		<box style={{ flexDirection: "column" }}>
			<text>
				<strong>Select a provider:</strong>
			</text>
			{KNOWN_PROVIDERS.map((provider, index) => {
				const isConfigured = configuredProviders.has(provider.name);
				return (
					<box key={String(provider.name)}>
						<text fg={selectedIndex === index ? "cyan" : "white"}>
							{selectedIndex === index ? "\u25B6 " : "  "}
							{isConfigured ? "\u2713 " : "  "}
							{String(provider.displayName)}
							{isConfigured ? " (configured)" : ""}
						</text>
					</box>
				);
			})}
			<box>
				<text fg={selectedIndex === KNOWN_PROVIDERS.length ? "cyan" : "white"}>
					{selectedIndex === KNOWN_PROVIDERS.length ? "\u25B6 " : "  "}
					[Type custom provider name]
				</text>
			</box>
			<text fg={colors.muted}>Use arrow keys to navigate, Enter to select</text>
		</box>
	);
}

// API Key input component
function ApiKeyInput({
	provider,
	onSubmit,
	onBack,
}: {
	provider: KnownProviderInfo | { name: string; displayName: string };
	onSubmit: (apiKey: string) => void;
	onBack: () => void;
}) {
	const [apiKey, setApiKey] = useState("");

	// Listen for paste events from stdin (bracketed paste mode)
	useEffect(() => {
		let buffer = "";
		let removeListener: (() => void) | undefined;

		const setup = () => {
			import("node:process").then(({ stdin }) => {
				if (!stdin.readable) return;
				const onData = (chunk: Buffer | string) => {
					const str = chunk.toString();
					// Bracketed paste: \x1b[200~ ... \x1b[201~
					if (str.includes("\x1b[200~")) {
						buffer = str.replace(/\x1b\[200~/g, "").replace(/\x1b\[201~/g, "");
					} else {
						buffer += str;
					}
					// If we got something and stdin is still flowing, check if it's a complete paste
					if (buffer && !str.endsWith("\n") && !str.endsWith("\r")) {
						setApiKey((prev) => prev + buffer);
						buffer = "";
					}
				};
				stdin.on("data", onData);
				removeListener = () => stdin.removeListener("data", onData);
			});
		};
		setup();
		return () => removeListener?.();
	}, []);

	useKeyboard((event) => {
		if (event.name === "return") {
			onSubmit(apiKey.trim());
		} else if (event.name === "escape") {
			onBack();
		} else if (event.name === "backspace" || event.name === "delete") {
			setApiKey((prev) => prev.slice(0, -1));
		} else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
			setApiKey((prev) => prev + event.name);
		}
	});

	const maskedKey = useMemo(() => {
		if (apiKey.length <= 4) return apiKey;
		return "*".repeat(apiKey.length - 4) + apiKey.slice(-4);
	}, [apiKey]);

	const maskedKeyStr = String(maskedKey);
	const cursor = "\u2588";

	return (
		<box style={{ flexDirection: "column" }}>
			<text>
				<strong>Enter API key for {String(provider.displayName)}:</strong>
			</text>
			<text fg={colors.accent}>
				{" > "}
				{maskedKeyStr}
				{cursor}
			</text>
			<text fg={colors.muted}>Press Enter to confirm, Escape to go back</text>
		</box>
	);
}

// Fetching models component
function FetchingModels({ provider }: { provider: KnownProviderInfo | { name: string; displayName: string } }) {
	const [dots, setDots] = useState("");

	useEffect(() => {
		const interval = setInterval(() => {
			setDots((prev) => (prev.length >= 3 ? "" : `${prev}.`));
		}, 300);
		return () => clearInterval(interval);
	}, []);

	const dotsStr = String(dots);
	const providerNameStr = String(provider.displayName);

	return (
		<box style={{ flexDirection: "row" }}>
			<text fg={colors.accent}>
				Fetching models from {providerNameStr}
				{dotsStr}
			</text>
		</box>
	);
}

// Model selection component
function ModelSelection({
	models,
	selectedModels,
	onToggle,
	onConfirm,
	onCustom,
	onBack,
	fetchError,
}: {
	models: FetchedModel[];
	selectedModels: Set<string>;
	onToggle: (modelId: string) => void;
	onConfirm: () => void;
	onCustom: () => void;
	onBack: () => void;
	fetchError?: string;
}) {
	const { height: termHeight } = useTerminalDimensions();
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [scrollOffset, setScrollOffset] = useState(0);

	// Filter models by search query
	const filteredModels = useMemo(() => {
		if (!query.trim()) return models;
		const q = query.toLowerCase();
		return models.filter((m) => m.id.toLowerCase().includes(q));
	}, [models, query]);

	// Build items list: filtered models + custom entry
	const items = useMemo(
		() => [
			...filteredModels.map((m) => ({ type: "model" as const, ...m })),
			{ type: "custom" as const, id: "custom", provider: "" },
		],
		[filteredModels],
	);

	// Calculate viewport height (reserve lines for header, search, footer, error)
	const reservedLines = 5 + (fetchError ? 1 : 0);
	const listHeight = Math.min(items.length, Math.max(termHeight - reservedLines, 5));

	// Visible slice of items
	const visibleItems = items.slice(scrollOffset, scrollOffset + listHeight);

	// Clamp scrollOffset when items change
	useEffect(() => {
		const maxOffset = Math.max(0, items.length - listHeight);
		if (scrollOffset > maxOffset) setScrollOffset(maxOffset);
	}, [items.length, listHeight, scrollOffset]);

	useKeyboard((event) => {
		// Typing: filter if not a special key
		if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
			setQuery((prev) => prev + event.name);
			setSelectedIndex(0);
			setScrollOffset(0);
			return;
		}
		if (event.name === "backspace" || event.name === "delete") {
			if (query.length > 0) {
				setQuery((prev) => prev.slice(0, -1));
				setSelectedIndex(0);
				setScrollOffset(0);
			} else {
				onBack();
			}
			return;
		}

		if (event.name === "up") {
			setSelectedIndex((prev) => {
				const next = prev > 0 ? prev - 1 : items.length - 1;
				if (next < scrollOffset) setScrollOffset(next);
				const bottomEdge = scrollOffset + listHeight - 1;
				if (next > bottomEdge) setScrollOffset(Math.max(0, next - listHeight + 1));
				return next;
			});
		} else if (event.name === "down") {
			setSelectedIndex((prev) => {
				const next = prev < items.length - 1 ? prev + 1 : 0;
				if (next < scrollOffset) setScrollOffset(next);
				const bottomEdge = scrollOffset + listHeight - 1;
				if (next > bottomEdge) setScrollOffset(Math.max(0, next - listHeight + 1));
				return next;
			});
		} else if (event.name === "return") {
			const item = items[selectedIndex];
			if (item.type === "custom") {
				onCustom();
			} else {
				onConfirm();
			}
		} else if (event.name === "escape") {
			if (query.length > 0) {
				setQuery("");
			} else {
				onBack();
			}
		} else if (event.name === " ") {
			const item = items[selectedIndex];
			if (item.type === "model") {
				onToggle(item.id);
			}
		}
	});

	const cursor = "\u2588";

	return (
		<box style={{ flexDirection: "column" }}>
			<text>
				<strong>Available models (space to select, enter to confirm):</strong>
			</text>
			{fetchError ? (
				<box>
					<text fg="yellow">Warning: {String(fetchError)}</text>
				</box>
			) : null}
			<box style={{ flexDirection: "row", gap: 1 }}>
				<text fg={colors.muted}>{"Filter:"}</text>
				<text>
					{query || ""}
					{cursor}
				</text>
			</box>
			{visibleItems.map((item, i) => {
				const idx = scrollOffset + i;
				if (item.type === "custom") {
					return (
						<box key="custom">
							<text fg={selectedIndex === idx ? "cyan" : "white"}>
								{selectedIndex === idx ? "> " : "  "}+ Add custom model...
							</text>
						</box>
					);
				}
				return (
					<box key={String(item.id)}>
						<text fg={selectedIndex === idx ? "cyan" : "white"}>
							{selectedIndex === idx ? "> " : "  "}
							{selectedModels.has(item.id) ? "\u25CF " : "\u25CB "}
							{String(item.id)}
						</text>
					</box>
				);
			})}
			{items.length > listHeight ? (
				<text fg={colors.muted}>
					Showing {scrollOffset + 1}-{Math.min(scrollOffset + listHeight, items.length)} of {items.length}
				</text>
			) : null}
			<text fg={colors.muted}>Space to toggle, Enter to confirm, Esc to clear filter or go back</text>
		</box>
	);
}

// API type selection component for custom providers
const API_TYPES = [
	{
		id: "openai-completions",
		label: "OpenAI Compatible (completions)",
		desc: "Chat completions API (OpenAI, OpenRouter, local models)",
	},
	{ id: "openai-responses", label: "OpenAI Responses", desc: "OpenAI Responses API" },
	{ id: "anthropic-messages", label: "Anthropic Messages", desc: "Anthropic Claude API" },
	{ id: "mistral-conversations", label: "Mistral Conversations", desc: "Mistral AI API" },
	{ id: "google-generative-ai", label: "Google Generative AI", desc: "Gemini API" },
] as const;

function ApiTypeSelection({ onSelect, onBack }: { onSelect: (api: string) => void; onBack: () => void }) {
	const [selectedIndex, setSelectedIndex] = useState(0);

	useKeyboard((event) => {
		if (event.name === "up") {
			setSelectedIndex((prev) => (prev > 0 ? prev - 1 : API_TYPES.length - 1));
		} else if (event.name === "down") {
			setSelectedIndex((prev) => (prev < API_TYPES.length - 1 ? prev + 1 : 0));
		} else if (event.name === "return") {
			onSelect(API_TYPES[selectedIndex].id);
		} else if (event.name === "escape") {
			onBack();
		}
	});

	return (
		<box style={{ flexDirection: "column" }}>
			<text>
				<strong>Select API type:</strong>
			</text>
			{API_TYPES.map((api, index) => (
				<box key={api.id} style={{ flexDirection: "column" }}>
					<text fg={selectedIndex === index ? "cyan" : "white"}>
						{selectedIndex === index ? "\u25B6 " : "  "}
						{api.label}
					</text>
				</box>
			))}
			<text fg={colors.muted}>Use arrow keys to navigate, Enter to select, Escape to go back</text>
		</box>
	);
}

// Base URL input component for custom providers
function BaseUrlInput({
	providerName,
	onSubmit,
	onBack,
}: {
	providerName: string;
	onSubmit: (baseUrl: string) => void;
	onBack: () => void;
}) {
	const [url, setUrl] = useState("");

	useKeyboard((event) => {
		if (event.name === "return" && url.trim()) {
			onSubmit(url.trim());
		} else if (event.name === "return" && !url.trim()) {
			// Allow empty URL for some providers
			onSubmit("");
		} else if (event.name === "escape") {
			onBack();
		} else if (event.name === "backspace" || event.name === "delete") {
			setUrl((prev) => prev.slice(0, -1));
		} else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
			setUrl((prev) => prev + event.name);
		}
	});

	const cursor = "\u2588";
	const urlStr = String(url ?? "");

	return (
		<box style={{ flexDirection: "column" }}>
			<text>
				<strong>Enter base URL for {String(providerName)}:</strong>
			</text>
			<text fg={colors.muted}>e.g. https://api.example.com/v1</text>
			<text fg={colors.accent}>
				{" > "}
				{urlStr}
				{cursor}
			</text>
			<text fg={colors.muted}>Press Enter to confirm, Escape to go back</text>
		</box>
	);
}

// Custom model input component
function CustomModelInput({ onSubmit, onCancel }: { onSubmit: (modelId: string) => void; onCancel: () => void }) {
	const [modelId, setModelId] = useState("");

	useKeyboard((event) => {
		if (event.name === "return" && modelId.trim()) {
			onSubmit(modelId.trim());
		} else if (event.name === "escape") {
			onCancel();
		} else if (event.name === "backspace" || event.name === "delete") {
			setModelId((prev) => prev.slice(0, -1));
		} else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
			setModelId((prev) => prev + event.name);
		}
	});

	const modelIdStr = String(modelId ?? "");
	const cursor = "\u2588";

	return (
		<box style={{ flexDirection: "column" }}>
			<text>
				<strong>Enter custom model ID:</strong>
			</text>
			<text fg={colors.accent}>
				{" > "}
				{modelIdStr}
				{cursor}
			</text>
			<text fg={colors.muted}>Press Enter to confirm, Escape to cancel</text>
		</box>
	);
}

// Save confirmation component
function SaveConfirmation({
	providerName,
	modelIds,
	onAddAnother,
	onFinish,
}: {
	providerName: string;
	modelIds: string[];
	onAddAnother: () => void;
	onFinish: () => void;
}) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const options = ["Add another provider", "Finish"];

	useKeyboard((event) => {
		if (event.name === "up" || event.name === "left") {
			setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
		} else if (event.name === "down" || event.name === "right") {
			setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
		} else if (event.name === "return") {
			if (selectedIndex === 0) {
				onAddAnother();
			} else {
				onFinish();
			}
		}
	});

	const providerNameStr = String(providerName);
	const modelIdsStr = modelIds.join(", ") || "None selected";
	const optionsStr = options.map(String);

	return (
		<box style={{ flexDirection: "column" }}>
			<text fg="green">Saved!</text>
			<text>Provider: {providerNameStr}</text>
			<text>Models: {modelIdsStr}</text>
			<box style={{ marginTop: 1, flexDirection: "row" }}>
				{optionsStr.map((option, index) => (
					<box key={option} style={{ marginRight: 2 }}>
						<text fg={selectedIndex === index ? "cyan" : "white"}>
							{selectedIndex === index ? "\u25B6 " : "  "}
							{option}
						</text>
					</box>
				))}
			</box>
		</box>
	);
}

// Main wizard component
function SetupWizard({ onComplete, onCancel }: SetupWizardProps) {
	const [state, setState] = useState<WizardState>({
		step: "provider",
		fetchedModels: [],
		customApi: "openai-completions",
		customBaseUrl: "",
		selectedModels: new Set(),
		isFetching: false,
		showAddAnother: false,
	});

	// Global Ctrl+C to cancel/exit from any step
	useKeyboard((event) => {
		if (event.ctrl && event.name === "c") {
			onCancel();
		}
	});

	// Handle model fetching
	useEffect(() => {
		if (state.step === "fetching" && state.selectedProvider && !state.isFetching) {
			setState((prev) => ({ ...prev, isFetching: true }));

			const doFetch = async () => {
				const providerConfig: ProviderConfig = {
					api: state.selectedProvider!.api,
					baseUrl: state.selectedProvider!.baseUrl || "",
					apiKey: state.apiKey || "",
				};

				const models = await fetchModels(providerConfig, state.selectedProvider!.name);

				// Pre-select models that are already in models.json
				const existingModels = loadModels();
				const existingForProvider = new Set(
					existingModels
						.filter((ref) => ref.startsWith(`${state.selectedProvider!.name}/`))
						.map((ref) => ref.slice(state.selectedProvider!.name.length + 1)),
				);

				const selectedModels = new Set<string>();

				// Pre-select models that already exist in models.json
				for (const model of models) {
					if (existingForProvider.has(model.id)) {
						selectedModels.add(model.id);
					}
				}

				// If nothing pre-selected, auto-select first model
				if (selectedModels.size === 0 && models.length > 0) {
					selectedModels.add(models[0].id);
				}

				setState((prev) => ({
					...prev,
					step: "models",
					fetchedModels: models,
					selectedModels,
					isFetching: false,
					fetchError: models.length === 0 ? "No models found. You can add custom models manually." : undefined,
				}));
			};

			doFetch();
		}
	}, [state.step, state.selectedProvider, state.apiKey, state.isFetching]);

	// Handle save
	useEffect(() => {
		if (state.step === "save" && state.selectedProvider && !state.showAddAnother) {
			// Save provider
			const existingProviders = loadProviders();
			const providerConfig: ProviderConfig = {
				api: state.selectedProvider.api,
				baseUrl: state.selectedProvider.baseUrl || "",
				apiKey: state.apiKey || "",
			};

			saveProviders({
				providers: {
					...existingProviders.providers,
					[state.selectedProvider.name]: providerConfig,
				},
			});

			// Add models to existing ones (don't replace)
			const modelIds = Array.from(state.selectedModels).map((id) => `${state.selectedProvider!.name}/${id}`);
			if (modelIds.length > 0) {
				addModels(modelIds);
			}

			setState((prev) => ({ ...prev, showAddAnother: true }));
		}
	}, [state.step, state.selectedProvider, state.apiKey, state.selectedModels, state.showAddAnother]);

	switch (state.step) {
		case "provider":
			return (
				<ProviderSelection
					onSelect={(provider) => {
						// Check if provider already has API key configured
						const existing = loadProviders();
						const existingConfig = existing.providers[provider.name];
						if (existingConfig?.apiKey) {
							// Skip API key input, go straight to fetching
							setState((prev) => ({
								...prev,
								selectedProvider: provider,
								apiKey: existingConfig.apiKey,
								step: "fetching",
							}));
						} else {
							setState((prev) => ({
								...prev,
								selectedProvider: provider,
								step: provider.authType === "api-key" ? "apiKey" : "fetching",
							}));
						}
					}}
					onCustom={(name) => {
						const knownProvider = getKnownProvider(name);
						if (knownProvider) {
							setState((prev) => ({
								...prev,
								selectedProvider: knownProvider,
								step: knownProvider.authType === "api-key" ? "apiKey" : "fetching",
							}));
						} else {
							// Custom provider - collect api type and base url
							setState((prev) => ({
								...prev,
								customProviderName: name,
								step: "customApi",
							}));
						}
					}}
				/>
			);

		case "customApi":
			return (
				<ApiTypeSelection
					onSelect={(api) =>
						setState((prev) => ({
							...prev,
							customApi: api,
							step: "customBaseUrl",
						}))
					}
					onBack={() =>
						setState((prev) => ({
							...prev,
							step: "provider",
							customProviderName: undefined,
						}))
					}
				/>
			);

		case "customBaseUrl":
			return (
				<BaseUrlInput
					providerName={state.customProviderName!}
					onSubmit={(baseUrl) =>
						setState((prev) => ({
							...prev,
							customBaseUrl: baseUrl,
							selectedProvider: {
								name: prev.customProviderName!,
								displayName: prev.customProviderName!,
								api: prev.customApi!,
								baseUrl,
								authType: "api-key",
							},
							step: "apiKey",
						}))
					}
					onBack={() =>
						setState((prev) => ({
							...prev,
							step: "customApi",
						}))
					}
				/>
			);

		case "apiKey":
			return (
				<ApiKeyInput
					provider={state.selectedProvider!}
					onSubmit={(apiKey) =>
						setState((prev) => ({
							...prev,
							apiKey,
							step: "fetching",
						}))
					}
					onBack={() =>
						setState((prev) => {
							// If custom provider, go back to baseUrl; otherwise to provider selection
							if (prev.customProviderName) {
								return { ...prev, step: "customBaseUrl", selectedProvider: undefined, apiKey: undefined };
							}
							return { ...prev, step: "provider", selectedProvider: undefined, customProviderName: undefined };
						})
					}
				/>
			);

		case "fetching":
			return <FetchingModels provider={state.selectedProvider!} />;

		case "models":
			return (
				<ModelSelection
					models={state.fetchedModels}
					selectedModels={state.selectedModels}
					onToggle={(modelId) =>
						setState((prev) => {
							const newSelected = new Set(prev.selectedModels);
							if (newSelected.has(modelId)) {
								newSelected.delete(modelId);
							} else {
								newSelected.add(modelId);
							}
							return { ...prev, selectedModels: newSelected };
						})
					}
					onConfirm={() =>
						setState((prev) => ({
							...prev,
							step: "save",
						}))
					}
					onCustom={() =>
						setState((prev) => ({
							...prev,
							step: "customModel",
						}))
					}
					onBack={() =>
						setState((prev) => ({
							...prev,
							step: "apiKey",
							apiKey: undefined,
						}))
					}
					fetchError={state.fetchError}
				/>
			);

		case "customModel":
			return (
				<CustomModelInput
					onSubmit={(modelId) =>
						setState((prev) => {
							const newSelected = new Set(prev.selectedModels);
							newSelected.add(modelId);

							const exists = prev.fetchedModels.some((m) => m.id === modelId);
							const newFetched = exists
								? prev.fetchedModels
								: [...prev.fetchedModels, { id: modelId, provider: prev.selectedProvider!.name }];

							return {
								...prev,
								step: "models",
								selectedModels: newSelected,
								fetchedModels: newFetched,
							};
						})
					}
					onCancel={() =>
						setState((prev) => ({
							...prev,
							step: "models",
						}))
					}
				/>
			);

		case "save":
			if (!state.showAddAnother) {
				return (
					<box style={{ flexDirection: "row" }}>
						<text fg={colors.accent}>Saving configuration...</text>
					</box>
				);
			}

			return (
				<SaveConfirmation
					providerName={state.selectedProvider!.name}
					modelIds={Array.from(state.selectedModels)}
					onAddAnother={() =>
						setState({
							step: "provider",
							selectedProvider: undefined,
							customProviderName: undefined,
							customApi: "openai-completions",
							customBaseUrl: "",
							apiKey: undefined,
							fetchedModels: [],
							selectedModels: new Set(),
							isFetching: false,
							showAddAnother: false,
						})
					}
					onFinish={() => {
						onComplete();
					}}
				/>
			);

		default:
			return null;
	}
}

export default SetupWizard;
