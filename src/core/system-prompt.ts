/**
 * System prompt construction and project context loading
 */

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write] */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. Default: process.cwd() */
	cwd?: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
	} = options;
	const resolvedCwd = cwd ?? process.cwd();
	const promptCwd = resolvedCwd.replace(/\\/g, "/");

	const date = new Date().toISOString().slice(0, 10);

	const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";

	const contextFiles = providedContextFiles ?? [];

	if (customPrompt) {
		let prompt = customPrompt;

		if (appendSection) {
			prompt += appendSection;
		}

		// Append project context files
		if (contextFiles.length > 0) {
			prompt += "\n\n# Project Context\n\n";
			prompt += "Project-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `## ${filePath}\n\n${content}\n\n`;
			}
		}

		// Add date and working directory last
		prompt += `\nCurrent date: ${date}`;
		prompt += `\nCurrent working directory: ${promptCwd}`;

		return prompt;
	}

	// Build tools list based on selected tools.
	// A tool appears in Available tools only when the caller provides a one-line snippet.
	const tools = selectedTools || ["read", "bash", "edit", "write"];
	const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";

	const platform = process.platform;
	const shell = process.env.SHELL ?? process.env.ComSpec ?? "unknown";

	let prompt = `You are HawCode, an interactive coding agent running in the terminal.
Use the tools available to help the user with software engineering tasks.

# Doing tasks
Think before acting. For non-trivial tasks, outline your approach first.
Read relevant files before editing. Prefer small, targeted changes.
Don't add features, refactor, or "improve" beyond what was asked.
After edits, verify correctness before moving on.
If a tool call fails, reason about why and try a different approach.
Never repeat the exact same failing call more than once.

# Using tools
Use dedicated tools instead of bash when available.
Use \`search\` or \`find\` before \`read\` to locate relevant code.
Use \`edit\` for targeted changes, \`write\` only for new files.
After \`bash\`, check exit code and stderr before continuing.
When truncating long command output, preserve the start and end — cut the middle.

# Actions with side effects
Before deleting files, force-pushing, or modifying shared systems — confirm with the user.
Local, reversible actions (editing files, running tests) can proceed freely.

# Tone and style
Be concise and direct. Go straight to the point.
Do not add preamble ("Sure, I'll...") or postamble ("Let me know if...").
Show file paths clearly. Use GitHub-flavored markdown.
Do not use emojis unless the user asks.
If a task is ambiguous, ask one clarifying question before starting.

# Communication
Write to communicate with the user — all text outside tool calls is visible.
Never use bash or code comments to communicate with the user.

# Available tools
${toolsList}

# Environment
Working directory: ${promptCwd}
Platform: ${platform}
Shell: ${shell}
Date: ${date}`;

	if (appendSection) {
		prompt += appendSection;
	}

	// Append project context files
	if (contextFiles.length > 0) {
		prompt += "\n\n# Project Context\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `## ${filePath}\n\n${content}\n\n`;
		}
	}

	return prompt;
}
