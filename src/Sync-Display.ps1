# Native dimensions only. OBS owns its browser source through obs-overlay.lua.
param([double]$CenterX=0,[double]$CenterY=0)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class OverlayDpi { [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value); }'
[void][OverlayDpi]::SetThreadDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Windows.Forms
$displays=@([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {@{device=$_.DeviceName;x=$_.Bounds.X;y=$_.Bounds.Y;width=$_.Bounds.Width;height=$_.Bounds.Height;workX=$_.WorkingArea.X;workY=$_.WorkingArea.Y;workWidth=$_.WorkingArea.Width;workHeight=$_.WorkingArea.Height}})
$selected=$displays | Where-Object {$CenterX -ge $_.x -and $CenterX -lt ($_.x+$_.width) -and $CenterY -ge $_.y -and $CenterY -lt ($_.y+$_.height)} | Select-Object -First 1
if(!$selected){$selected=$displays | Sort-Object { [math]::Pow(($_.x+$_.width/2-$CenterX),2)+[math]::Pow(($_.y+$_.height/2-$CenterY),2)} | Select-Object -First 1}
@{displays=$displays;selected=$selected;observed=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json -Depth 5 -Compress
