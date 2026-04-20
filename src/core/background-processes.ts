/**
 * BackgroundProcessManager — tracks background shell processes by ID.
 *
 * Provides spawn, kill, and output retrieval for long-running processes
 * that run independently of the agent loop.
 */

import { EventEmitter } from "node:events";
import { spawn } from "child_process";
import stripAnsi from "strip-ansi";
import { waitForChildProcess } from "../utils/child-process.js";
import { getShellConfig, getShellEnv, killProcessTree, sanitizeBinaryOutput } from "../utils/shell.js";

export interface BackgroundProcess {
	/** Unique ID for this process (e.g. "bg1") */
	id: string;
	/** The command being run */
	command: string;
	/** Process state */
	status: "running" | "completed" | "killed";
	/** Exit code (set when status is "completed") */
	exitCode: number | null;
	/** Accumulated output */
	output: string;
	/** Whether there is new output since last check */
	hasNewOutput: boolean;
	/** PID of the child process */
	pid: number | undefined;
}

export interface BackgroundProcessManagerEvents {
	/** Fired when a process is started, completes, or is killed */
	change: () => void;
}

export class BackgroundProcessManager extends EventEmitter {
	private processes = new Map<string, BackgroundProcess>();
	private counter = 0;

	/** Get all background processes */
	getAll(): BackgroundProcess[] {
		return [...this.processes.values()];
	}

	/** Get a specific process by ID */
	get(id: string): BackgroundProcess | undefined {
		return this.processes.get(id);
	}

	/** Get running process count */
	runningCount(): number {
		let count = 0;
		for (const p of this.processes.values()) {
			if (p.status === "running") count++;
		}
		return count;
	}

	/** Get completed process output and mark as read */
	getOutput(id: string): { output: string; status: string; exitCode: number | null } | null {
		const proc = this.processes.get(id);
		if (!proc) return null;
		proc.hasNewOutput = false;
		return { output: proc.output, status: proc.status, exitCode: proc.exitCode };
	}

	/** Spawn a command in the background. Returns the process ID. */
	spawn(command: string, cwd: string): string {
		this.counter++;
		const id = `bg${this.counter}`;
		const { shell, args } = getShellConfig();

		const child = spawn(shell, [...args, command], {
			cwd,
			detached: true,
			env: getShellEnv(),
			stdio: ["ignore", "pipe", "pipe"],
		});

		const proc: BackgroundProcess = {
			id,
			command,
			status: "running",
			exitCode: null,
			output: "",
			hasNewOutput: false,
			pid: child.pid,
		};

		this.processes.set(id, proc);

		const decoder = new TextDecoder();

		const onData = (data: Buffer): void => {
			const text = sanitizeBinaryOutput(stripAnsi(decoder.decode(data, { stream: true }))).replace(/\r/g, "");
			proc.output += text;
			proc.hasNewOutput = true;
			this.emit("change");
		};

		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);

		waitForChildProcess(child)
			.then((code) => {
				proc.status = "completed";
				proc.exitCode = code;
				proc.pid = undefined;
				this.emit("change");
			})
			.catch(() => {
				proc.status = "completed";
				proc.exitCode = null;
				proc.pid = undefined;
				this.emit("change");
			});

		this.emit("change");
		return id;
	}

	/** Kill a background process by ID. Returns true if killed, false if not found or already stopped. */
	kill(id: string): boolean {
		const proc = this.processes.get(id);
		if (!proc || proc.status !== "running") return false;

		if (proc.pid) {
			killProcessTree(proc.pid);
		}
		proc.status = "killed";
		proc.pid = undefined;
		this.emit("change");
		return true;
	}

	/** Dispose all running processes */
	dispose(): void {
		for (const proc of this.processes.values()) {
			if (proc.status === "running" && proc.pid) {
				try {
					killProcessTree(proc.pid);
				} catch {
					// best effort
				}
				proc.status = "killed";
				proc.pid = undefined;
			}
		}
		this.removeAllListeners();
	}
}
