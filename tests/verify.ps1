param([string]$SimHubPath)
$ErrorActionPreference='Stop';$root=Split-Path $PSScriptRoot
$dest=Join-Path $root 'local\mapping-test';New-Item -ItemType Directory -Force $dest|Out-Null
Copy-Item (Join-Path $root 'runtime\SharpDX*.dll') $dest
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
& $csc /nologo /optimize+ /target:exe /platform:x86 /main:MappingTest "/out:$dest\MappingTest.exe" /reference:System.Web.Extensions.dll "/reference:$root\runtime\SharpDX.dll" "/reference:$root\runtime\SharpDX.DirectInput.dll" "$root\src\Bridge.cs" "$root\src\PhysicsTelemetry.cs" "$root\src\SimHubTelemetry.cs" "$PSScriptRoot\BridgeMapping.cs"
if($LASTEXITCODE -ne 0){throw 'Mapping test compilation failed'}
& "$dest\MappingTest.exe";if($LASTEXITCODE -ne 0){throw 'Mapping fixtures failed'}
$bad=$false;Get-ChildItem $root -Filter '*.ps1' -Recurse | Where-Object {$_.FullName -notmatch '\\local\\|\\runtime\\|\\dist\\'} | ForEach-Object {$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$errors);if($errors.Count){$bad=$true;$errors|Write-Output}}
if($bad){throw 'PowerShell parse failed'}
