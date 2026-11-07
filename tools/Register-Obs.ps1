param([string]$Root=(Split-Path $PSScriptRoot),[string]$ConfigPath,[switch]$Remove)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Lifecycle.ps1')
. (Join-Path $PSScriptRoot 'Discovery.ps1')
$Root=[OverlayLifecyclePaths]::Canonical($Root)
$startLock=Enter-OverlayLock;$registrationLock=$null;$owned=$false
try {
 $registrationLock=[Threading.Mutex]::new($false,'Local\SimRacingOverlay.ObsRegistration')
 try{$owned=$registrationLock.WaitOne(30000)}catch [Threading.AbandonedMutexException]{$owned=$true}
 if(!$owned){throw 'Another OBS registration is still in progress.'}
 $cfg=Get-Content -LiteralPath (Join-Path $Root 'runtime\integration.json') -Raw|ConvertFrom-Json
 if(!$ConfigPath){$ConfigPath=Get-ObsConfig $cfg.obsExe $cfg.obsConfig}
 $ConfigPath=[OverlayLifecyclePaths]::Canonical($ConfigPath)
 $pending=Join-Path $Root 'runtime\obs-registration.pending'
 if(Get-Process obs64 -ErrorAction SilentlyContinue){
  if($Remove){throw 'Close OBS before removing its overlay script.'}
  Write-OverlayJson $pending @{root=$Root;configPath=$ConfigPath}
  @{state='pending';reason='OBS is running'}|ConvertTo-Json -Compress;return
 }
 $sceneDirectory=Join-Path $ConfigPath 'basic\scenes'
 $files=if(Test-Path -LiteralPath $sceneDirectory){@(Get-ChildItem -LiteralPath $sceneDirectory -Filter '*.json' -File)}else{@()}
 if(!$files.Count -and !$Remove){Write-OverlayJson $pending @{root=$Root;configPath=$ConfigPath};@{state='pending';reason='No OBS scene collection exists yet'}|ConvertTo-Json -Compress;return}
 $script=Join-Path $Root 'obs-overlay.lua';$changes=@()
 foreach($file in $files){
  $data=Get-Content -LiteralPath $file.FullName -Raw|ConvertFrom-Json
  if(!$data.PSObject.Properties['modules']){$data|Add-Member -NotePropertyName modules -NotePropertyValue ([pscustomobject]@{})}
  $entries=@();if($data.modules.PSObject.Properties['scripts-tool']){$entries=@($data.modules.'scripts-tool')}
  $matching=@($entries|Where-Object {$_.path -and [IO.Path]::IsPathRooted([string]$_.path) -and [OverlayLifecyclePaths]::Same([string]$_.path,$script)})
  if(($Remove -and !$matching.Count) -or (!$Remove -and $matching.Count -eq 1)){continue}
  $entries=@($entries|Where-Object {!($_.path -and [IO.Path]::IsPathRooted([string]$_.path) -and [OverlayLifecyclePaths]::Same([string]$_.path,$script))})
  if(!$Remove){$entry=if($matching.Count){$matching[0]}else{[pscustomobject]@{path=$script;settings=@{}}};$entries+=@($entry)}
  if($data.modules.PSObject.Properties['scripts-tool']){$data.modules.'scripts-tool'=$entries}else{$data.modules|Add-Member -NotePropertyName 'scripts-tool' -NotePropertyValue $entries}
  $changes+=@{file=$file.FullName;name=$file.Name;data=$data}
 }
 # Parse all collections before touching any. Only paths belonging to this
 # installation are changed; another script with the same basename is preserved.
 $backup=Join-Path $Root ('runtime\integration-backup\obs-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
 foreach($change in $changes){New-Item -ItemType Directory -Force $backup|Out-Null;Copy-Item -LiteralPath $change.file -Destination (Join-Path $backup $change.name);Write-OverlayJson $change.file $change.data}
 if(Test-Path -LiteralPath $pending){Remove-Item -LiteralPath $pending}
 $result=@{root=$Root;script=$script;configPath=$ConfigPath;state=$(if($Remove){'removed'}else{'installed'});collections=$files.Count;changed=$changes.Count}
 Write-OverlayJson (Join-Path $Root 'runtime\obs-registration.json') $result
 $result|ConvertTo-Json -Compress
} finally {if($registrationLock){if($owned){$registrationLock.ReleaseMutex()};$registrationLock.Dispose()};Exit-OverlayLock $startLock}
