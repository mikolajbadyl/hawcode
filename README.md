<div align="center">

<img src="assets/banner.png" alt="Hawcode" width="600" />

### Another AI agent. Less bloat, more terminal.

[![Version](https://img.shields.io/badge/version-0.3.0-blue.svg)](https://github.com/mikolajbadyl/hawcode)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/runtime-Bun-orange.svg)](https://bun.sh)

</div>

---

Hawcode is an interactive AI coding assistant that runs entirely in your terminal. It reads your codebase, edits files, runs commands, manages sessions, and gives you real-time LSP diagnostics — all from a keyboard-driven TUI.

Built on [pi-mono](https://github.com/badlogic/pi-mono).

## Features

- **Interactive TUI** — full keyboard-driven terminal UI with scrollable chat, syntax highlighting, and inline diffs
- **Multi-provider LLM** — works with OpenAI, Anthropic, Google, OpenRouter, Ollama, and any OpenAI-compatible API
- **Session management** — persistent sessions with branching, forking, compaction, and export to HTML / Markdown / JSONL
- **Built-in tools** — read, write, edit, bash, search, glob, web search, docs fetch, task tracking
- **Background processes** — spawn long-running commands in the background, view live output, kill on demand (`Ctrl+B`)
- **LSP diagnostics** — real-time error & warning feedback from TypeScript, Biome, ESLint, Prettier, Svelte, Vue, Python, Rust, Go, Ruby, Swift, and more
- **Configurable keybindings** — every key is rebindable via `keybindings.json`
- **Zero bloat** — only what's necessary, nothing more

## Quick Start

```bash
# Clone and build
git clone https://github.com/mikolajbadyl/hawcode.git
cd hawcode
bun install
bun run build

# Install globally
./install.sh
export PATH="${HOME}/.local/bin:${PATH}"

# First run — configure your providers
hawcode --login
```

## Usage

```bash
# Start a new session
hawcode

# Continue previous session
hawcode --continue

# Pick a session to resume
hawcode --resume

# Use a specific model
hawcode --model anthropic/claude-sonnet-4

# Pipe input
cat src/main.ts | hawcode "explain this file"

# Attach files
hawcode @package.json @tsconfig.json "review these configs"
```

## CLI Reference

| Flag | Description |
|------|-------------|
| `--login` | Interactive setup wizard |
| `--auth-tools` | Configure API keys for websearch/docsfetch |
| `--model <id>` | Use specific model (supports `provider/id:thinking`) |
| `--continue`, `-c` | Continue previous session |
| `--resume`, `-r` | Pick a session to resume from |
| `--tools <list>` | Comma-separated tool whitelist |
| `--export <file>` | Export session file to HTML and exit |
| `--reload-cache` | Force refresh model metadata |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |

## Tools

| Tool | What it does |
|------|-------------|
| **read** | Read files with line ranges and image support |
| **write** | Create or overwrite files |
| **edit** | Surgical text replacement with diff preview |
| **bash** | Execute shell commands (with background mode) |
| **search** | Ripgrep-powered content search |
| **glob** | Fast file globbing with multi-pattern support |
| **websearch** | Web search (only when you ask) |
| **docsfetch** | Fetch library documentation (only when you ask) |
| **task** | Track TODO items during multi-step work |

## Keybindings

All keybindings are configurable in `~/.config/hawcode/agent/keybindings.json`.

| Key | Action |
|-----|--------|
| `Ctrl+C` | Abort current operation (double-tap to exit) |
| `Ctrl+D` | Exit when editor is empty |
| `Ctrl+P` | Cycle model forward |
| `Ctrl+Shift+P` | Cycle model backward |
| `Ctrl+L` | Open model selector |
| `Tab` / `Ctrl+T` | Cycle thinking level |
| `Ctrl+E` | Toggle tool output expansion |
| `Ctrl+B` | Open background processes panel |
| `Ctrl+Z` | Suspend to background |
| `Escape` | Cancel / abort |
| `Ctrl+G` | Open external editor |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/models` | Switch model |
| `/export` | Export session to HTML / MD / JSONL |
| `/session` | Show session info and stats |
| `/new` | Start a new session |
| `/compact` | Compact conversation context |
| `/reload` | Reload config and resources |
| `/usage` | Show API usage and quota |
| `/lsp` | Toggle LSP diagnostics |
| `/quit` | Exit |

## Session Management

Sessions are stored in `~/.config/hawcode/agent/sessions`. Each session persists the full conversation, model choice, and thinking level.

- **Continue** — `hawcode --continue` picks up where you left off
- **Resume** — `hawcode --resume` opens a session picker
- **Export** — use `/export` inside the TUI for HTML, Markdown, or JSONL
- **Compact** — `/compact` summarizes context when you're running low on tokens
- **Fork** — branch a session to explore without losing the original

## Configuration

All config lives in `~/.config/hawcode/agent/`:

```
providers.json     — LLM provider API keys and endpoints
models.json        — Model definitions and overrides
settings.json      — General settings
keybindings.json   — Custom keybindings
```

## LSP Support

Hawcode auto-detects language servers on your `$PATH` and shows real-time diagnostics inline after file edits:

TypeScript, Biome, ESLint, Prettier, Svelte, Vue, Python (Pyright/Pylsp), Rust, Go, Ruby, Swift.

Toggle with `/lsp` or disable in `settings.json`.

## Development

```bash
bun install
bun run check    # lint + typecheck
bun run build    # compile binary
bun run dev      # run from source
```

## License

MIT
