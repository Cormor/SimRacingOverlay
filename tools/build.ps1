param([string]$SimHubPath,[string]$OutputPath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
if(!$OutputPath){$OutputPath=Join-Path $root 'runtime'}
New-Item -ItemType Directory -Force $OutputPath | Out-Null
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
& $csc /nologo /optimize+ /target:exe /platform:x86 "/out:$OutputPath\SimRacingBridge.exe" /reference:System.Web.Extensions.dll "/reference:$root\runtime\SharpDX.dll" "/reference:$root\runtime\SharpDX.DirectInput.dll" "$root\src\Bridge.cs" "$root\src\PhysicsTelemetry.cs" "$root\src\SimHubTelemetry.cs"
if($LASTEXITCODE -ne 0){throw 'Bridge compilation failed.'}
& $csc /nologo /optimize+ /target:winexe /platform:anycpu "/out:$OutputPath\SimRacingLauncher.exe" /reference:System.Web.Extensions.dll "$root\src\Launcher.cs"
if($LASTEXITCODE -ne 0){throw 'Launcher compilation failed.'}
if($SimHubPath){
 & $csc /nologo /optimize+ /target:library /platform:anycpu "/out:$OutputPath\SimRacingOverlay.SimHub.dll" /reference:System.Web.Extensions.dll "/reference:$SimHubPath\SimHub.Plugins.dll" "/reference:$SimHubPath\GameReaderCommon.dll" "$root\src\SimHubPlugin.cs"
 if($LASTEXITCODE -ne 0){throw 'SimHub plugin compilation failed.'}
}
