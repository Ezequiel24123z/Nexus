# Release Validation (`v0.3.0`)

Verified on Windows with Node.js `v24+` and Electron `44.3.0`.

| Check | Result |
| --- | --- |
| Desktop: `npm ci --no-audit --no-fund` | Passed, including Electron binary installation |
| Desktop: `npm test` | **202 unit & integration tests passed**, 0 failures |
| Desktop: `npm run build` | Passed; Vite bundles HTML, CSS, and JS into `desktop/ui/` |
| Desktop: `npm start -- --smoke-test` | Passed; **170 real Electron UI checks**, isolated temporary store, zero horizontal overflow at 1500px and 940px |
| Desktop: `npm run dist:portable` | Passed; generates standalone click-to-run `NEXUS-Portable.exe` in `desktop/release/` |
| Credential scan | Zero leaked tokens, private keys, or user profiles in tracked files |

## Scope of Automated Verification

- **Multi-Provider Engine**: Verified payload construction, headers, reasoning effort mapping, and catalog parsing for OpenRouter, Arli.ai, OpenAI, GitHub Copilot, Anthropic, and Custom/Local endpoints.
- **Agentic Coding & Self-Improvement Suite**: Verified line-range `read_file`, `multi_edit`, `apply_patch`, `glob_files`, `grep_search`, `code_outline`, `git_operation`, `manage_process`, `todo_write`, `memory_store`, `web_fetch`, `delegate_subagent`, `scaffold_mcp_server` (including live stdio JSON-RPC handshake and tool execution), `self_improve`, and slash command expansion (`/init`, `/review`, `/architect`, `/mcp-create`, `/self-improve`).
- **Electron UI Smoke Suite**: Verified English navigation, Light/Dark themes, quick model & mode picker, attachment previews, draft recovery, streaming markdown stability, context/cost inspector, OpenAPI importer, SQLite migration, and isolated backup recovery.
