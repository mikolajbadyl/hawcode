import { spawn } from "child_process";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/lib/node/main.js";
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types";
import { LANGUAGE_EXTENSIONS } from "./language.js";

const DIAGNOSTICS_DEBOUNCE_MS = 150;
const DIAGNOSTICS_TIMEOUT_MS = 8000;

export type Diagnostic = VSCodeDiagnostic;

export interface LspClientOptions {
	serverId: string;
	command: string;
	args: string[];
	root: string;
	directory: string;
	env?: Record<string, string>;
	initializationOptions?: Record<string, unknown>;
}

export interface LspClient {
	readonly serverId: string;
	readonly root: string;
	notify: {
		open(request: { path: string }): Promise<void>;
	};
	getDiagnostics(): Map<string, Diagnostic[]>;
	waitForDiagnostics(request: { path: string }): Promise<void>;
	onDiagnosticsChange(listener: (path: string) => void): () => void;
	shutdown(): Promise<void>;
}

export async function createLspClient(options: LspClientOptions): Promise<LspClient> {
	const proc = spawn(options.command, options.args, {
		cwd: options.root,
		env: { ...process.env, ...options.env },
		stdio: ["pipe", "pipe", "pipe"],
	});

	if (!proc.stdin || !proc.stdout || !proc.stderr) {
		throw new Error(`Failed to create LSP process for ${options.serverId}: stdio not available`);
	}

	const connection = createMessageConnection(
		new StreamMessageReader(proc.stdout),
		new StreamMessageWriter(proc.stdin),
	);

	const diagnostics = new Map<string, Diagnostic[]>();
	const diagnosticListeners = new Set<(path: string) => void>();

	connection.onNotification("textDocument/publishDiagnostics" as any, (params: any) => {
		let filePath: string;
		try {
			filePath = fileURLToPath(params.uri);
		} catch {
			return;
		}
		filePath = path.resolve(filePath);
		diagnostics.set(filePath, params.diagnostics);
		for (const listener of diagnosticListeners) {
			try {
				listener(filePath);
			} catch {}
		}
	});

	connection.onRequest("window/workDoneProgress/create" as any, () => null);
	connection.onRequest("workspace/configuration" as any, async () => [options.initializationOptions ?? {}]);
	connection.onRequest("client/registerCapability" as any, async () => {});
	connection.onRequest("client/unregisterCapability" as any, async () => {});
	connection.onRequest("workspace/workspaceFolders" as any, async () => [
		{ name: "workspace", uri: pathToFileURL(options.root).href },
	]);

	connection.listen();

	// Initialize
	await connection.sendRequest("initialize", {
		rootUri: pathToFileURL(options.root).href,
		processId: process.pid,
		workspaceFolders: [{ name: "workspace", uri: pathToFileURL(options.root).href }],
		initializationOptions: options.initializationOptions ?? {},
		capabilities: {
			window: { workDoneProgress: true },
			workspace: {
				configuration: true,
				didChangeWatchedFiles: { dynamicRegistration: true },
			},
			textDocument: {
				synchronization: { didOpen: true, didChange: true },
				publishDiagnostics: { versionSupport: true },
			},
		},
	});

	await connection.sendNotification("initialized", {});

	if (options.initializationOptions) {
		await connection.sendNotification("workspace/didChangeConfiguration", {
			settings: options.initializationOptions,
		});
	}

	const openFiles = new Map<string, number>();
	let disposed = false;

	const result: LspClient = {
		get serverId() {
			return options.serverId;
		},
		get root() {
			return options.root;
		},
		notify: {
			async open(request: { path: string }) {
				const absPath = path.isAbsolute(request.path)
					? request.path
					: path.resolve(options.directory, request.path);
				const fs = await import("fs/promises");
				let text: string;
				try {
					text = await fs.readFile(absPath, "utf-8");
				} catch {
					return;
				}
				const extension = path.extname(absPath);
				const languageId = (LANGUAGE_EXTENSIONS as Record<string, string>)[extension] ?? "plaintext";

				const version = openFiles.get(absPath);
				if (version !== undefined) {
					// File already open - send change
					await connection.sendNotification("workspace/didChangeWatchedFiles" as any, {
						changes: [{ uri: pathToFileURL(absPath).href, type: 2 }],
					});
					const next = version + 1;
					openFiles.set(absPath, next);
					await connection.sendNotification("textDocument/didChange" as any, {
						textDocument: { uri: pathToFileURL(absPath).href, version: next },
						contentChanges: [{ text }],
					});
					return;
				}

				// New file
				await connection.sendNotification("workspace/didChangeWatchedFiles" as any, {
					changes: [{ uri: pathToFileURL(absPath).href, type: 1 }],
				});
				diagnostics.delete(absPath);
				await connection.sendNotification("textDocument/didOpen" as any, {
					textDocument: {
						uri: pathToFileURL(absPath).href,
						languageId,
						version: 0,
						text,
					},
				});
				openFiles.set(absPath, 0);
			},
		},
		getDiagnostics() {
			return diagnostics;
		},
		async waitForDiagnostics(request: { path: string }): Promise<void> {
			const normalizedPath = path.resolve(request.path);
			await new Promise<void>((resolve) => {
				let debounceTimer: ReturnType<typeof setTimeout> | undefined;
				let settled = false;
				const finish = (): void => {
					if (settled) return;
					settled = true;
					diagnosticListeners.delete(handler);
					if (debounceTimer) clearTimeout(debounceTimer);
					if (hardTimeout) clearTimeout(hardTimeout);
					resolve();
				};
				const handler = (changedPath: string): void => {
					if (changedPath !== normalizedPath) return;
					if (debounceTimer) clearTimeout(debounceTimer);
					debounceTimer = setTimeout(finish, DIAGNOSTICS_DEBOUNCE_MS);
				};
				diagnosticListeners.add(handler);
				const hardTimeout = setTimeout(finish, DIAGNOSTICS_TIMEOUT_MS);
			});
		},
		onDiagnosticsChange(listener: (path: string) => void): () => void {
			diagnosticListeners.add(listener);
			return () => diagnosticListeners.delete(listener);
		},
		async shutdown() {
			if (disposed) return;
			disposed = true;
			diagnosticListeners.clear();
			try {
				connection.end();
				connection.dispose();
			} catch {}
			try {
				proc.kill();
			} catch {}
		},
	};

	return result;
}
