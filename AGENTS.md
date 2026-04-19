# Development Rules

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text
- Technical prose only, be kind but direct

## Code Quality

- No `any` types unless absolutely necessary
- Check node_modules for external API type definitions instead of guessing
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Do not preserve backward compatibility unless the user explicitly asks for it
- Never hardcode key checks with, eg. `matchesKey(keyData, "ctrl+x")`. All keybindings must be configurable. Add default to matching object (`DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS`)

## Commands

- After code changes (not documentation changes): `bun run check` (get full output, no tail). Fix all errors, warnings, and infos before committing.
- Note: `bun run check` does not run tests.
- NEVER run: `bun run dev`, `bun run build`, `bun test`
- NEVER use `npm` or `npx` commands. Always use `bun` equivalents (e.g. `bunx` instead of `npx`).
- NEVER commit unless user asks

## Adding a Tool

Tools are registered in a central registry. Adding a new tool requires changes in 3 places:

### 1. Implement the tool

Create `src/core/tools/<name>.ts` exporting a `ToolDefinition` (see `src/core/tools/tool-types.ts`) plus a `create<Name>ToolDefinition(cwd, opts?)` factory and convenience `create<Name>Tool` / default `<name>Tool` / `<name>ToolDefinition` exports. Required fields:

- `name`, `label` — identifier shown to the LLM and TUI
- `description` — full prose seen by the LLM; mention defaults, limits, and how to disable them (e.g. `.gitignore`, built-in excludes, truncation thresholds). Include the result shape if it is JSON
- `promptSnippet` — one line listed under `# Available tools` in the system prompt. Match the style of existing tools (e.g. `"... (respects .gitignore)"`)
- `parameters` — TypeBox schema; every field gets a `description`
- `execute(toolCallId, params, signal, onUpdate, ctx)` — must honor `signal` (reject with `Error("Operation aborted")` on abort)
- optional `renderCall` / `renderResult` for custom TUI rendering

Keep I/O behind a pluggable `operations` interface so the tool is testable without a real filesystem.

### 2. Register in the tool registry

In `src/core/tools/tool-registry.ts` append an entry to the `TOOL_REGISTRY` array:

```ts
{
  name: "<name>",
  createDefinition: create<Name>ToolDefinition,
  createTool: create<Name>Tool,
  defaultDefinition: <name>ToolDefinition,
  defaultTool: <name>Tool,
  tui: { color: "#hex", icon: "char", displayName: "Label" },
},
```

If the tool depends on runtime state (like task tools depend on `TaskManager`), add its TUI metadata to `DYNAMIC_TOOL_TUI` instead and wire creation in `src/core/sdk.ts`.

Also add re-exports in `src/core/tools/index.ts`:

```ts
export { create<Name>Tool, create<Name>ToolDefinition, <name>Tool, <name>ToolDefinition } from "./<name>.js";
```

### 3. Update system-prompt hints if relevant

If the tool overlaps with an existing workflow line in `src/core/system-prompt.ts` (e.g. "Use `search` or `glob` before `read`"), add it and clarify when to prefer it over neighbours.

### 4. Verify

- `bun run check` passes
- Start a fresh session — session state caches the old tool list, reload is required

## **CRITICAL** Git Rules for Parallel Agents **CRITICAL**

Multiple agents may work on different files in the same worktree simultaneously. You MUST follow these rules:

### Committing

- **ONLY commit files YOU changed in THIS session**
- ALWAYS include `fixes #<number>` or `closes #<number>` in the commit message when there is a related issue or PR
- NEVER use `git add -A` or `git add .` - these sweep up changes from other agents
- ALWAYS use `git add <specific-file-paths>` listing only files you modified
- Before committing, run `git status` and verify you are only staging YOUR files
- Track which files you created/modified/deleted during the session

### Forbidden Git Operations

These commands can destroy other agents' work:

- `git reset --hard` - destroys uncommitted changes
- `git checkout .` - destroys uncommitted changes
- `git clean -fd` - deletes untracked files
- `git stash` - stashes ALL changes including other agents' work
- `git add -A` / `git add .` - stages other agents' uncommitted work
- `git commit --no-verify` - bypasses required checks and is never allowed

### If Rebase Conflicts Occur

- Resolve conflicts in YOUR files only
- If conflict is in a file you didn't modify, abort and ask the user
- NEVER force push

### User override

If the user instructions conflict with rules set out here, ask for confirmation that they want to override the rules. Only then execute their instructions.
