# Release Validation (`v1.1.0` Standalone Native)

Verified on Windows with Node.js `v24.12.0` and `.NET SDK 10.0.404` + Microsoft Edge WebView2 Runtime. Zero Electron dependencies.

| Check | Result |
| --- | --- |
| Desktop: `npm test` | **221 unit & integration tests passed**, 0 failures |
| Desktop: `npm run build:ui` | Passed; Vite 8 code-split build (`index.js` 416 KB / 113 KB gzip + `react-vendor` + `icons-vendor` + lazy KaTeX/Mermaid) |
| Desktop: `npm run build:native` | Passed; 0 warnings, 0 errors — compiles standalone `desktop/release/NEXUS/NEXUS.exe` including Win32 `ConPtyHost.cs` |
| Desktop: `npm run dist:portable` | Passed; builds self-contained `desktop/release/NEXUS-Portable/` (bundled Node 24 + WebView2 + `NEXUS.exe`) |
| Live OpenRouter E2E (`deepseek/deepseek-v4.1-flash`, cheapest provider) | Passed across coding tools + inline diff + Mermaid/KaTeX, live self-evolution (`create_dynamic_tool` + native plugin `dev_hash`), concurrent nested sessions + inter-session messaging, Semi-Autopilot risk gate, **Lazy Toolsets (`8,643 → 3,022` tok = 65% input reduction)**, **Stage 1 Micro-Compaction ($0, 1,498 tok freed)** + **Stage 2 Full Compaction (marker preserved)**, **25.4% live cache hit**, and **Live GitHub `SKILL.md` search (10 results)** |
| Headless Edge CDP Visual Audit (1440×920) | **0 console errors, 0 uncaught exceptions, 0 horizontal overflow** across Chat, Nested Sessions, Model Picker Popover (Efficiency controls), Context Inspector (Micro-Prune/Compact Now), Semi-Autopilot Allow/Deny Rules, Skills & Plugins Gallery (GitHub Search + MCP Test & Connect), Private Browser, and Code & Git Studio |

## Scope of Automated Verification

- **Multi-Provider Engine**: Native Anthropic `/v1/messages` + SSE + caching + extended thinking, GitHub Copilot OAuth token exchange + caching, OpenAI-compatible `reasoning_content` streaming, OpenRouter, Arli.ai, OpenAI, Custom/Local, unlimited Custom Provider Profiles, and raw generation parameters (`temperature`, `topP`, `seed`, `extraBody`, `extraHeaders`).
- **Agentic Coding & Lifecycle**: Parallel read-only tool execution, isolated sub-agents, `apply_patch` new-file creation, 1-click `revertFileChange`, `resume()` slash command expansion + custom slash commands, unrestricted tool execution without bound workspace, `forkTask`, `editMessageAndResend`, `regenerate`, `deleteTask`, `ConfigFileManager` (`nexus.config.json`), and debounced `DraftController`.
- **Standalone Core Server & Native Host**: Verified `/api/health`, `/api/invoke` auth & RPC dispatch, `/api/events` SSE, direct file editor read/write, Arena with workspace propagation, and zero-warning .NET 10 WebView2 release build.
