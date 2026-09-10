<#
.SYNOPSIS
    Brings the GeoIntelliSense backend up after a Windows sign-in, and says so.

.DESCRIPTION
    Docker Desktop runs inside the interactive user session, not as a service,
    so the stack can only return once someone signs in. Worse, its own autostart
    is not dependable: on 2026-09-09 the machine rebooted at 14:20, the user
    signed in at 14:25, and Docker Desktop wrote no log entry at all - the Run
    key was present and enabled, AutoStart was true, and it simply never fired.
    The backend sat down for 2h47m and nothing anywhere said so.

    This script does not trust that mechanism. It waits for the engine, starts
    Docker Desktop itself if nothing else has, keeps retrying for a few minutes,
    then makes sure compose is up - and writes what happened to a log either
    way, so the next failure leaves evidence instead of silence.

    Installed as a shortcut in the user's Startup folder. Delete the shortcut to
    remove it; nothing else on the machine is touched. Safe to run by hand.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\ensure-backend.ps1
#>
[CmdletBinding()]
param(
    [string]$RepoPath,
    [int]$TimeoutMinutes = 10,
    [string]$LogPath = "$env:USERPROFILE\Documents\GeoIntelliSense-setup-logs\startup.log",
    [int]$MaxLogLines = 600
)

$ErrorActionPreference = 'Continue'

# $PSScriptRoot is not populated during parameter binding in Windows PowerShell
# 5.1, so the repo root is resolved here rather than as a param default.
if (-not $RepoPath) {
    $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $RepoPath = Split-Path -Parent $here
}

# A logon session normally has these; set them defensively because Docker
# Desktop fails to start with "unable to get 'ProgramData'" when it does not.
if (-not $env:ProgramData) { $env:ProgramData = 'C:\ProgramData' }
if (-not $env:ComSpec)     { $env:ComSpec     = 'C:\Windows\System32\cmd.exe' }

$DockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '{0} [{1,-5}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
    Write-Host $line
}

function Invoke-Native {
    # docker compose writes its progress to stderr. Under 2>&1 PowerShell wraps
    # each of those lines in an ErrorRecord and Out-String then decorates them
    # with "At <script>:<line> char:<n> ... NativeCommandError", which buries the
    # actual output. Unwrap to plain text and drop the "docker.exe : " prefix
    # PowerShell adds to the first stderr line.
    param([scriptblock]$Command)
    & $Command 2>&1 |
        ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" } } |
        ForEach-Object { ($_ -replace '^\s*docker(\.exe)?\s*:\s*', '').Trim() } |
        Where-Object { $_ }
}

function Test-Engine {
    # Exit code is the signal; the version string is only for the log.
    $null = & docker version --format '{{.Server.Version}}' 2>$null
    return ($LASTEXITCODE -eq 0)
}

Write-Log "--- ensure-backend starting (repo: $RepoPath) ---"
$bootedAt = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
Write-Log ("booted {0}, {1:N1} min ago" -f $bootedAt, ((Get-Date) - $bootedAt).TotalMinutes)

$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$launchedAt = $null
$engineUp = $false

while ((Get-Date) -lt $deadline) {
    if (Test-Engine) { $engineUp = $true; break }

    $running = Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue
    if (-not $running) {
        # Give any launch we already made three minutes before trying again,
        # so a slow start is not mistaken for a failed one.
        if (-not $launchedAt -or ((Get-Date) - $launchedAt).TotalMinutes -ge 3) {
            if (Test-Path $DockerDesktop) {
                Write-Log 'Docker Desktop is not running - starting it' 'WARN'
                Start-Process -FilePath $DockerDesktop -ErrorAction SilentlyContinue
                $launchedAt = Get-Date
            } else {
                Write-Log "Docker Desktop not found at $DockerDesktop" 'ERROR'
                break
            }
        }
    }
    Start-Sleep -Seconds 15
}

if (-not $engineUp) {
    Write-Log "Docker engine did not come up within $TimeoutMinutes min - backend is DOWN" 'ERROR'
    Write-Log '--- ensure-backend giving up ---'
    exit 1
}

$version = & docker version --format '{{.Server.Version}}' 2>$null
Write-Log "Docker engine responding (server $version)"

# restart:unless-stopped normally brings the containers back by itself, but this
# also recreates anything that was removed, and is a no-op when all is well.
Push-Location $RepoPath
$composeOut = Invoke-Native { docker compose up -d }
Pop-Location
foreach ($l in $composeOut) { Write-Log "compose: $l" }

# The gateway has no healthcheck of its own, so poll it rather than trusting
# "Up". First boot after a cold start can take a couple of minutes.
$healthy = $false
$healthDeadline = (Get-Date).AddMinutes(4)
while ((Get-Date) -lt $healthDeadline) {
    try {
        $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/health' -TimeoutSec 10 -UseBasicParsing
        if ($r.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
    Start-Sleep -Seconds 10
}

if ($healthy) {
    Write-Log 'gateway /health 200 - backend is UP'
} else {
    Write-Log 'gateway /health never answered 200 - check: docker compose logs gateway' 'ERROR'
}

Push-Location $RepoPath
$ps = Invoke-Native { docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' }
Pop-Location
foreach ($l in $ps) { Write-Log "ps: $l" }

# The phone reaches the stack through these, so a missing listener matters as
# much as a stopped container. tailscale serve config survives reboots, but
# check rather than assume.
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
if (Test-Path $ts) {
    $serve = & $ts serve status 2>&1 | Out-String
    foreach ($port in '8443', '8444') {
        if ($serve -match ":$port") { Write-Log "tailscale serve :$port present" }
        else { Write-Log "tailscale serve :$port MISSING - the phone cannot reach the backend" 'ERROR' }
    }
} else {
    Write-Log 'tailscale.exe not found - skipping serve check' 'WARN'
}

Write-Log '--- ensure-backend done ---'

# Keep the log readable rather than letting it grow without bound.
try {
    $lines = Get-Content -Path $LogPath -ErrorAction Stop
    if ($lines.Count -gt $MaxLogLines) {
        Set-Content -Path $LogPath -Value ($lines | Select-Object -Last $MaxLogLines) -Encoding UTF8
    }
} catch { }

if ($healthy) { exit 0 } else { exit 1 }
