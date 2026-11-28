# Changelog

All notable changes to **NEXUS** are documented in this file.

## [1.5.0] - 2026-11-28

### Added
- **NEXUS App Self-Edit Protection (`detectNexusSelfModification`, `runtime.mjs`, `ChatView.jsx`)**:
  - Hard runtime guardrail blocking unauthorized edits, deletions, mutating Git operations, temporary scripts, or process kill/restart commands targeting the NEXUS installation folder, NEXUS source code, or protected internal state files (`workspace.json`, `nexus.config.json`, `vault.*`) — enforced **even in Unrestricted mode** and immune to `sessionAutoApprove` or "Always Allow" rules.
  - Renders a distinct red **`NEXUS Self-Edit Protection`** approval card with one-time **Approve Once / Decline** confirmation only, while default workspace-less `cwd` safely falls back to the user home directory instead of the NEXUS install folder.
- **Full App Introspection & Live Control Core Tool (`nexus_control`, `core/nexus-control.mjs`)**:
  - Promoted into `CORE_TOOL_NAMES` so the AI can read a structured feature manual (`guide`), inspect redacted live configuration/providers/models/sessions/projects/privacy/tools/MCP/plugins/automations (`inspect`), and live-configure settings, session modes, custom providers, enabled models, tools, and custom slash commands without inspecting NEXUS source code or exposing vault secrets.
- **Single-UAC Persistent Windows Admin Broker (`ElevatedAdminBroker`, `core/coding-engine.mjs`)**:
  - Replaces repeated per-command Windows UAC (`RunAs`) dialogs in Admin-enabled sessions with a persistent authenticated `127.0.0.1` loopback elevated worker (256-bit constant-time token auth, parent-PID watchdog, clean per-command cancellation) shared by both `run_command` and `shell_session`.
- **GitHub Copilot-Style Chronological Activity Feed (`ToolTimeline.jsx`, `ChatView.jsx`, `app.css`)**:
  - Redesigned reasoning, tool calls, file reads/edits, and shell commands into a clean, borderless clickable vertical timeline (`Thought for 18s` with real tracked `reasoningDurationMs`, `View file`, `Edit file +N -N` with inline **Revert** and colored diff drawer, `>_ Command` with `$ cmd`, exit badge, and formatted terminal output).
- **Native First-Class Yeta Labs Provider & Strict Active-Provider / Enabled-Models Picker (`core/providers.mjs`, `ModelPickerPopover.jsx`, `SettingsView.jsx`)**:
  - Built-in **Yeta Labs** provider (`yeta/`, live `/v1/models`, vision metadata, per-model `reasoning_effort` normalization) + safe raster `data:image/(png|jpeg|webp|gif);base64,...` rendering in `MarkdownRenderer`.
  - Model Picker, Settings, Automations, and Arena strictly filter to the currently selected provider and its configured `enabledModels` list (preventing OpenRouter catalog bleed-through), with inline **Enabled** curation in both the popover and Settings.
- **Expanded AI Privacy Control & Proactive Session Renaming (`manage_privacy`, `manage_session`, `main.jsx`)**:
  - Extended `manage_privacy` with `verify` (live IP/VPN/proxy check), 1-step `apply_preset` (`maximum`, `wireguard-tor`, `wireguard`, `tor`, `balanced`, `off`), `wireguard_select`/`remove`/`install`, `tor_install`, `set_wireguard_binary`, `wipe_browser`, and live misconfiguration warnings.
  - Added strong Turn-1 and topic-shift session renaming directives (enforced even with customized `globalInstructions`) with parallel step-1 rename execution.
  - Upgraded the left sidebar with unmistakable session status icons (`Loader2` spinner, `CheckCircle2`, `ShieldAlert`, `Clock`, `PauseCircle`, `AlertCircle`), status pills (`Live`/`Done`/`Approve`/`Paused`/`Error`), left accent rails, live count badge, and `All / Active / Done` filter tabs.

