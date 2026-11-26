@echo off
cd /d "%~dp0"
if not exist "%~dp0release\NEXUS\NEXUS.exe" (
  echo Building NEXUS standalone native app...
  call npm run build
)
start "" "%~dp0release\NEXUS\NEXUS.exe"
