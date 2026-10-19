using System;using System.IO;using System.Diagnostics;using System.Threading;using System.Web.Script.Serialization;using System.Collections.Generic;
class Launcher {
 static readonly string root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
 static void Start(string script,string args=""){var p=new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \""+Path.Combine(root,script)+"\" "+args){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=root};using(var started=Process.Start(p)){} }
 [STAThread]static void Main(string[] args){if(args.Length==0){Start("Start-Overlay.ps1");return;}bool first;using(var mutex=new Mutex(true,"Local\\SimRacingOverlay.StartupWatcher",out first)){if(!first)return;bool wasRunning=false;long lastLaunch=0;while(true){try{var hosts=Process.GetProcessesByName("obs64");var sim=Process.GetProcessesByName("SimHubWPF");bool obsActive=hosts.Length>0;bool active=obsActive||sim.Length>0;foreach(var p in hosts)p.Dispose();foreach(var p in sim)p.Dispose();if(active&&(!wasRunning||Environment.TickCount-lastLaunch>15000)){Start("Start-Overlay.ps1","-FromHost");lastLaunch=Environment.TickCount;}wasRunning=active;
 if(!obsActive&&File.Exists(Path.Combine(root,"runtime","obs-registration.pending"))){Start("tools\\Register-Obs.ps1");}
 }catch{}Thread.Sleep(3000);}}}
}
