# NEXUS Development Guide

Read `.github/copilot-instructions.md` for the module map and core invariants. The primary application lives in `desktop/` (Electron + React 19 + Vite + Node ESM engine). The root directory contains an earlier standalone web prototype.

Use Node 24.12.0. For Desktop: `cd desktop`, `npm ci`, `npm test`, `npm run build`. `npm start` loads the compiled UI from `desktop/ui/`. To launch an isolated development profile without importing legacy data, set `NEXUS_TEST_DATA` to a fresh temporary directory.

All UI strings, tool schemas, system prompts, and documentation must remain in English. Preserve continuity checkpoints, external effect reconciliation, and unknown-cost accounting invariants.
