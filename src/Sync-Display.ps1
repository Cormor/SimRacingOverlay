param([string]$Root,[double]$CenterX=0,[double]$CenterY=0,[string]$SourceName='SimRacingOverlay')
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class OverlayDpi { [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value); }'
[void][OverlayDpi]::SetThreadDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Windows.Forms
$displays=@([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {@{device=$_.DeviceName;x=$_.Bounds.X;y=$_.Bounds.Y;width=$_.Bounds.Width;height=$_.Bounds.Height;workX=$_.WorkingArea.X;workY=$_.WorkingArea.Y;workWidth=$_.WorkingArea.Width;workHeight=$_.WorkingArea.Height}})
$selected=$displays | Where-Object {$CenterX -ge $_.x -and $CenterX -lt ($_.x+$_.width) -and $CenterY -ge $_.y -and $CenterY -lt ($_.y+$_.height)} | Select-Object -First 1
if(!$selected){$selected=$displays | Sort-Object { [math]::Pow(($_.x+$_.width/2-$CenterX),2)+[math]::Pow(($_.y+$_.height/2-$CenterY),2)} | Select-Object -First 1}
$obs=@{connected=$false;updated=$false}
$ws=$null;$cancel=[System.Threading.CancellationTokenSource]::new(2200)
function Receive-Json {
 $buffer=New-Object byte[] 65536;$memory=[System.IO.MemoryStream]::new()
 try{do{$result=$ws.ReceiveAsync([ArraySegment[byte]]::new($buffer),$cancel.Token).GetAwaiter().GetResult();if($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close){throw 'closed'};$memory.Write($buffer,0,$result.Count);if($memory.Length -gt 1048576){throw 'oversized response'}}while(!$result.EndOfMessage)
 return [System.Text.Encoding]::UTF8.GetString($memory.ToArray()) | ConvertFrom-Json
 }finally{$memory.Dispose()}
}
function Send-Json($value){$bytes=[System.Text.Encoding]::UTF8.GetBytes(($value | ConvertTo-Json -Depth 12 -Compress));[void]$ws.SendAsync([ArraySegment[byte]]::new($bytes),[System.Net.WebSockets.WebSocketMessageType]::Text,$true,$cancel.Token).GetAwaiter().GetResult()}
function Hash-Base64([string]$value){$sha=[System.Security.Cryptography.SHA256]::Create();try{return [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))}finally{$sha.Dispose()}}
function Request-Obs($name,$data){$id=[Guid]::NewGuid().ToString();Send-Json @{op=6;d=@{requestType=$name;requestId=$id;requestData=$data}};do{$reply=Receive-Json}while($reply.op -ne 7 -or $reply.d.requestId -ne $id);if(!$reply.d.requestStatus.result){throw 'request failed'};return $reply.d.responseData}
try{
 $file=Join-Path $env:APPDATA 'obs-studio\plugin_config\obs-websocket\config.json';$config=Get-Content $file -Raw | ConvertFrom-Json
 if($config.server_enabled -eq $false){throw 'disabled'}
 $ws=[System.Net.WebSockets.ClientWebSocket]::new();[void]$ws.ConnectAsync([Uri]("ws://127.0.0.1:"+$config.server_port),$cancel.Token).GetAwaiter().GetResult()
 $hello=Receive-Json;$identify=@{rpcVersion=1;eventSubscriptions=0}
 if($hello.d.authentication){$secret=Hash-Base64 ($config.server_password+$hello.d.authentication.salt);$identify.authentication=Hash-Base64 ($secret+$hello.d.authentication.challenge)}
 Send-Json @{op=1;d=$identify};$reply=Receive-Json;if($reply.op -ne 2){throw 'authentication failed'}
 $actual=Request-Obs 'GetInputSettings' @{inputName=$SourceName};$obs.connected=$true
 if($actual.inputSettings.width -ne $selected.width -or $actual.inputSettings.height -ne $selected.height){
  [void](Request-Obs 'SetInputSettings' @{inputName=$SourceName;inputSettings=@{width=$selected.width;height=$selected.height};overlay=$true});$obs.updated=$true
 }
 $readback=Request-Obs 'GetInputSettings' @{inputName=$SourceName};$obs.width=$readback.inputSettings.width;$obs.height=$readback.inputSettings.height
}catch{$obs.error='OBS unavailable, source missing or authentication/request failed'}finally{if($ws){$ws.Dispose()};$cancel.Dispose()}
@{displays=$displays;selected=$selected;obs=$obs;observed=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json -Depth 5 -Compress