### Improved & Fixed
- **Core Runtime & Storage Efficiency (`core/store.mjs`, `core/runtime.mjs`)**: Compacted bulky `events`/`effects` payloads in `workspace.json` (preserving 100% lossless full payloads in `journal.jsonl`), added a 5 s TTL cache for workspace instructions/skills discovery, eliminated duplicate context estimation passes per step, and added a non-blocking consecutive-error thrashing nudge.
- **Local PII Display Restoration**: When Outbound PII Scrubbing is active, outbound cloud requests remain 100% redacted while local streaming and saved chat messages transparently restore user-readable paths/hostnames instead of showing `__NEXUS_USER__` / `__NEXUS_HOST__`.

## [1.4.0] - 2026-11-27

### Added
- **App-Scoped WireGuard VPN (`wireproxy`) & Double-Hop WireGuard → Tor Chaining (`core/wireguard-manager.mjs`, `core/tor-manager.mjs`, `PrivateBrowserView.jsx`)**:
  - Embedded zero-admin user-space WireGuard client (`wireproxy.exe` on `127.0.0.1:9060`) that routes ONLY NEXUS without installing Windows adapters or altering system routing tables.
  - 1-click `.conf` file or paste import for **Mullvad** (€4.50/mo with Monero, zero email), **IVPN**, **Proton VPN**, **AirVPN**, and custom WireGuard profiles, with private keys stored encrypted inside the Windows DPAPI vault (`WIREGUARD_PROFILES_JSON`) and never exposed to the UI.
  - Added two app-scoped routing modes: **WireGuard VPN** (low-latency daily driver, zero CAPTCHAs) and **Double-Hop WireGuard → Tor** (`torrc` `Socks5Proxy 127.0.0.1:9060` so your ISP never even sees Tor traffic while the VPN never sees destinations).
- **Reversible Outbound PII & Local Path Scrubber + 1-Click Stealth Mode (`core/pii-scrubber.mjs`, `core/runtime.mjs`)**:
  - Automatically redacts your Windows home path (`C:\Users\<you>` → `C:\Users\operator`), username, PC hostname, and custom sensitive strings from outbound cloud LLM prompts (skipped for local loopback models), and transparently restores them before local tool execution so coding workflows never break.
  - Added **1-Click Stealth Mode** activating All-App VPN/Tor routing, Fail-Closed Kill-Switch, Outbound PII Scrubber, InPrivate Browser, Tracker Shield, and Strict Zero-Track Search while **explicitly preserving `promptCaching` and `cacheAffinity`**.
- **Bidirectional RAM-Only ↔ Regular Sessions (`core/store.mjs`, `core/artifacts.mjs`, `ChatView.jsx`, `manage_session`, `spawn_session`)**:
  - Choose **RAM-Only** (zero disk writes — excluded from `workspace.json`, SQLite, journals, artifacts, and exports) or **Regular** when creating new chats or nested child sessions (`spawn_session` inherits RAM-Only from ephemeral parents automatically).
  - Live bidirectional migration anytime by the user (header pill) OR autonomously by the AI via `manage_session(action="set_ephemeral", ephemeral=true|false)`: migrating to RAM-Only immediately purges all disk traces (`tasks/<id>/` + store entry) while keeping the conversation alive in RAM; migrating back to Regular materializes the full session and history cleanly to disk.
- **Per-Session Windows Administrator Rights (`core/coding-engine.mjs`, `native-host/Program.cs`, `ChatView.jsx`, `SettingsView.jsx`)**:
  - Grant or revoke **Admin Rights** per session (`adminMode`) directly from the chat composer, active session header, or Spawn Child modal so specific sessions can execute elevated PowerShell commands (`run_command` / `shell_session` with `elevated: true`) for VPN adapters, Windows services, firewall rules, and system admin tasks via Windows UAC or process elevation.
  - Added live **Windows Privilege Level** indicator and **Restart as Admin** action (`relaunchElevated`) in Settings → System & Host.
