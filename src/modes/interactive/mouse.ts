/**
 * Mouse event handling for terminal scroll wheel support.
 * Enables SGR mouse tracking mode and parses scroll events from stdin.
 */

const ESC = "\x1b";
const SGR_MOUSE_REGEX = /^\x1b\[<(\d+);(\d+);(\d+)([mM])/;
const X11_MOUSE_REGEX = /^\x1b\[M([\s\S]{3})/;

export type MouseScrollDirection = "up" | "down";

export interface MouseScrollEvent {
	direction: MouseScrollDirection;
	col: number;
	row: number;
}

/**
 * Parse SGR extended mouse mode events.
 * Scroll wheel: button code & 64 === 64, button & 1 indicates direction (0=up, 1=down).
 */
function parseSGRScroll(buffer: string): { event: MouseScrollEvent; length: number } | null {
	const match = buffer.match(SGR_MOUSE_REGEX);
	if (!match) return null;

	const buttonCode = parseInt(match[1]!, 10);
	// Check if scroll wheel (bit 6 set)
	if ((buttonCode & 64) !== 64) return null;

	const col = parseInt(match[2]!, 10);
	const row = parseInt(match[3]!, 10);
	const direction: MouseScrollDirection = (buttonCode & 1) === 0 ? "up" : "down";

	return { event: { direction, col, row }, length: match[0].length };
}

/**
 * Parse X11 mouse events for scroll wheel.
 */
function parseX11Scroll(buffer: string): { event: MouseScrollEvent; length: number } | null {
	const match = buffer.match(X11_MOUSE_REGEX);
	if (!match) return null;

	const bytes = match[1]!;
	if (bytes.length < 3) return null;

	const b = bytes.charCodeAt(0) - 32;
	const col = bytes.charCodeAt(1) - 32;
	const row = bytes.charCodeAt(2) - 32;

	// Check if scroll wheel (bit 6 set)
	if ((b & 64) !== 64) return null;

	const direction: MouseScrollDirection = (b & 1) === 0 ? "up" : "down";
	return { event: { direction, col, row }, length: match[0].length };
}

/**
 * Parse a mouse scroll event from the terminal input buffer.
 */
export function parseMouseScroll(buffer: string): { event: MouseScrollEvent; length: number } | null {
	return parseSGRScroll(buffer) || parseX11Scroll(buffer);
}

/**
 * Check if the buffer could be the start of a mouse sequence (incomplete).
 */
export function isIncompleteMouseSequence(buffer: string): boolean {
	if (buffer.length === 0) return true;
	if (buffer === ESC || buffer === `${ESC}[` || buffer === `${ESC}[<`) return true;
	if (buffer.startsWith(`${ESC}[<`)) return !/[mM]/.test(buffer) && buffer.length < 50;
	if (buffer.startsWith(`${ESC}[M`)) return buffer.length < 4;
	return false;
}

/**
 * Enable mouse event tracking (SGR extended mode with button tracking).
 * ?1002h = button event tracking (clicks + drags + scroll wheel)
 * ?1006h = SGR extended mouse mode
 */
export function enableMouseTracking(): void {
	process.stdout.write("\x1b[?1002h\x1b[?1006h");
}

/**
 * Disable mouse event tracking.
 */
export function disableMouseTracking(): void {
	process.stdout.write("\x1b[?1006l\x1b[?1002l");
}
