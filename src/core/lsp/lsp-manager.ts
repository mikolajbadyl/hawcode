import { existsSync, statSync } from "fs";
import path from "path";
import type { SettingsManager } from "../settings-manager.js";
import { countErrors, countWarnings, formatDiagnosticReport } from "./diagnostic.js";
import type { Diagnostic } from "./lsp-client.js";
import { createLspClient, type LspClient } from "./lsp-client.js";

export interface LspServerConfig {
	id: string;
	/** "lsp" for language intelligence servers, "lint" for linters/formatters */
	category: "lsp" | "lint";
	/** File extensions this server handles (e.g. [".ts", ".tsx"]) */
	extensions: string[];
	/** Command to spawn the server */
	command: string;
	/** Arguments for the command */
	args: string[];
	/** Root detection: look upward for these files from the edited file */
	rootMarkers: string[];
	/** Environment variables */
	env?: Record<string, string>;
	/** LSP initialization options */
	initializationOptions?: Record<string, unknown>;
}

/** Built-in LSP server configurations. */
const BUILTIN_SERVERS: LspServerConfig[] = [
	{
		id: "typescript",
		category: "lsp",
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
		command: "typescript-language-server",
		args: ["--stdio"],
		rootMarkers: ["tsconfig.json", "package.json", "jsconfig.json"],
	},
	{
		id: "biome",
		category: "lint",
		extensions: [
			".ts",
			".tsx",
			".js",
			".jsx",
			".mjs",
			".cjs",
			".mts",
			".cts",
			".json",
			".jsonc",
			".css",
			".html",
			".vue",
			".svelte",
			".astro",
			".graphql",
			".gql",
		],
		command: "biome",
		args: ["lsp-proxy"],
		rootMarkers: ["biome.json", "biome.jsonc"],
	},
	{
		id: "gopls",
		category: "lsp",
		extensions: [".go"],
		command: "gopls",
		args: [],
		rootMarkers: ["go.mod", "go.sum", "go.work"],
	},
	{
		id: "rust-analyzer",
		category: "lsp",
		extensions: [".rs"],
		command: "rust-analyzer",
		args: [],
		rootMarkers: ["Cargo.toml", "Cargo.lock"],
	},
	{
		id: "pyright",
		category: "lsp",
		extensions: [".py", ".pyi"],
		command: "pyright-langserver",
		args: ["--stdio"],
		rootMarkers: ["pyproject.toml", "setup.py", "pyrightconfig.json"],
	},
	{
		id: "lua-ls",
		category: "lsp",
		extensions: [".lua"],
		command: "lua-language-server",
		args: [],
		rootMarkers: [".luarc.json", ".luarc.jsonc"],
	},
	{
		id: "clangd",
		category: "lsp",
		extensions: [".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hh", ".hxx"],
		command: "clangd",
		args: ["--background-index"],
		rootMarkers: ["compile_commands.json", "compile_flags.txt", ".clangd"],
	},
	{
		id: "zls",
		category: "lsp",
		extensions: [".zig", ".zon"],
		command: "zls",
		args: [],
		rootMarkers: ["build.zig"],
	},
	{
		id: "dart",
		category: "lsp",
		extensions: [".dart"],
		command: "dart",
		args: ["language-server", "--lsp"],
		rootMarkers: ["pubspec.yaml"],
	},
	{
		id: "sourcekit-lsp",
		category: "lsp",
		extensions: [".swift"],
		command: "sourcekit-lsp",
		args: [],
		rootMarkers: ["Package.swift"],
	},
	{
		id: "vue",
		category: "lsp",
		extensions: [".vue"],
		command: "vue-language-server",
		args: ["--stdio"],
		rootMarkers: ["package.json"],
	},
	{
		id: "svelte",
		category: "lsp",
		extensions: [".svelte"],
		command: "svelteserver",
		args: ["--stdio"],
		rootMarkers: ["package.json"],
	},
	{
		id: "astro",
		category: "lsp",
		extensions: [".astro"],
		command: "astro-ls",
		args: ["--stdio"],
		rootMarkers: ["package.json"],
	},
];

export interface LspStatus {
	/** Active server IDs */
	activeServers: string[];
	/** Whether LSP is enabled */
	enabled: boolean;
	/** Per-file diagnostic summary */
	summary: string;
}