- **Inline Chat Documents, Images, Audio & Streaming Video Viewer (`present_media`, `ChatMediaCard.jsx`, `/api/media/:id`)**:
  - Added core tool `present_media` so the AI can display local **images** (inline preview + fullscreen Lightbox), **videos** (`<video controls>` with Range-capable `206 Partial Content` streaming for smooth scrubbing), **audio**, **PDFs** (embedded native Edge PDF reader), and **documents** (rendered Markdown, formatted CSV tables, code/JSON preview + Copy & Open in Windows) directly inside the chat stream.
  - Upgraded user chat attachments so attached images, videos, audio, and PDFs also render inline inside messages.
- **AI Live Privacy Awareness & `manage_privacy` Core Tool (`core/runtime.mjs`, `core/tools.mjs`, `PrivateBrowserView.jsx`)**:
  - Automatically injects live `[Active Privacy & Network Posture]` (routing mode, WireGuard/Tor status, All-App traffic, Kill-Switch, Stealth Mode, PII Scrubber, Search engine, Prompt Caching, OPSEC score) into every session's context so changes immediately reflect in the AI.
  - Added core tool `manage_privacy` (`status`, `explain`, `set_routing`, `stealth`, `set_search`, `set_pii`, `set_browser`, `wireguard_import`, `wireguard_connect`, `wireguard_disconnect`, `tor_start`, `tor_stop`, `tor_new_identity`) + an interactive ranked Protection & Mode Guide directly under the Network Routing selector in the UI.

### Fixed
- Attached `node.exe` core daemon to a Win32 Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) in `Program.cs`, added `--parent-pid` auto-exit watchdog in `server.mjs`, and prevented `ConfigFileManager` `fs.watch` from echo-writing back to `nexus.config.json`—eliminating stale orphaned daemon races that could revert `wireguard-tor` / routing selections back to `direct`.
- Fixed RFC 7233 suffix HTTP Range (`bytes=-N` → `206` instead of `416`) on `/api/media/:id` for smooth MP4 video seeking, plus proper `413 Payload Too Large` with socket draining and `Connection: close` on oversized `/api/invoke` requests (preventing keep-alive poisoning).
- Hardened `PiiScrubber` with unambiguous opaque sentinels (`C:\Users\__NEXUS_USER__`, `__NEXUS_HOST__`, preventing collisions with English prose/code), zero-character-leak `summary()` masking, and RFC 1918 LAN private IPv4/IPv6 detection in `isLocalModelEndpoint`.
- Fixed `delegate_subagent` so reaching `maxSteps` runs a final tool-free synthesis turn (and unscrubs PII placeholders in subagent tool args) instead of returning empty whitespace.
- Fixed SemVer 2.0.0 pre-release precedence in `compareSemver` (`1.4.0-rc.1 < 1.4.0`), added `runtimes/` and scoped target-dir process shutdown + retry logging to the portable auto-updater script, fixed `cssEscape()`/`attrEscape()` in `agent-browser.mjs`, enabled single-file searching in both `grep_search` and `search_files`, fixed `signal?.throwIfAborted()` in `search_files`, ignored `#` comments in WireGuard provider inference while flagging defaulted `AllowedIPs`, clarified empty `plugins` toolset activation, and stabilized Windows `ENOTEMPTY` cleanup in `chat-workspace.test.mjs`.

## [1.3.0] - 2026-11-27

