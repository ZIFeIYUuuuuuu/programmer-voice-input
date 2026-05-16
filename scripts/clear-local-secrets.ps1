param(
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$appDirs = @(
  (Join-Path $env:LOCALAPPDATA 'com.vibecoding.voiceinput'),
  (Join-Path $env:APPDATA 'com.vibecoding.voiceinput')
)

$repoReleaseDir = Join-Path (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path 'src-tauri\target\release'

$targets = foreach ($dir in $appDirs) {
  if (Test-Path -LiteralPath $dir) {
    Join-Path $dir 'EBWebView\Default\Local Storage'
    Join-Path $dir 'EBWebView\Default\Session Storage'
    Join-Path $dir 'EBWebView\Default\IndexedDB'
    Join-Path $dir '.cookies'
    Join-Path $dir 'settings.json'
    Join-Path $dir 'history.json'
    Join-Path $dir 'logs'
  }
}

if (Test-Path -LiteralPath $repoReleaseDir) {
  $targets += Join-Path $repoReleaseDir 'logs'
}

$existingTargets = $targets | Where-Object { Test-Path -LiteralPath $_ }

if (-not $existingTargets) {
  Write-Host 'No local Voice Input secrets or WebView storage found.'
  exit 0
}

foreach ($target in $existingTargets) {
  $resolved = Resolve-Path -LiteralPath $target
  $allowed = $false

  foreach ($dir in $appDirs) {
    if ((Test-Path -LiteralPath $dir) -and $resolved.Path.StartsWith((Resolve-Path -LiteralPath $dir).Path)) {
      $allowed = $true
      break
    }
  }

  if ((Test-Path -LiteralPath $repoReleaseDir) -and $resolved.Path.StartsWith((Resolve-Path -LiteralPath $repoReleaseDir).Path)) {
    $allowed = $true
  }

  if (-not $allowed) {
    throw "Refusing to remove path outside Voice Input app data: $($resolved.Path)"
  }

  if ($WhatIf) {
    Write-Host "Would remove $($resolved.Path)"
  } else {
    Remove-Item -LiteralPath $resolved.Path -Recurse -Force
    Write-Host "Removed $($resolved.Path)"
  }
}
