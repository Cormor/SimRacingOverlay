param([switch]$FromSimHub,[switch]$FromHost,[switch]$NoDesktop)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
New-Item -ItemType Directory -Force (Join-Path $root 'runtime') | Out-Null
$paused=Join-Path $root 'runtime\autostart.paused'
if(($FromSimHub -or $FromHost) -and (Test-Path $paused)){exit 0}
if(!$FromSimHub -and !$FromHost -and (Test-Path $paused)){Remove-Item -LiteralPath $paused}
$mutex=New-Object Threading.Mutex($false,'Local\SimRacingOverlay.Start')
if(!$mutex.WaitOne(10000)){exit 0}
try {
 foreach($pair in @(@('settings.json','settings.json'),@('runtime\desktop.json','desktop.json'),@('assets\layout.json','layout.json'))){$dest=Join-Path $root $pair[0];if(!(Test-Path $dest)){Copy-Item (Join-Path $root ('defaults\'+$pair[1])) $dest}}
 $cfg=Get-Content (Join-Path $root 'settings.json') -Raw | ConvertFrom-Json
 $bridge=Join-Path $root 'runtime\SimRacingBridge.exe';$running=Get-CimInstance Win32_Process -Filter "Name='SimRacingBridge.exe'" | Where-Object {$_.ExecutablePath -eq $bridge}
 if(!$running){Start-Process -FilePath $bridge -WorkingDirectory (Split-Path $bridge) -WindowStyle Hidden}
 if($cfg.ledObserver){$observer=Join-Path $root 'runtime\MozaLedObserver.exe';if((Test-Path $observer) -and !(Get-CimInstance Win32_Process -Filter "Name='MozaLedObserver.exe'" | Where-Object {$_.ExecutablePath -eq $observer})){Start-Process $observer -WorkingDirectory $root -WindowStyle Hidden}}
 if(!$NoDesktop){$electron=Join-Path $root 'runtime\electron\electron.exe';$main=Join-Path $root 'desktop-main.js';if(!(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object {$_.ExecutablePath -eq $electron -and $_.CommandLine -like "*$main*"})){Start-Process $electron -ArgumentList @('"'+$main+'"') -WorkingDirectory $root}}
}catch{[IO.File]::WriteAllText((Join-Path $root 'runtime\startup-error.txt'),($_ | Out-String));throw}finally{$mutex.ReleaseMutex();$mutex.Dispose()}
