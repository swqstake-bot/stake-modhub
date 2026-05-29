# Stake Mod Hub — Dist mit fertiger Windows-EXE (portable)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$AppName = 'Stake Mod Hub'
$pkg = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
$Version = $pkg.version
$OutBase = Join-Path $Root 'dist'
$Stage = Join-Path $OutBase '_stage'
$PackOut = Join-Path $OutBase 'packager-out'
$FinalName = "Stake-ModHub-v$Version-Windows"
$FinalDir = Join-Path $OutBase $FinalName
$exclude = @('node_modules', 'dist', 'versand', 'release', '.git')

Write-Host "==> Stake Mod Hub Dist EXE ($Version)"

if (Test-Path $OutBase) {
  Get-ChildItem $OutBase -Force | ForEach-Object {
    if ($_.Name -ne 'packager-out') {
      Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}
New-Item -ItemType Directory -Path $Stage, $PackOut, $FinalDir -Force | Out-Null

Get-ChildItem $Root -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
  Copy-Item $_.FullName -Destination (Join-Path $Stage $_.Name) -Recurse -Force
}

$dgStage = Join-Path $Stage 'Datengrube'
if (Test-Path $dgStage) { Remove-Item $dgStage -Recurse -Force }
New-Item -ItemType Directory -Path $dgStage -Force | Out-Null
$defaults = Join-Path $Stage 'defaults'
foreach ($f in @('ChatBlueprints.txt', 'MuteBlueprints.txt', 'WarnBlueprints.txt', 'RhBlueprints.txt')) {
  $src = Join-Path $defaults $f
  if (Test-Path $src) { Copy-Item $src (Join-Path $dgStage $f) -Force }
}

Push-Location $Stage
try {
  if (-not (Test-Path 'node_modules\electron\path.txt')) {
    Write-Host '==> npm install…'
    $prevEa = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    npm install --no-fund --no-audit 2>&1 | ForEach-Object { Write-Host $_ }
    $ErrorActionPreference = $prevEa
    if ($LASTEXITCODE -ne 0) { throw "npm install fehlgeschlagen (Exit $LASTEXITCODE)" }
  }
  Write-Host '==> Electron-Packager (win32 x64)…'
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & npx --yes @electron/packager@20 . $AppName `
    --platform=win32 --arch=x64 `
    --out=$PackOut --overwrite 2>&1 | ForEach-Object { Write-Host $_ }
  $ErrorActionPreference = $prevEa
  if ($LASTEXITCODE -ne 0) { throw "electron-packager fehlgeschlagen (Exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

$packed = Get-ChildItem $PackOut -Directory | Where-Object { $_.Name -like '*win32*' } | Select-Object -First 1
if (-not $packed) { throw 'Packager hat keinen Ordner erzeugt.' }

if (Test-Path $FinalDir) { Remove-Item $FinalDir -Recurse -Force }
Copy-Item $packed.FullName $FinalDir -Recurse -Force

$appRes = Join-Path $FinalDir 'resources\app\Datengrube'
if (-not (Test-Path $appRes)) { New-Item -ItemType Directory -Path $appRes -Force | Out-Null }
Get-ChildItem $appRes -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
foreach ($f in @('ChatBlueprints.txt', 'MuteBlueprints.txt', 'WarnBlueprints.txt', 'RhBlueprints.txt')) {
  $src = Join-Path $defaults $f
  if (Test-Path $src) { Copy-Item $src (Join-Path $appRes $f) -Force }
}

$exeName = "$AppName.exe"
@"
@echo off
title Stake Mod Hub
cd /d "%~dp0"
if not exist "$exeName" (
  echo FEHLER: $exeName fehlt. ZIP komplett entpacken.
  pause
  exit /b 1
)
start "" "$exeName"
"@ | Set-Content (Join-Path $FinalDir 'START.bat') -Encoding ASCII

@"
Stake Mod Hub v$Version — fertige App (Windows)
==============================================

START
  1. ZIP entpacken
  2. START.bat oder $exeName doppelklicken
  3. SmartScreen: Weitere Informationen -> Trotzdem ausfuehren

NICHT noetig
  - Node.js
  - npm start

EINRICHTUNG
  Settings -> Stake Mirror -> API-Key -> Login

HTTP 403 (VPN)
  Settings -> Cookies aktualisieren -> Stake kurz oeffnen -> Fenster schliessen -> Login

"@ | Set-Content (Join-Path $FinalDir 'LIEST-MICH-ZUERST.txt') -Encoding UTF8

$zipPath = Join-Path $OutBase "$FinalName.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Write-Host '==> ZIP erstellen…'
Compress-Archive -Path $FinalDir -DestinationPath $zipPath -Force

Remove-Item $Stage -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'Fertig:'
Write-Host "  Ordner: $FinalDir"
Write-Host "  EXE:    $(Join-Path $FinalDir $exeName)"
Write-Host "  ZIP:    $zipPath"
Write-Host ''
