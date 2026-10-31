# THYNKPDF installer for Windows (run via install-windows.bat).
$ErrorActionPreference = 'Stop'
$App    = Join-Path $env:USERPROFILE 'THYNKPDF'
$Repo   = 'https://github.com/ThynkAI/thynkpdf.git'
$Pnpm   = 'pnpm@10.34.6'

function Say($m)  { Write-Host "`n==> $m" -ForegroundColor Magenta }
function Fail($m) { Write-Host "`nERROR: $m" -ForegroundColor Red; exit 1 }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Run($exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE -ne 0) { Fail "$exe $($a -join ' ') failed (exit $LASTEXITCODE)" } }

try {
  Say "THYNKPDF installer - installing into $App"

  $needs = @()
  if (-not (Have git)) { $needs += @{id='Git.Git'; name='Git'} }
  $py = $null
  foreach ($v in '3.12','3.13') { try { & py "-$v" -c "import sys" 2>$null; if ($LASTEXITCODE -eq 0) { $py = @('py', "-$v"); break } } catch {} }
  if (-not $py) { $needs += @{id='Python.Python.3.12'; name='Python 3.12'} }
  if (-not (Have node)) { $needs += @{id='OpenJS.NodeJS.LTS'; name='Node.js LTS'} }

  if ($needs.Count -gt 0) {
    if (-not (Have winget)) {
      Fail ("winget (App Installer) is missing, so these can't be installed automatically: " + (($needs | ForEach-Object name) -join ', ') +
            ".`nInstall 'App Installer' from the Microsoft Store (or install them manually from git-scm.com, python.org, nodejs.org), then run this again.")
    }
    foreach ($n in $needs) {
      Say "Installing $($n.name)..."
      winget install --id $n.id -e --silent --accept-package-agreements --accept-source-agreements
    }
    Refresh-Path
  }
  if (-not $py) {
    foreach ($v in '3.12','3.13') { try { & py "-$v" -c "import sys" 2>$null; if ($LASTEXITCODE -eq 0) { $py = @('py', "-$v"); break } } catch {} }
    if (-not $py) { $cand = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'; if (Test-Path $cand) { $py = @($cand) } }
  }
  if (-not (Have git))  { Fail 'Git was installed but is not on PATH yet. Close this window and run install-windows.bat again.' }
  if (-not (Have node)) { Fail 'Node.js was installed but is not on PATH yet. Close this window and run install-windows.bat again.' }
  if (-not $py)         { Fail 'Python 3.12 not found. Close this window and run install-windows.bat again.' }

  if (Test-Path (Join-Path $App '.git')) {
    Say 'Updating existing copy...'; Run git @('-C', $App, 'pull', '--ff-only')
  } else {
    Say 'Downloading THYNKPDF...'; Run git @('clone', '--branch', 'main', $Repo, $App)
  }
  Set-Location $App

  Say 'Setting up the backend (Python)...'
  $venvPy = Join-Path $App '.venv\Scripts\python.exe'
  if (-not (Test-Path $venvPy)) { $pyExe = $py[0]; $pyArgs = @($py | Select-Object -Skip 1) + @('-m','venv','.venv'); Run $pyExe $pyArgs }
  Run $venvPy @('-m','pip','install','--upgrade','pip','-q')
  Run $venvPy @('-m','pip','install','-r','requirements.txt','-q')

  $envFile = Join-Path $App '.env'
  if (-not (Test-Path $envFile)) {
    Say 'Creating settings file (.env) with a random secret...'
    $bytes = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
    $data = (Join-Path $App 'data') -replace '\\','/'
    New-Item -ItemType Directory -Force -Path (Join-Path $App 'data') | Out-Null
    $lines = @("THYNKPDF_JWT_SECRET=$secret", "THYNKPDF_DATABASE_URL=sqlite:///$data/thynkpdf.db",
               "THYNKPDF_STORAGE_ROOT=$data/objects", 'THYNKPDF_CORS_ORIGINS=http://localhost:3000')
    [IO.File]::WriteAllLines($envFile, $lines)   # UTF-8 without BOM
  }
  Run $venvPy @('scripts\migrate.py')

  Say 'Setting up the web app (this can take a few minutes)...'
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
  Run 'npx.cmd' @('--yes', $Pnpm, 'install', '--config.minimumReleaseAge=0')
  $webEnv = Join-Path $App 'apps\web\.env.local'
  if (-not (Test-Path $webEnv)) { [IO.File]::WriteAllLines($webEnv, @('NEXT_PUBLIC_API_URL=http://localhost:8000')) }

  Say 'Done! Double-click start-windows.bat to open THYNKPDF.'
} catch {
  Fail $_.Exception.Message
}
