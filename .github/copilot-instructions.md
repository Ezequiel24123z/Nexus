# NEXUS Development Context

NEXUS is an autonomous local agentic coding and personal operator workspace. The primary application lives in `desktop/`: Electron + React/JSX + Vite, ESM `.mjs` engine modules, and CommonJS `.cjs` entrypoints. The root directory contains a separate Vinext/Workers/D1 web prototype. Do not mix commands, secrets, or storage between them.

Read `docs/ARQUITECTURA.md`, `docs/ESTADO-Y-ROADMAP.md`, and `docs/VALIDACION.md`. Reports in `desktop/research/` are historical snapshots.

## Install, Test & Build

Use Windows and Node 24.12.0 (`.node-version`). From `desktop/`:

```text
npm ci
npm test
npm run build
npm run dist:portable
```

Then `npm start` loads the compiled UI in `ui/`. Use `npm.cmd` if PowerShell blocks `npm.ps1`.

`npm test` uses synthetic fixtures and requires no API keys. Do not run `test:live*`, `tests/provision-vault.cjs`, or `tools/vault-inspect.cjs` during routine tasks. Never publish credentials, profiles, or private logs.

To open the app with an isolated profile during development, set `NEXUS_TEST_DATA` to a new temporary folder.

## Code Map (relative to `desktop/`)

- Windows/IPC/Vault: `main.cjs`; allowed renderer bridge list: `preload.cjs`.
- Agent loop, modes, subagents, queue, compaction: `core/runtime.mjs`.
- Agentic coding engine, Git, processes, MCP scaffolding, outline, self-improvement: `core/coding-engine.mjs`.
- Providers, payloads, errors, SSE stream parser: `core/providers.mjs`, `model-request.mjs`, `provider-errors.mjs`, `stream.mjs`.
- Tools, MCP, OpenAPI, Capabilities: `core/tools.mjs`, `mcp.mjs`, `openapi.mjs`, `capabilities.mjs`.
- Persistence & recovery: `core/store.mjs`, `sqlite-workspace.mjs`, `storage-*`, `response-journal.mjs`.
- UI components (100% English, Light/Dark themes): `src/main.jsx`, `src/CodeGitStudio.jsx`, `src/*.jsx`; Node tests: `tests/*.test.mjs`.

## Core Invariants

- All application UI, tool schemas, system prompts, and error messages must be in English.
- Zero client-side content filtering: delegate content policy to the selected model provider and grant full local capability in the user's chosen environment.
- Preserve originals and checkpoints on compaction; never resend literal hidden reasoning.
- Never automatically replay interrupted generations after visible output or repeat incomplete tool calls.
- Keep unknown cost (`null`) distinct from zero (`0`), and estimated context window tokens distinct from cumulative token usage.
- Keep secrets in the main process vault (`safeStorage`); never return raw secrets to the renderer or embed them in prompts.
