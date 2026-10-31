# THYNKPDF desktop app

One installer per OS (`.exe` for Windows, `.dmg` for Mac, `.AppImage` for Linux). Nothing else needs to be installed:
no Git, Python, Node or terminals.

## How it works
- **Shell:** Electron (`electron/main.js`). It starts the backend sidecar, waits for `THYNKPDF_READY <url>`, and opens the launcher.
  On quit it closes the sidecar's stdin; the sidecar exits on EOF, and is killed after 1.5 s if it hasn't.
- **Sidecar:** `server/desktop_server.py`, frozen with PyInstaller (`build/build_sidecar.py`). It runs FastAPI on `127.0.0.1` with a
  free port, and serves the static web export (`/`) and the launcher (`/desktop/`) on the same origin, so there are no CORS or cookie issues.
- **Data:** the OS app-data folder, under `data/`. On Windows that is `%APPDATA%\THYNKPDF`, on Mac `~/Library/Application Support/THYNKPDF`
  and on Linux `~/.config/THYNKPDF`. It holds the SQLite DB, stored PDFs, a JWT secret generated on first run, the dev signing cert and `server.log`.
  You can put overrides in `data/settings.env`.
- **Launcher:** tiles open the editor (`/?tool=<id>`). It checks GitHub Releases for a newer version and shows a download link
  (there is no auto-install yet).

## Build locally
```bash
THYNKPDF_STATIC_EXPORT=1 npx pnpm@10.34.6 --filter @thynkpdf/web build   # -> apps/web/out
python apps/desktop/build/build_sidecar.py   # needs Python with a shared libpython (python.org / uv / setup-python builds)
python apps/desktop/build/smoke_sidecar.py
cd apps/desktop && npm install && npx electron-builder --linux AppImage   # or --win nsis / --mac dmg on that OS
```
CI: `.github/workflows/desktop-release.yml` builds Windows (NSIS .exe), macOS arm64 and x64 (.dmg) and a Linux AppImage on every
run (download them as artifacts). Pushing a `v*` tag also creates a **draft** GitHub Release with the installers attached.

## Unsigned builds: what users will see
- **Windows SmartScreen:** "Windows protected your PC". Click **More info → Run anyway**.
- **macOS Gatekeeper:** "THYNKPDF can't be opened because Apple cannot check it for malicious software" (on recent macOS:
  "…is damaged" for downloaded unsigned apps). Fix: **right-click → Open**, or System Settings → Privacy & Security → **Open Anyway**.
  If macOS says it is "damaged", run `xattr -dr com.apple.quarantine /Applications/THYNKPDF.app`.

## To remove the warnings (code signing)
- **Windows:** an Authenticode code-signing certificate. The options are an OV/EV certificate from a CA (DigiCert, Sectigo, SSL.com),
  usually on a hardware token or cloud HSM, or **Azure Trusted Signing** (around $10/month). EV or Trusted Signing builds SmartScreen reputation fastest.
  Configure it with electron-builder `win.signtoolOptions` / `azureSignOptions` and GitHub secrets.
- **macOS:** an Apple Developer Program membership ($99/year), a **Developer ID Application** certificate, and **notarization**
  (an App Store Connect API key). Set `CSC_LINK`/`CSC_KEY_PASSWORD` plus `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER` secrets,
  then remove `"identity": null`.
- Once builds are signed, auto-update (electron-updater) can install updates in place. Until then the launcher only links to the new release.
