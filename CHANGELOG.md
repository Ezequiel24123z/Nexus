# Changelog

All notable changes to **NEXUS** are documented in this file.

## [1.1.0] - 2026-11-26

### Added
- **Standalone Native Windows Host (Zero Electron)**: Replaced Electron with a native C# / `.NET 10` + `Microsoft.Web.WebView2` executable (`desktop/native-host/NEXUS.exe`) featuring Win11 dark titlebar (`DWMWA`), System Tray, global summon hotkey (`Ctrl+Shift+Space`), single-instance lock, crash watchdogs (`host.log` / `core.log`), WebView2 auto-recovery, and Core daemon auto-restart.
- **Pure Win32 ConPTY Terminal & Native Desktop Automation**: Added `ConPtyHost.cs` (`CreatePseudoConsole`, zero `node-pty`) for real interactive terminal sessions and `NativeDesktop.cs` for low-latency native Win32 screenshots and input automation.
- **Decoupled Node 24 Core Server & Live Config**: Added `core/server.mjs`, `core/vault.mjs` (Windows DPAPI), `core/config-file.mjs` (`nexus.config.json` hot-reload), plus standalone browser (`npm run start:web`) and headless API (`npm run start:headless`) modes.
- **10 Built-In Providers + Unlimited Custom Profiles**: Added DeepSeek Direct, Google Gemini, xAI (Grok), Groq, native Anthropic `/v1/messages` + SSE + prompt caching + extended thinking, GitHub Copilot OAuth session exchange, unlimited custom OpenAI/Anthropic provider profiles, and raw `temperature` / `topP` / `seed` / `extraBody` / `extraHeaders` overrides.
- **4-Tier Autonomy Levels & Granular Allow/Deny Rules**: Added `Interactive`, `Semi-Autopilot` (with configurable allow/deny rules and 1-click **Always Allow**), `Autopilot`, and `Unrestricted` levels.
- **Copilot-Style Model Picker & Session Metrics Popovers**: Added freedom/capability filtering, inline reasoning/context/routing controls, live `% cached` telemetry, and quick compaction controls.
- **Integrated Account & InPrivate Browser + Managed Portable Tor**: Added side-panel (`BrowserSidePanel`) and full-view (`PrivateBrowserView`) WebView2 browser with persistent Account vs. zero-trace InPrivate modes, app-scoped portable Tor (`127.0.0.1:9055`), SOCKS5/HTTP proxy, system VPN detection, tracker blocking, anti-fingerprinting, Wipe, Send to AI, and Screenshot capture.
- **Rooted Projects, Concurrent Nested Sessions & Self-Evolution**: Added project-root auto-discovery (`NEXUS.md`/`CLAUDE.md`/`AGENTS.md` + `SKILL.md`), `spawn_session` / `list_sessions` / `send_session_message` / `read_session` orchestration with parent handoff, `GalleryView` (12 curated skills, 4 native JS plugins, 9 Cloud MCP plugins with live test/connect, live GitHub `SKILL.md` search/import), and live `create_dynamic_tool`.
- **Local Automations Scheduler**: Added interval, daily, weekly, 5-field cron, and one-shot autonomous jobs (`AutomationsView` + `manage_automation`).
- **Smart Lazy Toolsets & 2-Stage Lossless Compaction**: Added `load_toolset` (18 core + 10 on-demand tool groups across 61 built-in tools, ~65% Step-1 input token reduction), explicit prompt caching breakpoints, Stage 1 `$0` Micro-Compaction, Stage 2 lossless checkpoint compaction, `/compact`, Vite code splitting, and 40-turn progressive DOM windowing.

### Security & Audit Hardening
- Hardened Mermaid diagram rendering from `securityLevel: 'loose'` to `securityLevel: 'strict'` to eliminate prompt-injection XSS → RCE in WebView2.
- Replaced `cmd.exe /c start` in `core/server.mjs` with environment-passed `Start-Process` to prevent Windows shell metacharacter injection.
- Migrated DPAPI vault encryption/decryption (`core/vault.mjs`) from CLI arguments to `stdin` piping with automatic 5-file backup rotation and `vault.plain.json` cleanup on key deletion.
- Restricted local HTTP/SSE server CORS to loopback origins only, added constant-time token comparison, wrapped request dispatch against malformed percent-encoded URLs, fixed static UI path prefix-bypass, and enforced workspace containment + root-delete protection on Studio file APIs.
- Validated WebView2 `WebMessageReceived` origin (`e.Source`), restricted `NewWindowRequested`/`openExternal` to `http`/`https`, validated browser proxy URIs against Chromium CLI argument injection, and added Core watchdog restart rate limiting + process handle disposal.
- Sanitized `pluginId` in `PluginManager.createSingleTool` against directory traversal.
- Fixed React Rules-of-Hooks crash during streaming code/Mermaid blocks (`MarkdownRenderer.jsx`) and removed state-updater side effects in `StudioView.jsx`.
- Fixed falsy-zero bug in `validateAutomation` (`hour: 0` midnight and `weekday: 0` Sunday), added empty-arguments (`""`) handling for parameterless tool calls in `runtime.mjs`, fixed Semi-Autopilot relative path escape detection, fixed Tor `torrc` quoting for paths with spaces and unawaited timeout rejections, and hardened SOCKS5 leftover-byte buffering + HTTP 204/304 responses in `privacy-proxy.mjs`.
- Removed 5 obsolete Electron smoke files, migrated vault/live CLI scripts to pure Node 24 (`SecretVault`), aligned all error messages and launcher (`Launch NEXUS.cmd`) to English, synchronized `1.1.0` across all manifests/endpoints/`NEXUS.csproj`, and updated `build-portable.mjs` + `.github/workflows/desktop.yml` to build and publish `NEXUS-Portable-Windows.zip` with explicit `.NET 10` CI setup.

---

## [0.4.0] - 2026-11-02

- Unrestricted operator system prompt with zero client-side content filters.
- Automated code & syntax diagnostics (`run_diagnostics` + Diagnostics Studio tab).
- Stateful interactive shell sessions (`shell_session`), raw HTTP client (`http_request`), and headless web/DOM inspector (`browser_inspect`).
- Git Worktree manager (`worktree_list`, `worktree_add`, `worktree_remove` + Worktrees Studio tab).
- Multi-Model Arena side-by-side comparison (2–4 models).

---

## [0.3.0] - 2026-11-02

- 100% English Studio UI with `Studio Paper` (Light) and `Obsidian Carbon` (Dark) themes.
- 6 model providers (OpenRouter, Arli.ai, OpenAI, GitHub Copilot, Anthropic, Custom/Local).
- Agentic coding tool suite (`read_file` line ranges, `multi_edit`, `apply_patch`, `glob_files`, `grep_search`, `code_outline`, `git_operation`, `manage_process`, `todo_write`, `memory_store`, `web_fetch`, `delegate_subagent`).
- Autonomous MCP server scaffolding (`scaffold_mcp_server`), self-improvement (`self_improve`), and built-in slash commands.
