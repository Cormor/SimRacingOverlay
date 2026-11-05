$ErrorActionPreference='Stop'
# Start returns only after the listener belongs to this bridge and /state is ready.
$result=& (Join-Path $PSScriptRoot 'Start-Overlay.ps1')|ConvertFrom-Json
if(!$result.ok -or $result.state -ne 'running'){throw 'The overlay did not become ready.'}
Start-Process ('http://127.0.0.1:'+$result.port+'/setup')
