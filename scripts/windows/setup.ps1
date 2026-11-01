<#
.SYNOPSIS
  One-time setup for the Redirect & Compatibility Checker on Windows 10/11.

.DESCRIPTION
  Checks Node.js, installs npm dependencies, downloads the Playwright browser
  engines and builds the app. Safe to run again after pulling updates.

.PARAMETER ChromiumOnly
  Download only Chromium (about 150 MB) instead of Chromium, Firefox and WebKit.

.PARAMETER SkipBuild
  Skip the production build (use "npm run dev" for development instead).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1
#>
[CmdletBinding()]
param(
  [switch]$ChromiumOnly,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root

function Write-Step([string]$text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Fail([string]$text) {
  Write-Host "`nSetup failed: $text" -ForegroundColor Red
  exit 1
}
function Invoke-Npm([string[]]$arguments) {
  & npm.cmd @arguments
  if ($LASTEXITCODE -ne 0) { Fail "npm $($arguments -join ' ') exited with code $LASTEXITCODE" }
}

Write-Step 'Checking Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Fail 'Node.js was not found. Install Node.js 22 LTS from https://nodejs.org/ (or run: winget install OpenJS.NodeJS.LTS), then open a new terminal and run this script again.'
}
$version = (& node --version).TrimStart('v')
$parts = $version.Split('.') | ForEach-Object { [int]$_ }
if ($parts[0] -lt 20 -or ($parts[0] -eq 20 -and $parts[1] -lt 19)) {
  Fail "Node.js $version is too old. Install Node.js 22 LTS (or at least 20.19) from https://nodejs.org/"
}
Write-Host "Node.js $version"
if (-not [Environment]::Is64BitOperatingSystem) {
  Write-Host 'Warning: 32-bit Windows is not supported by the browser engines.' -ForegroundColor Yellow
}

# Long paths inside node_modules can exceed MAX_PATH on older setups.
try {
  $longPaths = Get-ItemPropertyValue 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -ErrorAction Stop
  if ($longPaths -ne 1 -and $root.Path.Length -gt 60) {
    Write-Host "Tip: the project path is long and Windows long paths are disabled. If install fails, move the folder closer to the drive root (for example C:\checker)." -ForegroundColor Yellow
  }
} catch { }

Write-Step 'Installing dependencies (npm install)'
if (Test-Path (Join-Path $root 'package-lock.json')) { Invoke-Npm @('ci', '--no-audit', '--no-fund') }
else { Invoke-Npm @('install', '--no-audit', '--no-fund') }

Write-Step 'Preparing data folder and browser engines'
$setupArgs = @('run', 'setup')
if ($ChromiumOnly) { $setupArgs += @('--', '--chromium-only') }
Invoke-Npm $setupArgs

if (-not $SkipBuild) {
  Write-Step 'Building the app'
  Invoke-Npm @('run', 'build')
}

Write-Host "`nAll set. Start the app by double-clicking scripts\windows\start.cmd (or run: npm start)." -ForegroundColor Green
