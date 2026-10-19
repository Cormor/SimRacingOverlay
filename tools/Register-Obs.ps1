param([string]$Root=(Split-Path $PSScriptRoot),[string]$ConfigPath)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Discovery.ps1')
$lock=New-Object Threading.Mutex($false,'Local\SimRacingOverlay.ObsRegistration')
if(!$lock.WaitOne(0)){exit 0}
try {
 $cfg=Get-Content (Join-Path $Root 'runtime\integration.json') -Raw | ConvertFrom-Json
 if(!$ConfigPath){$ConfigPath=Get-ObsConfig $cfg.obsExe $cfg.obsConfig}
 $pending=Join-Path $Root 'runtime\obs-registration.pending'
 if(Get-Process obs64 -ErrorAction SilentlyContinue){[IO.File]::WriteAllText($pending,$ConfigPath);Write-Output 'OBS registration queued until OBS closes.';exit 0}
 $scenes=Join-Path $ConfigPath 'basic\scenes';$files=@(Get-ChildItem $scenes -Filter '*.json' -ErrorAction SilentlyContinue)
 if(!$files.Count){[IO.File]::WriteAllText($pending,$ConfigPath);Write-Output 'OBS scene collection not created yet; registration remains pending.';exit 0}
 $script=Join-Path $Root 'obs-overlay.lua';$backup=Join-Path $Root ('runtime\integration-backup\obs-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff'));$count=0
 foreach($f in $files){$data=Get-Content $f.FullName -Raw | ConvertFrom-Json
  if(!$data.PSObject.Properties['modules']){$data | Add-Member -NotePropertyName modules -NotePropertyValue ([pscustomobject]@{})}
  $entries=@();if($data.modules.PSObject.Properties['scripts-tool']){$entries=@($data.modules.'scripts-tool')}
  $existing=@($entries | Where-Object {[IO.Path]::GetFileName([string]$_.path) -eq 'obs-overlay.lua'})
  if($existing.Count -eq 1 -and $existing[0].path -eq $script){continue}
  # Replace only our own named script entry; other loaded scripts and scene settings remain intact.
  $entries=@($entries | Where-Object {[IO.Path]::GetFileName([string]$_.path) -ne 'obs-overlay.lua'});$entries+=@{path=$script;settings=@{}}
  if($data.modules.PSObject.Properties['scripts-tool']){$data.modules.'scripts-tool'=$entries}else{$data.modules | Add-Member -NotePropertyName 'scripts-tool' -NotePropertyValue $entries}
  New-Item -ItemType Directory -Force $backup | Out-Null;Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $backup $f.Name)
  $temp=$f.FullName+'.sro.tmp';[IO.File]::WriteAllText($temp,($data | ConvertTo-Json -Depth 100),(New-Object Text.UTF8Encoding($false)));[IO.File]::Replace($temp,$f.FullName,$null);$count++
 }
 if(Test-Path $pending){Remove-Item -LiteralPath $pending}
 [IO.File]::WriteAllText((Join-Path $Root 'runtime\obs-registration.json'),(@{registered=$true;collections=$files.Count;changed=$count} | ConvertTo-Json))
}finally{$lock.ReleaseMutex();$lock.Dispose()}
