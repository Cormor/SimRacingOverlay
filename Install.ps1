param([string]$InstallPath=(Join-Path $env:LOCALAPPDATA 'SimRacingOverlay'),[string]$SimHubPath,[string]$ObsPath,[string]$ObsConfig,[switch]$NoLaunch,[switch]$NoAutostart,[switch]$NoShortcuts)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'tools\Discovery.ps1')
$source=$PSScriptRoot
$destination=[IO.Path]::GetFullPath($InstallPath).TrimEnd('\')
if($destination -eq [IO.Path]::GetPathRoot($destination)){throw 'Do not install into a drive root.'}
$manifestFile=Join-Path $source 'PAYLOAD.json'
if(!(Test-Path $manifestFile)){throw 'Use the extracted Release package, not the source archive. PAYLOAD.json is missing.'}
$active=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($destination+'\',[StringComparison]::OrdinalIgnoreCase) -and $_.Name -in @('SimRacingBridge.exe','SimRacingLauncher.exe','MozaLedObserver.exe','electron.exe')})
if($active.Count){throw 'Stop the installed overlay and its startup watcher before upgrading. No files were changed.'}
$payload=Get-Content $manifestFile -Raw | ConvertFrom-Json
# Verify the complete distribution before changing the destination.
foreach($item in $payload){$f=[IO.Path]::GetFullPath((Join-Path $source $item.path));if(!$f.StartsWith($source+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid package path.'};if(!(Test-Path -LiteralPath $f) -or (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash -ne $item.sha256){throw "Package integrity check failed: $($item.path)"}}
if($destination -ne $source){
 if((Test-Path $destination) -and !(Test-Path (Join-Path $destination 'VERSION'))){throw 'Target exists but is not a SimRacingOverlay installation. Choose another folder.'}
 New-Item -ItemType Directory -Force $destination | Out-Null
 foreach($item in $payload){$target=Join-Path $destination $item.path;New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null;Copy-Item -LiteralPath (Join-Path $source $item.path) -Destination $target -Force}
 Copy-Item -LiteralPath $manifestFile -Destination (Join-Path $destination 'PAYLOAD.json') -Force
}
$runtime=Join-Path $destination 'runtime';New-Item -ItemType Directory -Force $runtime | Out-Null
foreach($pair in @(@('settings.json','settings.json'),@('runtime\desktop.json','desktop.json'),@('assets\layout.json','layout.json'))){$target=Join-Path $destination $pair[0];if(!(Test-Path $target)){Copy-Item (Join-Path $destination ('defaults\'+$pair[1])) $target}}
$settingsFile=Join-Path $destination 'settings.json';$settings=Get-Content $settingsFile -Raw | ConvertFrom-Json
# Do not silently attach to another installation occupying the default port.
$busy=Get-NetTCPConnection -LocalPort $settings.httpPort -State Listen -ErrorAction SilentlyContinue
if($busy){$own=Get-CimInstance Win32_Process -Filter "Name='SimRacingBridge.exe'" | Where-Object {$_.ExecutablePath -eq (Join-Path $runtime 'SimRacingBridge.exe')};if(!$own){$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();$settings.httpPort=$listener.LocalEndpoint.Port;$listener.Stop();[IO.File]::WriteAllText($settingsFile,($settings|ConvertTo-Json -Depth 20))}}
$sim=Find-Application 'SimHub' $SimHubPath;$obs=Find-Application 'OBS' $ObsPath
$integration=@{simHubExe=$sim;obsExe=$obs;obsConfig=(Get-ObsConfig $obs $ObsConfig);root=$destination}
[IO.File]::WriteAllText((Join-Path $runtime 'integration.json'),($integration|ConvertTo-Json))
if($sim){
 $hubRoot=Split-Path $sim
 # Only our DLL and pointer are written beside SimHub. No game or device configuration is changed.
 $argsFile=Join-Path $runtime 'simhub-registration.json';[IO.File]::WriteAllText($argsFile,(@{root=$destination;simHubRoot=$hubRoot}|ConvertTo-Json))
 try{& (Join-Path $destination 'tools\Register-SimHub.ps1') -ArgumentsFile $argsFile}catch [UnauthorizedAccessException]{
  $p=Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $destination 'tools\Register-SimHub.ps1')+'"'),'-ArgumentsFile',('"'+$argsFile+'"'));if($p.ExitCode -ne 0){throw 'SimHub integration elevation failed.'}
 }
}
if($obs){& (Join-Path $destination 'tools\Register-Obs.ps1') -Root $destination -ConfigPath $integration.obsConfig}
$watcher=Join-Path $runtime 'SimRacingLauncher.exe'
if(!$NoAutostart){$run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run';New-Item -Path $run -Force | Out-Null;Set-ItemProperty $run -Name SimRacingOverlay -Value ('"'+$watcher+'" --watch')}
if(!$NoShortcuts){$menu=Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\SimRacingOverlay';New-Item -ItemType Directory -Force $menu|Out-Null;$shell=New-Object -ComObject WScript.Shell
 foreach($entry in @(@('SimRacingOverlay',$watcher,''),@('设备设置','powershell.exe',('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $destination 'Setup.ps1')+'"')),@('卸载','powershell.exe',('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $destination 'Uninstall.ps1')+'"')))){$link=$shell.CreateShortcut((Join-Path $menu ($entry[0]+'.lnk')));$link.TargetPath=$entry[1];$link.Arguments=$entry[2];$link.WorkingDirectory=$destination;$link.Save()}}
if(!$NoLaunch){if(!$NoAutostart){Start-Process $watcher -ArgumentList '--watch' -WorkingDirectory $destination}; & (Join-Path $destination 'Setup.ps1')}
Write-Output "Installed: $destination"
if($sim){Write-Output 'SimHub integration installed. If SimHub is running, enable the SimRacingOverlay plugin after the next normal restart.'}else{Write-Output 'SimHub not found. Re-run with -SimHubPath if using a portable install.'}
if($obs){Write-Output 'OBS registration installed or queued until OBS closes.'}else{Write-Output 'OBS not found. Re-run with -ObsPath if using a portable install.'}
