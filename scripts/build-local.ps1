# WP-9: local Windows installer build on the Windows host (full E2E path).
# Mirrors package-windows.yml exactly; run this in a Windows PowerShell where
# the repository is reachable (a C:\ git clone is recommended over the WSL UNC).
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-local.ps1
# Optional: npm run package:verify afterwards to install/launch/uninstall locally.
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host '==> building (CI-equivalent)'
& npm ci
& npm run build
& npm run typecheck
& npm run compliance
& npm run icons
& npm run package:win
& npm run release:manifest

$installer = Get-ChildItem -Path (Join-Path $repoRoot 'release') -Filter '*.exe' |
  Where-Object { $_.Name -match 'Setup' } |
  Select-Object -First 1
if (-not $installer) { throw 'no installer produced under release/' }
Write-Host "==> installer: $($installer.FullName)"
Write-Host 'Next: npm run verify:local  (real install/launch/uninstall check)'
