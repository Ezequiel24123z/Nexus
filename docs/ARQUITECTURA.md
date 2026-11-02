# NEXUS Architecture

Desktop (`desktop/`) is the primary application and operates completely offline/locally except when contacting the user's configured model provider or external connectors. The root web prototype is retained as historical context with its own dependencies and storage.

| Area | Files inside `desktop/` | Responsibility |
| --- | --- | --- |
| Electron Main Process | `main.cjs` | Window lifecycle, IPC validation, DPAPI vault, files, models, Git/process actions, and native desktop control |
| Renderer Bridge | `preload.cjs` | Explicit allowlist of `nexus:invoke` methods |
| User Interface | `src/main.jsx`, `src/CodeGitStudio.jsx`, JSX & CSS | 100% English UI, Light/Dark themes, chats, projects, Files & Git Studio, Quick Terminal, Background Process Monitor, Memory Manager, Connectors, and MCP Builder |
| Agent Runtime | `core/runtime.mjs` | Agent loop, operating modes (`agent`, `architect`, `explore`, `unrestricted`), sub-agent delegation, dependency queue, pause/resume, and context compaction |
| Agentic Coding Engine | `core/coding-engine.mjs` | Line-range file reader, `multi_edit`, `apply_patch`, `glob_files`, `grep_search`, `code_outline` symbol maps, Git & worktree operations, background process manager, `NEXUS.md`/`CLAUDE.md`/`AGENTS.md` auto-discovery, `web_fetch`, `scaffold_mcp_server`, `self_improve`, and slash command expansion |
| Multi-Provider Engine | `core/providers.mjs`, `model-request.mjs`, `provider-errors.mjs`, `stream.mjs` | Routing across OpenRouter, Arli.ai, OpenAI, GitHub Copilot, Anthropic, and Custom/Local OpenAI-compatible servers; SSE parsing and retry budget |
| Tools & Extensibility | `core/tools.mjs`, `mcp.mjs`, `openapi.mjs`, `capabilities.mjs` | 30+ built-in agentic tools, stdio/HTTP MCP client, OpenAPI 3.0/3.1 importer, and on-demand Skills/Functions catalog |
| Persistence | `core/store.mjs`, `sqlite-workspace.mjs`, `storage-migration.mjs` | Atomic JSON store, optional incremental SQLite (`node:sqlite`), and verified storage migration |
| Recovery | `core/storage-recovery*.mjs`, `recovery-jobs.mjs`, `response-journal.mjs`, `migrate.mjs` | Isolated backup verification/restoration, interrupted stream recovery, and legacy profile migration |
| Observability & Cost | `core/context-inspector.mjs`, `chat-workspace.mjs`, `telemetry.mjs`, `artifacts.mjs` | Paged history, USD cost accounting, cache hit metrics, and bounded local artifacts |
| Attachments & Drafts | `core/attachments.mjs`, `drafts.mjs`, `src/Attachments.jsx` | Local attachment descriptors (zero base64 inflation in state) and per-chat draft persistence |
| Windows Native | `native/desktop.ps1` | Native mouse and keyboard automation coordinated from Electron |
| Node Unit Suite | `tests/*.test.mjs` and `tests/fixtures/` | Synthetic provider responses, real stdio child processes, and temporary stores |
| Electron Smoke Suite | `core/*smoke.mjs` | Offscreen real-Electron UI, accessibility, layout, and IPC verification |

## Primary Execution Flow

1. The renderer invokes an allowlisted operation via `preload.cjs`; the main process validates origin, frame, and arguments.
2. `Runtime` expands slash commands (`/init`, `/review`, `/architect`, `/mcp-create`, `/self-improve`), assembles typed context sections (global instructions, project instructions, auto-discovered `NEXUS.md`/`CLAUDE.md`/`AGENTS.md`, persistent memories, active todo checklist, pinned messages, and compacted continuity), and filters tools according to the active Operating Mode.
3. `modelConnection(model)` resolves the provider from the namespaced model ID (`arliai/*`, `openai/*`, `copilot/*`, `anthropic/*`, `custom/*`, or OpenRouter default).
4. The SSE parser streams text, reasoning summaries, token/cost usage, and tool calls without executing partial tool arguments on interrupted streams.
5. External side effects (`write_file`, `multi_edit`, `apply_patch`, `run_command`, `git_operation`, `manage_process`, `invoke_mcp`, `invoke_connector`, `scaffold_mcp_server`) are tracked in the durable effect ledger (`intended → dispatched → observed / uncertain`).
6. Large tool outputs are materialized as local hash-verified artifacts and read in bounded slices via `read_artifact`.

## Core Invariants

- Preserve original messages and checkpoints on compaction; never resend hidden literal reasoning across turns.
- Never automatically retry a generation after visible output has been emitted, and never replay incomplete tool calls.
- On restart, pause formerly running tasks and mark unfinished external side effects as `uncertain` for evidence-based reconciliation.
- Unknown cost (`null`) is never conflated with `$0.00`. Estimated context tokens and cumulative usage tokens are tracked separately.
- Keep binary/image attachments on disk as local descriptors; hydrate base64 only at the outbound network boundary.
- Keep `desktop/core/*.mjs` in ESM and `main.cjs` / `preload.cjs` in CommonJS. Vite compiles JSX into `desktop/ui/`. `npm run dist:portable` packages a standalone click-to-run Windows `.exe` (`NEXUS-Portable.exe`).
