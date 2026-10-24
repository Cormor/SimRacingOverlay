param([string]$SimHubPath,[string]$OutputPath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
if(!$OutputPath){$OutputPath=Join-Path $root 'runtime'}
New-Item -ItemType Directory -Force $OutputPath | Out-Null
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
& $csc /nologo /optimize+ /target:exe /platform:x86 "/out:$OutputPath\SimRacingBridge.exe" /reference:System.Web.Extensions.dll "/reference:$root\runtime\SharpDX.dll" "/reference:$root\runtime\SharpDX.DirectInput.dll" "$root\src\Bridge.cs" "$root\src\PhysicsTelemetry.cs" "$root\src\IRacingTelemetry.cs" "$root\src\TelemetryEventStream.cs" "$root\src\SimHubTelemetry.cs" "$root\src\NativeMotionTelemetry.cs" "$root\src\NativeUdpTelemetry.cs" "$root\src\TelemetrySourceSelection.cs"
if($LASTEXITCODE -ne 0){throw 'Bridge compilation failed.'}
& $csc /nologo /optimize+ /target:winexe /platform:anycpu "/out:$OutputPath\SimRacingLauncher.exe" /reference:System.Web.Extensions.dll "$root\src\Launcher.cs"
if($LASTEXITCODE -ne 0){throw 'Launcher compilation failed.'}
if($SimHubPath){
 & $csc /nologo /optimize+ /target:library /platform:anycpu "/out:$OutputPath\SimRacingOverlay.SimHub.dll" /reference:System.Web.Extensions.dll "/reference:$SimHubPath\SimHub.Plugins.dll" "/reference:$SimHubPath\GameReaderCommon.dll" "$root\src\SimHubPlugin.cs"
 if($LASTEXITCODE -ne 0){throw 'SimHub plugin compilation failed.'}
}

$sourceNames=@('Bridge','PhysicsTelemetry','IRacingTelemetry','TelemetryEventStream','SimHubTelemetry','NativeMotionTelemetry','NativeUdpTelemetry','TelemetrySourceSelection','Launcher')
$sourceHashes=[ordered]@{};foreach($name in $sourceNames){$sourceHashes['src/'+$name+'.cs']=(Get-FileHash (Join-Path $root ('src/'+$name+'.cs')) -Algorithm SHA256).Hash.ToLowerInvariant()}
$binaryHashes=[ordered]@{};foreach($name in @('SimRacingBridge.exe','SimRacingLauncher.exe')){$binaryHashes['runtime/'+$name]=(Get-FileHash (Join-Path $OutputPath $name) -Algorithm SHA256).Hash.ToLowerInvariant()}
$receipt=@{sources=$sourceHashes;binaries=$binaryHashes;platform='x86 bridge / anycpu launcher'} | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $OutputPath 'native-build.json'),$receipt,[Text.UTF8Encoding]::new($false))
