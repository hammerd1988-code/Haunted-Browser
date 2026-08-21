<#
.SYNOPSIS
  Launch Casper Browser against your local LM Studio.
#>
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  Casper Browser - launch" -ForegroundColor Cyan
Write-Host "  ========================" -ForegroundColor Cyan
Write-Host ""

# 1) Node.js present?
try {
    $node = node -v
    Write-Host "  [ok] Node.js $node" -ForegroundColor Green
} catch {
    Write-Host "  [!!] Node.js not found. Install from https://nodejs.org (LTS) then re-run." -ForegroundColor Red
    exit 1
}

# 2) Is LM Studio's local server up?
$lm = "http://127.0.0.1:1234"
try {
    $resp = Invoke-WebRequest -Uri "$lm/v1/models" -UseBasicParsing -TimeoutSec 3
    $models = ($resp.Content | ConvertFrom-Json).data.id
    if ($models) {
        Write-Host "  [ok] LM Studio reachable - models:" -ForegroundColor Green
        $models | ForEach-Object { Write-Host "       - $_" -ForegroundColor DarkGray }
    } else {
        Write-Host "  [!] LM Studio is up but no model is loaded. Load a chat model in LM Studio." -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [!] LM Studio not reachable at $lm" -ForegroundColor Yellow
    Write-Host "      Start it: LM Studio -> Developer tab -> Start server -> load a model." -ForegroundColor Yellow
    Write-Host "      (Casper will run in demo mode until then.)" -ForegroundColor DarkGray
}

# 3) Install deps if needed
if (-not (Test-Path "node_modules")) {
    Write-Host "  [..] Installing dependencies (first run)..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Host "  [!!] npm install failed." -ForegroundColor Red; exit 1 }
}

# 4) Launch
Write-Host "  [..] Launching Casper Browser..." -ForegroundColor Cyan
Write-Host ""
npm run electron
