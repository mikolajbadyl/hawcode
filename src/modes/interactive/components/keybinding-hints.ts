/**
 * Utilities for formatting keybinding hints in the UI.
 */

import { KEYBINDINGS } from "../../../core/keybindings.js";
import type { KeyId } from "../../../core/tui-stubs.js";
import { theme } from "../theme/theme.js";

function formatKeys(keys: KeyId[]): string {
	if (keys.length === 0) return "";
	if (keys.length === 1) return keys[0]!;
	return keys.join("/");
}

/** Get the default key IDs for a keybinding name (e.g. "tui.select.cancel" -> ["escape"]) */
function getDefaultKeys(keybinding: string): KeyId[] {
	const def = KEYBINDINGS[keybinding as keyof typeof KEYBINDINGS];
	if (!def) return [];
	const keys = def.defaultKeys;
	return Array.isArray(keys) ? keys : [keys];
}

export function keyText(keybinding: string): string {
	return formatKeys(getDefaultKeys(keybinding));
}

export function keyHint(keybinding: string, description: string): string {
	return theme.fg("dim", keyText(keybinding)) + theme.fg("muted", ` ${description}`);
}

export function rawKeyHint(key: string, description: string): string {
	return theme.fg("dim", key) + theme.fg("muted", ` ${description}`);
}
