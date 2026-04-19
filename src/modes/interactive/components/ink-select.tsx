/// <reference path="../../../opentui-jsx.d.ts" />

/**
 * OpenTUI-based simple selector dialog.
 * Uses native <select> component.
 */

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type React from "react";
import "@opentui/react/jsx-runtime";
import type { SelectOption } from "@opentui/core";

import { colors } from "./colors.js";

interface SelectorAppProps {
	message: string;
	options: string[];
	onSelect: (value: string | undefined) => void;
}

function SelectorApp({ message, options, onSelect }: SelectorAppProps): React.ReactNode {
	const selectOptions: SelectOption[] = options.map((opt) => ({
		name: opt,
		description: "",
		value: opt,
	}));

	return (
		<box style={{ flexDirection: "column", padding: 1 }}>
			<text>
				<strong>{message}</strong>
			</text>
			<box style={{ height: 1 }} />
			<select
				options={selectOptions}
				focused
				onSelect={(_index: number, option: SelectOption | null) => {
					onSelect(option?.value ? String(option.value) : undefined);
				}}
				onChange={() => {}}
				style={{ height: Math.min(options.length + 2, 20) }}
			/>
			<box style={{ height: 1 }} />
			<text fg={colors.muted}>Enter to select, Esc to cancel</text>
		</box>
	);
}

/**
 * Show a simple selector dialog using OpenTUI and return the selected option.
 */
export async function inkSelect(message: string, options: string[]): Promise<string | undefined> {
	return new Promise(async (resolve) => {
		let resolved = false;
		const finish = (value: string | undefined) => {
			if (resolved) return;
			resolved = true;
			resolve(value);
		};

		const renderer = await createCliRenderer({
			screenMode: "alternate-screen",
			exitOnCtrlC: false,
		});

		renderer.on("destroy", () => finish(undefined));

		const root = createRoot(renderer);
		root.render(
			<SelectorApp
				message={message}
				options={options}
				onSelect={(value) => {
					finish(value);
					renderer.destroy();
				}}
			/>,
		);
	});
}
