import type React from "react";
import { WaveSpinner } from "./wave-spinner.js";

interface BorderedLoaderProps {
	message?: string;
	color?: string;
	width?: number;
}

export function BorderedLoader({
	message = "Working...",
	color = "#707880",
	width,
}: BorderedLoaderProps): React.ReactNode {
	return (
		<box
			border={true}
			borderStyle="rounded"
			borderColor={color}
			paddingLeft={1}
			paddingRight={1}
			width={width}
			flexDirection="row"
			gap={1}
		>
			<WaveSpinner />
			<text fg={color}>{message}</text>
		</box>
	);
}
