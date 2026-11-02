# Status & Roadmap

Updated: November 2, 2026. Current verification results are documented in [VALIDACION.md](VALIDACION.md).

## Implemented in NEXUS Desktop (`v0.3.0`)

- **100% English Interface & Studio Themes**: Light (`Studio Paper`), Dark (`Obsidian Carbon`), and System themes with comfortable/compact density and reduced-motion mode.
- **Unrestricted Personal & Agentic Operating Modes**: `Agent`, `Architect`, `Explore`, and `Unrestricted` modes with zero client-side content filtering.
- **6 Model Provider Integrations**:
  - **OpenRouter** (`owner/model`)
  - **Arli.ai** (`arliai/<model>`, including coding and derestricted models)
  - **OpenAI Direct** (`openai/<model>`)
  - **GitHub Copilot** (`copilot/<model>`, with 1-click token import from `gh auth token` / local Copilot configuration)
  - **Anthropic Direct** (`anthropic/<model>`)
  - **Custom / Local OpenAI-Compatible** (`custom/<model>` for Ollama, LM Studio, vLLM, llama.cpp)
- **Full Agentic Coding Tool Suite**:
  - Line-ranged `read_file` (`startLine`/`endLine`), `write_file`, `replace_text`, `multi_edit`, and `apply_patch` (`SEARCH/REPLACE` & unified diff hunks).
  - Fast `glob_files`, ripgrep-style `grep_search` (regex + context lines), and `code_outline` (structural symbol map).
  - `git_operation` (`status`, `diff`, `log`, `branch`, `stage`, `unstage`, `commit`, `worktree_list`, `worktree_add`).
  - `manage_process` for asynchronous background processes and dev servers.
  - `todo_write` / `todo_read` live task checklist and `memory_store` persistent cross-session memories.
  - `delegate_subagent` isolated sub-agent execution, `web_fetch`, and `system_info`.
- **Autonomous Self-Improvement & MCP Builder**:
  - `scaffold_mcp_server`: Generates, registers, and hot-connects local Node.js stdio MCP servers on the fly.
  - `self_improve`: Analyzes workspace telemetry and synthesizes reusable Skills into the Capability Library.
  - Built-in slash commands: `/init`, `/review`, `/architect`, `/mcp-create`, and `/self-improve`.
  - Auto-discovery of `NEXUS.md`, `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, and `.github/copilot-instructions.md`.
- **Files & Git Studio**: Integrated file explorer, Git status, syntax-highlighted diff viewer, stage/unstage/commit, Quick Terminal, and Background Process Monitor.
- **Durable Continuity & Observability**: JSON & incremental SQLite storage, compaction checkpoints, interrupted stream recovery, effect ledger reconciliation, and Context/Cache/Spend Inspector.
- **Single-Click Portable `.exe` Packaging**: `npm run dist:portable` builds `NEXUS-Portable.exe` for instant click-to-run execution on Windows.
