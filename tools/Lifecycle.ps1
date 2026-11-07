# Shared by the program's own start/stop/install entry points; no background work.
if(-not ('OverlayLifecyclePaths' -as [type])) { Add-Type -Path (Join-Path (Split-Path $PSScriptRoot) 'runtime\OverlayLifecycle.dll') }

function Write-OverlayJson([string]$File,$Value) {
 $temp=$File+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
 try {
  [IO.File]::WriteAllText($temp,($Value|ConvertTo-Json -Depth 100),[Text.UTF8Encoding]::new($false))
  if([IO.File]::Exists($File)){[IO.File]::Replace($temp,$File,[NullString]::Value)}else{[IO.File]::Move($temp,$File)}
 } finally { if([IO.File]::Exists($temp)){[IO.File]::Delete($temp)} }
}
function Enter-OverlayLock {
 $mutex=[Threading.Mutex]::new($false,'Local\SimRacingOverlay.Start')
 try {
  $owned=$false
  try {$owned=$mutex.WaitOne(30000)} catch [Threading.AbandonedMutexException] {$owned=$true}
  if(!$owned){throw 'Another overlay start, stop or update is still in progress.'}
  return $mutex
 } catch {$mutex.Dispose();throw}
}
function Exit-OverlayLock($Mutex) {if($Mutex){try{$Mutex.ReleaseMutex()}finally{$Mutex.Dispose()}}}
function Get-OverlayProcesses([string]$Root,[string]$Kind) {
 $relative=switch($Kind){'bridge'{'runtime\SimRacingBridge.exe'}'desktop'{'runtime\electron\electron.exe'}'observer'{'runtime\MozaLedObserver.exe'}'watcher'{'runtime\SimRacingLauncher.exe'}default{throw 'Unknown overlay process kind.'}}
 $exe=Join-Path $Root $relative;$name=[IO.Path]::GetFileName($exe)
 foreach($item in @([OverlayLifecyclePaths]::Processes($exe,($Kind -in @('desktop','watcher'))))) {
  if(!$item.ExecutablePath){continue}
  try {
   if(![OverlayLifecyclePaths]::Same($item.ExecutablePath,$exe)){continue}
   if($Kind -eq 'desktop' -and ![OverlayLifecyclePaths]::HasScript($item.CommandLine,(Join-Path $Root 'desktop-main.js'))){continue}
   if($Kind -eq 'watcher' -and ![OverlayLifecyclePaths]::Same([OverlayLifecyclePaths]::LauncherRoot($item.CommandLine),$Root)){continue}
   $item
  } catch [IO.FileNotFoundException] { } catch [IO.DirectoryNotFoundException] { }
 }
}
function Read-OverlaySettings([string]$Root) {
 $cfg=Get-Content -Encoding UTF8 -LiteralPath (Join-Path $Root 'settings.json') -Raw|ConvertFrom-Json
 $port=0
 if(![int]::TryParse([string]$cfg.httpPort,[ref]$port) -or $port -lt 1024 -or $port -gt 65534){throw 'settings.json httpPort must be an integer from 1024 to 65534.'}
 return $cfg
}
function Get-OverlayListener([int]$Port) {
 # Native owner table retains port ownership checks without CIM startup.
 @([OverlayLifecyclePaths]::Listeners($Port))
}
function Wait-OverlayBridge([string]$Root,[int]$Port,[Diagnostics.Process]$Started=$null) {
 $clock=[Diagnostics.Stopwatch]::StartNew();$last='The bridge has not opened its HTTP listener.'
 while($clock.Elapsed.TotalSeconds -lt 20) {
  if($Started -and $Started.HasExited){throw ('The bridge exited before becoming ready (exit '+$Started.ExitCode+').')}
  $owned=@(Get-OverlayProcesses $Root 'bridge');$pids=@($owned.ProcessId)
  $listeners=@(Get-OverlayListener $Port)
  if(@($listeners|Where-Object {$_.OwningProcess -notin $pids}).Count){throw "Port $Port belongs to another process. The configured port was not changed."}
  if($listeners.Count -and $owned.Count) {
   try {
    $request=[Net.HttpWebRequest]::Create('http://127.0.0.1:'+$Port+'/state');$request.Proxy=$null;$request.Timeout=750;$request.ReadWriteTimeout=750
    $response=$request.GetResponse()
    try{$reader=[IO.StreamReader]::new($response.GetResponseStream());try{$state=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}}finally{$response.Dispose()}
    if([string]$state.configToken -notmatch '^[a-fA-F0-9]{32}$'){throw 'The bridge returned an invalid state response.'}
    return [int]$listeners[0].OwningProcess
   } catch {$last=$_.Exception.Message}
  }
  Start-Sleep -Milliseconds 150
 }
 throw ('The bridge did not become ready: '+$last)
}
function Set-OverlayLifecycle([string]$Root,[string]$State,$Details=@{}) {
 $value=[ordered]@{root=[OverlayLifecyclePaths]::Canonical($Root);state=$State;time=[DateTime]::UtcNow.ToString('O')}
 foreach($key in $Details.Keys){$value[$key]=$Details[$key]}
 Write-OverlayJson (Join-Path $Root 'runtime\lifecycle-state.json') $value
}
function Stop-OverlayDesktop([string]$Root) {
 foreach($item in @(Get-OverlayProcesses $Root 'desktop')) {
  try{$process=[Diagnostics.Process]::GetProcessById($item.ProcessId)}catch [ArgumentException]{continue}
  $requestFile=Join-Path $Root 'runtime\desktop-control.json';$resultFile=Join-Path $Root 'runtime\desktop-control-result.json'
  $requestId=[Guid]::NewGuid().ToString('N');$sent=$false
  try {
   $clock=[Diagnostics.Stopwatch]::StartNew();$status=$null
   while(!$process.HasExited -and $clock.Elapsed.TotalSeconds -lt 5) {
    try{$status=Get-Content -Encoding UTF8 -LiteralPath (Join-Path $Root 'runtime\desktop-status.json') -Raw|ConvertFrom-Json}catch{$status=$null}
    if($status.control.pid -eq $item.ProcessId -and $status.control.session -match '^[a-f0-9]{32}$'){break}
    Start-Sleep -Milliseconds 100
   }
   if($process.HasExited){continue}
   if(!$status -or $status.control.pid -ne $item.ProcessId -or $status.control.session -notmatch '^[a-f0-9]{32}$') {throw 'This desktop has no current save-and-close endpoint. Finish editing and close it before updating.'}
   Write-OverlayJson $requestFile @{id=$requestId;session=$status.control.session;pid=[int]$item.ProcessId;action='quit';expiresAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+25000};$sent=$true
   $clock.Restart()
   while(!$process.WaitForExit(100)) {
    if([IO.File]::Exists($resultFile)) {
     try{$result=Get-Content -Encoding UTF8 -LiteralPath $resultFile -Raw|ConvertFrom-Json}catch{$result=$null}
     if($result.id -eq $requestId -and $result.session -eq $status.control.session -and $result.state -eq 'cancelled'){throw ('The desktop kept the current edit open: '+$result.error)}
    }
    if($clock.Elapsed.TotalSeconds -ge 30){throw 'The desktop did not confirm a normal close. No process was forcibly terminated; the close request has expired.'}
   }
  } finally {
   $process.Dispose()
   if($sent){foreach($file in @($requestFile,$resultFile)){if([IO.File]::Exists($file)){try{$data=Get-Content -Encoding UTF8 -LiteralPath $file -Raw|ConvertFrom-Json;if($data.id -eq $requestId){[IO.File]::Delete($file)}}catch{}}}}
  }
 }
}
function Stop-OverlayRuntime([string]$Root,[switch]$Pause) {
 Stop-OverlayDesktop $Root
 if($Pause){Write-OverlayJson (Join-Path $Root 'runtime\autostart.paused') @{paused=$true}}
 foreach($kind in @('bridge','observer')) {
  foreach($item in @(Get-OverlayProcesses $Root $kind)) {
   try{$process=[Diagnostics.Process]::GetProcessById($item.ProcessId)}catch [ArgumentException]{continue}
   try{if(!$process.HasExited){$process.Kill()};if(!$process.WaitForExit(10000)){throw ('The '+$kind+' process did not stop.')}}finally{$process.Dispose()}
  }
 }
}

