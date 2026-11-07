param([Parameter(Mandatory=$true)][string]$InstallPath,[int]$UninstallerProcessId)
$ErrorActionPreference='Stop'
$InstallPath=[IO.Path]::GetFullPath($InstallPath).TrimEnd('\')
if((Get-Item -LiteralPath $InstallPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Uninstall requires the installed application directory, not a junction.'}
$receiptPath=Join-Path $InstallPath 'runtime\installed-app.json'
$receipt=Get-Content -Encoding UTF8 -LiteralPath $receiptPath -Raw|ConvertFrom-Json
if($receipt.root -ine $InstallPath){throw 'The installation record belongs to a different directory.'}
# Load from bytes so the shared lifecycle DLL can be removed during this run.
if(-not ('OverlayLifecyclePaths' -as [type])){[void][Reflection.Assembly]::Load([IO.File]::ReadAllBytes((Join-Path $InstallPath 'runtime\OverlayLifecycle.dll')))}
. (Join-Path $InstallPath 'tools\Lifecycle.ps1')
$mutex=Enter-OverlayLock
try {
 Stop-OverlayWatcher $InstallPath;Stop-OverlayPendingStarts $InstallPath;Stop-OverlayRuntime $InstallPath -Pause
 # Delete only the installed program manifest; settings, layouts, downloaded faces,
 # Electron profile and diagnostics are intentionally retained.
 foreach($relative in $receipt.files){
  $file=[IO.Path]::GetFullPath((Join-Path $InstallPath $relative))
  if(!$file.StartsWith($InstallPath+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid path in installation record.'}
  if($relative -ieq 'runtime\SimRacingUninstall.exe'){continue}
  $parent=Split-Path $file
  while($parent -ine $InstallPath){if((Test-Path -LiteralPath $parent) -and ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Uninstall will not follow a directory link.'};$parent=Split-Path $parent}
  if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force}
 }
 $shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'SimRacingOverlay.lnk'
 if(Test-Path -LiteralPath $shortcut){$shell=New-Object -ComObject WScript.Shell;$entry=$shell.CreateShortcut($shortcut);if($entry.TargetPath -ieq (Join-Path $InstallPath 'runtime\SimRacingLauncher.exe')){Remove-Item -LiteralPath $shortcut -Force}}
 $key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SimRacingOverlay'
 if((Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).InstallLocation -ieq $InstallPath){Remove-Item -LiteralPath $key -Recurse -Force}
 Write-OverlayJson $receiptPath @{root=$InstallPath;installed=$false;files=@();retainedData=$true;version=$receipt.version}
 $run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
 $line=(Get-ItemProperty -Path $run -ErrorAction SilentlyContinue).SimRacingOverlay
 if($line -and (Test-OverlayLauncherEntry $line $InstallPath)){Remove-ItemProperty -Path $run -Name SimRacingOverlay}
 & {
  $exe=Join-Path $InstallPath 'runtime\SimRacingUninstall.exe'
  $cleanup='Wait-Process -Id '+$PID+' -ErrorAction SilentlyContinue; '
  if($UninstallerProcessId){$cleanup+='Wait-Process -Id '+$UninstallerProcessId+' -ErrorAction SilentlyContinue; '}
  $cleanup+='Remove-Item -LiteralPath '''+$exe.Replace("'","''")+''' -Force -ErrorAction SilentlyContinue'
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cleanup))
  Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',$encoded) -WindowStyle Hidden|Out-Null
 }
 @{ok=$true;retainedData=$InstallPath}|ConvertTo-Json -Compress
} finally {Exit-OverlayLock $mutex}
