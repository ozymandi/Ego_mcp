# Removes the Gemma4FigmaMcpDaemon scheduled task installed by
# install-autostart.ps1. Does not delete files; safe to re-install later.

$ErrorActionPreference = "Stop"

$TaskName = "Gemma4FigmaMcpDaemon"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Task '$TaskName' is not registered. Nothing to do."
    exit 0
}

# Stop the task if it's running.
if ($task.State -eq "Running") {
    Write-Host "Stopping task..."
    Stop-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 1
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed task '$TaskName'."
Write-Host "daemon.log left in place (delete it manually if you don't need it)."
