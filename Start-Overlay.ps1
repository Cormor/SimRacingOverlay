param([switch]$FromSimHub,[switch]$FromHost,[switch]$NoDesktop,[switch]$OpenLayout)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'tools\Lifecycle.ps1')
$root=[OverlayLifecyclePaths]::Canonical($PSScriptRoot)
if($OpenLayout -and $NoDesktop){throw 'Opening layout requires the desktop.'}
$mutex=Enter-OverlayLock
$ready=$false
try {
 New-Item -ItemType Directory -Force (Join-Path $root 'runtime')|Out-Null
 if(Test-Path -LiteralPath (Join-Path $root 'runtime\installing.json')){throw 'An overlay update has not finished. Complete that installation before starting.'}
 $paused=Join-Path $root 'runtime\autostart.paused'
 if(($FromSimHub -or $FromHost) -and (Test-Path -LiteralPath $paused)){@{ok=$true;state='paused';root=$root}|ConvertTo-Json -Compress;return}
 if(!$FromSimHub -and !$FromHost -and (Test-Path -LiteralPath $paused)){Remove-Item -LiteralPath $paused}
 foreach($pair in @(@('settings.json','settings.json'),@('runtime\desktop.json','desktop.json'),@('assets\layout.json','layout.json'))) {
  $dest=Join-Path $root $pair[0]
  if(!(Test-Path -LiteralPath $dest)){Copy-Item -LiteralPath (Join-Path $root ('defaults\'+$pair[1])) -Destination $dest}
 }
 $cfg=Read-OverlaySettings $root;$port=[int]$cfg.httpPort
 $bridge=Join-Path $root 'runtime\SimRacingBridge.exe';$existing=@(Get-OverlayProcesses $root 'bridge')
 $listeners=@(Get-OverlayListener $port);$ownedPids=@($existing.ProcessId)
 if(@($listeners|Where-Object {$_.OwningProcess -notin $ownedPids}).Count){throw "Port $port belongs to another process. Change the port explicitly or stop that process; settings were kept."}
 $started=$null
 try {
  if(!$existing.Count){$started=Start-Process -FilePath $bridge -WorkingDirectory (Split-Path $bridge) -WindowStyle Hidden -PassThru}
  $bridgeId=Wait-OverlayBridge $root $port $started
 } finally {if($started){$started.Dispose()}}
 if($cfg.ledObserver) {
  $observer=Join-Path $root 'runtime\MozaLedObserver.exe'
  if((Test-Path -LiteralPath $observer) -and !@(Get-OverlayProcesses $root 'observer').Count){Start-Process -FilePath $observer -WorkingDirectory $root -WindowStyle Hidden}
 }
 $desktopId=$null
 if(!$NoDesktop) {
  $desktop=@(Get-OverlayProcesses $root 'desktop')
  if($desktop.Count){$desktopId=[int]$desktop[0].ProcessId}else{
   $process=Start-Process -FilePath (Join-Path $root 'runtime\electron\electron.exe') -ArgumentList @('"'+(Join-Path $root 'desktop-main.js')+'"') -WorkingDirectory $root -PassThru
   try{$desktopId=$process.Id}finally{$process.Dispose()}
  }
  $desktopControl=Wait-OverlayDesktop $root $desktopId
 }
 Set-OverlayLifecycle $root 'running' @{bridgePid=$bridgeId;desktopPid=$desktopId;port=$port}
 $ready=$true
 if($OpenLayout){
  $requestFile=Join-Path $root 'runtime\desktop-control.json';$resultFile=Join-Path $root 'runtime\desktop-control-result.json'
  $requestId=[Guid]::NewGuid().ToString('N')
  try{
   Write-OverlayJson $requestFile @{id=$requestId;session=$desktopControl.session;pid=$desktopId;action='open-layout';expiresAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+5000}
   $clock=[Diagnostics.Stopwatch]::StartNew()
   do{
    try{$result=Get-Content -LiteralPath $resultFile -Raw|ConvertFrom-Json}catch{$result=$null}
    if($result.id -eq $requestId -and $result.session -eq $desktopControl.session){
     if($result.state -ne 'opened'){throw $result.error}
     break
    }
    Start-Sleep -Milliseconds 100
   }while($clock.Elapsed.TotalMilliseconds -lt 5250)
   if($result.id -ne $requestId -or $result.session -ne $desktopControl.session){throw 'The desktop did not confirm opening layout.'}
  }finally{
   foreach($file in @($requestFile,$resultFile)){
    try{$data=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json;if($data.id -eq $requestId){[IO.File]::Delete($file)}}catch{}
   }
  }
 }
 @{ok=$true;state='running';root=$root;port=$port;bridgePid=$bridgeId;desktopPid=$desktopId}|ConvertTo-Json -Compress
} catch {
 if(!$ready){try{Set-OverlayLifecycle $root 'error' @{error=$_.Exception.Message}}catch{}}
 throw
} finally {Exit-OverlayLock $mutex}
