param([Parameter(Mandatory=$true)][string]$WindowHandle,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OverlayCaptureWindow {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd,out RECT rect);
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
}
'@
[OverlayCaptureWindow]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$rect=New-Object OverlayCaptureWindow+RECT
if(![OverlayCaptureWindow]::GetWindowRect([IntPtr]::new([Int64]$WindowHandle),[ref]$rect)){throw 'Own QA window no longer exists'}
$width=$rect.Right-$rect.Left;$height=$rect.Bottom-$rect.Top
if($width -le 0 -or $height -le 0 -or $width -gt 8000 -or $height -gt 5000){throw 'Invalid QA window bounds'}
$bitmap=[Drawing.Bitmap]::new($width,$height);$graphics=[Drawing.Graphics]::FromImage($bitmap)
try{$graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,[Drawing.Size]::new($width,$height));$bitmap.Save($OutputPath,[Drawing.Imaging.ImageFormat]::Png)}finally{$graphics.Dispose();$bitmap.Dispose()}
