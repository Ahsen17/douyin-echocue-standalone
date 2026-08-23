# T-PKG-001 / A-09: Windows install, launch, exit, no-residue, upgrade and
# uninstall verification for the packaged NSIS installer.
#
# Precondition: `npm run package:win` produced release/Echocue Setup *.exe.
# Runs entirely against a real Windows x64 session. Writes release/verify-results.json.
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $repoRoot 'release'
$installer = Get-ChildItem -Path $releaseDir -Filter '*.exe' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'Setup' } |
  Select-Object -First 1
if (-not $installer) { throw "No NSIS installer found under $releaseDir" }

$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Echocue'
$dataRoot = Join-Path $env:LOCALAPPDATA 'Echocue'
$appExe = Join-Path $installRoot 'Echocue.exe'
$uninstaller = Join-Path $installRoot 'Uninstall Echocue.exe'
$auditDb = Join-Path $dataRoot 'audit\audit.sqlite'
$resourcesDir = Join-Path $installRoot 'resources'

$BUNDLED = @(
  'assets\qdrant_windows.exe',
  'assets\douyinLive_windows.exe',
  'docs\06-data-interface\migrations\001_initial_schema.sql',
  'build\tray.png',
  'build\icon.png',
  'resources\qdrant-config.yaml'
)

function Run-Silent([string]$path, [string[]]$argsList) {
  $p = Start-Process -FilePath $path -ArgumentList $argsList -Wait -PassThru
  if ($p.ExitCode -ne 0) {
    throw "$path failed with exit code $($p.ExitCode)"
  }
}

# Launch the installed app with the graceful-exit smoke hook; returns exit code.
function Invoke-Smoke([string]$exe) {
  $p = Start-Process -FilePath $exe -ArgumentList '--smoke-quit' -PassThru
  if (-not $p.WaitForExit(60000)) {
    Stop-Process -Id $p.Id -Force
    throw 'app did not exit within 60s'
  }
  return $p.ExitCode
}

function Get-SidecarProcesses {
  Get-Process -Name 'qdrant_windows', 'douyinLive_windows' -ErrorAction SilentlyContinue
}

function Clear-DataRoot {
  if (Test-Path $dataRoot) {
    Remove-Item -Path $dataRoot -Recurse -Force
  }
}

$results = [ordered]@{ installer = $installer.Name; passed = $false }

try {
  # 1. one-click silent install to the per-user directory
  Run-Silent $installer.FullName @('/S')
  if (-not (Test-Path $appExe)) { throw "app not installed at $appExe" }
  $results.installDir = $installRoot
  $results.dataDir = $dataRoot

  # 2. sidecars / migration / icons are bundled (no runtime download needed)
  foreach ($rel in $BUNDLED) {
    if (-not (Test-Path (Join-Path $resourcesDir $rel))) {
      throw "missing bundled resource: $rel"
    }
  }
  $results.bundledResources = $BUNDLED

  # 3. fresh launch creates the audit store and exits cleanly (code 0)
  Clear-DataRoot
  $results.launchExitCode = Invoke-Smoke $appExe
  if ($results.launchExitCode -ne 0) {
    throw "smoke launch exited with code $($results.launchExitCode)"
  }
  if (-not (Test-Path $auditDb)) { throw 'audit.sqlite was not created on first launch' }
  $results.dataCreated = $true

  # 4. no sidecar processes left behind after graceful exit
  $orphans = Get-SidecarProcesses
  if ($orphans) {
    throw "orphan sidecar processes after exit: $($orphans.Name -join ', ')"
  }
  $results.noOrphanProcesses = $true

  # 5. upgrade: reinstall over existing data must preserve the audit store
  Run-Silent $installer.FullName @('/S')
  $results.upgradeLaunchExitCode = Invoke-Smoke $appExe
  if ($results.upgradeLaunchExitCode -ne 0) {
    throw "upgrade smoke launch exited with code $($results.upgradeLaunchExitCode)"
  }
  if (-not (Test-Path $auditDb)) { throw 'audit.sqlite lost after reinstall/upgrade' }
  $results.upgradeDataPreserved = $true

  # 6. uninstall removes the app but never the permanent audit data. NSIS
  # uninstallers self-spawn and the launched process exits before files are
  # gone, so poll for the install dir to disappear rather than checking at once.
  Run-Silent $uninstaller @('/S')
  $uninstallDeadline = (Get-Date).AddSeconds(60)
  while ((Test-Path $installRoot) -and (Get-Date) -lt $uninstallDeadline) {
    Start-Sleep -Milliseconds 500
  }
  if (Test-Path $installRoot) { throw "install dir still present after uninstall: $installRoot" }
  $orphansAfter = Get-SidecarProcesses
  if ($orphansAfter) {
    throw "orphan sidecar processes after uninstall: $($orphansAfter.Name -join ', ')"
  }
  if (-not (Test-Path $auditDb)) { throw 'audit data must survive uninstall (permanent audit)' }
  $results.uninstalled = $true
  $results.uninstallDataPreserved = $true

  $results.passed = $true
  Write-Host 'win-install-verify: PASSED'
} catch {
  $results.error = $_.Exception.Message
  Write-Error $_
  $script:exitCode = 1
} finally {
  $jsonPath = Join-Path $releaseDir 'verify-results.json'
  $results | ConvertTo-Json -Depth 5 | Set-Content -Path $jsonPath -Encoding utf8
  Write-Host "wrote $jsonPath"
}

exit $script:exitCode
