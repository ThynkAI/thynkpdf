@echo off
REM THYNKPDF one-click installer for Windows. Double-click this file.
REM Runs the PowerShell script with -ExecutionPolicy Bypass for this run only (no system policy change).
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
echo.
pause
