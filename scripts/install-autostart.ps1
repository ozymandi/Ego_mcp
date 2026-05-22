# Registers a per-user Scheduled Task that keeps the Gemma 4 ↔ Figma MCP
# bridge daemon running. The task starts at user logon, runs hidden,
# restarts on failure, and writes logs to daemon.log in the project root.
#
# Usage (no admin required):
#   pwsh -File scripts/install-autostart.ps1
# Or:
#   powershell -ExecutionPolicy Bypass -File scripts/install-autostart.ps1

$ErrorActionPreference = "Stop"

$TaskName    = "Gemma4FigmaMcpDaemon"
$ProjectDir  = (Resolve-Path -Path (Join-Path $PSScriptRoot "..")).Path
$DaemonPath  = Join-Path $ProjectDir "dist\daemon.js"
$LogPath     = Join-Path $ProjectDir "daemon.log"

if (-not (Test-Path $DaemonPath)) {
    Write-Error "daemon.js not found at: $DaemonPath`nRun 'npm run build' first."
    exit 1
}

$NodeCmd = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $NodeCmd) {
    Write-Error "node was not found in PATH. Install Node.js, then re-run this script."
    exit 1
}
$NodePath = $NodeCmd.Source

Write-Host "Project dir : $ProjectDir"
Write-Host "Daemon path : $DaemonPath"
Write-Host "Node binary : $NodePath"
Write-Host "Log file    : $LogPath"
Write-Host ""

# Wrap the node invocation in PowerShell so we can hide the window and
# redirect stdout/stderr to daemon.log. We use Start-Process with
# -WindowStyle Hidden inside a hidden powershell to avoid any flash.
$Inner = @"
Set-Location -LiteralPath '$ProjectDir'
& '$NodePath' '$DaemonPath' *>> '$LogPath'
"@

$EncodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Inner))

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -EncodedCommand $EncodedCommand" `
    -WorkingDirectory $ProjectDir

$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -StartWhenAvailable `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)   # never time out

$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

# Replace any prior registration with the same name.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Removing existing task '$TaskName' before re-registering..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Description "Gemma 4 ↔ Figma MCP bridge daemon (auto-started at logon)." `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal | Out-Null

Write-Host "Registered task '$TaskName'."

# Start it right now so the user doesn't have to log out/in.
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

$state = (Get-ScheduledTask -TaskName $TaskName).State
Write-Host "Current state: $state"
Write-Host ""
Write-Host "Done. Inspect logs at: $LogPath"
Write-Host "Stop daemon (this session):  Stop-ScheduledTask -TaskName $TaskName"
Write-Host "Start it again:              Start-ScheduledTask -TaskName $TaskName"
Write-Host "Remove autostart:            pwsh -File scripts\uninstall-autostart.ps1"
