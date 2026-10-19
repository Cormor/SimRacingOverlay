$root=$PSScriptRoot
[IO.File]::WriteAllText((Join-Path $root 'runtime\autostart.paused'),'Paused until the next manual start.')
Get-CimInstance Win32_Process | Where-Object {($_.Name -in @('SimRacingBridge.exe','MozaLedObserver.exe') -and $_.ExecutablePath -like "$root\runtime\*") -or ($_.Name -eq 'electron.exe' -and $_.ExecutablePath -eq "$root\runtime\electron\electron.exe" -and $_.CommandLine -like "*$root\desktop-main.js*")} | ForEach-Object {Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue}