/** Structured footer chip: one per active server. */
export interface LspStatusPart {
	id: string;
	category: "lsp" | "lint";
	errors: number;
	warnings: number;
}

export class LspManager {
	private clients = new Map<string, LspClient>();
	private clientUnsubscribes = new Map<string, () => void>();
	private spawning = new Map<string, Promise<LspClient | undefined>>();
	private broken = new Set<string>();
	private enabled = true;
	private cwd: string;
	private disposed = false;
	private settingsManager?: SettingsManager;

	/** Cached diagnostics info for footer display */
	private cachedStatusText: string;
	private statusChangeCallbacks = new Set<() => void>();

	constructor(cwd: string, settingsManager?: SettingsManager) {
		this.cwd = cwd;
		this.settingsManager = settingsManager;
		// Read persisted state
		if (settingsManager) {
			this.enabled = settingsManager.getLspEnabled();
		}
		this.cachedStatusText = this.enabled ? "LSP: ON" : "LSP: OFF";
	}

	/** Category lookup by server id. */
	private categoryFor(id: string): "lsp" | "lint" {
		const cfg = BUILTIN_SERVERS.find((s) => s.id === id);
		return cfg?.category ?? "lsp";
	}

	/** Get all active server IDs */
	getActiveServers(): string[] {
		return Array.from(this.clients.values()).map((c) => c.serverId);
	}

	/** Whether LSP is enabled */
	isEnabled(): boolean {
		return this.enabled;
	}

	/** Toggle LSP on/off. Returns new state. Persists to settings. */
	toggle(): boolean {
		this.enabled = !this.enabled;
		if (!this.enabled) {
			this.shutdownAll();
		}
		if (this.settingsManager) {
			this.settingsManager.setLspEnabled(this.enabled);
		}
		this.updateStatusText();
		this.notifyStatusChange();
		return this.enabled;
	}

	/** Get display text for footer */
	getStatusText(): string {
		if (!this.enabled) return "LSP: OFF";
		return this.cachedStatusText;
	}

	/** Structured footer chips: one per active server. Empty when disabled or no servers running. */
	getStatusParts(): LspStatusPart[] {
		if (!this.enabled) return [];
		// Merge clients with the same serverId (can happen when the same server
		// type runs in different roots, e.g. project root and dist/).
		const map = new Map<string, LspStatusPart>();
		for (const client of this.clients.values()) {
			const existing = map.get(client.serverId);
			let errors = 0;
			let warnings = 0;
			for (const diags of client.getDiagnostics().values()) {
				errors += countErrors(diags);
				warnings += countWarnings(diags);
			}
			if (existing) {
				existing.errors += errors;
				existing.warnings += warnings;
			} else {
				map.set(client.serverId, {
					id: client.serverId,
					category: this.categoryFor(client.serverId),
					errors,
					warnings,
				});
			}
		}
		const parts = Array.from(map.values());
		// Show LSP first, then lint.
		parts.sort((a, b) => {
			if (a.category !== b.category) return a.category === "lsp" ? -1 : 1;
			return a.id.localeCompare(b.id);
		});
		return parts;
	}

	/** Subscribe to status changes */
	onStatusChange(callback: () => void): () => void {
		this.statusChangeCallbacks.add(callback);
		return () => this.statusChangeCallbacks.delete(callback);
	}

	/** Touch a file (notify LSP servers) and optionally wait for diagnostics */
	async touchFile(filePath: string, waitForDiagnostics = true): Promise<void> {
		if (!this.enabled || this.disposed) return;

		const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(this.cwd, filePath);
		const clients = await this.getClients(absPath);

		await Promise.all(
			clients.map(async (client) => {
				const wait = waitForDiagnostics ? client.waitForDiagnostics({ path: absPath }) : Promise.resolve();
				await client.notify.open({ path: absPath });
				return wait;
			}),
		).catch(() => {});

		this.updateStatusText();
		this.notifyStatusChange();
	}

	/** Get diagnostics for a specific file */
	getDiagnosticsForFile(filePath: string): Diagnostic[] {
		const absPath = path.resolve(this.cwd, filePath);
		const result: Diagnostic[] = [];
		for (const client of this.clients.values()) {
			const diags = client.getDiagnostics().get(absPath);
			if (diags) result.push(...diags);
		}
		return result;
	}

