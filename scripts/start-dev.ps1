$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Find-FirstExistingPath {
  param([string[]]$Paths)

  foreach ($Path in $Paths) {
    if (Test-Path $Path) {
      return $Path
    }
  }

  return $null
}

function Add-ToPathFront {
  param([string]$Path)

  if ($Path -and (Test-Path $Path)) {
    $env:Path = "$Path;$env:Path"
  }
}

$CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
Add-ToPathFront $CargoBin

$VsDevCmd = Find-FirstExistingPath @(
  "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat",
  "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat",
  "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat"
)

if ($VsDevCmd) {
  Write-Host "Loading Visual Studio build environment..." -ForegroundColor Cyan
  $VsEnv = cmd.exe /d /c "`"$VsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"
  foreach ($Line in $VsEnv) {
    $Index = $Line.IndexOf("=")
    if ($Index -gt 0) {
      [Environment]::SetEnvironmentVariable($Line.Substring(0, $Index), $Line.Substring($Index + 1), "Process")
    }
  }
}

$MsvcLinkBin = Find-FirstExistingPath @(
  "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64",
  "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\14.50.35717\bin\HostX64\x64"
)
Add-ToPathFront $MsvcLinkBin
Add-ToPathFront $CargoBin

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found in PATH. Install Node.js first."
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing npm dependencies..." -ForegroundColor Cyan
  npm install
}

Write-Host "Starting Voice Input in Tauri dev mode..." -ForegroundColor Green
npm run tauri dev
