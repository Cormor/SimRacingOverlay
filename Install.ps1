param([string]$InstallPath=(Join-Path $env:LOCALAPPDATA 'SimRacingOverlay'),[string]$SimHubPath,[string]$ObsPath,[string]$ObsConfig,[switch]$NoLaunch,[switch]$NoAutostart,[switch]$NoShortcuts)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'tools\Lifecycle.ps1')
. (Join-Path $PSScriptRoot 'tools\Discovery.ps1')
$source=[OverlayLifecyclePaths]::Canonical($PSScriptRoot)
$destination=[OverlayLifecyclePaths]::Canonical($InstallPath)
if($destination -eq [IO.Path]::GetPathRoot($destination)){throw 'Do not install into a drive root.'}
$manifestFile=Join-Path $source 'PAYLOAD.json'
if(!(Test-Path -LiteralPath $manifestFile)){throw 'Use the extracted Release package. PAYLOAD.json is missing.'}
$payload=Get-Content -LiteralPath $manifestFile -Raw|ConvertFrom-Json
if(!$payload.Count){throw 'The package manifest is empty.'}
$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach($item in $payload){
 $file=[OverlayLifecyclePaths]::Canonical((Join-Path $source $item.path));$target=[OverlayLifecyclePaths]::Canonical((Join-Path $destination $item.path))
 if(!$file.StartsWith($source+'\',[StringComparison]::OrdinalIgnoreCase) -or !$target.StartsWith($destination+'\',[StringComparison]::OrdinalIgnoreCase) -or !$seen.Add($target)){throw ('Invalid or duplicate package path: '+$item.path)}
 $normalized=$target.Substring($destination.Length+1).Replace('\','/')
 if($normalized -in @('settings.json','assets/layout.json','runtime/desktop.json') -or $normalized -like 'runtime/desktop-profile/*'){throw 'The package must not overwrite user settings.'}
 if(!(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $item.sha256){throw ('Package integrity check failed: '+$item.path)}
}
# Resolve integrations and settings before changing the installation.
$sim=Find-Application 'SimHub' $SimHubPath;$obs=Find-Application 'OBS' $ObsPath
$integration=[ordered]@{root=$destination;simHubExe=$sim;obsExe=$obs;obsConfig=(Get-ObsConfig $obs $ObsConfig);simHubState='not-found';obsState='not-found'}
$settingsFile=Join-Path $destination 'settings.json'
if(Test-Path -LiteralPath $settingsFile){$settings=Read-OverlaySettings $destination}else{$settings=Read-OverlaySettings (Join-Path $source 'defaults')}
if(!$NoLaunch){$ownedPids=@((Get-OverlayProcesses $destination 'bridge').ProcessId);if(@(Get-OverlayListener ([int]$settings.httpPort)|Where-Object {$_.OwningProcess -notin $ownedPids}).Count){throw 'The configured HTTP port belongs to another process. Choose the port explicitly before installation.'}}
if($sim){
 $existingPlugin=Join-Path (Split-Path $sim) 'SimRacingOverlay.SimHub.dll'
 if((Test-Path -LiteralPath $existingPlugin) -and (Get-FileHash -LiteralPath $existingPlugin).Hash -ne (Get-FileHash -LiteralPath (Join-Path $source 'runtime\SimRacingOverlay.SimHub.dll')).Hash -and (Get-Process SimHubWPF -ErrorAction SilentlyContinue)){throw 'Close SimHub before upgrading its overlay plugin. The installation was not changed.'}
}
$packageHash=(Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
$bootstrap=@('src/LifecyclePaths.cs','tools/Lifecycle.ps1','Start-Overlay.ps1')
foreach($name in $bootstrap){if(!$seen.Contains([OverlayLifecyclePaths]::Canonical((Join-Path $destination $name)))){throw ('The package is missing its startup dependency: '+$name)}}
function Assert-InstallDestination {
 if(!(Test-Path -LiteralPath $destination)){return}
 $marker=Join-Path $destination 'runtime\installing.json'
 if(Test-Path -LiteralPath $marker){
  $previous=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json
  if($previous.application -ne 'SimRacingOverlay' -or ![OverlayLifecyclePaths]::Same($previous.destination,$destination) -or $previous.packageSha256 -ne $packageHash){throw 'This directory contains an unfinished installation from another package. Resume it with that release package.'}
  return
 }
 $entries=@(Get-ChildItem -LiteralPath $destination -Force)
 if(!$entries.Count -or ($entries.Count -eq 1 -and $entries[0].Name -eq 'runtime' -and $entries[0].PSIsContainer -and !@(Get-ChildItem -LiteralPath $entries[0].FullName -Force).Count)){return}
 $oldManifest=Join-Path $destination 'PAYLOAD.json'
 if((Test-Path -LiteralPath (Join-Path $destination 'VERSION')) -and (Test-Path -LiteralPath $oldManifest)){
  $old=Get-Content -LiteralPath $oldManifest -Raw|ConvertFrom-Json
  $oldNames=@($old|ForEach-Object {([string]$_.path).Replace('\','/')})
  $identity=@('Start-Overlay.ps1','runtime/SimRacingBridge.exe','runtime/SimRacingLauncher.exe')
  if(!@($identity|Where-Object {$_ -notin $oldNames -or !(Test-Path -LiteralPath (Join-Path $destination $_) -PathType Leaf)}).Count){return}
 }
 throw 'The destination contains files that do not belong to a released SimRacingOverlay installation. Choose another folder.'
}
$mutex=Enter-OverlayLock;$committed=$false;$beganUpdate=$false;$failures=[Collections.Generic.List[string]]::new()
try {
 Assert-InstallDestination
 # Do not silently take another installation's external startup ownership.
 $run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
 $existingRun=(Get-ItemProperty -Path $run -ErrorAction SilentlyContinue).SimRacingOverlay
 if(!$NoAutostart -and $existingRun -and !(Test-OverlayLauncherEntry $existingRun $destination)){throw 'Another overlay installation owns the Windows startup entry. Select that installation directory or remove its integration first.'}
 if($sim){$pointer=Join-Path (Split-Path $sim) 'SimRacingOverlay.path';if((Test-Path -LiteralPath $pointer) -and ![OverlayLifecyclePaths]::Same((Get-Content -LiteralPath $pointer -Raw).Trim(),$destination)){throw 'Another overlay installation owns the SimHub plugin. Select its installation directory or remove its integration first.'}}
 if(!$NoShortcuts){
  $menu=Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\SimRacingOverlay';$shell=New-Object -ComObject WScript.Shell
  foreach($name in @('SimRacingOverlay.lnk','设备设置.lnk','卸载.lnk')){$file=Join-Path $menu $name;if(Test-Path -LiteralPath $file){$link=$shell.CreateShortcut($file);if(!(Test-OverlayShortcut $link $destination)){throw 'Another installation owns an overlay shortcut. Select its installation directory or remove its shortcuts first.'}}}
 }
 New-Item -ItemType Directory -Force (Join-Path $destination 'runtime')|Out-Null
 Stop-OverlayRuntime $destination
 Stop-OverlayWatcher $destination
 $installing=Join-Path $destination 'runtime\installing.json'
 Write-OverlayJson $installing @{application='SimRacingOverlay';packageSha256=$packageHash;source=$source;destination=$destination;version=(Get-Content -LiteralPath (Join-Path $source 'VERSION') -Raw).Trim()}
 $beganUpdate=$true
 if(![OverlayLifecyclePaths]::Same($source,$destination)){
  foreach($name in $bootstrap){$target=Join-Path $destination $name;New-Item -ItemType Directory -Force (Split-Path $target)|Out-Null;Copy-OverlayProgramFile (Join-Path $source $name) $target}
  Stop-OverlayPendingStarts $destination
  foreach($item in $payload){$target=Join-Path $destination $item.path;New-Item -ItemType Directory -Force (Split-Path $target)|Out-Null;Copy-OverlayProgramFile (Join-Path $source $item.path) $target}
  Copy-OverlayProgramFile $manifestFile (Join-Path $destination 'PAYLOAD.json')
 }
 Stop-OverlayPendingStarts $destination
 foreach($pair in @(@('settings.json','settings.json'),@('runtime\desktop.json','desktop.json'),@('assets\layout.json','layout.json'))){$target=Join-Path $destination $pair[0];if(!(Test-Path -LiteralPath $target)){Copy-Item -LiteralPath (Join-Path $destination ('defaults\'+$pair[1])) -Destination $target}}
 Write-OverlayJson (Join-Path $destination 'runtime\integration.json') $integration
 # A complete package may run even if an optional external integration needs attention.
 Remove-Item -LiteralPath $installing;$committed=$true
 if($sim){
  $argsFile=Join-Path $destination 'runtime\simhub-registration.json';Write-OverlayJson $argsFile @{root=$destination;simHubRoot=(Split-Path $sim)}
  try{
   try{& (Join-Path $destination 'tools\Register-SimHub.ps1') -ArgumentsFile $argsFile}catch [UnauthorizedAccessException]{
    $process=Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $destination 'tools\Register-SimHub.ps1')+'"'),'-ArgumentsFile',('"'+$argsFile+'"'))
    try{if($process.ExitCode -ne 0){throw 'SimHub integration elevation failed.'}}finally{$process.Dispose()}
   };$integration.simHubState='installed'
  }catch{$integration.simHubState='failed';$failures.Add('SimHub: '+$_.Exception.Message)}
 }
 if($obs){try{$registration=& (Join-Path $destination 'tools\Register-Obs.ps1') -Root $destination -ConfigPath $integration.obsConfig|ConvertFrom-Json;$integration.obsState=$registration.state}catch{$integration.obsState='failed';$failures.Add('OBS: '+$_.Exception.Message)}}
 Write-OverlayJson (Join-Path $destination 'runtime\integration.json') $integration
 $watcher=Join-Path $destination 'runtime\SimRacingLauncher.exe';$run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
 if(!$NoAutostart){New-Item -Path $run -Force|Out-Null;Set-ItemProperty -Path $run -Name SimRacingOverlay -Value ('"'+$watcher+'" --watch --root "'+$destination+'"')}
 else{$entry=(Get-ItemProperty -Path $run -ErrorAction SilentlyContinue).SimRacingOverlay;if($entry -and (Test-OverlayLauncherEntry $entry $destination)){Remove-ItemProperty -Path $run -Name SimRacingOverlay}}
 if(!$NoShortcuts){
  $menu=Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\SimRacingOverlay';New-Item -ItemType Directory -Force $menu|Out-Null;$shell=New-Object -ComObject WScript.Shell
  foreach($entry in @(@('SimRacingOverlay',$watcher,('--root "'+$destination+'"')),@('设备设置','powershell.exe',('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $destination 'Setup.ps1')+'"')),@('卸载','powershell.exe',('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $destination 'Uninstall.ps1')+'"')))){
   $link=$shell.CreateShortcut((Join-Path $menu ($entry[0]+'.lnk')));$link.TargetPath=$entry[1];$link.Arguments=$entry[2];$link.WorkingDirectory=$destination;$link.Save()
  }
 }
 if($NoLaunch){Write-OverlayJson (Join-Path $destination 'runtime\autostart.paused') @{paused=$true}}
 else{& (Join-Path $destination 'Setup.ps1');if(!$NoAutostart){Start-Process -FilePath $watcher -ArgumentList @('--watch','--root',('"'+$destination+'"')) -WorkingDirectory $destination}}
 Write-Output ('Installed: '+$destination)
 Write-Output ('SimHub: '+$integration.simHubState+'; OBS: '+$integration.obsState)
 if($failures.Count){throw ('The program was installed; integration needs attention: '+($failures -join '; '))}
} catch {
 if($beganUpdate -and !$committed -and (Test-Path -LiteralPath (Join-Path $destination 'runtime\installing.json'))){Write-OverlayJson (Join-Path $destination 'runtime\installing.json') @{application='SimRacingOverlay';packageSha256=$packageHash;source=$source;destination=$destination;state='incomplete';error=$_.Exception.Message}}
 throw
} finally {Exit-OverlayLock $mutex}
