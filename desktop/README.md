# NEXUS Desktop (`v1.2.0`) — Standalone Native Agentic Workstation

NEXUS is a local-first standalone native Windows application for autonomous agentic coding, integrated private browsing, and unrestricted personal environment control — built with **.NET 10 + Microsoft WebView2 (Zero Electron)** and a decoupled **Node 24 ESM Core Engine**.

## Launching NEXUS

### 1. Build & Launch Native Standalone App (`NEXUS.exe`)
From `desktop/`:
```powershell
npm ci
npm test
npm run build
npm start
```
Or double-click `desktop\Launch NEXUS.cmd` to launch `desktop\release\NEXUS\NEXUS.exe` directly.

### 2. Build Portable Windows Bundle (`NEXUS-Portable-Windows.zip`)
```powershell
npm run dist:portable
```
Creates both `desktop/release/NEXUS-Portable/` and `desktop/release/NEXUS-Portable-Windows.zip` containing `NEXUS.exe`, WebView2 loader, bundled Node 24 runtime, built UI (`ui/`), core engine (`core/`), and backend dependencies.

### 3. Standalone Web / Headless API Mode
```powershell
npm run start:web       # Launches local core server and opens UI in default browser
npm run start:headless  # Runs local HTTP + SSE engine daemon on 127.0.0.1:4789
```

## Architecture (Zero Electron)

- **Native Windows Host (`desktop/native-host/`)**: C# / .NET 10 WinForms + official `Microsoft.Web.WebView2` runtime (built into Windows 10/11). Native Dark Titlebar (`DWMWA_USE_IMMUTABLE_DARK_MODE`), System Tray, Global Summon Hotkey (`Ctrl+Shift+Space`), single-instance lock, crash watchdogs, native Win32 ConPTY terminal (`ConPtyHost.cs`), offscreen JS-capable WebView2 inspector (`NativeBrowser.cs`), window-scoped/multi-monitor Win32 desktop automation (`NativeDesktop.cs`), embedded Account/InPrivate WebView2 browser, native OS dialogs, and DevTools (`F12`).
- **Local Core Engine (`desktop/core/server.mjs`)**: Zero-dependency Node 24 HTTP + SSE server managing the agent runtime, structured User Memory & Preference Profile (`memory.mjs`), DPAPI secret vault (`vault.mjs`, stdin-piped with rotating backups), live-reloading `nexus.config.json` (`config-file.mjs`), SQLite/JSON storage, local automations (`automations.mjs`), managed Tor/SOCKS5/HTTP privacy proxy (`tor-manager.mjs`, `privacy-proxy.mjs`), hot-loaded JS plugins & Cloud `SKILL.md` gallery (`plugins.mjs`, `gallery.mjs`), MCP servers, Windows UI Automation (`native/ui-tree.ps1`), and **63 built-in agentic tools** (with optional 19-core + 10 lazy toolsets).
- **Modular React 19 UI (`desktop/src/`)**: Token-driven Obsidian Dark, Studio Paper Light, and Midnight Slate themes + Live Custom CSS injection, dedicated **Memory & Profile** studio (`MemoryView`), zero-dependency syntax highlighting, strict-mode Mermaid & KaTeX Markdown rendering, inline collapsible tool timelines with 1-click file rollback, `@`-mention & `/`-slash autocomplete, drag-and-drop/paste attachments, Copilot-style Model Picker & Session Metrics popovers, side-panel & full-view Private Browser, Skills & Plugins Gallery, local Automations scheduler, side-by-side Model Arena, editable Code & Git Studio, live ConPTY terminal, background processes, and raw `nexus.config.json` editor.

## Provider Integrations (10 Built-In + Unlimited Custom Profiles)

- **OpenRouter**, **Arli.ai**, **OpenAI Direct**, **Anthropic Direct** (native `/v1/messages` + prompt caching + extended thinking), **GitHub Copilot** (automatic OAuth → Copilot session token exchange via `gh auth token`), **DeepSeek Direct**, **Google Gemini**, **xAI (Grok)**, **Groq**, **Custom / Local** (Ollama, LM Studio, vLLM, llama.cpp), plus **unlimited user-defined Custom Provider Profiles** (OpenAI or Anthropic format) and raw `temperature` / `top_p` / `seed` / `extraBody` / `extraHeaders` overrides.

## Full Hackability & Zero Content Filters

- Edit `%APPDATA%\NEXUS\nexus.config.json` directly on disk (auto hot-reloads) or inside **Settings → nexus.config.json**.
- Customize system prompts globally or per chat, inject live Custom CSS, toggle any of the **63 built-in tools** individually, customize `webUserAgent`, manage prioritized personal memories/constraints in **Memory & Profile**, configure Semi-Autopilot allow/deny pattern rules, define custom `/slash` commands, author live JS tools (`create_dynamic_tool`), and connect local HTTP/HTTPS REST connectors or stdio/HTTP MCP servers.