function Test-OverlayLauncherEntry([string]$Line,[string]$Root) {
 $arguments=[OverlayLifecyclePaths]::Arguments($Line)
 return $arguments.Length -gt 0 -and [IO.Path]::IsPathRooted($arguments[0]) -and [OverlayLifecyclePaths]::Same($arguments[0],(Join-Path $Root 'runtime\SimRacingLauncher.exe')) -and [OverlayLifecyclePaths]::Same([OverlayLifecyclePaths]::LauncherRoot($Line),$Root)
}

function Stop-OverlayWatcher([string]$Root) {
 foreach($item in @(Get-OverlayProcesses $Root 'watcher')) {
  try{$process=[Diagnostics.Process]::GetProcessById($item.ProcessId)}catch [ArgumentException]{continue}
  try{if(!$process.HasExited){$process.Kill()};if(!$process.WaitForExit(10000)){throw 'The overlay startup watcher did not stop.'}}finally{$process.Dispose()}
 }
}
function Stop-OverlayPendingStarts([string]$Root) {
 # A pre-upgrade launcher may already have a PowerShell request waiting on our
 # lock. Retire those old script instances before replacing their implementation.
 foreach($item in @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'")) {
  if($item.ProcessId -eq $PID -or ![OverlayLifecyclePaths]::HasScript($item.CommandLine,(Join-Path $Root 'Start-Overlay.ps1'))){continue}
  try{$process=[Diagnostics.Process]::GetProcessById($item.ProcessId)}catch [ArgumentException]{continue}
  try{if(!$process.HasExited){$process.Kill()};if(!$process.WaitForExit(10000)){throw 'An old overlay start request did not stop.'}}finally{$process.Dispose()}
 }
}
function Copy-OverlayProgramFile([string]$Source,[string]$Target) {
 $temp=$Target+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
 try{Copy-Item -LiteralPath $Source -Destination $temp;if([IO.File]::Exists($Target)){[IO.File]::Replace($temp,$Target,[NullString]::Value)}else{[IO.File]::Move($temp,$Target)}}finally{if([IO.File]::Exists($temp)){[IO.File]::Delete($temp)}}
}

