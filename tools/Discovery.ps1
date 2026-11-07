function Find-Application([string]$Kind,[string]$Explicit='') {
 $exe=if($Kind -eq 'SimHub'){'SimHubWPF.exe'}else{'obs64.exe'}
 $candidates=New-Object 'System.Collections.Generic.List[string]'
 if($Explicit){
  foreach($candidate in @($Explicit,(Join-Path $Explicit $exe),$(if($Kind -eq 'OBS'){Join-Path $Explicit 'bin\64bit\obs64.exe'}))){if($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf) -and [IO.Path]::GetFileName($candidate) -ieq $exe){return [IO.Path]::GetFullPath($candidate)}}
  throw ('The explicit '+$Kind+' path does not contain '+$exe+'.')
 }
 Get-CimInstance Win32_Process -Filter "Name='$exe'" -ErrorAction SilentlyContinue | ForEach-Object {if($_.ExecutablePath){$candidates.Add($_.ExecutablePath)}}
 foreach($base in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
  Get-ItemProperty "$base\*" -ErrorAction SilentlyContinue | Where-Object {($_.DisplayName -like '*SimHub*' -and $Kind -eq 'SimHub') -or ($_.DisplayName -like '*OBS Studio*' -and $Kind -eq 'OBS')} | ForEach-Object {if($_.InstallLocation){$candidates.Add((Join-Path $_.InstallLocation $exe));if($Kind -eq 'OBS'){$candidates.Add((Join-Path $_.InstallLocation 'bin\64bit\obs64.exe'))}}}
 }
 $shell=New-Object -ComObject WScript.Shell
 foreach($base in @([Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('CommonStartMenu'))) {
  Get-ChildItem $base -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | Where-Object {$_.BaseName -like "*$Kind*"} | ForEach-Object {try{$target=$shell.CreateShortcut($_.FullName).TargetPath;if($target){$candidates.Add($target)}}catch{}}
 }
 if($Kind -eq 'SimHub'){foreach($p in @(${env:ProgramFiles(x86)},$env:ProgramFiles,$env:LOCALAPPDATA)){if($p){$candidates.Add((Join-Path $p 'SimHub\SimHubWPF.exe'))}}}else{foreach($p in @($env:ProgramFiles,${env:ProgramFiles(x86)},$env:LOCALAPPDATA)){if($p){$candidates.Add((Join-Path $p 'obs-studio\bin\64bit\obs64.exe'))}}}
 foreach($candidate in $candidates | Select-Object -Unique){if((Test-Path -LiteralPath $candidate -PathType Leaf) -and [IO.Path]::GetFileName($candidate) -ieq $exe){return [IO.Path]::GetFullPath($candidate)}}
 return $null
}
function Get-ObsConfig([string]$Exe,[string]$Explicit='') {
 if($Explicit){return [IO.Path]::GetFullPath($Explicit)}
 if($Exe){$obsRoot=Split-Path (Split-Path (Split-Path $Exe));if((Test-Path (Join-Path $obsRoot 'portable_mode.txt')) -or (Test-Path (Join-Path $obsRoot 'config\obs-studio'))){return Join-Path $obsRoot 'config\obs-studio'}}
 return Join-Path $env:APPDATA 'obs-studio'
}
