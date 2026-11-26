# Release Validation (`v1.1.0` Standalone Native)

Verified on Windows with Node.js (`.node-version` `24.12.0`) and `.NET 10 SDK` + Microsoft Edge WebView2 Runtime (CI runner `windows-latest` with `actions/setup-dotnet@v4`). Zero Electron dependencies.

| Check | Result |
| --- | --- |
| Desktop: `npm test` | **227 unit & integration tests passed**, 0 failures |
| Desktop: `npm run build:ui` | Passed; Vite 8 code-split build (`index.js` 444 KB / 121 KB gzip + `react-vendor` + `icons-vendor` + lazy KaTeX/Mermaid) |
| Desktop: `npm run build:native` | Verified in Windows CI (`actions/setup-dotnet@v4`, .NET 10) — compiles standalone `desktop/release/NEXUS/NEXUS.exe` including Win32 `ConPtyHost.cs` and `NativeDesktop.cs` |
| Desktop: `npm run dist:portable` | Packages self-contained `desktop/release/NEXUS-Portable/` and `desktop/release/NEXUS-Portable-Windows.zip` (bundled Node 24 + WebView2 + `NEXUS.exe`), verified & uploaded in Windows CI (`if-no-files-found: error`) |
| Live OpenRouter E2E (`deepseek/deepseek-v4.1-flash`, cheapest provider) | Passed across coding tools + inline diff + Mermaid/KaTeX, live self-evolution (`create_dynamic_tool` + native plugin `dev_hash`), concurrent nested sessions + inter-session messaging, Semi-Autopilot risk gate, **Lazy Toolsets (`8,643 → 3,022` tok = 65% input reduction)**, **Stage 1 Micro-Compaction ($0, 1,498 tok freed)** + **Stage 2 Full Compaction (marker preserved)**, **25.4% live cache hit**, and **Live GitHub `SKILL.md` search (10 results)** |
| Headless Edge CDP Visual Audit (1440×920) | **0 console errors, 0 uncaught exceptions, 0 horizontal overflow** across Chat, Nested Sessions, Model Picker Popover (Efficiency controls), Context Inspector (Micro-Prune/Compact Now), Semi-Autopilot Allow/Deny Rules, Skills & Plugins Gallery (GitHub Search + MCP Test & Connect), Private Browser, and Code & Git Studio |

## Scope of Automated Verification

- **Multi-Provider Engine**: Native Anthropic `/v1/messages` + SSE + caching + extended thinking, GitHub Copilot OAuth token exchange + caching, OpenAI-compatible `reasoning_content` streaming, OpenRouter, Arli.ai, OpenAI, DeepSeek, Gemini, xAI, Groq, Custom/Local, unlimited Custom Provider Profiles, and raw generation parameters (`temperature`, `topP`, `seed`, `extraBody`, `extraHeaders`).
- **Agentic Coding & Lifecycle**: Parallel read-only tool execution, isolated sub-agents, concurrent nested sessions, `apply_patch` new-file creation, 1-click `revertFileChange`, `resume()` slash command expansion + custom slash commands, parameterless empty-argument tool calls, unrestricted tool execution without bound workspace, `forkTask`, `editMessageAndResend`, `regenerate`, `deleteTask`, `ConfigFileManager` (`nexus.config.json`), and debounced `DraftController`.
- **Security & Audit Hardening**: Stdin-piped Windows DPAPI vault encryption/decryption with 5-file backup rotation and plaintext cleanup, loopback-only CORS rejection of untrusted origins, malformed percent-encoded URL 400 handling, workspace root deletion & traversal blocking on `deleteFileOrDir`, `pluginId` path traversal sanitization, Semi-Autopilot relative path escape detection, midnight (`hour: 0`) & Sunday (`weekday: 0`) automation preservation, and synchronized `1.1.0` version reporting across `/api/health`, `hostInfo`, `package.json`, and `NEXUS.csproj`.
- **Standalone Core Server & Native Host**: Verified `/api/health`, `/api/invoke` auth & RPC dispatch, `/api/events` SSE, direct file editor read/write, Arena with workspace propagation, and pure-Node Zero-Electron live vault runner (`live-runner.test.mjs`).
