$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'tools\Lifecycle.ps1')
$root=[OverlayLifecyclePaths]::Canonical($PSScriptRoot)
$mutex=Enter-OverlayLock
try {
 Stop-OverlayRuntime $root -Pause
 Set-OverlayLifecycle $root 'paused'
 @{ok=$true;state='paused';root=$root}|ConvertTo-Json -Compress
} catch {
 try{Set-OverlayLifecycle $root 'stop-failed' @{error=$_.Exception.Message}}catch{}
 throw
} finally {Exit-OverlayLock $mutex}
