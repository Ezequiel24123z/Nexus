# NEXUS Architecture (`v1.0.0` Native Standalone — Zero Electron)

Desktop (`desktop/`) is the primary application and runs as a **standalone native Windows executable (`NEXUS.exe`)** powered by **.NET 10 + Microsoft WebView2** paired with a local **Node 24 ESM Core Engine** (`core/server.mjs`). No Electron or bundled Chromium is used.

| Area | Files inside `desktop/` | Responsibility |
| --- | --- | --- |
| Native Windows Host | `native-host/NEXUS.csproj`, `native-host/Program.cs` | Standalone `NEXUS.exe` using WebView2, Win11 Dark Titlebar (`DWMWA`), System Tray, Global Hotkey (`Ctrl+Shift+Space`), single-instance lock, native OS file/folder dialogs, and Core daemon supervision |
| Local Core Daemon | `core/server.mjs`, `core/vault.mjs`, `core/config-file.mjs` | Zero-dependency HTTP + SSE server, Windows DPAPI secret vault (`vault.dpapi` + optional `vault.plain.json`), live-watched `nexus.config.json`, static UI serving, and standalone/headless API mode |
| Client Bridge | `src/bridge.mjs` | Unified `window.nexus` client routing OS dialogs/theme/tray to native WebView2 and engine calls/SSE to `core/server.mjs` (with full browser fallback) |
| Modular React 19 UI | `src/main.jsx`, `src/styles/tokens.css`, `src/styles/app.css`, `src/components/*.jsx` | Token-driven Obsidian/Studio Paper/Slate themes + Live Custom CSS, ErrorBoundary, inline collapsible Tool Timelines with 1-click file rollback, syntax-highlighted Markdown, `@`-mentions & `/`-slash autocomplete, Side-by-Side Model Arena, editable Code & Git Studio, Stateful Shell, Processes, Library, Connectors Tester, MCP Studio, and Raw Config Editor |
| Agent Runtime | `core/runtime.mjs` | Agent loop, parallel read-only tool execution, isolated sub-agents, chat fork/edit/regenerate/delete, operating modes (`agent`, `architect`, `explore`, `unrestricted`), dependency queue, pause/resume, and compaction |
| Agentic Coding Engine | `core/coding-engine.mjs` | Line-range file reader, `multi_edit`, `apply_patch` (SEARCH/REPLACE & unified diff including new files), `revertFileBackup`, `glob_files`, `grep_search`, `code_outline`, Git & worktree operations, stateful shell, background process manager, `.mcp.json` discovery, `scaffold_mcp_server`, `self_improve`, and custom slash commands |
| Multi-Provider Engine | `core/providers.mjs`, `model-request.mjs`, `provider-errors.mjs`, `stream.mjs` | Native Anthropic `/v1/messages` + SSE, GitHub Copilot OAuth token exchange, OpenRouter, Arli.ai, OpenAI, DeepSeek, Gemini, xAI, Groq, Custom/Local, unlimited Custom Provider Profiles, `reasoning_content` streaming, and raw parameter/body/header overrides |
| Tools & Extensibility | `core/tools.mjs`, `mcp.mjs`, `openapi.mjs`, `capabilities.mjs` | 35+ built-in agentic tools with per-tool toggle support, stdio/HTTP MCP client with live stderr logs + resources/prompts, OpenAPI 3.0/3.1 importer, and Skills/Functions catalog |
| Persistence & Recovery | `core/store.mjs`, `sqlite-workspace.mjs`, `storage-recovery*.mjs`, `response-journal.mjs` | Atomic JSON & incremental WAL SQLite (`node:sqlite`), compaction checkpoints, interrupted stream recovery, and isolated backup restoration |
| Windows Native Control | `native/desktop.ps1` | Win32 mouse (`click`, `double_click`, `right_click`, `scroll`) and keyboard automation |
| Node Unit & Integration Suite | `tests/*.test.mjs` | Synthetic provider/SSE streams, real stdio MCP handshakes, HTTP/SSE server API, and temporary stores |

## Core Invariants

- All application UI, tool schemas, system prompts, and error messages remain in English.
- Zero client-side content filtering or artificial generation caps; maximum user hackability via UI and `nexus.config.json`.
- Preserve original messages and checkpoints on compaction; never resend hidden literal reasoning across turns.
- Never automatically retry a generation after visible output has been emitted, and never replay incomplete tool calls.
- Unknown cost (`null`) is never conflated with `$0.00`. Estimated context tokens and cumulative usage tokens are tracked separately.
