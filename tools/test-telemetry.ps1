$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$out=Join-Path $root 'build\telemetry-tests'
New-Item -ItemType Directory -Force $out | Out-Null
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
function Check($name,$sources,$arguments){
 $files=@($sources | ForEach-Object {Join-Path $root ('src\'+$_+'.cs')})
 $exe=Join-Path $out ($name+'.exe')
 & $csc /nologo /target:exe /platform:x86 "/out:$exe" /reference:System.Web.Extensions.dll @files
 if($LASTEXITCODE -ne 0){throw "$name compilation failed"}
 & $exe @arguments
 if($LASTEXITCODE -ne 0){throw "$name failed"}
}
Check 'Sources' @('TestTelemetrySourceSelection','TelemetrySourceSelection') @()
Check 'Udp' @('TestNativeUdpTelemetry','NativeUdpTelemetry','NativeMotionTelemetry') @()
Check 'Physics' @('TestPhysicsTelemetry','PhysicsTelemetry') @((Join-Path $out 'physics.json'))
$fixture=Join-Path $out 'simhub-input.json'
[IO.File]::WriteAllText($fixture,'{"NewData":{}}')
Check 'SimHub' @('TestSimHubTelemetry','SimHubTelemetry','NativeMotionTelemetry') @($fixture,(Join-Path $out 'normalized.json'))
