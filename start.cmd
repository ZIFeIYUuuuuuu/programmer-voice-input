@echo off
setlocal
cd /d "%~dp0"

set "APP_EXE=%~dp0src-tauri\target\release\voice.exe"

if exist "%APP_EXE%" (
  start "" "%APP_EXE%"
  exit /b 0
)

echo Release app was not found. Starting development mode...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dev.ps1"
exit /b %ERRORLEVEL%
