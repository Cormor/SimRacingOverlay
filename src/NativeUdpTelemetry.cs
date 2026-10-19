using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading;

// Wire-layout decoder only. The estimator never receives or branches on a game name.
// Packet format/version identify the documented layout, not a vehicle/grip preset.
sealed class MotionPacketStream {
 readonly object gate=new object();
 Dictionary<string,object> motion,world,car;ulong? session;uint lastMotionFrame;bool haveFrame;long lastMotionAt;int sequence;
 readonly Queue<long> arrivals=new Queue<long>();bool? paused;int? maxRpm,absSetting,tcSetting;
 public long Received,Accepted,Rejected;
 static double? F(byte[] b,int o){double v=BitConverter.ToSingle(b,o);return double.IsNaN(v)||double.IsInfinity(v)?(double?)null:v;}
 static object[] Floats(byte[] b,int o,int n){return Enumerable.Range(0,n).Select(i=>(object)F(b,o+4*i)).ToArray();}
 static double[] Dirs(byte[] b,int o){return Enumerable.Range(0,3).Select(i=>(double)BitConverter.ToInt16(b,o+2*i)).ToArray();}
 static object Get(Dictionary<string,object> d,string k){object v;return d!=null&&d.TryGetValue(k,out v)?v:null;}
 public bool Ingest(byte[] b,long now){lock(gate){
  Received++;
  if(b==null||b.Length<29||BitConverter.ToUInt16(b,0)!=2025||b[5]!=1||b[27]>=22){Rejected++;return false;}
  int id=b[6],size=id==0?1349:id==1?753:id==6?1352:id==7?1239:id==13?273:0;
  if(size==0)return false;if(b.Length!=size){Rejected++;return false;}
  ulong uid=BitConverter.ToUInt64(b,7);uint frame=BitConverter.ToUInt32(b,23);var time=F(b,15);
  if(!time.HasValue||time.Value<0){Rejected++;return false;}
  if(session!=uid){session=uid;motion=null;world=null;car=null;haveFrame=false;arrivals.Clear();maxRpm=null;absSetting=null;tcSetting=null;paused=null;}
  int o=29+b[27]*60;
  if(id==0){
   world=new Dictionary<string,object>{{"worldAt",now},{"worldFrame",(double)frame},{"velocity",Floats(b,o+12,3)},{"forward",Dirs(b,o+24)},{"right",Dirs(b,o+30)},
    {"accG",new object[]{F(b,o+36),F(b,o+44),F(b,o+40)}}};
  }else if(id==13){
   if(haveFrame&&(int)(frame-lastMotionFrame)<=0){Rejected++;return false;}
   motion=new Dictionary<string,object>{{"frameBefore",(double)frame},{"frame",(double)frame},{"session",uid.ToString()},{"time",time},
    {"speedMs",Floats(b,77,4)},{"ratio",Floats(b,93,4)},{"angle",Floats(b,109,4)},{"fy",Floats(b,125,4)},{"fx",Floats(b,141,4)},
    {"localVelocity",Floats(b,161,3)},{"angularVelocity",Floats(b,173,3)},{"roadWheelAngle",F(b,197)},{"load",Floats(b,201,4)}};
   haveFrame=true;lastMotionFrame=frame;lastMotionAt=now;sequence++;arrivals.Enqueue(now);while(arrivals.Count>0&&now-arrivals.Peek()>1000)arrivals.Dequeue();
  }else if(id==6){
   car=new Dictionary<string,object>{{"frame",(double)frame},{"at",now},{"speedKmh",(double)BitConverter.ToUInt16(b,o)},{"gas",F(b,o+2)},{"brake",F(b,o+10)},
    {"clutch",b[o+14]/100.0},{"gear",(int)(sbyte)b[o+15]},{"rpm",(int)BitConverter.ToUInt16(b,o+16)},
    {"pressure",Floats(b,o+40,4)},{"temperature",Enumerable.Range(0,4).Select(i=>(object)(double)b[o+34+i]).ToArray()}};
  }else if(id==7){int c=29+b[27]*55;maxRpm=BitConverter.ToUInt16(b,c+17);tcSetting=b[c];absSetting=b[c+1];
  }else if(id==1)paused=b[43]!=0;
  Accepted++;return true;
 }}
 public object Current(long now){lock(gate){
  if(motion==null||now-lastMotionAt>400||now<lastMotionAt)return null;
  var raw=new Dictionary<string,object>(motion);if(world!=null&&now-Convert.ToInt64(world["worldAt"])<=150)foreach(var kv in world)raw[kv.Key]=kv.Value;
  object[] wheels=Enumerable.Range(0,4).Select(i=>(object)new Dictionary<string,object>{{"key",new[]{"FL","FR","RL","RR"}[i]}}).ToArray();
  bool carFresh=car!=null&&now-Convert.ToInt64(car["at"])<=250&&Math.Abs(Convert.ToDouble(car["frame"])-lastMotionFrame)<=3;
  var g=new Dictionary<string,object>{{"available",true},{"packet",sequence},{"sampleTime",now},{"wheels",wheels},{"carModel",""},
   {"speedKmh",carFresh?Get(car,"speedKmh"):null},{"gas",carFresh?Get(car,"gas"):null},{"brake",carFresh?Get(car,"brake"):null},
   {"clutch",carFresh?Get(car,"clutch"):null},{"gear",carFresh?Get(car,"gear"):null},{"rpm",carFresh?Get(car,"rpm"):null},{"maxRpm",maxRpm},
   {"paused",paused},{"inMenu",null},{"statuses",new {absActive=(object)null,tcActive=(object)null,escActive=(object)null,absSetting=absSetting,tcSetting=tcSetting}}};
  NativeMotionTelemetry.Enrich(g,raw);g["source"]="UDP-native-motion";g["transport"]=new {kind="loopback-udp",port=20778,receivedHz=arrivals.Count,packetFormat=2025};
  if(carFresh){int[] order={2,3,0,1};var ps=(object[])car["pressure"];var ts=(object[])car["temperature"];for(int i=0;i<4;i++){var w=(Dictionary<string,object>)wheels[i];w["pressurePsi"]=ps[order[i]];w["temperatureC"]=ts[order[i]];}}
  return g;
 }}
}

static class NativeUdpTelemetry {
 static readonly MotionPacketStream stream=new MotionPacketStream();static string error;static bool listening;
 public static object Current(){return stream.Current(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());}
 public static object Diagnostics(){return new {listening=listening,port=20778,error=error,received=stream.Received,accepted=stream.Accepted,rejected=stream.Rejected};}
 public static void Start(){new Thread(()=>{
  try{using(var udp=new UdpClient()){udp.Client.ExclusiveAddressUse=true;udp.Client.Bind(new IPEndPoint(IPAddress.Loopback,20778));listening=true;
   while(true){var remote=new IPEndPoint(IPAddress.Any,0);var data=udp.Receive(ref remote);if(IPAddress.IsLoopback(remote.Address))stream.Ingest(data,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());}
  }}catch(Exception e){listening=false;error=e.GetType().Name+": "+e.Message;}
 }){IsBackground=true,Name="read-only native UDP telemetry"}.Start();}
}
