#!/bin/bash
# Starts THYNKPDF (backend :8000 + web :3000) and opens your browser. Close this window to stop.
set -uo pipefail
API_PORT="${THYNKPDF_API_PORT:-8000}"; WEB_PORT="${THYNKPDF_WEB_PORT:-3000}"
APP_DIR="${THYNKPDF_HOME:-$HOME/THYNKPDF}"
cd "$APP_DIR" 2>/dev/null || { echo "THYNKPDF is not installed. Run install-mac.command first."; read -r _; exit 1; }
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
command -v brew >/dev/null 2>&1 && export PATH="$(brew --prefix node@22 2>/dev/null)/bin:$PATH"
.venv/bin/python scripts/serve_api.py --port "$API_PORT" > data/api.log 2>&1 & API=$!
npx --yes pnpm@10.34.6 --filter @thynkpdf/web exec next dev -p "$WEB_PORT" > data/web.log 2>&1 & WEB=$!
trap 'kill $API $WEB 2>/dev/null; exit' INT TERM EXIT
echo "Starting THYNKPDF… (logs in $APP_DIR/data)"
for i in $(seq 1 120); do curl -sf http://localhost:$WEB_PORT >/dev/null 2>&1 && break; sleep 1; done
curl -sf http://localhost:$API_PORT/health >/dev/null || echo "Backend did not respond — see data/api.log"
[ "${NO_BROWSER:-0}" = "1" ] || open http://localhost:$WEB_PORT
echo "THYNKPDF is running at http://localhost:$WEB_PORT — close this window (or press Ctrl+C) to stop."
wait
