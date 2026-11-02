# NEXUS Desktop — User & Developer Manual

NEXUS Desktop is a local-first Windows application for autonomous agentic coding and personal environment control. It runs completely locally and connects directly to your chosen model providers.

## Launching NEXUS

### 1. Single-Click Portable Executable
Download `NEXUS-Portable.exe` from GitHub Releases (or build it via `npm run dist:portable` inside `desktop/`) and double-click it to launch immediately.

### 2. Development Mode
From `desktop/`:
```powershell
npm ci
npm test
npm run build
npm start
```

## Provider Connections

In **Settings → Model & Connection**, select your preferred provider service:
- **OpenRouter**: Supports 300+ models, prompt caching affinity, provider routing (`price`, `throughput`, `latency`), and native server web search.
- **Arli.ai**: Supports high-context coding (`arliai/DeepSeek-V4.1-Flash-1017`) and uncensored/derestricted models (`arliai/GLM-4.6-Derestricted-v5`).
- **OpenAI Direct**: Direct API access (`openai/gpt-5`, `openai/gpt-4.1`, `openai/o3`, `openai/o4-mini`).
- **GitHub Copilot**: Use your GitHub Copilot subscription (`copilot/claude-sonnet-4.5`, `copilot/gpt-5`, `copilot/gemini-2.5-pro`). Click **Import token from GitHub CLI / Copilot** to automatically import your token from `gh auth token` or local Copilot configuration.
- **Anthropic Direct**: Direct API access (`anthropic/claude-sonnet-4-5`, `anthropic/claude-opus-4-5`, `anthropic/claude-haiku-4-5`).
- **Custom / Local**: Connect to any OpenAI-compatible local server (`http://localhost:11434/v1` for Ollama, `http://localhost:1234/v1` for LM Studio, vLLM, or llama.cpp) without requiring an API key.

All credentials are encrypted on disk using Windows DPAPI (`Electron safeStorage`) in `vault.bin` with automatic backups.

## Operating Modes & Slash Commands

Switch operating modes per chat or globally from the composer bar:
- **Agent**: Full read/write file tools, shell commands, Git operations, background processes, MCP server scaffolding, and sub-agent delegation.
- **Architect**: Read-only codebase exploration plus structured task planning (`todo_write`) and memory updates.
- **Explore**: Fast read-only search (`glob_files`, `grep_search`, `code_outline`, `read_file`).
- **Unrestricted**: Full local environment control with zero path confinement or per-action approval prompts.

Quick slash commands available in the composer:
- `/init` — Scan the repository and generate/update `NEXUS.md`.
- `/review` — Inspect `git diff` and perform a structured code and security review.
- `/architect` — Analyze architecture with `code_outline` and create a step-by-step `todo_write` plan.
- `/mcp-create` — Autonomously generate, register, and hot-connect a new local MCP server.
- `/self-improve` — Analyze workspace telemetry and synthesize reusable skills.

## Built-in Studios & Panels

- **Files & Git Studio**: Browse project files, inspect working-tree Git status, stage/unstage files, view syntax-highlighted unified diffs, commit changes, run commands in the integrated PowerShell Quick Terminal, and monitor/stop Background Processes.
- **Library & Persistent Memory**: Create and version reusable Skills, Functions, and persistent global/project Agent Memories.
- **Connectors & OpenAPI Importer**: Register reusable HTTPS REST connectors with `CONNECTOR_*` secret references and `Idempotency-Key` reconciliation, or import OpenAPI 3.0/3.1 specifications.
- **MCP Extensions & Autonomous Builder**: Connect stdio or HTTP MCP servers, or use the **Autonomous MCP Server Builder** to generate and hot-connect local Node.js MCP tools on the fly.
- **Context, Cache & Spend Inspector**: Inspect token estimates by context section, provider cache hit rates, USD costs, and pre-compaction checkpoints.
