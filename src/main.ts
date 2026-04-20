/**
 * Main entry point for the coding agent CLI.
 *
 * This file handles CLI argument parsing and translates them into
 * createAgentSession() options. The SDK does the heavy lifting.
 */

import chalk from "chalk";
import type { ImageContent } from "./ai/index.js";
import { type Args, parseArgs, printHelp } from "./cli/args.js";
import { runAuthTools } from "./cli/auth-tools.js";
import { processFileArguments } from "./cli/file-processor.js";
import { buildInitialMessage } from "./cli/initial-message.js";
import { inkSelectSession } from "./cli/session-picker-ink.js";
import { runSetup } from "./cli/setup.js";
import { getAgentDir, getModelsPath, VERSION } from "./config.js";
import { type CreateAgentSessionRuntimeFactory, createAgentSessionRuntime } from "./core/agent-session-runtime.js";
import {
	type AgentSessionRuntimeDiagnostic,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "./core/agent-session-services.js";
import { AuthStorage } from "./core/auth-storage.js";
import { exportFromFile } from "./core/export-html/index.js";
import { resolveCliModel } from "./core/model-resolver.js";
import { takeOverStdout } from "./core/output-guard.js";
import type { CreateAgentSessionOptions } from "./core/sdk.js";
import { formatMissingSessionCwdPrompt, getMissingSessionCwdIssue, type SessionCwdIssue } from "./core/session-cwd.js";
import { SessionManager } from "./core/session-manager.js";
import { SettingsManager } from "./core/settings-manager.js";
import { printTimings, resetTimings, time } from "./core/timings.js";
import { allTools } from "./core/tools/index.js";
import { runMigrations, showDeprecationWarnings } from "./migrations.js";
import { TuiInteractiveMode } from "./modes/index.js";
import { inkSelect } from "./modes/interactive/components/ink-select.js";
import { initTheme } from "./modes/interactive/theme/theme.js";
import { handleConfigCommand, handlePackageCommand } from "./package-manager-cli.js";

function collectSettingsDiagnostics(
	settingsManager: SettingsManager,
	context: string,
): AgentSessionRuntimeDiagnostic[] {
	return settingsManager.drainErrors().map(({ scope, error }) => ({
		type: "warning",
		message: `(${context}, ${scope} settings) ${error.message}`,
	}));
}

function reportDiagnostics(diagnostics: readonly AgentSessionRuntimeDiagnostic[]): void {
	for (const diagnostic of diagnostics) {
		const color = diagnostic.type === "error" ? chalk.red : diagnostic.type === "warning" ? chalk.yellow : chalk.dim;
		const prefix = diagnostic.type === "error" ? "Error: " : diagnostic.type === "warning" ? "Warning: " : "";
		console.error(color(`${prefix}${diagnostic.message}`));
	}
}

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

async function prepareInitialMessage(
	parsed: Args,
	autoResizeImages: boolean,
	stdinContent?: string,
): Promise<{
	initialMessage?: string;
	initialImages?: ImageContent[];
}> {
	if (parsed.fileArgs.length === 0) {
		return buildInitialMessage({ parsed, stdinContent });
	}

	const { text, images } = await processFileArguments(parsed.fileArgs, { autoResizeImages });
	return buildInitialMessage({
		parsed,
		fileText: text,
		fileImages: images,
		stdinContent,
	});
}

async function createSessionManager(
	parsed: Args,
	cwd: string,
	sessionDir: string | undefined,
	_settingsManager: SettingsManager,
): Promise<SessionManager> {
	if (parsed.resume) {
		initTheme();
		try {
			const selectedPath = await inkSelectSession((onProgress) => SessionManager.list(cwd, sessionDir, onProgress));
			if (!selectedPath) {
				console.log(chalk.dim("No session selected"));
				process.exit(0);
			}
			return SessionManager.open(selectedPath, sessionDir);
		} finally {
		}
	}

	if (parsed.continue) {
		return SessionManager.continueRecent(cwd, sessionDir);
	}

	return SessionManager.create(cwd, sessionDir);
}

function buildSessionOptions(
	parsed: Args,
	modelRegistry: import("./core/model-registry.js").ModelRegistry,
): {
	options: CreateAgentSessionOptions;
	diagnostics: AgentSessionRuntimeDiagnostic[];
} {
	const options: CreateAgentSessionOptions = {};
	const diagnostics: AgentSessionRuntimeDiagnostic[] = [];

	if (parsed.model) {
		const resolved = resolveCliModel({
			cliModel: parsed.model,
			modelRegistry,
		});
		if (resolved.error) {
			diagnostics.push({ type: "error", message: resolved.error });
		}
		if (resolved.model) {
			options.model = resolved.model;
		}
	}

	if (parsed.tools) {
		options.tools = parsed.tools.map((name) => allTools[name]);
	}

	return { options, diagnostics };
}

async function promptForMissingSessionCwd(
	issue: SessionCwdIssue,
	_settingsManager: SettingsManager,
): Promise<string | undefined> {
	const selected = await inkSelect(formatMissingSessionCwdPrompt(issue), ["Continue", "Cancel"]);
	return selected === "Continue" ? issue.fallbackCwd : undefined;
}

export async function main(args: string[]) {
	resetTimings();

	if (await handlePackageCommand(args)) {
		return;
	}

	if (await handleConfigCommand(args)) {
		return;
	}

	const parsed = parseArgs(args);

	// Handle --login flag early before any other processing
	if (parsed.login) {
		await runSetup();
		process.exit(0);
	}

	// Handle --auth-tools flag early
	if (parsed.authTools) {
		await runAuthTools();
		process.exit(0);
	}

	if (parsed.diagnostics.length > 0) {
		for (const d of parsed.diagnostics) {
			const color = d.type === "error" ? chalk.red : chalk.yellow;
			console.error(color(`${d.type === "error" ? "Error" : "Warning"}: ${d.message}`));
		}
		if (parsed.diagnostics.some((d) => d.type === "error")) {
			process.exit(1);
		}
	}
	time("parseArgs");

	// Force model DB refresh before registry is created
	if (parsed.reloadCache) {
		process.env.HAWCODE_RELOAD_CACHE = "1";
	}

	if (parsed.version) {
		console.log(VERSION);
		process.exit(0);
	}

	if (parsed.export) {
		let result: string;
		try {
			const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
			result = await exportFromFile(parsed.export, outputPath);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to export session";
			console.error(chalk.red(`Error: ${message}`));
			process.exit(1);
		}
		console.log(`Exported to: ${result}`);
		process.exit(0);
	}

	// Run migrations (pass cwd for project-local migrations)
	const { deprecationWarnings } = runMigrations(process.cwd());
	time("runMigrations");

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const startupSettingsManager = SettingsManager.create(cwd, agentDir);
	reportDiagnostics(collectSettingsDiagnostics(startupSettingsManager, "startup session lookup"));

	const sessionDir = startupSettingsManager.getSessionDir();
	let sessionManager = await createSessionManager(parsed, cwd, sessionDir, startupSettingsManager);
	const missingSessionCwdIssue = getMissingSessionCwdIssue(sessionManager, cwd);
	if (missingSessionCwdIssue) {
		const selectedCwd = await promptForMissingSessionCwd(missingSessionCwdIssue, startupSettingsManager);
		if (!selectedCwd) {
			process.exit(0);
		}
		sessionManager = SessionManager.open(missingSessionCwdIssue.sessionFile!, sessionDir, selectedCwd);
	}
	time("createSessionManager");

	const authStorage = new AuthStorage();
	const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager }) => {
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			authStorage,
			resourceLoaderOptions: {},
		});
		const { settingsManager, modelRegistry } = services;
		const diagnostics: AgentSessionRuntimeDiagnostic[] = [
			...services.diagnostics,
			...collectSettingsDiagnostics(settingsManager, "runtime creation"),
		];

		const { options: sessionOptions, diagnostics: sessionOptionDiagnostics } = buildSessionOptions(
			parsed,
			modelRegistry,
		);
		diagnostics.push(...sessionOptionDiagnostics);

		const created = await createAgentSessionFromServices({
			services,
			sessionManager,
			model: sessionOptions.model,
			thinkingLevel: sessionOptions.thinkingLevel,
			scopedModels: sessionOptions.scopedModels,
			tools: sessionOptions.tools,
			customTools: sessionOptions.customTools,
		});

		return {
			...created,
			services,
			diagnostics,
		};
	};
	time("createRuntime");
	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: sessionManager.getCwd(),
		agentDir,
		sessionManager,
	});
	const { services, session, modelFallbackMessage } = runtime;
	const { settingsManager } = services;

	// Check if models.json has any configured models
	const { loadModels: loadHawcodeModels, loadProviders: loadHawcodeProviders } = await import(
		"./core/hawcode-config.js"
	);
	const hawcodeModels = loadHawcodeModels();
	const hawcodeProviders = loadHawcodeProviders();
	if (hawcodeModels.length === 0 && Object.keys(hawcodeProviders.providers).length === 0) {
		console.error(chalk.red("No models configured."));
		console.error(chalk.dim(`Run ${chalk.bold("hawcode --login")} to configure providers and models.`));
		process.exit(1);
	}

	if (parsed.help) {
		printHelp();
		process.exit(0);
	}

	// Read piped stdin content (if any)
	const stdinContent = await readPipedStdin();
	const isPipedMode = stdinContent !== undefined;
	time("readPipedStdin");

	const { initialMessage, initialImages } = await prepareInitialMessage(
		parsed,
		settingsManager.getImageAutoResize(),
		stdinContent,
	);
	time("prepareInitialMessage");

	const isInteractive = !isPipedMode && process.stdin.isTTY;
	if (!isInteractive) {
		takeOverStdout();
	}

	initTheme();
	time("initTheme");

	// Show deprecation warnings in interactive mode
	if (isInteractive && deprecationWarnings.length > 0) {
		await showDeprecationWarnings(deprecationWarnings);
	}

	reportDiagnostics(runtime.diagnostics);
	if (runtime.diagnostics.some((diagnostic) => diagnostic.type === "error")) {
		process.exit(1);
	}
	time("createAgentSession");

	if (!isInteractive && !session.model) {
		console.error(chalk.red("No models available."));
		console.error(chalk.yellow("\nSet an API key environment variable:"));
		console.error("  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.");
		console.error(chalk.yellow(`\nOr create ${getModelsPath()}`));
		process.exit(1);
	}

	const startupBenchmark = isTruthyEnvFlag(process.env.HAWCODE_STARTUP_BENCHMARK);

	if (isInteractive) {
		const interactiveMode = new TuiInteractiveMode(runtime, {
			modelFallbackMessage,
			initialMessage,
			initialImages,
			initialMessages: parsed.messages,
			verbose: false,
		});
		if (startupBenchmark) {
			await interactiveMode.init();
			time("interactiveMode.init");
			printTimings();
			interactiveMode.stop();
			if (process.stdout.writableLength > 0) {
				await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
			}
			if (process.stderr.writableLength > 0) {
				await new Promise<void>((resolve) => process.stderr.once("drain", resolve));
			}
			return;
		}

		printTimings();
		await interactiveMode.run();
	} else {
		// Piped stdin or non-TTY: process and exit
		const { restoreStdout } = await import("./core/output-guard.js");
		printTimings();
		const { runPrintMode } = await import("./modes/index.js");
		const exitCode = await runPrintMode(runtime, {
			mode: "text",
			messages: parsed.messages,
			initialMessage,
			initialImages,
		});
		restoreStdout();
		if (exitCode !== 0) {
			process.exitCode = exitCode;
		}
		return;
	}
}

/**
 * Read all content from piped stdin.
 * Returns undefined if stdin is a TTY (interactive terminal).
 */
async function readPipedStdin(): Promise<string | undefined> {
	if (process.stdin.isTTY) {
		return undefined;
	}

	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => {
			resolve(data.trim() || undefined);
		});
		process.stdin.resume();
	});
}