### Added
- **App-Wide Tor / SOCKS5h Encryption & Fail-Closed Kill-Switch (`core/privacy-proxy.mjs` + `server.mjs`)**:
  - Upgraded `proxiedFetch` to true streaming `ReadableStream` responses so real-time LLM SSE streaming works seamlessly over Tor/SOCKS5h.
  - Added unified `createNexusFetcher` with **Route ALL App Traffic Through Tor** (`torRouteAllTraffic`: encrypts LLM APIs, web search, Agent Browser, MCP HTTP calls, Skills downloads, and GitHub update checks through SOCKS5h with remote DNS resolution, while keeping `localhost`/`127.0.0.1` local for Ollama/vLLM) and a **Fail-Closed Kill-Switch** (`torStrictFailClosed`).
  - Added live **Anonymity & OPSEC Scorecard (`buildPrivacyAudit`, 0–100)** inside the Private Browser drawer with real-time security checks and actionable OPSEC hardening recommendations for untraceable communications.
- **Multi-Tier Zero-Track, AI & Tor `.onion` Search Suite (`core/search-engines.mjs`)**:
  - Added 13 configurable search modes: **Auto Privacy-First Cascade**, **SearXNG** (self-hosted/private JSON & HTML metasearch), **DuckDuckGo HTML**, **Mojeek** (independent zero-tracking index), **Brave Search API** (Zero Data Retention), **Kagi Search API** (zero ads/tracking), **LangSearch**, **Tavily**, **Exa**, **Ahmia** (`.onion` index), **Torch** (`.onion` hidden-service search strictly over Tor), **Combined Tor `.onion`**, and optional **Bing RSS** (disabled when **Strict Zero-Track Mode** is enabled).
  - Added DPAPI vault inputs for `SEARCH_BRAVE_KEY`, `SEARCH_KAGI_KEY`, `SEARCH_LANGSEARCH_KEY`, `SEARCH_TAVILY_KEY`, `SEARCH_EXA_KEY`, and `SEARCH_MOJEEK_KEY` in Settings, plus an interactive private/onion search bar inside the Agent Browser view.
- **Dual-Mode Specialized Agent Browser (`core/agent-browser.mjs` + `NativeBrowser.cs` + `PrivateBrowserView.jsx` + `BrowserSidePanel.jsx`)**:
  - Added a fast zero-bloat **Agent Browser** engine (`agent-fast`) that strips ads/trackers and emits compact `@e1..@eN` interactive accessibility refs, forms, links, and clean Markdown (80–90% fewer tokens, 100% Tor/SOCKS5h & `.onion` compatible).
  - Upgraded headless WebView2 `NativeBrowser.cs` (`agent-js`) with live `data-nexus-ref="eN"` DOM tagging, `@eN` ref-based actions (`click`/`type`/`select`/`press_key`), tracker & heavy-media resource blocking, and anti-fingerprinting (`DNT`/`GPC`/`sendBeacon` block).
  - Added a **Standard Visual ↔ Agent View (`@eN`)** toggle in both the full Private Browser and the chat Side Browser Panel.
