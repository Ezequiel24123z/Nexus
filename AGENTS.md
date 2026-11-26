# NEXUS Development Guide

Read `.github/copilot-instructions.md` for the module map and core invariants. The primary application lives in `desktop/` (**Native Windows .NET 10 + WebView2 standalone app without Electron** + React 19 + Vite 8 + Node 24 ESM core daemon). The root directory contains an earlier standalone web prototype.

Use Node 24.12.0 and .NET 10 SDK. For Desktop: `cd desktop`, `npm install`, `npm test`, `npm run build`, `npm start` (launches `desktop/release/NEXUS/NEXUS.exe`). To launch an isolated development profile without importing legacy data, set `NEXUS_TEST_DATA` to a fresh temporary directory.

All UI strings, tool schemas, system prompts, and documentation must remain in English. Preserve continuity checkpoints, external effect reconciliation, zero content filtering, and unknown-cost accounting invariants.
