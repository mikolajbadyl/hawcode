import type React from "react";
import { useEffect, useState } from "react";

// Circular progress bar: 6 blocks fill/drain in a looping pattern
// □□□□□□ → ■□□□□□ → ■■□□□□ → ... → ■■■■■■ → □■■■■■ → ... → □□□□□□ → □□□□□■ → ...
//
// Color: gradient behind the leading edge.
// The lead block gets the accent color; filled blocks trailing behind it
// gradually dim. Empty blocks are dim gray. The gradient direction is
// tied to the wave direction so the fade always looks natural.

const BLOCKS = 6;
const TICK_MS = 80;

// Colors: accent lead, blue gradient trailing, dim empty
const LEAD_COLOR = "#6CB6FF"; // bright blue
const TRAIL_COLORS = ["#539BEC", "#3A80D9", "#2765C5", "#1F4FA8", "#1D3557"];
const EMPTY_COLOR = "#2D333B"; // dim gray

const FILLED = "■";
const EMPTY = "□";

type Direction = "right" | "left";

interface FrameData {
	blocks: boolean[];
	leadPos: number;
	direction: Direction;
}

function buildFrames(): FrameData[] {
	const frames: FrameData[] = [];

	// Phase 1: fill from left → lead moves right
	for (let count = 1; count <= BLOCKS; count++) {
		const blocks = Array.from({ length: BLOCKS }, (_, i) => i < count);
		frames.push({ blocks, leadPos: count - 1, direction: "right" });
	}

	// Phase 2: drain from left → blocks go out from left, lead stays rightmost
	for (let offset = 1; offset < BLOCKS; offset++) {
		const blocks = Array.from({ length: BLOCKS }, (_, i) => i >= offset);
		frames.push({ blocks, leadPos: BLOCKS - 1, direction: "right" });
	}

	// Phase 3: fill from right → lead moves left
	for (let count = 1; count <= BLOCKS; count++) {
		const blocks = Array.from({ length: BLOCKS }, (_, i) => i >= BLOCKS - count);
		frames.push({ blocks, leadPos: BLOCKS - count, direction: "left" });
	}

	// Phase 4: drain from right → blocks go out from right, lead stays leftmost
	for (let offset = 1; offset < BLOCKS; offset++) {
		const blocks = Array.from({ length: BLOCKS }, (_, i) => i < BLOCKS - offset);
		frames.push({ blocks, leadPos: 0, direction: "left" });
	}

	return frames;
}

const FRAMES = buildFrames();

function getBlockColor(index: number, filled: boolean, leadPos: number, direction: Direction): string {
	if (!filled) return EMPTY_COLOR;

	// Trail distance: how far behind the lead this block sits
	const dist = direction === "right" ? leadPos - index : index - leadPos;
	if (dist <= 0) return LEAD_COLOR;
	return TRAIL_COLORS[Math.min(dist - 1, TRAIL_COLORS.length - 1)];
}

export function WaveSpinner(): React.ReactNode {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), TICK_MS);
		return () => clearInterval(timer);
	}, []);

	const { blocks, leadPos, direction } = FRAMES[frame];

	return (
		<box style={{ flexDirection: "row" }}>
			{blocks.map((filled, i) => (
				<text key={i} fg={getBlockColor(i, filled, leadPos, direction)}>
					{filled ? FILLED : EMPTY}
				</text>
			))}
		</box>
	);
}
