@echo off
chcp 65001 >nul
setlocal
set "PS1=%~dp0install-freebuff-zh.ps1"

if not exist "%PS1%" (
  echo [X] install-freebuff-zh.ps1 not found. Put it in the same folder as this file.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -List %*
set "RC=%ERRORLEVEL%"

echo.
echo  Press any key to close.
pause >nul
exit /b %RC%
