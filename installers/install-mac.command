#!/bin/bash
# THYNKPDF one-click installer for macOS. Double-click this file in Finder.
# Installs into ~/THYNKPDF. Safe to run again (updates with git pull).
set -euo pipefail
APP_DIR="${THYNKPDF_HOME:-$HOME/THYNKPDF}"
REPO_URL="${THYNKPDF_REPO_URL:-https://github.com/ThynkAI/thynkpdf.git}"
BRANCH="${THYNKPDF_BRANCH:-main}"
PNPM="pnpm@10.34.6"
say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*"; read -r -p "Press Enter to close..." _ || true; exit 1; }
trap 'fail "Something went wrong (line $LINENO). Scroll up for details."' ERR

say "THYNKPDF installer — installing into $APP_DIR"

if [ "${SKIP_BREW:-0}" != "1" ]; then
  if ! command -v brew >/dev/null 2>&1; then
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
  fi
  if ! command -v brew >/dev/null 2>&1; then
    say "Installing Homebrew (it may ask for your Mac password)…"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
  fi
  say "Installing Git, Python 3.12 and Node.js (LTS)…"
  brew list git >/dev/null 2>&1 || brew install git
  brew list python@3.12 >/dev/null 2>&1 || brew install python@3.12
  brew list node@22 >/dev/null 2>&1 || brew install node@22
  export PATH="$(brew --prefix node@22)/bin:$(brew --prefix python@3.12)/bin:$PATH"
fi

PY=""
for c in python3.12 python3.13 python3; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
[ -n "$PY" ] || fail "Python 3 not found."
command -v git >/dev/null 2>&1 || fail "Git not found."
command -v node >/dev/null 2>&1 || fail "Node.js not found."

if [ -d "$APP_DIR/.git" ]; then
  say "Updating existing copy…"; git -C "$APP_DIR" pull --ff-only
else
  say "Downloading THYNKPDF…"; git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

say "Setting up the backend (Python)…"
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/python -m pip install --upgrade pip -q
.venv/bin/python -m pip install -r requirements.txt -q

if [ ! -f .env ]; then
  say "Creating settings file (.env) with a random secret…"
  SECRET=$(.venv/bin/python -c 'import secrets;print(secrets.token_urlsafe(48))')
  mkdir -p data
  cat > .env <<ENV
THYNKPDF_JWT_SECRET=$SECRET
THYNKPDF_DATABASE_URL=sqlite:///$APP_DIR/data/thynkpdf.db
THYNKPDF_STORAGE_ROOT=$APP_DIR/data/objects
THYNKPDF_CORS_ORIGINS=http://localhost:3000
ENV
fi
.venv/bin/python scripts/migrate.py

say "Setting up the web app (this can take a few minutes)…"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
npx --yes "$PNPM" install --config.minimumReleaseAge=0
[ -f apps/web/.env.local ] || printf 'NEXT_PUBLIC_API_URL=http://localhost:8000\n' > apps/web/.env.local

trap - ERR
say "Done! Double-click start-mac.command to open THYNKPDF."
[ "${NONINTERACTIVE:-0}" = "1" ] || read -r -p "Press Enter to close..." _ || true
