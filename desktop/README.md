# NEXUS Desktop — Standalone Native Agentic Workstation

NEXUS is a local-first standalone native Windows application for autonomous agentic coding and unrestricted personal environment control — built with **.NET 10 + Microsoft WebView2 (Zero Electron)** and a decoupled **Node 24 ESM Core Engine**.

## Launching NEXUS

### 1. Build & Launch Native Standalone App (`NEXUS.exe`)
From `desktop/`:
```powershell
npm install
npm test
npm run build
npm start
```
Or double-click `desktop\Abrir NEXUS.cmd` to launch `desktop\release\NEXUS\NEXUS.exe` directly.

### 2. Standalone Web / Headless API Mode
```powershell
npm run start:web       # Launches local core server and opens UI in default browser
npm run start:headless  # Runs local HTTP + SSE engine daemon on port 4789
```

## Architecture (Zero Electron)

- **Native Windows Host (`desktop/native-host/`)**: C# / .NET 10 WinForms + official `Microsoft.Web.WebView2` runtime (already built into Windows 10/11). Native Dark Titlebar (`DWMWA_USE_IMMUTABLE_DARK_MODE`), System Tray, Global Summon Hotkey (`Ctrl+Shift+Space`), single-instance lock, native OS dialogs, and DevTools (`F12`).
- **Local Core Engine (`desktop/core/server.mjs`)**: Zero-dependency Node 24 HTTP + SSE server managing the agent runtime, DPAPI secret vault (`vault.mjs`), live-reloading `nexus.config.json` (`config-file.mjs`), SQLite/JSON storage, MCP servers, and 35+ agentic tools.
- **Modular React 19 UI (`desktop/src/`)**: Token-driven Obsidian Dark, Studio Paper Light, and Midnight Slate themes + Live Custom CSS injection, zero-dependency syntax highlighting, inline collapsible tool timelines with 1-click file rollback, `@`-mention & `/`-slash autocomplete, drag-and-drop/paste attachments, side-by-side Model Arena, editable Code & Git Studio, stateful shell, live processes, and raw `nexus.config.json` editor.

## Provider Integrations (10 Built-In + Unlimited Custom Profiles)

- **OpenRouter**, **Arli.ai**, **OpenAI Direct**, **Anthropic Direct** (native `/v1/messages` + prompt caching + extended thinking), **GitHub Copilot** (automatic OAuth → Copilot session token exchange via `gh auth token`), **DeepSeek Direct**, **Google Gemini**, **xAI (Grok)**, **Groq**, **Custom / Local** (Ollama, LM Studio, vLLM, llama.cpp), plus **unlimited user-defined Custom Provider Profiles** (OpenAI or Anthropic format) and raw `temperature` / `top_p` / `extraBody` / `extraHeaders` overrides.

## Full Hackability & Zero Content Filters

- Edit `%APPDATA%\NEXUS\nexus.config.json` directly on disk (auto hot-reloads) or inside **Settings → nexus.config.json**.
- Customize system prompts globally or per chat, inject live Custom CSS, toggle any of the 35+ built-in tools individually, define custom `/slash` commands, and connect local HTTP/HTTPS REST connectors or stdio/HTTP MCP servers.
