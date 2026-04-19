![Hawcode Banner](assets/banner.png)

# Hawcode

Minimalist AI coding agent with interactive TUI, session management, and multi-provider LLM support.

## Philosophy

Hawcode is built on a simple principle: **only include what's necessary**. No bloat, no unnecessary features - just a focused tool that does one thing well.

The project is developed and maintained by me, with careful attention to keeping things lean and practical. Built on [pi-mono](https://github.com/badlogic/pi-mono).

## What is Hawcode?

Hawcode is an interactive AI coding assistant that runs in your terminal. It can:

- Read, write, and edit files
- Execute shell commands
- Search across your codebase
- Manage multiple sessions with branches
- Export conversations to HTML/MD/JSONL

## Installation

### From source

```bash
bun install
bun run build
```

### Install system-wide

```bash
./install.sh

# Add to PATH (add to ~/.bashrc or ~/.zshrc):
export PATH="${HOME}/.local/bin:${PATH}"
```

## First-time setup

Run the interactive setup wizard:

```bash
hawcode --login
```

This will prompt you to configure providers and models.

### Using from command line

```bash
# New session
hawcode

# Continue previous session
hawcode --continue

# Resume from picker
hawcode --resume

# Run with piped command
cat readme.md | hawcode "explain this file"
```

## CLI Options

| Option | Description |
|--------|-------------|
| `--login` | Interactive setup wizard |
| `--auth-tools` | Configure API keys for tools |
| `--model <id>` | Use specific model |
| `--continue, -c` | Continue previous session |
| `--resume, -r` | Resume specific session |
| `--reload-cache` | Force refresh model metadata |

## Tools

| Tool | Description |
|------|-------------|
| **read** | Read files with highlighting |
| **write** | Create or overwrite files |
| **edit** | Make precise edits |
| **bash** | Execute shell commands |
| **search** | Search with regex, glob |
| **find** | Find files by name |
| **ls** | List directory contents |
| **websearch** | Search the web |
| **docsfetch** | Fetch library docs |
| **task** | Manage TODO items |

## LSP & Diagnostics

Hawcode includes built-in LSP and lint support for real-time diagnostics. It automatically detects and uses:

- **TypeScript** (`typescript-language-server`)
- **Biome** (linter/formatter)
- **ESLint**
- **Prettier**
- **Svelte** (`svelte-language-server`)
- **Vue** (`volar-language-server`)
- **Python** (`pyright`, `pylsp`)
- **Rust** (`rust-analyzer`)
- **Go** (`gopls`)
- **Ruby** (`solargraph`)
- **SourceKit** (Swift)

Toggle diagnostics with `/lsp` slash command or disable entirely in settings.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/models` | Switch model |
| `/export` | Export session |
| `/session` | Show stats |
| `/new` | Start new session |
| `/compact` | Compact context |
| `/quit` | Exit |

## Session Management

Sessions are stored in `~/.config/hawcode/agent/sessions`.

Use `/export` in the TUI to export sessions to HTML, Markdown, or JSONL.

## Configuration

Config files are in `~/.config/hawcode/agent/`:
- `providers.json`
- `models.json`
- `settings.json`
- `keybindings.json`

## Development

```bash
bun install
bun run build
bun run check
```

## License

MIT