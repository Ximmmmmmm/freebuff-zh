@echo off
rem Rebuild FreebuffController.exe (output lands in this folder as
rem FreebuffController.exe; rename to the Chinese display name if you like).
set CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
"%CSC%" -nologo -target:winexe -platform:anycpu -optimize+ -codepage:65001 ^
  -r:System.dll -r:System.Core.dll -r:System.Drawing.dll -r:System.Windows.Forms.dll -r:System.Management.dll ^
  -win32icon:"%~dp0app.ico" -out:"%~dp0FreebuffController.exe" "%~dp0FreebuffController.cs"
rem ...and propagate the exit code so CI smoke builds actually fail on error.
if %errorlevel%==0 (echo BUILD OK) else (
  echo BUILD FAILED
  exit /b 1
)
