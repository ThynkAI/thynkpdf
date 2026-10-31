@echo off
REM Starts THYNKPDF: backend on :8000 and web app on :3000 in two windows, then opens the browser.
set "APP=%USERPROFILE%\THYNKPDF"
if not exist "%APP%\.venv\Scripts\python.exe" (
  echo THYNKPDF is not installed yet. Double-click install-windows.bat first.
  pause & exit /b 1
)
set "PATH=%ProgramFiles%\nodejs;%PATH%"
start "THYNKPDF backend (close to stop)" /D "%APP%" cmd /k ""%APP%\.venv\Scripts\python.exe" scripts\serve_api.py --port 8000"
start "THYNKPDF web app (close to stop)" /D "%APP%" cmd /k "npx --yes pnpm@10.34.6 --filter @thynkpdf/web dev"
echo Starting THYNKPDF... the browser will open in about 20 seconds.
timeout /t 20 /nobreak >nul
start "" http://localhost:3000
echo If the page is blank, wait a few seconds and refresh. Close the two black windows to stop THYNKPDF.
timeout /t 8 >nul
