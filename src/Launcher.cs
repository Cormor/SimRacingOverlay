using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Threading;
using System.Management;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Security.Cryptography;

class Launcher {
 static string root;
 static readonly AutoResetEvent wake=new AutoResetEvent(false);
 static readonly List<FileSystemWatcher> files=new List<FileSystemWatcher>();
 static readonly List<ManagementEventWatcher> hosts=new List<ManagementEventWatcher>();
 static int resetRetry=1;
 static volatile bool hostEvents=true;
 static int rebuildFiles;
 static readonly object statusGate=new object();
 static long Clock {get{return Stopwatch.GetTimestamp()*1000/Stopwatch.Frequency;}}
 static void Changed(bool retry){if(retry)Interlocked.Exchange(ref resetRetry,1);wake.Set();}
 static Dictionary<string,object> Read(string file){return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(file));}
 static object Field(Dictionary<string,object> data,string name){object value;return data!=null&&data.TryGetValue(name,out value)?value:null;}
 static string Text(Dictionary<string,object> data,string name){return Convert.ToString(Field(data,name));}
 static string Runtime(string name){return Path.Combine(root,"runtime",name);}
 static void Status(string state,string error=null) {
  lock(statusGate)try{
   string path=Runtime("launcher-state.json"),temp=path+".tmp";
   string data=new JavaScriptSerializer().Serialize(new{root=root,state=state,error=error,time=DateTime.UtcNow.ToString("O")});
   File.WriteAllText(temp,data,new UTF8Encoding(false));if(File.Exists(path))File.Replace(temp,path,null);else File.Move(temp,path);
  }catch{}
 }
 sealed class Command:IDisposable {
  public readonly Process Process;
  readonly StringBuilder output=new StringBuilder();
  public Command(string script,string args="") {
   Process=new Process{StartInfo=new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \""+Path.Combine(root,script)+"\" "+args){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=root,RedirectStandardOutput=true,RedirectStandardError=true},EnableRaisingEvents=true};
   DataReceivedEventHandler append=(sender,e)=>{if(e.Data!=null)lock(output){if(output.Length<8192)output.AppendLine(e.Data.Substring(0,Math.Min(e.Data.Length,8192-output.Length)));}};
   Process.OutputDataReceived+=append;Process.ErrorDataReceived+=append;Process.Exited+=(sender,e)=>Changed(false);
   Process.Start();Process.BeginOutputReadLine();Process.BeginErrorReadLine();
  }
  public string Output {get{lock(output)return output.ToString();}}
  public void Dispose(){Process.Dispose();}
 }
 static void Watch(string directory,Action<string> changed) {
  var watcher=new FileSystemWatcher(directory){NotifyFilter=NotifyFilters.FileName|NotifyFilters.DirectoryName|NotifyFilters.LastWrite};
  watcher.Changed+=(s,e)=>changed(e.Name);watcher.Created+=(s,e)=>changed(e.Name);watcher.Deleted+=(s,e)=>changed(e.Name);watcher.Renamed+=(s,e)=>{changed(e.OldName);changed(e.Name);};
  watcher.Error+=(s,e)=>{Interlocked.Exchange(ref rebuildFiles,1);Status("watch-error",e.GetException().Message);Changed(true);};
  watcher.EnableRaisingEvents=true;files.Add(watcher);
 }
 static void WatchOwnFiles() {
  foreach(var watcher in files)watcher.Dispose();files.Clear();
  Watch(root,name=>{if(name=="settings.json")Changed(true);});
  Watch(Runtime(""),name=>{if(name=="autostart.paused")Changed(true);else if(name=="installing.json"||name=="lifecycle-state.json"||name=="integration.json"||name=="obs-registration.pending")Changed(false);});
 }
 static void WatchHosts() {
  foreach(string kind in new[]{"Start","Stop"})try {
   var watcher=new ManagementEventWatcher(new WqlEventQuery("SELECT * FROM Win32_Process"+kind+"Trace WHERE ProcessName='obs64.exe' OR ProcessName='SimHubWPF.exe'"));
   watcher.EventArrived+=(s,e)=>Changed(true);
   watcher.Stopped+=(s,e)=>{hostEvents=false;Status("host-events-unavailable","Host process observation stopped; using a low-frequency process check.");Changed(false);};
   watcher.Start();hosts.Add(watcher);
  }catch(Exception e){hostEvents=false;Status("host-events-unavailable",e.Message);}
 }
 static bool Running(string name) {
  Process[] values=Process.GetProcessesByName(name);bool result=values.Length>0;foreach(var process in values)process.Dispose();return result;
 }
 static Process Attach(Process previous,int id,string relative,bool desktop=false) {
  if(previous!=null){if(previous.Id==id&&!previous.HasExited)return previous;previous.Dispose();}
  if(id<=0)return null;
  try {
   var process=Process.GetProcessById(id);
   try {
    if(!OverlayLifecyclePaths.Same(process.MainModule.FileName,Path.Combine(root,relative))){process.Dispose();return null;}
    if(desktop)using(var instance=new ManagementObject("Win32_Process.Handle='"+id+"'")){if(!OverlayLifecyclePaths.HasScript(Convert.ToString(instance["CommandLine"]),Path.Combine(root,"desktop-main.js"))){process.Dispose();return null;}}
    process.EnableRaisingEvents=true;process.Exited+=(s,e)=>Changed(false);return process;
   }catch{process.Dispose();throw;}
  }catch(ArgumentException){return null;}catch(InvalidOperationException){return null;}
 }
 static int Number(Dictionary<string,object> value,string name){int result;return Int32.TryParse(Text(value,name),out result)?result:0;}
 static bool StartAvailable() {
  using(var mutex=new Mutex(false,"Local\\SimRacingOverlay.Start")) {
   bool owned=false;try{try{owned=mutex.WaitOne(0);}catch(AbandonedMutexException){owned=true;}return owned;}finally{if(owned)mutex.ReleaseMutex();}
  }
 }
 static FileSystemWatcher sceneWatcher;
 static string sceneObserved;
 static string ObserveScenes() {
  string target=null;
  if(File.Exists(Runtime("integration.json"))) {var cfg=Read(Runtime("integration.json"));string config=Text(cfg,"obsConfig");if(!String.IsNullOrWhiteSpace(config))target=Path.Combine(config,"basic","scenes");}
  string directory=target,filter="*.json";
  while(directory!=null&&!Directory.Exists(directory)){filter=Path.GetFileName(directory);directory=Path.GetDirectoryName(directory);}
  string identity=directory==null?null:directory+"|"+filter;
  if(identity!=sceneObserved) {
   if(sceneWatcher!=null){sceneWatcher.Dispose();sceneWatcher=null;}
   sceneObserved=identity;
   if(directory!=null) {
    sceneWatcher=new FileSystemWatcher(directory,filter){NotifyFilter=NotifyFilters.FileName|NotifyFilters.DirectoryName|NotifyFilters.LastWrite};
    FileSystemEventHandler changed=(s,e)=>Changed(false);
    sceneWatcher.Created+=changed;sceneWatcher.Deleted+=changed;sceneWatcher.Changed+=changed;sceneWatcher.Renamed+=(s,e)=>Changed(false);
    sceneWatcher.Error+=(s,e)=>{sceneObserved=null;Status("registration-watch-error",e.GetException().Message);Changed(false);};sceneWatcher.EnableRaisingEvents=true;
   }
  }
  return target;
 }
 static string RegistrationKey(string scenes) {
  if(!File.Exists(Runtime("obs-registration.pending"))||String.IsNullOrEmpty(scenes)||!Directory.Exists(scenes))return null;
  string[] paths=Directory.GetFiles(scenes,"*.json");if(paths.Length==0)return null;Array.Sort(paths,StringComparer.OrdinalIgnoreCase);
  var key=new StringBuilder(File.GetLastWriteTimeUtc(Runtime("obs-registration.pending")).Ticks.ToString());
  foreach(string path in paths)key.Append('|').Append(Path.GetFileName(path)).Append(':').Append(File.GetLastWriteTimeUtc(path).Ticks);
  return key.ToString();
 }
 static void RunWatcher() {
  Directory.CreateDirectory(Runtime(""));WatchHosts();Interlocked.Exchange(ref rebuildFiles,1);
  Process bridge=null,desktop=null;Command start=null,registration=null;
  int attempts=0;long nextAttempt=0,healthySince=0;string registrationKey=null;bool wasActive=false;
  try {
   while(true) {
    int wait=hostEvents?Timeout.Infinite:3000;
    try {
     if(Interlocked.Exchange(ref rebuildFiles,0)!=0){try{WatchOwnFiles();}catch{Interlocked.Exchange(ref rebuildFiles,1);throw;}}
     bool obs=Running("obs64"),active=obs||Running("SimHubWPF");
     if(Interlocked.Exchange(ref resetRetry,0)!=0||active&&!wasActive){attempts=0;nextAttempt=0;}
     wasActive=active;
     if(start!=null&&start.Process.HasExited){start.Process.WaitForExit();if(start.Process.ExitCode!=0)Status("start-failed",start.Output);start.Dispose();start=null;nextAttempt=Clock+(attempts==1?1000:attempts==2?3000:10000);}
     if(registration!=null&&registration.Process.HasExited){registration.Process.WaitForExit();if(registration.Process.ExitCode!=0)Status("registration-failed",registration.Output);registration.Dispose();registration=null;}
     if(File.Exists(Runtime("lifecycle-state.json"))) {
      var state=Read(Runtime("lifecycle-state.json"));
      if(Text(state,"state")=="running"&&OverlayLifecyclePaths.Same(Text(state,"root"),root)) {
       bridge=Attach(bridge,Number(state,"bridgePid"),"runtime\\SimRacingBridge.exe");desktop=Attach(desktop,Number(state,"desktopPid"),"runtime\\electron\\electron.exe",true);
      }
     }
     bool healthy=bridge!=null&&!bridge.HasExited&&desktop!=null&&!desktop.HasExited;
     if(healthy){if(healthySince==0)healthySince=Clock;}
     else if(healthySince!=0){if(Clock-healthySince>=30000)attempts=0;healthySince=0;nextAttempt=Clock+1000;}
     bool paused=File.Exists(Runtime("autostart.paused")),updating=File.Exists(Runtime("installing.json"));
     if(active&&!paused&&!updating&&!healthy&&start==null&&attempts<4) {
      if(Clock>=nextAttempt&&StartAvailable()){attempts++;Status("starting");start=new Command("Start-Overlay.ps1","-FromHost");}
      else wait=Math.Min(wait==Timeout.Infinite?Int32.MaxValue:wait,(int)Math.Max(100,Math.Min(1000,nextAttempt-Clock)));
     }
     string scenes=ObserveScenes(),key=RegistrationKey(scenes);
     if(!obs&&!updating&&key!=null&&key!=registrationKey&&registration==null) {
      if(StartAvailable()){registrationKey=key;registration=new Command("tools\\Register-Obs.ps1");}
      else wait=Math.Min(wait==Timeout.Infinite?Int32.MaxValue:wait,1000);
     }
    } catch(Exception error){Status("watcher-error",error.Message);wait=3000;}
    wake.WaitOne(wait);
   }
  } finally {
   if(bridge!=null)bridge.Dispose();if(desktop!=null)desktop.Dispose();if(start!=null)start.Dispose();if(registration!=null)registration.Dispose();
   if(sceneWatcher!=null)sceneWatcher.Dispose();foreach(var watcher in files)watcher.Dispose();foreach(var watcher in hosts)watcher.Dispose();
  }
 }
 static string StartFailureMessage(string detail) {
  if(detail.IndexOf("Port ",StringComparison.OrdinalIgnoreCase)>=0&&detail.IndexOf("another process",StringComparison.OrdinalIgnoreCase)>=0)return "本程序使用的端口已被其他程序占用。请关闭占用端口的程序后重试。";
  if(detail.IndexOf("update has not finished",StringComparison.OrdinalIgnoreCase)>=0)return "更新尚未完成，请等待安装结束后再打开。";
  if(detail.IndexOf("still in progress",StringComparison.OrdinalIgnoreCase)>=0)return "程序正在启动、退出或更新，请稍候再试。";
  if(detail.IndexOf("kept the current edit open",StringComparison.OrdinalIgnoreCase)>=0)return "当前编辑尚未关闭。请回到管理窗口保存并完成编辑后重试。";
  return "程序未能启动，请重试；仍无法打开时，请重新安装最新版本。错误详情已保存在安装目录的 runtime/launcher-state.json。";
 }
 [STAThread]static int Main(string[] args) {
  try {
   root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));bool watch=false;
   for(int i=0;i<args.Length;i++){if(args[i]=="--watch")watch=true;else if(args[i]=="--root"&&i+1<args.Length)root=args[++i];else throw new ArgumentException("Unknown launcher argument: "+args[i]);}
   root=OverlayLifecyclePaths.Canonical(root);
   if(!watch){using(var command=new Command("Start-Overlay.ps1","-OpenManager")){command.Process.WaitForExit();if(command.Process.ExitCode!=0){Status("start-failed",command.Output);System.Windows.Forms.MessageBox.Show(StartFailureMessage(command.Output),"无法启动 SimRacingOverlay",System.Windows.Forms.MessageBoxButtons.OK,System.Windows.Forms.MessageBoxIcon.Error);}return command.Process.ExitCode;}}
   string identity;using(var sha=SHA256.Create())identity=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(root.ToLowerInvariant()))).Replace("-","");
   bool first;using(var mutex=new Mutex(true,"Local\\SimRacingOverlay.StartupWatcher."+identity,out first)){if(!first)return 0;RunWatcher();}
   return 0;
  } catch(Exception error){if(root!=null)Status("launcher-failed",error.Message);return 1;}
 }
}
