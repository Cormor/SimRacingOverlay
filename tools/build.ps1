param([string]$SimHubPath,[string]$OutputPath,[switch]$BuildObserver)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
if(!$OutputPath){$OutputPath=Join-Path $root 'runtime'}
New-Item -ItemType Directory -Force $OutputPath | Out-Null
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
& $csc /nologo /optimize+ /target:exe /platform:x86 "/out:$OutputPath\SimRacingBridge.exe" /reference:System.Web.Extensions.dll "/reference:$root\runtime\SharpDX.dll" "/reference:$root\runtime\SharpDX.DirectInput.dll" "$root\src\Bridge.cs" "$root\src\PhysicsTelemetry.cs" "$root\src\IRacingTelemetry.cs" "$root\src\TelemetryEventStream.cs" "$root\src\SimHubTelemetry.cs" "$root\src\NativeMotionTelemetry.cs" "$root\src\NativeUdpTelemetry.cs" "$root\src\TelemetrySourceSelection.cs"
if($LASTEXITCODE -ne 0){throw 'Bridge compilation failed.'}
& $csc /nologo /optimize+ /target:winexe /platform:anycpu "/win32icon:$root\assets\app.ico" "/out:$OutputPath\SimRacingLauncher.exe" /reference:System.Web.Extensions.dll /reference:System.Management.dll /reference:System.Windows.Forms.dll "$root\src\Launcher.cs" "$root\src\LifecyclePaths.cs"
if($LASTEXITCODE -ne 0){throw 'Launcher compilation failed.'}
& $csc /nologo /optimize+ /target:winexe /platform:anycpu "/out:$OutputPath\SimRacingHudLayer.exe" "$root\src\HudWindowLayer.cs"
if($LASTEXITCODE -ne 0){throw 'HUD layer observer compilation failed.'}
& $csc /nologo /optimize+ /target:library /platform:anycpu "/out:$OutputPath\OverlayLifecycle.dll" /reference:System.Management.dll "$root\src\LifecyclePaths.cs"
if($LASTEXITCODE -ne 0){throw 'Lifecycle library compilation failed.'}
if($SimHubPath){
 & $csc /nologo /optimize+ /target:library /platform:anycpu "/out:$OutputPath\SimRacingOverlay.SimHub.dll" /reference:System.Web.Extensions.dll "/reference:$SimHubPath\SimHub.Plugins.dll" "/reference:$SimHubPath\GameReaderCommon.dll" "$root\src\SimHubPlugin.cs"
 if($LASTEXITCODE -ne 0){throw 'SimHub plugin compilation failed.'}
}

$sourceNames=@('Bridge','PhysicsTelemetry','IRacingTelemetry','TelemetryEventStream','SimHubTelemetry','NativeMotionTelemetry','NativeUdpTelemetry','TelemetrySourceSelection','Launcher','LifecyclePaths','HudWindowLayer')
$sourceHashes=[ordered]@{};foreach($name in $sourceNames){$sourceHashes['src/'+$name+'.cs']=(Get-FileHash (Join-Path $root ('src/'+$name+'.cs')) -Algorithm SHA256).Hash.ToLowerInvariant()}
$binaryHashes=[ordered]@{};foreach($name in @('SimRacingBridge.exe','SimRacingLauncher.exe','OverlayLifecycle.dll','SimRacingHudLayer.exe')){$binaryHashes['runtime/'+$name]=(Get-FileHash (Join-Path $OutputPath $name) -Algorithm SHA256).Hash.ToLowerInvariant()}
if($SimHubPath){
 $sourceHashes['src/SimHubPlugin.cs']=(Get-FileHash (Join-Path $root 'src/SimHubPlugin.cs') -Algorithm SHA256).Hash.ToLowerInvariant()
 $binaryHashes['runtime/SimRacingOverlay.SimHub.dll']=(Get-FileHash (Join-Path $OutputPath 'SimRacingOverlay.SimHub.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
}
if($BuildObserver){
 & python -m PyInstaller --clean --noconfirm --onefile --noconsole --name MozaLedObserver --distpath $OutputPath --workpath (Join-Path $root 'build/observer') --specpath (Join-Path $root 'build') --paths (Join-Path $root 'src') (Join-Path $root 'src/led_tap.py')
 if($LASTEXITCODE -ne 0){throw 'LED observer compilation failed.'}
 foreach($name in @('led_tap.py','led_decoder.py','led-tap.js')){$sourceHashes['src/'+$name]=(Get-FileHash (Join-Path $root ('src/'+$name)) -Algorithm SHA256).Hash.ToLowerInvariant()}
 $binaryHashes['runtime/MozaLedObserver.exe']=(Get-FileHash (Join-Path $OutputPath 'MozaLedObserver.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
}
$receipt=@{sources=$sourceHashes;binaries=$binaryHashes;platform='x86 bridge / anycpu launcher'} | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $OutputPath 'native-build.json'),$receipt,[Text.UTF8Encoding]::new($false))
