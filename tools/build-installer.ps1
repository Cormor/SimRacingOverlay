param(
 [Parameter(Mandatory=$true)][string]$Payload,
 [Parameter(Mandatory=$true)][string]$OutputPath,
 [string]$ScratchPath
)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$OutputPath=[IO.Path]::GetFullPath($OutputPath)
$Payload=[IO.Path]::GetFullPath($Payload)
if(!$ScratchPath){$ScratchPath=Join-Path (Split-Path $OutputPath) '.installer-build'}
$work=Join-Path $ScratchPath ('installer-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work|Out-Null
try {
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $stage=Join-Path $work 'app';New-Item -ItemType Directory -Path $stage|Out-Null
 if((Get-Item -LiteralPath $Payload -Force).PSIsContainer){$source=$Payload}else{
  $source=Join-Path $work 'input';[IO.Compression.ZipFile]::ExtractToDirectory($Payload,$source)
  if(!(Test-Path -LiteralPath (Join-Path $source 'VERSION'))){$folders=@(Get-ChildItem -LiteralPath $source -Directory);if($folders.Count -eq 1){$source=$folders[0].FullName}}
 }
 if(!(Test-Path -LiteralPath (Join-Path $source 'VERSION')) -or !(Test-Path -LiteralPath (Join-Path $source 'runtime\OverlayLifecycle.dll'))){throw 'Payload root must contain VERSION and a complete runtime including OverlayLifecycle.dll.'}
 function Copy-PlainFolder([string]$From,[string]$To){
  if((Get-Item -LiteralPath $From -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Payload must contain real files, not directory links: $From"}
  New-Item -ItemType Directory -Force -Path $To|Out-Null
  foreach($item in Get-ChildItem -LiteralPath $From -Force){
   if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Payload must contain real files, not directory links: $($item.FullName)"}
   $destination=Join-Path $To $item.Name
   if($item.PSIsContainer){Copy-PlainFolder $item.FullName $destination}else{Copy-Item -LiteralPath $item.FullName -Destination $destination}
  }
 }
 Copy-PlainFolder $source $stage
 New-Item -ItemType Directory -Force -Path (Join-Path $stage 'tools')|Out-Null
 foreach($name in @('Install-App.ps1','Uninstall-App.ps1')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $stage ('tools\'+$name)) -Force}
 $csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
 $sourceFile=Join-Path $root 'src\AppInstaller.cs';$uninstaller=Join-Path $work 'SimRacingUninstall.exe';$icon=Join-Path $stage 'assets\app.ico'
 $references=@('/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll','/reference:System.Web.Extensions.dll')
 & $csc /nologo /optimize+ /target:winexe /platform:anycpu /define:UNINSTALLER "/win32icon:$icon" "/out:$uninstaller" @references ('/resource:'+(Join-Path $PSScriptRoot 'Uninstall-App.ps1')+',UninstallScript') $sourceFile
 if($LASTEXITCODE -ne 0){throw 'Uninstaller compilation failed.'}
 $zip=Join-Path $work 'payload.zip';[IO.Compression.ZipFile]::CreateFromDirectory($stage,$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
 New-Item -ItemType Directory -Force -Path (Split-Path $OutputPath)|Out-Null
 & $csc /nologo /optimize+ /target:winexe /platform:anycpu "/win32icon:$icon" "/out:$OutputPath" @references "/resource:$zip,Payload" ('/resource:'+(Join-Path $stage 'VERSION')+',PackageVersion') "/resource:$uninstaller,Uninstaller" ('/resource:'+(Join-Path $PSScriptRoot 'Uninstall-App.ps1')+',UninstallScript') $sourceFile
 if($LASTEXITCODE -ne 0){throw 'Installer compilation failed.'}
 @{ok=$true;version=(Get-Content -LiteralPath (Join-Path $stage 'VERSION') -Raw).Trim();installer=$OutputPath}|ConvertTo-Json -Compress
}finally{if(Test-Path -LiteralPath $work){Remove-Item -LiteralPath $work -Recurse -Force}}
