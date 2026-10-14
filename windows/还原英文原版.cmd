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

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Restore %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo  Done. Press any key to close.
) else (
  echo  Exit code %RC% -- see the red lines above. Press any key to close.
)
pause >nul
exit /b %RC%
