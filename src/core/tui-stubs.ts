/**
 * Local TUI stubs for core tools and extensions.
 * Provides lightweight implementations of common UI utilities
 * without depending on any external TUI framework.
 */

import stripAnsi from "strip-ansi";

// ============================================================================
// Component Interface (for extensions)
// ============================================================================

export interface Component {
	render(width: number): string[];
	invalidate?(): void;
}

// ============================================================================
// Text Component
// ============================================================================

export class Text implements Component {
	private text: string;
	private paddingY: number;
	private paddingX: number;

	constructor(text: string, paddingY?: number, paddingX?: number);
	constructor(text: string, paddingY: number = 0, paddingX: number = 0) {
		this.text = text;
		this.paddingY = paddingY;
		this.paddingX = paddingX;
	}

	setText(text: string): void {
		this.text = text;
	}

	invalidate(): void {
		// No-op in stub
	}

	render(width: number): string[] {
		const lines = this.text.split("\n");
		const result: string[] = [];

		// Top padding
		for (let i = 0; i < this.paddingY; i++) {
			result.push("");
		}

		// Content with horizontal padding
		const horizontalPadding = " ".repeat(this.paddingX);
		for (const line of lines) {
			const contentWidth = width - this.paddingX * 2;
			if (contentWidth <= 0) {
				result.push(horizontalPadding);
			} else if (stripAnsi(line).length > contentWidth) {
				result.push(horizontalPadding + truncateToWidth(line, contentWidth, "...") + horizontalPadding);
			} else {
				result.push(horizontalPadding + line + horizontalPadding);
			}
		}

		// Bottom padding
		for (let i = 0; i < this.paddingY; i++) {
			result.push("");
		}

		return result;
	}
}

// ============================================================================
// Container Component
// ============================================================================

export class Container implements Component {
	private children: Component[] = [];

	addChild(child: Component | { render: (width: number) => string[]; invalidate?: () => void }): void {
		this.children.push(child as Component);
	}

	clear(): void {
		this.children = [];
	}

	render(width: number): string[] {
		const result: string[] = [];
		for (const child of this.children) {
			result.push(...child.render(width));
		}
		return result;
	}

	invalidate(): void {
		for (const child of this.children) {
			if (child.invalidate) {
				child.invalidate();
			}
		}
	}
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Calculate the visible width of a string (excluding ANSI codes).
 * @deprecated Unused — will be removed in a future version.
 */
export function visibleWidth(str: string): number {
	return stripAnsi(str).length;
}

/**
 * Truncate a string to a specified visual width, accounting for ANSI codes.
 * If the string exceeds maxWidth, it will be truncated and suffix added.
 */
export function truncateToWidth(str: string, maxWidth: number, suffix = "..."): string {
	const plainText = stripAnsi(str);
	if (plainText.length <= maxWidth) {
		return str;
	}

	// We need to truncate while preserving ANSI codes
	// For simplicity, we strip ANSI and add a reset at the end
	const targetLength = maxWidth - suffix.length;
	if (targetLength <= 0) {
		return suffix.slice(0, maxWidth);
	}

	return `${plainText.slice(0, targetLength)}${suffix}\x1b[0m`;
}

// ============================================================================
// Image/Capability Functions (for render-utils.ts)
// ============================================================================

export interface TerminalCapabilities {
	images: boolean;
}

export function getCapabilities(): TerminalCapabilities {
	return { images: false };
}

export interface ImageDimensions {
	width: number;
	height: number;
}

export function getImageDimensions(_data: string, _mimeType: string): ImageDimensions | null {
	return null;
}

export function imageFallback(mimeType: string, _dimensions?: ImageDimensions): string {
	return `[image: ${mimeType}]`;
}

// ============================================================================
// Keybinding Types (for keybindings.ts and extensions)
// ============================================================================

export type KeyId = string;

export interface Keybinding {
	defaultKeys: string | string[];
	description?: string;
}

export type KeybindingDefinitions = Record<string, Keybinding>;

export type KeybindingsConfig = Record<string, KeyId | KeyId[]>;

// Minimal keybindings manager stub
export class KeybindingsManager {
	private definitions: KeybindingDefinitions;
	private userBindings: KeybindingsConfig;

	constructor(definitions: KeybindingDefinitions, userBindings: KeybindingsConfig = {}) {
		this.definitions = definitions;
		this.userBindings = userBindings;
	}

	setUserBindings(bindings: KeybindingsConfig): void {
		this.userBindings = bindings;
	}

