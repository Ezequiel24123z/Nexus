# NEXUS Development Context

NEXUS is an autonomous local agentic coding and personal operator workstation. The primary application lives in `desktop/`: **Native Windows .NET 10 + Microsoft WebView2 host (`native-host/`, Zero Electron)** paired with a decoupled **Node 24 ESM Core Engine (`core/server.mjs`)** and modular **React 19 + Vite 8 UI (`src/`)**. The root directory contains a separate historical Vinext/Workers/D1 web prototype. Do not mix commands, secrets, or storage between them.

Read `docs/ARQUITECTURA.md`, `docs/ESTADO-Y-ROADMAP.md`, and `docs/VALIDACION.md`. Reports in `desktop/research/` are historical snapshots.

## Install, Test & Build

Use Windows, Node 24.12.0 (`.node-version`), and .NET 10 SDK. From `desktop/`:

```text
npm install
npm test
npm run build
npm start
```

`npm run build` runs `vite build` (`ui/`) and `dotnet build` (`release/NEXUS/NEXUS.exe`). `npm start` launches the standalone native `NEXUS.exe` (or use `npm run start:web` / `npm run start:headless` for browser/API mode). Use `npm.cmd` if PowerShell blocks `npm.ps1`.

`npm test` uses synthetic fixtures and requires no API keys. Never publish credentials, profiles, or private logs.

To open the app with an isolated profile during development, set `NEXUS_TEST_DATA` to a new temporary folder.

## Code Map (relative to `desktop/`)

- Standalone Native Windows Host (Zero Electron): `native-host/NEXUS.csproj`, `native-host/Program.cs`.
- Decoupled Local HTTP/SSE Core Server, DPAPI Vault & Live Config: `core/server.mjs`, `core/vault.mjs`, `core/config-file.mjs`.
- Agent loop, modes, subagents, parallel read-only tools, queue, compaction: `core/runtime.mjs`.
- Agentic coding engine, Git, stateful shell, processes, MCP scaffolding, outline, self-improvement: `core/coding-engine.mjs`.
- Providers (native Anthropic `/v1/messages`, Copilot OAuth exchange, OpenRouter, Arli.ai, OpenAI, DeepSeek, Gemini, xAI, Groq, unlimited Custom Profiles), payloads, errors, SSE stream parser: `core/providers.mjs`, `model-request.mjs`, `provider-errors.mjs`, `stream.mjs`.
- Tools, MCP, OpenAPI, Capabilities: `core/tools.mjs`, `mcp.mjs`, `openapi.mjs`, `capabilities.mjs`.
- Persistence & recovery: `core/store.mjs`, `sqlite-workspace.mjs`, `storage-*`, `response-journal.mjs`.
- Modular React 19 UI (100% English, Obsidian Dark / Studio Paper Light / Midnight Slate + Live Custom CSS): `src/main.jsx`, `src/bridge.mjs`, `src/styles/*.css`, `src/components/*.jsx`, `src/lib/*.mjs`; Node tests: `tests/*.test.mjs`.

## Core Invariants

- All application UI, tool schemas, system prompts, and error messages must be in English.
- Zero Electron: keep the desktop host as a real standalone native Windows executable (`native-host/`).
- Zero client-side content filtering or artificial generation caps: maximize user hackability via both `nexus.config.json` and the UI.
- Preserve originals and checkpoints on compaction; never resend literal hidden reasoning.
- Never automatically replay interrupted generations after visible output or repeat incomplete tool calls.
- Keep unknown cost (`null`) distinct from zero (`0`), and estimated context window tokens distinct from cumulative token usage.
- Keep secrets in the local Windows DPAPI vault (`core/vault.mjs`); never return raw secrets to the renderer or embed them in prompts.