- **In-App GitHub Auto-Updater & Custom System Prompt Protection (`core/updater.mjs` + `core/store.mjs`)**:
  - Added GitHub Releases update detection (`checkUpdate`), SHA-256 checksum verification, automatic pre-update snapshots of `nexus.config.json`, `workspace.json`, and custom prompts into `%APPDATA%\NEXUS\backups\`, and one-click portable binary updates that never touch user profile data.
  - Added automatic **Custom System Prompt Protection** (`globalInstructionsCustomized` flag + dedicated always-preserved `customSystemPrompt` personal addendum + 1-click **Backup Prompts** and **Reset Base to Stock** in Settings) so future releases never overwrite user-customized prompts.
- **Visual Changelog & Release Timeline (`core/changelog.mjs` + `ChangelogView.jsx`)**:
  - Added a dedicated **Changelog & Updates** view accessible from the sidebar footer (`v1.3.0`) and Command Palette (`Ctrl+K`) with a vertical milestone timeline, category filters (`Added`, `Security`, `Improved`, `Fixed`), live search, and the GitHub Auto-Updater bar.
- **AI Self-Management Tools for Projects & Sessions (`manage_project` + `manage_session`)**:
  - Promoted `manage_project` (list, get, create, update, delete, assign current session) and `manage_session` (get, rename, assign/unassign project, set workspace, pin) into `CORE_TOOL_NAMES` so the AI can organize projects and sessions autonomously even under Lazy Toolsets, with Semi-Autopilot gating destructive project deletion.

### Security
- Enforced a hard fail-closed `.onion` guard in `createNexusFetcher` and `search-engines.mjs` so `.onion` URLs and Torch searches can never leak to clearnet DNS resolvers when Tor is inactive.
- Kept all Tor/SOCKS5h routing strictly app-scoped to NEXUS without modifying Windows system proxy settings or attempting to bypass corporate/Defender network controls.

## [1.2.0] - 2026-11-26

### Added
- **Structured User Memory, Priorities & Working Style System (`core/memory.mjs` + `MemoryView.jsx`)**:
  - Dedicated **Memory & Profile** studio in the main sidebar and Command Palette (`Ctrl+K`) with 6 categories (`priority`, `preference`, `constraint`, `workflow`, `profile`, `fact`), 4 priority levels (`critical`, `high`, `normal`, `low`), pinning, tags, Global vs. Project scopes, live **Prompt Preview**, and Markdown/JSON export & import.
  - Upgraded `memory_store` tool (`list`, `search`, `remember`, `update`, `forget`, `profile`) promoted into `CORE_TOOL_NAMES` so agents always preserve and respect user priorities, working style, and hard constraints—even when Lazy Toolsets are active.
  - Priority-ranked structured Markdown memory profile injection into `runtime.buildContext()` with seamless backward-compatible migration of legacy memories.
- **Real JavaScript WebView2 Browser Inspection & DOM Actions (`native-host/NativeBrowser.cs`)**:
  - Wired `NEXUS.exe --browser-inspect` into `core/server.mjs` and `browser_inspect` so `renderJs: true` executes real JavaScript inside an offscreen Edge WebView2 instance (supporting SPAs, `waitMs`, `waitForSelector`, scripted DOM `actions` for `click`/`type`/`select`/`scroll`/`wait`/`eval`, optional Account Mode cookies, interactive CSS selector extraction, and `captureScreenshot` while preserving full extracted DOM text).
  - Semi-Autopilot automatically gates interactive `browser_inspect` calls (`actions` / `useAccountSession`) while keeping passive reads frictionless; static HTTP fallback transparently reports `renderedJs: false` with `renderJsNote`.
- **Windows UI Automation, Privacy-Safe Window Capture & Multi-Monitor Desktop Control**:
  - Added `desktop_windows` (`NEXUS.exe --list-windows`) to enumerate all monitors and visible desktop windows (`hwnd`, `title`, `processName`, `bounds`, `active`).
  - Added `desktop_ui_tree` (`desktop/native/ui-tree.ps1`) using native Windows UI Automation (`UIAutomationClient`) to inspect buttons, inputs, tabs, values, and exact clickable `(x, y)` center coordinates without capturing pixels.
  - Upgraded `desktop_screenshot` (`NativeDesktop.cs`) with **window-only capture via Win32 `PrintWindow`** (`windowTitle`/`hwnd` so unrelated sensitive windows are never captured), multi-monitor selection (`monitor: 0 | 1 | "all"`), and region cropping.
  - Upgraded `desktop_action` with `focus_window`, `move`, and `drag`.
- **Realistic Configurable Browser HTTP Headers**:
  - Unified standard Edge/Chrome Windows browser headers (`User-Agent`, `Sec-CH-UA`, `Accept-Language`, `Sec-Fetch-*`) across `web_fetch`, `browser_inspect`, and `web_search` instead of identifying as `NEXUS-Agent`, with optional custom `webUserAgent` override in Settings and `nexus.config.json`.
- **Inline Session Renaming Anytime**:
  - Rename any session (root or nested child) anytime—even while the agent is actively running—by clicking the topbar title / pencil icon, double-clicking or clicking the pencil icon in the sidebar, or saving from Chat Settings.

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
