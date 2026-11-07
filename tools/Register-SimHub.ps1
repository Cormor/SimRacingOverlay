param([Parameter(Mandatory=$true)][string]$ArgumentsFile,[switch]$Remove)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Lifecycle.ps1')
$cfg=Get-Content -LiteralPath $ArgumentsFile -Raw|ConvertFrom-Json
$root=[OverlayLifecyclePaths]::Canonical($cfg.root);$hub=[OverlayLifecyclePaths]::Canonical($cfg.simHubRoot)
if(!(Test-Path -LiteralPath (Join-Path $hub 'SimHubWPF.exe'))){throw 'SimHub executable not found.'}
$target=Join-Path $hub 'SimRacingOverlay.SimHub.dll';$pointer=Join-Path $hub 'SimRacingOverlay.path'
if($Remove){
 if(!(Test-Path -LiteralPath $pointer) -or ![OverlayLifecyclePaths]::Same((Get-Content -LiteralPath $pointer -Raw).Trim(),$root)){return}
 if(Get-Process SimHubWPF -ErrorAction SilentlyContinue){throw 'Close SimHub before removing its overlay plugin.'}
 if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -ErrorAction Stop}
 Remove-Item -LiteralPath $pointer -ErrorAction Stop;return
}
if((Test-Path -LiteralPath $pointer) -and ![OverlayLifecyclePaths]::Same((Get-Content -LiteralPath $pointer -Raw).Trim(),$root)){throw 'Another overlay installation owns the SimHub plugin; its pointer was kept.'}
$source=Join-Path $root 'runtime\SimRacingOverlay.SimHub.dll'
$same=(Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target).Hash -eq (Get-FileHash -LiteralPath $source).Hash
if(!$same -and (Test-Path -LiteralPath $target) -and (Get-Process SimHubWPF -ErrorAction SilentlyContinue)){throw 'Close SimHub before upgrading its overlay plugin.'}
if(!$same){
 $temp=$target+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
 try{Copy-Item -LiteralPath $source -Destination $temp;if([IO.File]::Exists($target)){[IO.File]::Replace($temp,$target,[NullString]::Value)}else{[IO.File]::Move($temp,$target)}}finally{if([IO.File]::Exists($temp)){[IO.File]::Delete($temp)}}
}
$temp=$pointer+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
try{[IO.File]::WriteAllText($temp,$root,[Text.UTF8Encoding]::new($false));if([IO.File]::Exists($pointer)){[IO.File]::Replace($temp,$pointer,[NullString]::Value)}else{[IO.File]::Move($temp,$pointer)}}finally{if([IO.File]::Exists($temp)){[IO.File]::Delete($temp)}}
# Plugin enablement and all other SimHub settings stay under SimHub's control.
