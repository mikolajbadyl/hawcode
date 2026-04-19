import type React from "react";
import { colors } from "./colors.js";

interface UserMessageProps {
	text: string;
	width?: number;
}

export function UserMessage({ text, width }: UserMessageProps): React.ReactNode {
	const safeText = text || "";
	return (
		<box style={{ flexDirection: "column", width }}>
			<box style={{ height: 1 }} />
			<box style={{ paddingLeft: 1, flexDirection: "row", gap: 1 }}>
				<text fg={colors.accent}>
					<strong>{">"}</strong>
				</text>
				<text fg={colors.text}>{safeText}</text>
			</box>
		</box>
	);
}
