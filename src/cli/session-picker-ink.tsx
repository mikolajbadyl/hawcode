import { colors } from "../modes/interactive/components/colors.js";

/// <reference path="../opentui-jsx.d.ts" />

/**
 * OpenTUI-based session selector for --resume flag.
 * Uses native <select> component.
 */

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type React from "react";
import "@opentui/react/jsx-runtime";
import type { SelectOption } from "@opentui/core";
import type { SessionInfo, SessionListProgress } from "../core/session-manager.js";

interface SessionSelectorAppProps {
	sessions: SessionInfo[];
	onSelect: (path: string | null) => void;
}

function SessionSelectorApp({ sessions, onSelect }: SessionSelectorAppProps): React.ReactNode {
	const options: SelectOption[] = sessions.map((s) => {
		const date = new Date(s.modified).toLocaleDateString();
		const name = s.name ?? s.id.slice(0, 8);
		return {
			name,
			description: `${date} ${String(s.messageCount)} messages`,
			value: s,
		};
	});

	return (
		<box style={{ flexDirection: "column", padding: 1 }}>
			<text>
				<strong>Select a session:</strong>
			</text>
			<box style={{ height: 1 }} />
			<select
				options={options}
				focused
				onSelect={(_index: number, option: SelectOption | null) => {
					const session = option?.value as SessionInfo | undefined;
					onSelect(session?.path ?? null);
				}}
				onChange={() => {}}
				showDescription
				showScrollIndicator
				style={{ height: Math.min(sessions.length + 2, 20) }}
			/>
			<box style={{ height: 1 }} />
			<text fg={colors.muted}>Enter to select, Esc to cancel</text>
		</box>
	);
}

/**
 * Show OpenTUI-based session selector and return selected session path or null.
 */
export async function inkSelectSession(
	currentSessionsLoader: (onProgress?: SessionListProgress) => Promise<SessionInfo[]>,
): Promise<string | null> {
	const sessions = await currentSessionsLoader();

	if (sessions.length === 0) {
		return null;
	}

	if (sessions.length === 1) {
		return sessions[0].path;
	}

	return new Promise(async (resolve) => {
		let resolved = false;
		const finish = (value: string | null) => {
			if (resolved) return;
			resolved = true;
			resolve(value);
		};

		const renderer = await createCliRenderer({
			screenMode: "alternate-screen",
			exitOnCtrlC: false,
		});

		renderer.on("destroy", () => finish(null));

		const root = createRoot(renderer);
		root.render(
			<SessionSelectorApp
				sessions={sessions}
				onSelect={(path) => {
					finish(path);
					renderer.destroy();
				}}
			/>,
		);
	});
}
