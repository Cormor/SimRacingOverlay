using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
// Read-only generic SimHub fallback. Never changes properties or calls AZOM actions.
static class SimHubTelemetry {
 static long nativeAt=-1;
 static long ClockMs(){return (long)(Stopwatch.GetTimestamp()*1000.0/Stopwatch.Frequency);}
 public static void NativeObserved(){Interlocked.Exchange(ref nativeAt,ClockMs());}
 static readonly object gate=new object();
 static readonly FrameCache frames=new FrameCache();
 static readonly AutoResetEvent demandChanged=new AutoResetEvent(false);
 static readonly object Unavailable=new {available=false};
 const int DemandMs=400,RequestMs=350,CycleMs=700;
 static Func<int> readPort;
 static int demandPort;
 static long lastDemand=-1,demandSince=-1,demandEpoch,publishedEpoch=-1;
 static long lastResultEpoch=-1;
 static bool endpointUnavailable;
 static string latestError;
 static long? latestErrorAt;
 public static object Diagnostics(){lock(gate){
  long now=ClockMs(),lastNative=Interlocked.Read(ref nativeAt);
  bool wanted=Wanted(now,lastNative);
  long cutoff=Math.Max(lastNative,demandSince-1);
  bool available=publishedEpoch==demandEpoch&&!object.ReferenceEquals(frames.Current(now,cutoff),Unavailable);
  long? sampleAt=frames.LastSampleAt;
  string state=lastDemand<0&&lastNative<0?"unknown":!wanted?"not-requested":available?"available":
   publishedEpoch==demandEpoch&&frames.Stopped?"unavailable":
   publishedEpoch==demandEpoch&&sampleAt>cutoff?"expired":
   lastResultEpoch==demandEpoch&&endpointUnavailable?"unavailable":"waiting";
  return new {state,lastSampleAgeMs=now-sampleAt,observedAgeMs=lastDemand<0?(long?)null:now-lastDemand,
   latestError,latestErrorAgeMs=now-latestErrorAt};
 }}
 static Dictionary<string,object> Map(object o){return o as Dictionary<string,object>;}
 static object Get(Dictionary<string,object> d,string k){object v;return d!=null&&d.TryGetValue(k,out v)?v:null;}
 static double? Num(Dictionary<string,object> d,string k){var v=Get(d,k);double n;if(v==null||!double.TryParse(Convert.ToString(v,System.Globalization.CultureInfo.InvariantCulture),System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out n)||double.IsNaN(n)||double.IsInfinity(n))return null;return n;}
 static double? Range(Dictionary<string,object> d,string k,double lo,double hi){var v=Num(d,k);return v.HasValue&&v>=lo&&v<=hi?v:null;}
 static bool Flag(Dictionary<string,object> d,string k){var v=Get(d,k);if(v is bool)return (bool)v;var n=Num(d,k);return n==1;}
 static double? Divide(double? v,double d){return v.HasValue?(double?)(v.Value/d):null;}
 static double? Pressure(Dictionary<string,object> n,string name){var p=Range(n,name,0.1,1500);string unit=Convert.ToString(Get(n,"TyrePressureUnit")).ToLowerInvariant();if(unit=="kpa")return Divide(p,6.894757293);if(unit=="psi")return p<=150?p:null;if(unit=="bar")return p.HasValue&&p<11?(double?)(p.Value*14.5037738):null;return null;}
 static bool? Loose(Dictionary<string,object> fb,int i){var a=Get(fb,"WheelInGrassOrGravel") as System.Collections.IList;return a!=null&&i<a.Count&&a[i] is bool?(bool?)a[i]:null;}
 static double[] Vector(double? x,double? y,double? z){return x.HasValue&&y.HasValue&&z.HasValue?new[]{x.Value,y.Value,z.Value}:null;}
 static bool Wanted(long now,long lastNative){
  return lastDemand>lastNative&&now-lastDemand<DemandMs;
 }
 public static object Current(){lock(gate){
  long now=ClockMs(),lastNative=Interlocked.Read(ref nativeAt);
  int port=readPort();
  if(port!=demandPort||!Wanted(now,lastNative)){
   demandPort=port;demandSince=now;demandEpoch++;
   demandChanged.Set();
  }
  lastDemand=now;
  return publishedEpoch==demandEpoch?frames.Current(now,Math.Max(lastNative,demandSince-1)):Unavailable;
 }}
 public static void Start(Func<int> configuredPort){
  readPort=configuredPort;
  new Thread(Poll){IsBackground=true,Name="read-only SimHub telemetry"}.Start();
 }
 static string Download(string uri,long deadline){
  int remaining=(int)Math.Min(RequestMs,deadline-ClockMs());
  if(remaining<=0)throw new TimeoutException();
  var request=(HttpWebRequest)WebRequest.Create(uri);
  request.Proxy=null;request.Timeout=remaining;request.ReadWriteTimeout=remaining;
  using(var timeout=new Timer(_=>request.Abort(),null,remaining,Timeout.Infinite))
  using(var response=request.GetResponse())
  using(var body=new StreamReader(response.GetResponseStream(),Encoding.UTF8))
   return body.ReadToEnd();
 }
 static void Poll(){
  var json=new JavaScriptSerializer();
  var root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
  var pluginFile=Path.Combine(root,"runtime","simhub-telemetry.json");
  string probePath=null;
  try{probePath="/api/EvaluateStringFormula?interpreter=Javascript&formula="+
   Uri.EscapeDataString(File.ReadAllText(Path.Combine(root,"assets","telemetry-probe.js")));}catch{}
  long probingEpoch=-1,nextProbe=0;
  DateTime lastPluginWrite=DateTime.MinValue;
  Dictionary<string,object> pluginData=null;
  while(true){
   int port=0;
   long epoch=0,since=0,lastNative;
   lock(gate){
    lastNative=Interlocked.Read(ref nativeAt);
    if(Wanted(ClockMs(),lastNative)){port=demandPort;epoch=demandEpoch;since=demandSince;}
   }
   if(port==0){demandChanged.WaitOne();continue;}
   if(epoch!=probingEpoch){probingEpoch=epoch;nextProbe=0;}

   bool native=false;
   try{
    long now=ClockMs(),deadline=now+CycleMs;
    string uri="http://127.0.0.1:"+port;
    string channel="probe";
    Dictionary<string,object> data=null;
    if(probePath!=null&&now>=nextProbe){
     nextProbe=now+1000;
     try{
      data=json.Deserialize<Dictionary<string,object>>(Download(uri+probePath,deadline));
      native=NativeMotionTelemetry.Supported(Map(Get(data,"NativeMotion")));
      if(native)nextProbe=0;
     }catch{}
    }
    if(!native){
     var written=File.GetLastWriteTimeUtc(pluginFile);
     var age=DateTime.UtcNow-written;
     if(age>=TimeSpan.Zero&&age<TimeSpan.FromSeconds(1)){
      channel="plugin";
      if(written!=lastPluginWrite){
       pluginData=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(pluginFile));
       lastPluginWrite=written;
      }
      data=pluginData;
     }else{
      channel="api";
      data=json.Deserialize<Dictionary<string,object>>(Download(uri+"/api/getgamedata",deadline));
     }
    }
    lock(gate){
     now=ClockMs();
     if(epoch==demandEpoch&&port==readPort()&&lastNative==Interlocked.Read(ref nativeAt)&&Wanted(now,lastNative)){
      if(data!=null){
       var accepted=frames.Observe(data,now,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),channel+":"+port,Math.Max(lastNative,since-1));
       if(accepted!=null)publishedEpoch=epoch;
      }else{
       latestError="invalid-fallback-response";latestErrorAt=now;
      }
      lastResultEpoch=epoch;endpointUnavailable=data==null;
     }
    }
   }catch(Exception error){lock(gate){
    if(epoch==demandEpoch&&port==readPort()&&lastNative==Interlocked.Read(ref nativeAt)&&Wanted(ClockMs(),lastNative)){
     lastResultEpoch=epoch;endpointUnavailable=true;latestErrorAt=ClockMs();
     var network=error as WebException;
     latestError=network!=null?(network.Status==WebExceptionStatus.Timeout?"http-timeout":"http-unavailable"):
      error is IOException?"fallback-read-error":"invalid-fallback-response";
    }
   }}
   demandChanged.WaitOne(native?12:60);
  }
 }

 internal sealed class FrameCache {
  const int LifetimeMs=1000;
  readonly string instance=Guid.NewGuid().ToString("N");
  string identity,lastFrame;
  double? lastNativeTime,probeTime;
  long? lastOrder,probeOrder;
  long probeAt;
  long stamp=-1,epoch;
  int packet;
  bool stopped;
  object cached;
  internal long? LastSampleAt{get{return stamp>=0?(long?)stamp:null;}}
  internal bool Stopped{get{return stopped;}}

  bool Fresh(long now,long nativeAt){return stamp>nativeAt&&now>=stamp&&now-stamp<LifetimeMs;}
  internal object Current(long now,long nativeAt=-1){return cached!=null&&Fresh(now,nativeAt)?cached:Unavailable;}

  static int OrderDelta(long next,long prior,bool native){
   return native?unchecked((int)((uint)next-(uint)prior)):next.CompareTo(prior);
  }
  bool ConfirmsRestart(long order,double? producerTime,bool native,long now){
   if(!stopped&&now-stamp<LifetimeMs)return false;
   int delta=probeOrder.HasValue?OrderDelta(order,probeOrder.Value,native):0;
   if(!probeOrder.HasValue||now-probeAt>=LifetimeMs||delta<0||producerTime<probeTime){
    probeOrder=order;probeTime=producerTime;probeAt=now;return false;
   }
   return now>probeAt&&delta>0;
  }

  internal object Observe(Dictionary<string,object> data,long now,long receivedAt,string channel,long nativeAt=-1){
   var n=Map(Get(data,"NewData"));
   if(n==null||!Flag(data,"GameRunning")){
    cached=null;probeOrder=null;stopped=true;return Unavailable;
   }
   var raw=Map(Get(data,"NativeMotion"));
   bool native=NativeMotionTelemetry.Supported(raw);
   if(native&&!NativeMotionTelemetry.Coherent(raw))return null;

   // Game name contributes to identity only, never schema or source selection.
   string nextIdentity=string.Join("|",channel,native?"motion":"generic",Convert.ToString(Get(data,"GameName")),
    Convert.ToString(Get(data,"SessionId")),Convert.ToString(Get(n,"CarModel")),
    native?Convert.ToString(Get(raw,"session")):"",
    native?Convert.ToString(Get(raw,"playerCarIndex")):"");
   bool same=nextIdentity==identity;
   uint? nextNativeTick=native?(uint?)Num(raw,"frame").Value:null;
   double? nextNativeTime=native?Num(raw,"time"):null;
   string nextFrame=native?nextNativeTick.Value.ToString(CultureInfo.InvariantCulture):
    Convert.ToString(Get(data,"FrameTimeUTC")??Get(data,"FrameTime"));
   if(string.IsNullOrEmpty(nextFrame)||same&&nextFrame==lastFrame)return null;
   DateTimeOffset ordered;
   long? nextOrder=nextNativeTick.HasValue?(long?)nextNativeTick.Value:
    DateTimeOffset.TryParse(nextFrame,CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal,out ordered)?(long?)ordered.UtcTicks:null;
   if(same&&nextOrder.HasValue&&lastOrder.HasValue){
    int delta=OrderDelta(nextOrder.Value,lastOrder.Value,native);
    if(delta==0||delta<0&&!ConfirmsRestart(nextOrder.Value,nextNativeTime,native,now))return null;
   }
   bool rewound=same&&nextNativeTime.HasValue&&lastNativeTime.HasValue&&nextNativeTime.Value<lastNativeTime.Value;
   if(!same||stopped||!Fresh(now,nativeAt)||rewound)epoch++;
   var result=Normalize(data,n,raw,native,now,receivedAt,++packet,instance+":"+epoch);
   identity=nextIdentity;lastFrame=nextFrame;lastOrder=nextOrder;lastNativeTime=nextNativeTime;
   stopped=false;probeOrder=null;cached=result;stamp=now;
   return result;
  }
 }
 static object Normalize(Dictionary<string,object> data,Dictionary<string,object> n,Dictionary<string,object> raw,
  bool native,long sampleTime,long receivedAt,int packet,string streamEpoch){
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
  result["sampleTimeKind"]=native?"producer-session":"bridge-observed-monotonic";
  result["receivedAt"]=receivedAt;
  result["streamEpoch"]=streamEpoch;
  return result;
 }

}