	/** Get all diagnostics across all clients */
	getAllDiagnostics(): Map<string, Diagnostic[]> {
		const result = new Map<string, Diagnostic[]>();
		for (const client of this.clients.values()) {
			for (const [file, diags] of client.getDiagnostics()) {
				const existing = result.get(file) ?? [];
				existing.push(...diags);
				result.set(file, existing);
			}
		}
		return result;
	}

	/** Build diagnostic summary for tool output (colored short summary) */
	buildDiagnosticSummary(filePath: string): string {
		if (!this.enabled) return "";

		const absPath = path.resolve(this.cwd, filePath);
		const diags = this.getDiagnosticsForFile(absPath);
		const errors = countErrors(diags);
		const warnings = countWarnings(diags);

		if (errors === 0 && warnings === 0) return "";

		const parts: string[] = [];
		if (errors > 0) parts.push(`${errors} error${errors > 1 ? "s" : ""}`);
		if (warnings > 0) parts.push(`${warnings} warning${warnings > 1 ? "s" : ""}`);
		return parts.join(", ");
	}

	/** Build full diagnostic report text for tool output */
	buildDiagnosticReport(filePath: string): string {
		if (!this.enabled) return "";

		const absPath = path.resolve(this.cwd, filePath);
		let output = "";
		const allDiags = this.getAllDiagnostics();

		// Report for the edited file
		const fileDiags = allDiags.get(absPath) ?? [];
		const block = formatDiagnosticReport(filePath, fileDiags);
		if (block) {
			output += `\n\nLSP errors detected in this file:\n${block}`;
		}

		// Report for other affected files (limit to 5)
		let otherCount = 0;
		for (const [file, issues] of allDiags) {
			if (file === absPath) continue;
			if (otherCount >= 5) break;
			const otherBlock = formatDiagnosticReport(file, issues);
			if (otherBlock) {
				output += `\n\nLSP errors in other files:\n${otherBlock}`;
				otherCount++;
			}
		}

		return output;
	}

	/** Update the CWD (e.g., when session changes) */
	setCwd(cwd: string): void {
		if (this.cwd === cwd) return;
		this.cwd = cwd;
		this.shutdownAll();
	}

	/** Shut down all LSP clients */
	async shutdownAll(): Promise<void> {
		for (const unsub of this.clientUnsubscribes.values()) {
			try {
				unsub();
			} catch {}
		}
		this.clientUnsubscribes.clear();
		const shutdowns = Array.from(this.clients.values()).map((c) => c.shutdown().catch(() => {}));
		this.clients.clear();
		this.spawning.clear();
		this.broken.clear();
		await Promise.all(shutdowns);
		this.updateStatusText();
		this.notifyStatusChange();
	}

	/** Dispose the manager */
	async dispose(): Promise<void> {
		this.disposed = true;
		await this.shutdownAll();
		this.statusChangeCallbacks.clear();
	}

	// ---------------------------------------------------------------------------
	// Private
	// ---------------------------------------------------------------------------

	private async getClients(filePath: string): Promise<LspClient[]> {
		const ext = path.extname(filePath) || path.basename(filePath);
		const result: LspClient[] = [];

		for (const server of BUILTIN_SERVERS) {
			if (server.extensions.length > 0 && !server.extensions.includes(ext)) continue;

			const root = this.findRoot(filePath, server.rootMarkers);
			if (!root) continue;

			const key = `${root}:${server.id}`;
			if (this.broken.has(key)) continue;

			// Already have a client
			const existing = this.clients.get(key);
			if (existing) {
				result.push(existing);
				continue;
			}

			// Already spawning
			const inFlight = this.spawning.get(key);
			if (inFlight) {
				const client = await inFlight;
				if (client) result.push(client);
				continue;
			}

			// Spawn new
			const task = this.spawnServer(server, root, key);
			this.spawning.set(key, task);
			task.finally(() => {
				if (this.spawning.get(key) === task) {
					this.spawning.delete(key);
				}
			});

			const client = await task;
			if (client) result.push(client);
		}

		return result;
	}

