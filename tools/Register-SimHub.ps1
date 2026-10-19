param([Parameter(Mandatory=$true)][string]$ArgumentsFile)
$ErrorActionPreference='Stop'
$cfg=Get-Content -LiteralPath $ArgumentsFile -Raw | ConvertFrom-Json
$root=[IO.Path]::GetFullPath($cfg.root);$hub=[IO.Path]::GetFullPath($cfg.simHubRoot)
if(!(Test-Path (Join-Path $hub 'SimHubWPF.exe'))){throw 'SimHub executable not found.'}
$target=Join-Path $hub 'SimRacingOverlay.SimHub.dll'
if(Test-Path $target){if((Get-FileHash $target).Hash -eq (Get-FileHash (Join-Path $root 'runtime\SimRacingOverlay.SimHub.dll')).Hash){[IO.File]::WriteAllText((Join-Path $hub 'SimRacingOverlay.path'),$root);exit 0};if(Get-Process SimHubWPF -ErrorAction SilentlyContinue){throw 'Close SimHub before upgrading its overlay plugin.'}}
Copy-Item -LiteralPath (Join-Path $root 'runtime\SimRacingOverlay.SimHub.dll') -Destination $target -Force
[IO.File]::WriteAllText((Join-Path $hub 'SimRacingOverlay.path'),$root)
# SimHub prompts to enable newly discovered external plugins. Its active settings are never overwritten.