	getResolvedBindings(): KeybindingsConfig {
		const resolved: KeybindingsConfig = {};
		for (const [key, binding] of Object.entries(this.definitions)) {
			if (key in this.userBindings) {
				resolved[key] = this.userBindings[key];
			} else {
				resolved[key] = Array.isArray(binding.defaultKeys) ? binding.defaultKeys : [binding.defaultKeys];
			}
		}
		return resolved;
	}
}

// Default TUI keybindings (minimal set)
export const TUI_KEYBINDINGS: KeybindingDefinitions = {
	"tui.editor.cursorUp": { defaultKeys: "up", description: "Move cursor up" },
	"tui.editor.cursorDown": { defaultKeys: "down", description: "Move cursor down" },
	"tui.editor.cursorLeft": { defaultKeys: "left", description: "Move cursor left" },
	"tui.editor.cursorRight": { defaultKeys: "right", description: "Move cursor right" },
	"tui.editor.cursorWordLeft": { defaultKeys: "ctrl+left", description: "Move cursor word left" },
	"tui.editor.cursorWordRight": { defaultKeys: "ctrl+right", description: "Move cursor word right" },
	"tui.editor.cursorLineStart": { defaultKeys: "home", description: "Move to line start" },
	"tui.editor.cursorLineEnd": { defaultKeys: "end", description: "Move to line end" },
	"tui.editor.pageUp": { defaultKeys: "pageup", description: "Page up" },
	"tui.editor.pageDown": { defaultKeys: "pagedown", description: "Page down" },
	"tui.editor.deleteCharBackward": { defaultKeys: "backspace", description: "Delete character backward" },
	"tui.editor.deleteCharForward": { defaultKeys: "delete", description: "Delete character forward" },
	"tui.editor.deleteWordBackward": { defaultKeys: "ctrl+w", description: "Delete word backward" },
	"tui.editor.deleteWordForward": { defaultKeys: "ctrl+d", description: "Delete word forward" },
	"tui.editor.deleteToLineStart": { defaultKeys: "ctrl+u", description: "Delete to line start" },
	"tui.editor.deleteToLineEnd": { defaultKeys: "ctrl+k", description: "Delete to line end" },
	"tui.editor.undo": { defaultKeys: "ctrl+z", description: "Undo" },
	"tui.editor.yank": { defaultKeys: "ctrl+y", description: "Yank/paste" },
	"tui.editor.yankPop": { defaultKeys: "alt+y", description: "Yank pop" },
	"tui.input.newLine": { defaultKeys: "enter", description: "New line" },
	"tui.input.submit": { defaultKeys: "ctrl+enter", description: "Submit input" },
	"tui.input.copy": { defaultKeys: "ctrl+shift+c", description: "Copy" },
	"tui.select.up": { defaultKeys: "up", description: "Select up" },
	"tui.select.down": { defaultKeys: "down", description: "Select down" },
	"tui.select.pageUp": { defaultKeys: "pageup", description: "Select page up" },
	"tui.select.pageDown": { defaultKeys: "pagedown", description: "Select page down" },
	"tui.select.confirm": { defaultKeys: "enter", description: "Confirm selection" },
	"tui.select.cancel": { defaultKeys: "escape", description: "Cancel selection" },
};

// ============================================================================
// Theme Types (for theme.ts)
// ============================================================================

export interface MarkdownTheme {
	heading: (text: string) => string;
	link: (text: string) => string;
	linkUrl: (text: string) => string;
	code: (text: string) => string;
	codeBlock: (text: string) => string;
	codeBlockBorder: (text: string) => string;
	quote: (text: string) => string;
	quoteBorder: (text: string) => string;
	hr: (text: string) => string;
	listBullet: (text: string) => string;
	bold: (text: string) => string;
	italic: (text: string) => string;
	underline: (text: string) => string;
	strikethrough: (text: string) => string;
	highlightCode: (code: string, lang?: string) => string[];
}

export interface SelectListTheme {
	selectedPrefix: (text: string) => string;
	selectedText: (text: string) => string;
	description: (text: string) => string;
	scrollInfo: (text: string) => string;
	noMatch: (text: string) => string;
}

export interface EditorTheme {
	borderColor: (text: string) => string;
	selectList: SelectListTheme;
}

export interface SettingsListTheme {
	label: (text: string, selected: boolean) => string;
	value: (text: string, selected: boolean) => string;
	description: (text: string) => string;
	cursor: string;
	hint: (text: string) => string;
}

// ============================================================================
// Fuzzy Filter (for list-models.ts)
// ============================================================================

interface FuzzyMatchResult<T> {
	item: T;
	score: number;
}

function fuzzyMatch(haystack: string, needle: string): { match: boolean; score: number } {
	const haystackLower = haystack.toLowerCase();
	const needleLower = needle.toLowerCase();

	// Exact match gets highest priority
	if (haystackLower === needleLower) {
		return { match: true, score: 1 };
	}

	// Contains match gets second priority
	if (haystackLower.includes(needleLower)) {
		return { match: true, score: 0.9 };
	}

	// Fuzzy match
	let haystackIdx = 0;
	let needleIdx = 0;
	let consecutiveMatches = 0;
	let totalConsecutive = 0;
	let matches = 0;

	while (haystackIdx < haystack.length && needleIdx < needle.length) {
		const hayChar = haystackLower[haystackIdx];
		const needleChar = needleLower[needleIdx];

		if (hayChar === needleChar) {
			matches++;
			consecutiveMatches++;
			if (consecutiveMatches > 1) {
				totalConsecutive++;
			}
			needleIdx++;
		} else {
			consecutiveMatches = 0;
		}
		haystackIdx++;
	}

	if (needleIdx < needle.length) {
		return { match: false, score: 0 };
	}

	// Calculate score based on match quality
	const matchRatio = matches / needle.length;
	const lengthPenalty = haystack.length / 100; // Prefer shorter strings
	const consecutiveBonus = totalConsecutive * 0.1;

	return { match: true, score: matchRatio * 0.7 + consecutiveBonus - lengthPenalty * 0.01 };
}

export function fuzzyFilter<T>(items: T[], pattern: string, keyFn: (item: T) => string): T[] {
	if (!pattern.trim()) {
		return items;
	}

	const results: FuzzyMatchResult<T>[] = [];
	for (const item of items) {
		const key = keyFn(item);
		const { match, score } = fuzzyMatch(key, pattern);
		if (match) {
			results.push({ item, score });
		}
	}

	// Sort by score descending
	results.sort((a, b) => b.score - a.score);

	return results.map((r) => r.item);
}

// ============================================================================
// Additional TUI Types (for interactive mode compatibility)
// ============================================================================

// TUI class stub - minimal implementation for CLI files
export class TUI {
	private children: Component[] = [];

