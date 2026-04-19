import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { AgentTool } from "../../agent-core/index.js";
import type { ReadonlySessionManager } from "../session-manager.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import type { ToolDefinition } from "./tool-types.js";

// ============================================================================
// Types
// ============================================================================

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export interface Task {
	id: number;
	title: string;
	description?: string;
	status: TaskStatus;
}

// ============================================================================
// TaskManager
// ============================================================================

export class TaskManager {
	private sessionManager: ReadonlySessionManager;

	constructor(sessionManager: ReadonlySessionManager) {
		this.sessionManager = sessionManager;
	}

	getTasksFilePath(): string {
		return join(this.sessionManager.getSessionDir(), `tasks-${this.sessionManager.getSessionId()}.json`);
	}

	loadTasks(): Task[] {
		const filePath = this.getTasksFilePath();
		if (!existsSync(filePath)) return [];
		try {
			return JSON.parse(readFileSync(filePath, "utf8")) as Task[];
		} catch {
			return [];
		}
	}

	saveTasks(tasks: Task[]): void {
		writeFileSync(this.getTasksFilePath(), JSON.stringify(tasks, null, 2));
	}

	createTask(title: string, description?: string): Task {
		const tasks = this.loadTasks();
		const maxId = tasks.reduce((max, t) => Math.max(max, t.id), 0);
		const task: Task = { id: maxId + 1, title, status: "pending", ...(description ? { description } : {}) };
		tasks.push(task);
		this.saveTasks(tasks);
		return task;
	}

	updateTask(id: number, updates: Partial<Pick<Task, "title" | "description" | "status">>): Task | null {
		const tasks = this.loadTasks();
		const task = tasks.find((t) => t.id === id);
		if (!task) return null;

		if (updates.status === "in_progress") {
			for (const t of tasks) {
				if (t.status === "in_progress") t.status = "pending";
			}
		}

		Object.assign(task, updates);
		this.saveTasks(tasks);
		return task;
	}

	getTask(id: number): Task | null {
		return this.loadTasks().find((t) => t.id === id) ?? null;
	}

	/** Format active tasks as a message to inject into context after compaction */
	formatForInjection(): string | null {
		const tasks = this.loadTasks().filter((t) => t.status !== "deleted");
		if (tasks.length === 0) return null;

		const lines = ["<tasks>", "Current task list:"];
		for (const task of tasks) {
			const statusIcon = task.status === "completed" ? "[x]" : task.status === "in_progress" ? "[>]" : "[ ]";
			lines.push(`${statusIcon} ${task.id}. ${task.title}${task.description ? ` — ${task.description}` : ""}`);
		}
		lines.push("</tasks>");
		return lines.join("\n");
	}
}

// ============================================================================
// Schemas
// ============================================================================

const taskCreateItemSchema = Type.Object({
	title: Type.String({ description: "Short title describing the task" }),
	description: Type.Optional(Type.String({ description: "Optional longer description" })),
});

const taskCreateSchema = Type.Object({
	tasks: Type.Array(taskCreateItemSchema, { description: "List of tasks to create" }),
});

const taskUpdateSchema = Type.Object({
	id: Type.Number({ description: "Task ID to update" }),
	status: Type.Optional(
		Type.Union(
			[Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed"), Type.Literal("deleted")],
			{
				description: "New status",
			},
		),
	),
	title: Type.Optional(Type.String({ description: "New title" })),
	description: Type.Optional(Type.String({ description: "New description" })),
});

const taskGetSchema = Type.Object({
	id: Type.Number({ description: "Task ID to retrieve" }),
});

const taskListSchema = Type.Object({});

// ============================================================================
// Tool Definitions
// ============================================================================

function formatTask(task: Task): string {
	const statusIcon = task.status === "completed" ? "[x]" : task.status === "in_progress" ? "[>]" : "[ ]";
	const desc = task.description ? `\n   ${task.description}` : "";
	return `${statusIcon} ${task.id}. ${task.title} (${task.status})${desc}`;
}

const TASK_GUIDELINES = [
	'For multi-step work: create ALL tasks upfront (one per step), then start working. Before each step: task_update status="in_progress". After: task_update status="completed". Never skip status updates.',
];

export function createTaskToolDefinitions(taskManager: TaskManager): ToolDefinition<any, any>[] {
	const taskCreate: ToolDefinition<typeof taskCreateSchema> = {
		name: "task_create",
		label: "task_create",
		description: "Create one or more tasks to track steps in your current work.",
		promptSnippet: "Create tasks to track steps",
		promptGuidelines: TASK_GUIDELINES,
		parameters: taskCreateSchema,
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const created = params.tasks.map((t) => taskManager.createTask(t.title, t.description));
			const lines = ["Created tasks:", ...created.map((t) => `  [ ] ${t.id}. ${t.title}`)];
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: created.map((t) => ({ id: t.id, title: t.title, status: t.status })),
			};
		},
	};

	const taskUpdate: ToolDefinition<typeof taskUpdateSchema> = {
		name: "task_update",
		label: "task_update",
		description: "Update a task's status (pending/in_progress/completed/deleted), title, or description.",
		promptSnippet: "Update task status or details",
		parameters: taskUpdateSchema,
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const { id, ...updates } = params;
			const task = taskManager.updateTask(id, updates);
			if (!task)
				return {
					content: [{ type: "text", text: `Task ${id} not found` }],
					isError: true,
					details: { id, error: true },
				};
			return {
				content: [{ type: "text", text: formatTask(task) }],
				details: { id: task.id, title: task.title, status: task.status },
			};
		},
	};

	const taskList: ToolDefinition<typeof taskListSchema> = {
		name: "task_list",
		label: "task_list",
		description: "List all current tasks (excluding deleted).",
		promptSnippet: "List all current tasks",
		parameters: taskListSchema,
		async execute(_id, _params, _signal, _onUpdate, _ctx) {
			const tasks = taskManager.loadTasks().filter((t) => t.status !== "deleted");
			if (tasks.length === 0) return { content: [{ type: "text", text: "No tasks." }], details: { count: 0 } };
			return {
				content: [{ type: "text", text: tasks.map(formatTask).join("\n") }],
				details: { count: tasks.length },
			};
		},
	};

	const taskGet: ToolDefinition<typeof taskGetSchema> = {
		name: "task_get",
		label: "task_get",
		description: "Get details of a specific task by ID.",
		promptSnippet: "Get task details by ID",
		parameters: taskGetSchema,
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const task = taskManager.getTask(params.id);
			if (!task)
				return {
					content: [{ type: "text", text: `Task ${params.id} not found` }],
					isError: true,
					details: { id: params.id, error: true },
				};
			return {
				content: [{ type: "text", text: formatTask(task) }],
				details: { id: task.id, title: task.title, status: task.status },
			};
		},
	};

	return [taskCreate, taskUpdate, taskList, taskGet];
}

export function createTaskTools(taskManager: TaskManager): AgentTool<any>[] {
	return createTaskToolDefinitions(taskManager).map((def) => wrapToolDefinition(def));
}
