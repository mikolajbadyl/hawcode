/**
 * opentui config selector for `pi config` command
 */

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import type { ResolvedPaths } from "../core/package-manager.js";
import type { SettingsManager } from "../core/settings-manager.js";
import { ConfigSelectorComponent } from "../modes/interactive/components/config-selector.js";
import { initTheme, stopThemeWatcher } from "../modes/interactive/theme/theme.js";

export interface ConfigSelectorOptions {
	resolvedPaths: ResolvedPaths;
	settingsManager: SettingsManager;
	cwd: string;
	agentDir: string;
}

/** Show TUI config selector and return when closed */
export async function selectConfig(options: ConfigSelectorOptions): Promise<void> {
	initTheme(options.settingsManager.getTheme(), true);

	const renderer = await createCliRenderer();

	return new Promise((resolve) => {
		let resolved = false;

		function App(): React.ReactNode {
			return React.createElement(ConfigSelectorComponent, {
				resolvedPaths: options.resolvedPaths,
				settingsManager: options.settingsManager,
				cwd: options.cwd,
				agentDir: options.agentDir,
				onClose: () => {
					if (!resolved) {
						resolved = true;
						renderer.destroy();
						stopThemeWatcher();
						resolve();
					}
				},
				onExit: () => {
					renderer.destroy();
					stopThemeWatcher();
					process.exit(0);
				},
			});
		}

		createRoot(renderer).render(React.createElement(App));
	});
}
