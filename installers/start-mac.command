#!/bin/bash
# Starts THYNKPDF (backend :8000 + web :3000) and opens your browser. Close this window to stop.
set -uo pipefail
APP_DIR="${THYNKPDF_HOME:-$HOME/THYNKPDF}"
cd "$APP_DIR" 2>/dev/null || { echo "THYNKPDF is not installed. Run install-mac.command first."; read -r _; exit 1; }
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
command -v brew >/dev/null 2>&1 && export PATH="$(brew --prefix node@22 2>/dev/null)/bin:$PATH"
.venv/bin/python scripts/serve_api.py --port 8000 > data/api.log 2>&1 & API=$!
npx --yes pnpm@10.34.6 --filter @thynkpdf/web dev > data/web.log 2>&1 & WEB=$!
trap 'kill $API $WEB 2>/dev/null; exit' INT TERM EXIT
echo "Starting THYNKPDF… (logs in $APP_DIR/data)"
for i in $(seq 1 120); do curl -sf http://localhost:3000 >/dev/null 2>&1 && break; sleep 1; done
curl -sf http://localhost:8000/health >/dev/null || echo "Backend did not respond — see data/api.log"
[ "${NO_BROWSER:-0}" = "1" ] || open http://localhost:3000
echo "THYNKPDF is running at http://localhost:3000 — close this window (or press Ctrl+C) to stop."
wait