	addChild(child: Component): void {
		this.children.push(child);
	}

	setFocus(_focusable: unknown): void {
		// No-op in stub
	}

	start(): void {
		// No-op in stub
	}

	stop(): void {
		// No-op in stub
	}

	requestRender(): void {
		// No-op in stub
	}
}

/** ProcessTerminal stub for CLI files
 * @deprecated Unused — will be removed in a future version.
 */
export class ProcessTerminal {
	// Minimal stub - the real implementation handles terminal I/O
}

/** Additional types needed by extensions and components
 * @deprecated Unused — will be removed in a future version.
 */
export type AutocompleteItem = {
	label: string;
	description?: string;
};

/** @deprecated Unused — will be removed in a future version. */
export interface OverlayHandle {
	hide(): void;
	show(): void;
	close(): void;
}

/** @deprecated Unused — will be removed in a future version. */
export interface OverlayOptions {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
}

/** @deprecated Unused — will be removed in a future version. */
export interface EditorComponent extends Component {
	handleInput(data: string): void;
	getValue(): string;
	setValue(value: string): void;
}

/** @deprecated Unused — will be removed in a future version. */
export interface Focusable {
	focus(): void;
	blur(): void;
	isFocused(): boolean;
}

/** @deprecated Unused — will be removed in a future version. */
export const CURSOR_MARKER = "{cursor}";

/** Helper function for matching key events
 * @deprecated Unused — will be removed in a future version.
 */
export function matchesKey(keyData: string, keyId: KeyId, _keybindings?: KeybindingsConfig): boolean {
	// Simplified matching - exact comparison
	return keyData.toLowerCase() === keyId.toLowerCase();
}

/** getKeybindings stub
 * @deprecated Unused — will be removed in a future version.
 */
export function getKeybindings(): KeybindingsConfig {
	return {};
}

/** setKeybindings stub
 * @deprecated Unused — will be removed in a future version.
 */
export function setKeybindings(_bindings: KeybindingsConfig): void {
	// No-op in stub
}

/** TruncatedText stub class
 * @deprecated Unused — will be removed in a future version.
 */
export class TruncatedText implements Component {
	private text: string;

	constructor(text: string) {
		this.text = text;
	}

	render(width: number): string[] {
		return [truncateToWidth(this.text, width)];
	}
}
