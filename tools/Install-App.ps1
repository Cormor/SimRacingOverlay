param(
 [Parameter(Mandatory=$true)][string]$Payload,
 [string]$InstallPath=(Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'AI\Apps\SimRacingOverlay'),
 [string]$MigrationSource
)
$ErrorActionPreference='Stop'
$Payload=[IO.Path]::GetFullPath($Payload).TrimEnd('\')
$InstallPath=[IO.Path]::GetFullPath($InstallPath)
if($InstallPath.TrimEnd('\') -ieq [IO.Path]::GetPathRoot($InstallPath).TrimEnd('\')){throw 'Choose an application folder, not a drive root.'}
$InstallPath=$InstallPath.TrimEnd('\')
$preserved=@('settings.json','assets\layout.json','assets\wheel-packs','assets\modules','assets\components','runtime\desktop.json','runtime\desktop-profile','runtime\integration.json','runtime\autostart.paused')
function Is-UserFile([string]$Relative) {
 foreach($item in $preserved){if($Relative -ieq $item -or $Relative.StartsWith($item+'\',[StringComparison]::OrdinalIgnoreCase)){return $true}}
 return $false
}
function Assert-PlainTree([string]$Path) {
 if((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Payload or destination must not contain directory links: $Path"}
 foreach($entry in Get-ChildItem -LiteralPath $Path -Force){
  if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Directory links are not installation files: $($entry.FullName)"}
  if($entry.PSIsContainer){Assert-PlainTree $entry.FullName}
 }
}
if(!(Test-Path -LiteralPath (Join-Path $Payload 'runtime\SimRacingLauncher.exe')) -or !(Test-Path -LiteralPath (Join-Path $Payload 'runtime\OverlayLifecycle.dll'))){throw 'Payload must be an extracted application folder with its complete runtime.'}
Assert-PlainTree $Payload
if($InstallPath -ieq $Payload -or $Payload.StartsWith($InstallPath+'\',[StringComparison]::OrdinalIgnoreCase) -or $InstallPath.StartsWith($Payload+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Payload and installation must be separate directories.'}
. (Join-Path $Payload 'tools\Lifecycle.ps1')
$link=$null
if(Test-Path -LiteralPath $InstallPath){
 $target=Get-Item -LiteralPath $InstallPath -Force
 if($target.Attributes -band [IO.FileAttributes]::ReparsePoint){
  # Resolve while the junction still exists. Removing the junction never recurses into its target.
  $link=[OverlayLifecyclePaths]::Canonical($InstallPath)
  if(!$MigrationSource){$MigrationSource=$link}
 }else{Assert-PlainTree $InstallPath}
}
if($MigrationSource){$MigrationSource=[OverlayLifecyclePaths]::Canonical($MigrationSource)}
if($link -and ![OverlayLifecyclePaths]::Same($link,$MigrationSource)){throw 'MigrationSource must match the existing junction target.'}
$record=Join-Path $InstallPath 'runtime\installed-app.json'
$identity=$null
if(!$link -and (Test-Path -LiteralPath $record)){
 $identity=Get-Content -Encoding UTF8 -LiteralPath $record -Raw|ConvertFrom-Json
 if($identity.root -ine $InstallPath){throw 'The installation record belongs to another directory.'}
}
if(!$link -and (Test-Path -LiteralPath $InstallPath) -and !(Test-Path -LiteralPath (Join-Path $InstallPath 'runtime\installed-app.json')) -and @((Get-ChildItem -LiteralPath $InstallPath -Force)).Count){throw 'Choose an empty folder or the existing SimRacingOverlay installation.'}
$mutex=Enter-OverlayLock
try {
 $run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
 $existingRun=(Get-ItemProperty -Path $run -ErrorAction SilentlyContinue).SimRacingOverlay
 $ownedRun=$false
 foreach($candidate in @($InstallPath,$MigrationSource)){if($candidate -and $existingRun -and (Test-OverlayLauncherEntry $existingRun $candidate)){$ownedRun=$true}}
 if($existingRun -and !$ownedRun){throw 'Another application directory owns the SimRacingOverlay startup entry.'}
 $roots=@($InstallPath,$MigrationSource)|Where-Object {$_ -and (Test-Path -LiteralPath (Join-Path $_ 'runtime\SimRacingLauncher.exe'))}|Select-Object -Unique
 foreach($root in $roots){Stop-OverlayWatcher $root;Stop-OverlayPendingStarts $root;Stop-OverlayRuntime $root}
 if($link){[IO.Directory]::Delete($InstallPath)}
 New-Item -ItemType Directory -Force -Path $InstallPath|Out-Null
 $programFiles=[Collections.Generic.List[string]]::new()
 foreach($file in Get-ChildItem -LiteralPath $Payload -Recurse -File -Force){
  $relative=$file.FullName.Substring($Payload.Length+1)
  if(Is-UserFile $relative){continue}
  $destination=Join-Path $InstallPath $relative
  New-Item -ItemType Directory -Force -Path (Split-Path $destination)|Out-Null
  Copy-OverlayProgramFile $file.FullName $destination
  $programFiles.Add($relative)
 }
 # Remove superseded manual shells owned by this installation; the launcher
 # and its Start/Stop-Overlay.ps1 dependencies remain the runtime entry chain.
 foreach($relative in @('Start.cmd','Setup.ps1')){
  if($identity -and @($identity.files) -icontains $relative -and !(Test-Path -LiteralPath (Join-Path $Payload $relative))){
   [IO.File]::Delete((Join-Path $InstallPath $relative))
  }
 }
 # Existing target data wins; migration only fills absent files.
 if($MigrationSource -and $MigrationSource -ine $InstallPath){
  foreach($relative in $preserved){
   $source=Join-Path $MigrationSource $relative;$destination=Join-Path $InstallPath $relative
   if(!(Test-Path -LiteralPath $source)){continue}
   if((Get-Item -LiteralPath $source -Force).PSIsContainer){
    Assert-PlainTree $source
    foreach($file in Get-ChildItem -LiteralPath $source -Recurse -File -Force){
     $to=Join-Path $destination $file.FullName.Substring($source.Length+1)
     if(!(Test-Path -LiteralPath $to)){New-Item -ItemType Directory -Force -Path (Split-Path $to)|Out-Null;Copy-Item -LiteralPath $file.FullName -Destination $to}
    }
   }elseif(!(Test-Path -LiteralPath $destination)){New-Item -ItemType Directory -Force -Path (Split-Path $destination)|Out-Null;Copy-Item -LiteralPath $source -Destination $destination}
  }
 }
 foreach($pair in @(@('settings.json','defaults\settings.json'),@('assets\layout.json','defaults\layout.json'))){
  $destination=Join-Path $InstallPath $pair[0]
  if(!(Test-Path -LiteralPath $destination)){New-Item -ItemType Directory -Force -Path (Split-Path $destination)|Out-Null;Copy-Item -LiteralPath (Join-Path $InstallPath $pair[1]) -Destination $destination}
 }
 $version=(Get-Content -Encoding UTF8 -LiteralPath (Join-Path $InstallPath 'VERSION') -Raw).Trim()
 $programs=[Environment]::GetFolderPath('Programs');$shortcut=Join-Path $programs 'SimRacingOverlay.lnk'
 $shell=New-Object -ComObject WScript.Shell;$entry=$shell.CreateShortcut($shortcut)
 $entry.TargetPath=Join-Path $InstallPath 'runtime\SimRacingLauncher.exe';$entry.Arguments='--root "'+$InstallPath+'"';$entry.WorkingDirectory=$InstallPath;$entry.Description='SimRacingOverlay';$entry.IconLocation=(Join-Path $InstallPath 'assets\app.ico');$entry.Save()
 if($ownedRun){Set-ItemProperty -Path $run -Name SimRacingOverlay -Value ('"'+$entry.TargetPath+'" --watch --root "'+$InstallPath+'"')}
 $key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SimRacingOverlay'
 New-Item -Path $key -Force|Out-Null
 $values=@{DisplayName='SimRacingOverlay';DisplayVersion=$version;Publisher='砺行';InstallLocation=$InstallPath;DisplayIcon=(Join-Path $InstallPath 'assets\app.ico');UninstallString=('"'+(Join-Path $InstallPath 'runtime\SimRacingUninstall.exe')+'" --uninstall --root "'+$InstallPath+'"')}
 foreach($name in $values.Keys){New-ItemProperty -Path $key -Name $name -Value $values[$name] -PropertyType String -Force|Out-Null}
 New-ItemProperty -Path $key -Name NoModify -Value 1 -PropertyType DWord -Force|Out-Null
 New-ItemProperty -Path $key -Name NoRepair -Value 1 -PropertyType DWord -Force|Out-Null
 # Full upgrades select the new bundled algorithms, while imported generations remain user data.
 $activeModules=Join-Path $InstallPath 'assets\modules\active.json'
 if(Test-Path -LiteralPath $activeModules){Remove-Item -LiteralPath $activeModules -Force}
 Write-OverlayJson (Join-Path $InstallPath 'runtime\installed-app.json') @{version=$version;root=$InstallPath;installed=$true;files=@($programFiles);shortcut=$shortcut;installedAt=[DateTime]::UtcNow.ToString('O')}
 @{ok=$true;version=$version;installPath=$InstallPath;shortcut=$shortcut}|ConvertTo-Json -Compress
} finally {Exit-OverlayLock $mutex}
