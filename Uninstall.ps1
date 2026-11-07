param([switch]$NoPause)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'tools\Lifecycle.ps1')
$root=[OverlayLifecyclePaths]::Canonical($PSScriptRoot)
$mutex=Enter-OverlayLock
try {
 $integrationFile=Join-Path $root 'runtime\integration.json'
 $cfg=if(Test-Path -LiteralPath $integrationFile){Get-Content -LiteralPath $integrationFile -Raw|ConvertFrom-Json}else{$null}
 $obsReceipt=Join-Path $root 'runtime\obs-registration.json';$registered=$null
 if(Test-Path -LiteralPath $obsReceipt){$registered=Get-Content -LiteralPath $obsReceipt -Raw|ConvertFrom-Json}
 $hasObs=$cfg -and $cfg.obsExe -and (!$registered -or $registered.state -ne 'removed')
 if($hasObs -and (Get-Process obs64 -ErrorAction SilentlyContinue)){throw 'Close OBS before removing its overlay integration. Nothing has been removed.'}
 $ownsSim=$false
 if($cfg.simHubExe){
  $hub=Split-Path $cfg.simHubExe;$pointer=Join-Path $hub 'SimRacingOverlay.path'
  if(Test-Path -LiteralPath $pointer){$ownsSim=[OverlayLifecyclePaths]::Same((Get-Content -LiteralPath $pointer -Raw).Trim(),$root)}
  if($ownsSim -and (Get-Process SimHubWPF -ErrorAction SilentlyContinue)){throw 'Close SimHub before removing its overlay plugin. Nothing has been removed.'}
 }
 Stop-OverlayRuntime $root -Pause
 Stop-OverlayWatcher $root
 Stop-OverlayPendingStarts $root
 if($hasObs){$null=& (Join-Path $root 'tools\Register-Obs.ps1') -Root $root -ConfigPath $cfg.obsConfig -Remove}
 if($ownsSim){
  $argsFile=Join-Path $root 'runtime\simhub-registration.json';Write-OverlayJson $argsFile @{root=$root;simHubRoot=$hub}
  try{& (Join-Path $root 'tools\Register-SimHub.ps1') -ArgumentsFile $argsFile -Remove}catch [UnauthorizedAccessException]{
   $process=Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $root 'tools\Register-SimHub.ps1')+'"'),'-ArgumentsFile',('"'+$argsFile+'"'),'-Remove')
   try{if($process.ExitCode -ne 0){throw 'SimHub integration removal did not finish.'}}finally{$process.Dispose()}
  }
 }
 $watcher=Join-Path $root 'runtime\SimRacingLauncher.exe';$run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
 $entry=(Get-ItemProperty -Path $run -ErrorAction SilentlyContinue).SimRacingOverlay
 if($entry -and (Test-OverlayLauncherEntry $entry $root)){Remove-ItemProperty -Path $run -Name SimRacingOverlay}
 $menu=Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\SimRacingOverlay';$shell=New-Object -ComObject WScript.Shell
 foreach($name in @('SimRacingOverlay.lnk','设备设置.lnk','卸载.lnk')){
  $file=Join-Path $menu $name
  if(Test-Path -LiteralPath $file){
   $link=$shell.CreateShortcut($file);$line='"'+$link.TargetPath+'" '+$link.Arguments
   $owned=(Test-OverlayLauncherEntry $line $root) -or [OverlayLifecyclePaths]::HasScript($link.Arguments,(Join-Path $root 'Setup.ps1')) -or [OverlayLifecyclePaths]::HasScript($link.Arguments,(Join-Path $root 'Uninstall.ps1'))
   if($owned){Remove-Item -LiteralPath $file}
  }
 }
 Set-OverlayLifecycle $root 'uninstalled'
 Write-Output 'Startup integration removed. Your program files, calibration, layout and downloaded faces are kept.'
} finally {Exit-OverlayLock $mutex}
if(!$NoPause){Read-Host 'Press Enter to close'}