	private async spawnServer(server: LspServerConfig, root: string, key: string): Promise<LspClient | undefined> {
		try {
			// Resolve command — check local node_modules/.bin first, then PATH
			const resolved = await this.resolveCommand(server.command, root);
			if (!resolved) {
				this.broken.add(key);
				return undefined;
			}

			// Prepend every node_modules/.bin from root up to filesystem root to PATH
			// so the server can find sibling binaries (e.g. tsserver for typescript-language-server).
			const binDirs = this.collectNodeModulesBinDirs(root);
			const pathSep = process.platform === "win32" ? ";" : ":";
			const mergedPath = [...binDirs, process.env.PATH ?? ""].filter(Boolean).join(pathSep);

			const client = await createLspClient({
				serverId: server.id,
				command: resolved,
				args: server.args,
				root,
				directory: this.cwd,
				env: { ...server.env, PATH: mergedPath },
				initializationOptions: server.initializationOptions,
			});

			this.clients.set(key, client);
			const unsub = client.onDiagnosticsChange(() => {
				this.updateStatusText();
				this.notifyStatusChange();
			});
			this.clientUnsubscribes.set(key, unsub);
			this.updateStatusText();
			this.notifyStatusChange();
			return client;
		} catch {
			this.broken.add(key);
			this.updateStatusText();
			this.notifyStatusChange();
			return undefined;
		}
	}

	private findRoot(filePath: string, markers: string[]): string | undefined {
		let dir = path.dirname(path.resolve(this.cwd, filePath));
		const root = path.resolve("/");

		while (dir !== root) {
			for (const marker of markers) {
				if (existsSync(path.join(dir, marker))) {
					return dir;
				}
			}
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}

		// Check root level too
		for (const marker of markers) {
			if (existsSync(path.join(this.cwd, marker))) {
				return this.cwd;
			}
		}

		return undefined;
	}

	private collectNodeModulesBinDirs(startDir: string): string[] {
		const dirs: string[] = [];
		let dir = path.resolve(startDir);
		const fsRoot = path.resolve("/");
		while (true) {
			const candidate = path.join(dir, "node_modules", ".bin");
			if (existsSync(candidate)) dirs.push(candidate);
			const parent = path.dirname(dir);
			if (parent === dir || dir === fsRoot) break;
			dir = parent;
		}
		return dirs;
	}

	private async resolveCommand(command: string, startDir: string): Promise<string | undefined> {
		// 1. Absolute path: just verify it exists and is a file
		if (path.isAbsolute(command)) {
			try {
				if (statSync(command).isFile()) return command;
			} catch {}
			return undefined;
		}

		// 2. Walk up from startDir looking for node_modules/.bin/<command>
		const suffixes = process.platform === "win32" ? ["", ".cmd", ".exe", ".bat"] : [""];
		for (const binDir of this.collectNodeModulesBinDirs(startDir)) {
			for (const suffix of suffixes) {
				const candidate = path.join(binDir, command + suffix);
				try {
					if (statSync(candidate).isFile()) return candidate;
				} catch {}
			}
		}

		// 3. Fall back to PATH lookup
		const { execFile } = await import("child_process");
		return new Promise((resolve) => {
			const lookup = process.platform === "win32" ? "where" : "which";
			execFile(lookup, [command], (err, stdout) => {
				if (err) {
					resolve(undefined);
					return;
				}
				const first = String(stdout)
					.split(/\r?\n/)
					.find((line) => line.trim().length > 0);
				resolve(first?.trim() || command);
			});
		});
	}

	private updateStatusText(): void {
		if (!this.enabled) {
			this.cachedStatusText = "LSP: OFF";
			return;
		}

		const servers = this.getActiveServers();
		if (servers.length === 0) {
			this.cachedStatusText = "LSP: ON";
			return;
		}

		// Count total diagnostics
		let totalErrors = 0;
		let totalWarnings = 0;
		for (const client of this.clients.values()) {
			for (const diags of client.getDiagnostics().values()) {
				totalErrors += countErrors(diags);
				totalWarnings += countWarnings(diags);
			}
		}

		const parts: string[] = [];
		if (totalErrors > 0) parts.push(`${totalErrors} err`);
		if (totalWarnings > 0) parts.push(`${totalWarnings} warn`);

		const serverPart = servers.join(", ");
		const diagPart = parts.length > 0 ? parts.join(", ") : "OK";

		this.cachedStatusText = `${serverPart} | ${diagPart}`;
	}

	private notifyStatusChange(): void {
		for (const cb of this.statusChangeCallbacks) {
			try {
				cb();
			} catch {}
		}
	}
}