function Test-OverlayShortcut($Link,[string]$Root) {
 $line='"'+$Link.TargetPath+'" '+$Link.Arguments
 return (Test-OverlayLauncherEntry $line $Root) -or [OverlayLifecyclePaths]::HasScript($Link.Arguments,(Join-Path $Root 'Setup.ps1')) -or [OverlayLifecyclePaths]::HasScript($Link.Arguments,(Join-Path $Root 'Uninstall.ps1'))
}
function Wait-OverlayDesktop([string]$Root,[int]$ProcessId) {
 $process=[Diagnostics.Process]::GetProcessById($ProcessId);$clock=[Diagnostics.Stopwatch]::StartNew()
 try {
  while($clock.Elapsed.TotalSeconds -lt 20){
   if($process.HasExited){throw ('The desktop exited before becoming ready (exit '+$process.ExitCode+').')}
   try{$status=Get-Content -Encoding UTF8 -LiteralPath (Join-Path $Root 'runtime\desktop-status.json') -Raw|ConvertFrom-Json}catch{$status=$null}
   if($status.control.pid -eq $ProcessId -and $status.control.session -match '^[a-f0-9]{32}$' -and $status.control.ready -eq $true){return $status.control}
   Start-Sleep -Milliseconds 100
  }
  throw 'The bridge is ready, but the desktop did not finish loading. Its process was kept for diagnosis.'
 }finally{$process.Dispose()}
}
