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

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [X] powershell.exe not found. Windows PowerShell 5.1 ships with Windows; check system integrity.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo ------------------------------------------------------------
  echo  Done. Press any key to close.
  echo ------------------------------------------------------------
) else (
  echo ------------------------------------------------------------
  echo  Exit code %RC% -- see the red lines above. Press any key to close.
  echo ------------------------------------------------------------
)
pause >nul
exit /b %RC%
