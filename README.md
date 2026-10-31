# THYNKPDF

A free PDF editor: edit, merge and split, compress, sign, fill forms, annotate and comment, and keep your documents organized. It runs entirely on your own computer, with no account to pay for and no billing.

## Install the desktop app (recommended)

1. Open the [Releases page](https://github.com/ThynkAI/thynkpdf/releases) and download the installer for your computer:
   | Your computer | File |
   |---|---|
   | Windows 10/11 (64-bit) | `THYNKPDF.Setup.<version>.exe` |
   | Mac with Apple silicon (M1/M2/M3/M4) | `THYNKPDF-<version>-arm64.dmg` |
   | Mac with Intel | `THYNKPDF-<version>.dmg` (no `arm64` in the name) |
   | Linux (64-bit) | `THYNKPDF-<version>.AppImage` |
   Not sure which Mac you have? Apple menu → **About This Mac**: "Chip: Apple M…" means Apple silicon; "Processor: Intel" means Intel.
2. Install it:
   - **Windows:** double-click the `.exe` and follow the steps.
   - **Mac:** open the `.dmg` and drag **THYNKPDF** into **Applications**.
   - **Linux:** `chmod +x THYNKPDF-*.AppImage`, then run it.
3. Open THYNKPDF. The launcher appears; pick a tool. Nothing else (Python, Node, Git) is needed.

Your documents and settings are stored in `%APPDATA%\THYNKPDF` (Windows), `~/Library/Application Support/THYNKPDF` (Mac) or `~/.config/THYNKPDF` (Linux).

### "Unknown app" warnings (the installers are not code-signed yet)
- **Windows SmartScreen** says "Windows protected your PC": click **More info → Run anyway**.
- **macOS** says THYNKPDF "can't be opened because Apple cannot check it for malicious software": **right-click the app → Open**, or go to **System Settings → Privacy & Security → Open Anyway**.
  If macOS says the app "is damaged", run this in Terminal, then open it again:
  ```bash
  xattr -dr com.apple.quarantine /Applications/THYNKPDF.app
  ```
- These warnings only mean the app isn't signed yet; see [apps/desktop/README.md](apps/desktop/README.md) for what signing would take.

## Alternative: script installer (`installers/`)
If you'd rather run from a source checkout without terminals, use the scripts in [`installers/`](installers/README.md) (download the zips built with `python installers/make_zips.py`, or use the files directly).
- **Windows:** `install-windows.bat` runs `install-windows.ps1` with `-ExecutionPolicy Bypass` for that run only. It installs Git, Python 3.12 and Node.js through winget if missing, clones THYNKPDF into `C:\Users\<you>\THYNKPDF`, creates the Python environment, writes a `.env` with a random login secret, runs the database migrations, and installs the web app. Then double-click `start-windows.bat` to start the backend and the web app and open http://localhost:3000.
- **Mac:** `install-mac.command` (right-click → Open the first time) does the same into `~/THYNKPDF`, using Homebrew to install Git, Python 3.12 and Node 22. `start-mac.command` starts both servers and opens http://localhost:3000; close the window to stop.
- Run the installer again to update (it runs `git pull`). Logs are in `THYNKPDF/data/` (Mac) or the console windows (Windows).

## Run from source (developers)
Requires Python 3.12, Node.js 22+ and pnpm 10 (`npx pnpm@10.34.6` works without a global install).

```bash
git clone https://github.com/ThynkAI/thynkpdf.git && cd thynkpdf

# Backend (FastAPI) on http://localhost:8000
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cat > .env <<ENV
THYNKPDF_JWT_SECRET=$(python -c 'import secrets;print(secrets.token_urlsafe(48))')
THYNKPDF_DATABASE_URL=sqlite:///$PWD/data/thynkpdf.db
THYNKPDF_STORAGE_ROOT=$PWD/data/objects
THYNKPDF_CORS_ORIGINS=http://localhost:3000
ENV
mkdir -p data && python scripts/migrate.py
python scripts/serve_api.py --port 8000

# Web app (Next.js) on http://localhost:3000, in a second terminal
npx pnpm@10.34.6 install
echo 'NEXT_PUBLIC_API_URL=http://localhost:8000' > apps/web/.env.local
npx pnpm@10.34.6 dev
```

### Tests
```bash
python packages/backend-tests/make_fixtures.py && python -m pytest -q   # backend
npx pnpm@10.34.6 web:test                                              # frontend unit tests
npx pnpm@10.34.6 web:e2e                                               # Playwright (needs the backend running)
```

### Build the desktop app yourself
See [apps/desktop/README.md](apps/desktop/README.md). CI (`.github/workflows/desktop-release.yml`) builds all installers. Pushing a `v*` tag creates a **draft** release with them attached.

## Docs
`docs/capability-matrix.md`, `docs/licensing.md`, `docs/openapi.json`, `apps/web/docs/`.
