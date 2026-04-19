/// <reference path="../opentui-jsx.d.ts" />

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import "@opentui/react/jsx-runtime";
import SetupWizard from "../core/setup-wizard.js";

/**
 * Run the interactive setup wizard.
 * This guides the user through configuring providers and models.
 */
export async function runSetup(): Promise<void> {
	return new Promise(async (resolve) => {
		const renderer = await createCliRenderer({
			screenMode: "alternate-screen",
			exitOnCtrlC: false,
		});

		const root = createRoot(renderer);
		root.render(
			<SetupWizard
				onComplete={() => {
					renderer.destroy();
					resolve();
				}}
				onCancel={() => {
					renderer.destroy();
					resolve();
				}}
			/>,
		);
	});
}
