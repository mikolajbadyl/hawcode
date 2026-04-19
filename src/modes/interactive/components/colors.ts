/**
 * Centralized color palette for all UI components.
 * 256-color palette: IDs 0–255.
 * Lighter variant — neutral blues and warm grays on dark background.
 */

export const colors = {
	// Primary accent — lighter steel blue
	accent: "#8BC4DB",
	blue: "#8BC4DB",
	cyan: "#9ECBE0",
	red: "#E08080",
	yellow: "#E8B07A",
	green: "#A4D494",

	// Neutral
	gray: "#8E96A0",
	dimGray: "#6A7380",
	darkGray: "#4E5560",
	muted: "#8E96A0",
	text: "#D8DBE0",

	// Context indicators
	contextOk: "#A4D494",
	contextWarn: "#E8B07A",
	contextCritical: "#E08080",

	// UI elements
	border: "#4E5560",
	borderMuted: "#3A404A",
	borderAccent: "#8BC4DB",
	selected: "#8BC4DB",
	selectionBg: "#344860",

	// Markdown
	mdHeading: "#8BC4DB",
	mdLink: "#9ECBE0",
	mdLinkUrl: "#8BC4DB",
	mdCode: "#9ECBE0",
	mdCodeBlock: "#A4D494",
	mdCodeBlockBorder: "#4E5560",
	mdQuote: "#8E96A0",
	mdQuoteBorder: "#4E5560",
	mdListBullet: "#8BC4DB",
	mdItalic: "#C8AED0",
	mdHr: "#4E5560",

	// Status
	success: "#A4D494",
	running: "#9ECBE0",
	error: "#E08080",
	warning: "#E8B07A",
	thinking: "#8E96A0",

	// Syntax
	syntaxComment: "#8E96A0",
	syntaxKeyword: "#C8AED0",
	syntaxFunction: "#8BC4DB",
	syntaxVariable: "#9ECBE0",
	syntaxString: "#E8B07A",
	syntaxNumber: "#A4D494",
	syntaxType: "#9ECBE0",

	// Tool output
	toolTitle: "#C8AED0",
	toolOutput: "#D8DBE0",
	toolDiffAdded: "#1A3D22",
	toolDiffRemoved: "#4A1E1E",
	toolDiffContext: "#8E96A0",
} as const;

/** Context color based on usage percent */
export function contextColor(percent: number): string {
	if (percent > 80) return colors.contextCritical;
	if (percent > 50) return colors.contextWarn;
	return colors.contextOk;
}
