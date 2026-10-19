using System;using System.IO;using System.Diagnostics;using System.Reflection;using System.Threading;using System.Collections.Generic;using System.Web.Script.Serialization;using SimHub.Plugins;using GameReaderCommon;
namespace SimRacingOverlay {
 [PluginName("SimRacingOverlay")][PluginAuthor("Cormor")][PluginDescription("Starts the overlay and exports normalized game telemetry locally.")]
 public sealed class SimHubPlugin:IPlugin,IDataPlugin {
  public PluginManager PluginManager {get;set;}string root;Timer writer;object latest;long serial;static int launched;bool disposed;int flushing;
  static object Read(object o,string name){if(o==null)return null;try{var p=o.GetType().GetProperty(name);return p==null?null:p.GetValue(o,null);}catch{return null;}}
  static Dictionary<string,object> Fields(object o,string[] names){var d=new Dictionary<string,object>();foreach(var n in names){var v=Read(o,n);if(v!=null&&(v is string||v is bool||v is int||v is double||v is float||v is long||v is decimal||v.GetType().IsEnum))d[n]=v;}return d;}
  public void Init(PluginManager manager){try{root=File.ReadAllText(Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location),"SimRacingOverlay.path")).Trim();if(!Path.IsPathRooted(root)||!File.Exists(Path.Combine(root,"Start-Overlay.ps1")))return;
   if(Interlocked.Exchange(ref launched,1)==0){var s=new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \""+Path.Combine(root,"Start-Overlay.ps1")+"\" -FromSimHub"){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=root};using(var p=Process.Start(s)){} }
   writer=new Timer(Flush,null,0,20);
  }catch(Exception e){Trace.TraceError("SimRacingOverlay: "+e.GetType().Name);}}
  public void DataUpdate(PluginManager manager,ref GameData data){if(disposed||root==null)return;try{
   var n=Fields(data.NewData,new[]{"CarModel","SpeedKmh","Rpms","MaxRpm","Gear","Throttle","Brake","Clutch","Handbrake","AccelerationSway","AccelerationHeave","AccelerationSurge","ABSActive","TCActive","TemperatureUnit","TyrePressureUnit","TyrePressureFrontLeft","TyrePressureFrontRight","TyrePressureRearLeft","TyrePressureRearRight","TyreTemperatureFrontLeft","TyreTemperatureFrontRight","TyreTemperatureRearLeft","TyreTemperatureRearRight"});
   var feedback=Read(data.NewData,"FeedbackData");var fields=new List<string>();foreach(var w in new[]{"FrontLeft","FrontRight","RearLeft","RearRight"})foreach(var suffix in new[]{"WheelSlip","WheelLock","WheelSpeed","SuspensionVelocityMs"})fields.Add(w+suffix);n["FeedbackData"]=Fields(feedback,fields.ToArray());
   var f=new Dictionary<string,object>{{"GameRunning",data.GameRunning},{"GameName",Convert.ToString(Read(data,"GameName"))},{"GamePaused",Read(data,"GamePaused")??false},{"GameInMenu",Read(data,"GameInMenu")??false},{"FrameTimeUTC",DateTime.UtcNow.ToString("O")},{"NewData",n}};Interlocked.Exchange(ref latest,f);Interlocked.Increment(ref serial);
  }catch{}}
  void Flush(object unused){if(disposed||Interlocked.Exchange(ref flushing,1)!=0)return;try{var frame=Interlocked.Exchange(ref latest,null);if(frame==null)return;try{var folder=Path.Combine(root,"runtime");Directory.CreateDirectory(folder);var f=Path.Combine(folder,"simhub-telemetry.json");File.WriteAllText(f+".tmp",new JavaScriptSerializer().Serialize(frame));if(File.Exists(f))File.Replace(f+".tmp",f,null);else File.Move(f+".tmp",f);}catch{}}finally{Interlocked.Exchange(ref flushing,0);}}
  public void End(PluginManager manager){disposed=true;if(writer!=null)writer.Dispose();}
 }
}
