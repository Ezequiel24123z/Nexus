# Working on a Windows VM with GitHub Copilot

## Prerequisites

You need Git, **Node.js 24.12.0** (`.node-version`), **.NET 10 SDK**, and Windows 10/11 with Microsoft Edge WebView2 Runtime (preinstalled on Windows 11). Zero Electron dependencies are used. On non-Windows hosts you can edit code and run `npm test`, `npm run build:ui`, and `npm run start:web`, but compiling and launching the native `.NET 10` executable (`NEXUS.exe`) requires Windows.

```powershell
git clone https://github.com/Ezequiel24123z/Nexus.git
cd Nexus
git switch -c feat/my-change
cd desktop
npm ci
npm test
npm run build
$env:NEXUS_TEST_DATA = Join-Path $env:TEMP ('nexus-dev-' + [guid]::NewGuid())
npm start
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` with the exact same arguments. Setting `NEXUS_TEST_DATA` launches NEXUS with an isolated temporary data directory so your personal chats and DPAPI vault remain untouched. Reuse the same path to keep state across restarts, or run `Remove-Item Env:NEXUS_TEST_DATA` when done.

Open the **root `Nexus` folder** in your editor so Copilot loads `.github/copilot-instructions.md` and `AGENTS.md`. Run Desktop commands from `Nexus\desktop`.

## Copilot Context & Credentials

No API keys are required to edit code, build, or run `npm test` (the test suite uses synthetic fixtures). For live inference inside NEXUS, configure any of the 10 built-in providers (OpenRouter, Arli.ai, OpenAI, Anthropic, GitHub Copilot via `gh auth token`, DeepSeek, Gemini, xAI, Groq, or Custom/Local Ollama/vLLM) inside **Settings → Providers & Models**. Credentials are encrypted locally with Windows DPAPI (`vault.dpapi`) and are never committed to Git.

## Submitting Changes

```powershell
git status
git diff
git add desktop docs .github AGENTS.md README.md CHANGELOG.md
git commit -m "Describe the change"
git push -u origin feat/my-change
```

Open a pull request. The GitHub Actions workflow (`.github/workflows/desktop.yml`) installs dependencies, runs `npm test`, compiles the React UI and `.NET 10` native host on `windows-latest`, and packages `NEXUS-Portable-Windows.zip`. Pushing a `v*` tag automatically publishes the GitHub Release with `NEXUS-Portable-Windows.zip` attached.
