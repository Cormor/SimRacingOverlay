$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'Start-Overlay.ps1')
$cfg=Get-Content (Join-Path $PSScriptRoot 'settings.json') -Raw|ConvertFrom-Json
$url='http://127.0.0.1:'+$cfg.httpPort+'/setup'
for($i=0;$i -lt 30;$i++){try{$null=Invoke-WebRequest ($url.Replace('/setup','/state')) -UseBasicParsing -TimeoutSec 1;break}catch{Start-Sleep -Milliseconds 150}}
Start-Process $url
