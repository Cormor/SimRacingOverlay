using System;
using System.Collections.Generic;
using System.Net;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
// Read-only generic SimHub fallback. Never changes properties or calls AZOM actions.
static class SimHubTelemetry {
 static readonly object gate=new object();static object cached=new {available=false};static long stamp;static string lastFrame;static int packet;static DateTime? lastFrameTime;static string lastFrameKey;
 sealed class LocalClient:WebClient {protected override WebRequest GetWebRequest(Uri address){var r=base.GetWebRequest(address);r.Timeout=350;r.Proxy=null;return r;}}
 static Dictionary<string,object> Map(object o){return o as Dictionary<string,object>;}
 static object Get(Dictionary<string,object> d,string k){object v;return d!=null&&d.TryGetValue(k,out v)?v:null;}
 static double? Num(Dictionary<string,object> d,string k){var v=Get(d,k);double n;if(v==null||!double.TryParse(Convert.ToString(v,System.Globalization.CultureInfo.InvariantCulture),System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out n)||double.IsNaN(n)||double.IsInfinity(n))return null;return n;}
 static double? Range(Dictionary<string,object> d,string k,double lo,double hi){var v=Num(d,k);return v.HasValue&&v>=lo&&v<=hi?v:null;}
 static bool Flag(Dictionary<string,object> d,string k){var v=Get(d,k);if(v is bool)return (bool)v;var n=Num(d,k);return n==1;}
 static double? Divide(double? v,double d){return v.HasValue?(double?)(v.Value/d):null;}
 static double? Pressure(Dictionary<string,object> n,string name){var p=Range(n,name,0.1,1500);string unit=Convert.ToString(Get(n,"TyrePressureUnit")).ToLowerInvariant();if(unit=="kpa")return Divide(p,6.894757293);if(unit=="psi")return p<=150?p:null;if(unit=="bar")return p.HasValue&&p<11?(double?)(p.Value*14.5037738):null;return null;}
 static bool? Loose(Dictionary<string,object> fb,int i){var a=Get(fb,"WheelInGrassOrGravel") as System.Collections.IList;return a!=null&&i<a.Count&&a[i] is bool?(bool?)a[i]:null;}
 static double[] Vector(double? x,double? y,double? z){return x.HasValue&&y.HasValue&&z.HasValue?new[]{x.Value,y.Value,z.Value}:null;}
 public static object Current(){lock(gate)return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-stamp<1000?cached:new {available=false};}
 public static void Start(){new Thread(Poll){IsBackground=true,Name="MOZA read-only SimHub telemetry"}.Start();}
 static void Poll(){var json=new JavaScriptSerializer();string probeCode=null;var root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
  try{probeCode=File.ReadAllText(Path.Combine(root,"assets","telemetry-probe.js"));}catch{}
  while(true){bool native=false;try{
   int port=8888;try{port=(int)Math.Max(1024,Math.Min(65535,Num(json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"settings.json"))),"simHubPort")??8888));}catch{}
   Dictionary<string,object> data=null;
   using(var c=new LocalClient()){c.Encoding=Encoding.UTF8;
    if(probeCode!=null)try{data=json.Deserialize<Dictionary<string,object>>(c.DownloadString("http://127.0.0.1:"+port+"/api/EvaluateStringFormula?interpreter=Javascript&formula="+Uri.EscapeDataString(probeCode)));native=NativeMotionTelemetry.Supported(Map(Get(data,"NativeMotion")));}catch{}
    if(!native){var file=Path.Combine(root,"runtime","simhub-telemetry.json");if(File.Exists(file)&&DateTime.UtcNow-File.GetLastWriteTimeUtc(file)<TimeSpan.FromSeconds(1))data=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));else data=json.Deserialize<Dictionary<string,object>>(c.DownloadString("http://127.0.0.1:"+port+"/api/getgamedata"));}
   }
   var result=Normalize(data,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
   if(result!=null)lock(gate){cached=result;stamp=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();}
  }catch{}Thread.Sleep(native?12:60);}
 }
 public static object Normalize(Dictionary<string,object> data,long sampleTime){
  var n=Map(Get(data,"NewData"));
  if(n==null||!Flag(data,"GameRunning"))return new {available=false};
  var raw=Map(Get(data,"NativeMotion"));bool native=NativeMotionTelemetry.Supported(raw);
  if(native&&!NativeMotionTelemetry.Coherent(raw))return null;
  string frame=native?NativeMotionTelemetry.FrameKey(raw):Convert.ToString(Get(data,"FrameTimeUTC")??Get(data,"FrameTime"));
  if(string.IsNullOrEmpty(frame)||frame==lastFrame)return null;
  DateTime parsed;string streamKey=Convert.ToString(Get(data,"SessionId"))+":"+Convert.ToString(Get(n,"CarModel"));
  if(DateTime.TryParse(frame,System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.RoundtripKind,out parsed)){
   if(lastFrameTime.HasValue&&lastFrameKey==streamKey&&parsed<=lastFrameTime.Value)return null;
   lastFrameTime=parsed;lastFrameKey=streamKey;
  }
  lastFrame=frame;packet++;
  var feedback=Map(Get(n,"FeedbackData"));string[] names={"FrontLeft","FrontRight","RearLeft","RearRight"};var wheels=new object[4];bool hasSlip=false;
  for(int i=0;i<4;i++){hasSlip=hasSlip||Num(feedback,names[i]+"WheelSlip").HasValue||Num(feedback,names[i]+"WheelLock").HasValue;wheels[i]=new Dictionary<string,object>{{"key",new[]{"FL","FR","RL","RR"}[i]},{"load",null},{"fx",null},{"fy",null},{"mz",null},{"angle",null},{"ratio",null},
   {"slipFeedback",Range(feedback,names[i]+"WheelSlip",-100,100)},{"lockFeedback",Range(feedback,names[i]+"WheelLock",0,100)},{"speed",Range(feedback,names[i]+"WheelSpeed",-1000,1000)},
   {"pressurePsi",Pressure(n,"TyrePressure"+names[i])},{"temperatureC",Convert.ToString(Get(n,"TemperatureUnit"))=="Celcius"?Range(n,"TyreTemperature"+names[i],-80,250):null},
   {"onLooseSurface",Loose(feedback,i)},{"suspensionVelocity",Range(feedback,names[i]+"SuspensionVelocityMs",-20,20)}};}
  var lv=Map(Get(feedback,"LocalVelocity"));
  var result=new Dictionary<string,object>{{"available",true},{"telemetryVersion",2},{"optionalVersion",1},{"packet",packet},{"source","SimHub-generic"},{"carModel",Convert.ToString(Get(n,"CarModel"))},
   {"sampleTime",sampleTime},{"speedKmh",Num(n,"SpeedKmh")},{"rpm",Num(n,"Rpms")},{"maxRpm",Num(n,"MaxRpm")},{"gear",Get(n,"Gear")},
   {"accGFrame","body"},{"handbrake",Divide(Range(n,"Handbrake",0,100),100)},{"gas",Divide(Range(n,"Throttle",0,100),100)},{"brake",Divide(Range(n,"Brake",0,100),100)},{"clutch",Divide(Range(n,"Clutch",0,100),100)},{"wheels",wheels},
   {"accG",Vector(Divide(Range(n,"AccelerationSway",-294,294),9.80665),Divide(Range(n,"AccelerationHeave",-294,294),9.80665),Divide(Range(n,"AccelerationSurge",-294,294),9.80665))},
   {"localVelocity",Vector(Range(lv,"Lateral",-250,250),Range(lv,"Upward",-250,250),Range(lv,"Forward",-250,250))},
   {"fieldPolicy","reported optional fields; feedback is not asserted to be a native physical slip ratio"},
   {"paused",Flag(data,"GamePaused")},{"inMenu",Flag(data,"GameInMenu")},{"capabilities",new {forces=false,loads=false,slipFeedback=hasSlip}},
   {"statuses",new {absActive=(Num(n,"ABSActive")??0)>0,tcActive=(Num(n,"TCActive")??0)>0,escActive=(object)null}}};
  if(native)NativeMotionTelemetry.Enrich(result,raw);
  return result;
 }

}
