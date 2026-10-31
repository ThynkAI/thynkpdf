# Install THYNKPDF on your computer (script installer)

> Prefer the desktop app? Download the **THYNKPDF installer** (.exe for Windows, .dmg for Mac) from the
> [Releases page](https://github.com/ThynkAI/thynkpdf/releases) instead. It needs nothing else installed.
> This folder is the fallback "script" installer.

## Windows
1. Unzip **THYNKPDF-Windows.zip** anywhere (e.g. your Desktop or Downloads; **not** `C:\Windows\System32`).
2. Double-click **install-windows.bat**. It installs Git, Python 3.12 and Node.js if missing (via winget), then sets everything up in `C:\Users\<you>\THYNKPDF`. Takes 5–10 minutes the first time. If Windows asks "Do you want to allow this app to make changes?", click **Yes**.
3. Double-click **start-windows.bat**. Two black windows open (leave them open) and your browser opens THYNKPDF at http://localhost:3000. Close the two black windows to stop.

## Mac
1. Unzip **THYNKPDF-Mac.zip** (double-click it in Downloads).
2. **Right-click → Open** on **install-mac.command** (the first time macOS asks for confirmation because the file is downloaded). It installs Homebrew, Git, Python 3.12 and Node.js if missing (it may ask for your Mac password), then sets up `~/THYNKPDF`.
3. **Right-click → Open** on **start-mac.command**. Your browser opens THYNKPDF at http://localhost:3000. Close the Terminal window to stop.

## Good to know
- Run the installer again any time to update (it does `git pull`). Your documents stay in the `THYNKPDF/data` folder.
- No PowerShell policy change is needed: the .bat runs the script with `-ExecutionPolicy Bypass` for that run only.
- pnpm is pinned to 10 (`npx pnpm@10.34.6`), so newer pnpm versions don't fail with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`.
- Settings (including a randomly generated login secret) are in `THYNKPDF/.env`. Don't share that file.
- Something went wrong? Look at `THYNKPDF/data/api.log` / `web.log` (Mac) or the black windows (Windows).
