param([switch]$NoPause)
$ErrorActionPreference='Stop';$root=$PSScriptRoot
& (Join-Path $root 'Stop-Overlay.ps1')
$watcher=Join-Path $root 'runtime\SimRacingLauncher.exe'
Get-CimInstance Win32_Process -Filter "Name='SimRacingLauncher.exe'" | Where-Object {$_.ExecutablePath -eq $watcher} | ForEach-Object {Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue}
$run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run';$entry=(Get-ItemProperty $run -ErrorAction SilentlyContinue).SimRacingOverlay
if($entry -and $entry.Contains($watcher)){Remove-ItemProperty $run -Name SimRacingOverlay}
$cfg=Get-Content (Join-Path $root 'runtime\integration.json') -Raw|ConvertFrom-Json
if(Get-Process obs64 -ErrorAction SilentlyContinue){Write-Output 'Close OBS and run uninstall again to remove its startup script safely.';exit 1}
$script=Join-Path $root 'obs-overlay.lua'
Get-ChildItem (Join-Path $cfg.obsConfig 'basic\scenes') -Filter '*.json' -ErrorAction SilentlyContinue | ForEach-Object {
 $data=Get-Content $_.FullName -Raw|ConvertFrom-Json
 if($data.modules -and $data.modules.PSObject.Properties['scripts-tool']){$data.modules.'scripts-tool'=@($data.modules.'scripts-tool'|Where-Object {$_.path -ne $script});[IO.File]::WriteAllText($_.FullName,($data|ConvertTo-Json -Depth 100),(New-Object Text.UTF8Encoding($false)))}
}
if($cfg.simHubExe){$hub=Split-Path $cfg.simHubExe;$pointer=Join-Path $hub 'SimRacingOverlay.path';if((Test-Path $pointer) -and (Get-Content $pointer -Raw).Trim() -eq $root){if(Get-Process SimHubWPF -ErrorAction SilentlyContinue){Write-Output 'Close SimHub and run uninstall again to remove its overlay plugin safely.';exit 1}
 try{Remove-Item -LiteralPath (Join-Path $hub 'SimRacingOverlay.SimHub.dll') -ErrorAction Stop;Remove-Item -LiteralPath $pointer}catch{Write-Output 'Run this uninstaller as administrator to remove the SimHub plugin.';exit 1}}}
$menu=Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\SimRacingOverlay'
foreach($name in @('SimRacingOverlay.lnk','设备设置.lnk','卸载.lnk')){$file=Join-Path $menu $name;if(Test-Path $file){$link=(New-Object -ComObject WScript.Shell).CreateShortcut($file);if($link.TargetPath.StartsWith($root) -or $link.Arguments.Contains($root)){Remove-Item -LiteralPath $file}}}
Write-Output 'Startup integration removed. Your files and calibration are kept. Delete the installation folder manually if no longer needed.'
if(!$NoPause){Read-Host 'Press Enter to close'}
