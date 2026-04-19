import type React from "react";
import type { AssistantMessage as AssistantMessageType } from "../../../ai/index.js";
import { colors } from "./colors.js";
import { MarkdownWidget } from "./markdown-widget.js";

interface AssistantMessageProps {
	message?: AssistantMessageType;
	width?: number;
}

export function AssistantMessage({ message, width }: AssistantMessageProps): React.ReactNode {
	if (!message) return null;

	const thinkingParts: string[] = [];
	const textParts: string[] = [];

	for (const c of message.content) {
		if (c.type === "thinking" && c.thinking) {
			thinkingParts.push(c.thinking);
		}
		if (c.type === "text" && c.text) {
			textParts.push(c.text);
		}
	}

	const thinking = thinkingParts.join("\n\n");
	const text = textParts.join("\n\n");

	const hasToolCalls = message.content.some((c: any) => c.type === "toolCall");
	const isAborted = !hasToolCalls && message.stopReason === "aborted";
	const isError = !hasToolCalls && message.stopReason === "error";
	const isComplete = message.stopReason != null && message.stopReason !== "aborted" && message.stopReason !== "error";

	return (
		<box style={{ flexDirection: "column", width }}>
			{thinking ? (
				<box style={{ flexDirection: "column", paddingLeft: 1 }}>
					<text fg={colors.muted}>{thinking}</text>
				</box>
			) : null}
			{text ? (
				<box style={{ flexDirection: "column", paddingLeft: 1, width: width ? width - 1 : undefined }}>
					{isComplete ? (
						<MarkdownWidget content={text} width={width ? width - 1 : undefined} />
					) : (
						<text>{text}</text>
					)}
				</box>
			) : null}
			{isAborted ? <text fg={colors.error}>Operation aborted</text> : null}
			{isError ? <text fg={colors.error}>Error: {message.errorMessage || "Unknown error"}</text> : null}
		</box>
	);
}
