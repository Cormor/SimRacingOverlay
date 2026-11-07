using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading;

// Wire-layout decoder only. Packet format/version identify the documented
// layout, not a game-name-based vehicle or grip preset.
sealed class MotionPacketStream {
 const long MotionLifetimeMs=400, WorldLifetimeMs=150, CarLifetimeMs=250, SlowLifetimeMs=1500;
 readonly object gate=new object();
 readonly Queue<long> arrivals=new Queue<long>();
 readonly Queue<ulong> retiredSessions=new Queue<ulong>();
 Header? main;
 uint? segmentStart;
 long motionAt,receivedAt;
 int sequence,epoch;
 Dictionary<string,object> motion;
 Supplements active,pending;
 long received,accepted,rejected;
 long? lastUsableAt,lastInspectedAt;
 bool usable;

 struct Header {
  internal ulong Session;
  internal byte Player;
  internal uint Frame,Overall;
  internal double Time;
 }
 sealed class Supplement {
  internal readonly Header Header;
  internal readonly long At;
  internal readonly byte[] Data;
  internal readonly Dictionary<string,object> World;
  internal Supplement(int id,Header header,long at,byte[] data){
   Header=header;At=at;Data=data;
   if(id==0){
    int o=CarOffset(header);
    World=new Dictionary<string,object>{{"worldFrame",(double)header.Overall},
     {"velocity",Floats(data,o+12,3)},{"forward",Dirs(data,o+24)},{"right",Dirs(data,o+30)},
     {"accG",new object[]{F(data,o+36),F(data,o+44),F(data,o+40)}}};
   }
  }
 }
 sealed class Supplements {
  internal readonly Header Owner;
  internal Supplement World,Car,Status,Session;
  internal Supplements(Header owner){Owner=owner;}
  internal void Add(int id,Supplement value){
   switch(id){
    case 0:World=Newest(World,value);break;
    case 1:Session=Newest(Session,value);break;
    case 6:Car=Newest(Car,value);break;
    case 7:Status=Newest(Status,value);break;
   }
  }
  internal Supplements From(Header start){
   return new Supplements(start){World=After(World,start),Car=After(Car,start),
    Status=After(Status,start),Session=After(Session,start)};
  }
  static Supplement After(Supplement value,Header start){
   return value!=null&&FrameDelta(value.Header.Overall,start.Overall)>=0?value:null;
  }
  static Supplement Newest(Supplement prior,Supplement next){
   return prior==null||FrameDelta(next.Header.Overall,prior.Header.Overall)>=0?next:prior;
  }
 }
 static int FrameDelta(uint current,uint prior){return unchecked((int)(current-prior));}
 static bool SamePlayer(Header a,Header b){return a.Session==b.Session&&a.Player==b.Player;}
 static bool Fresh(long at,long now,long lifetime){return now>=at&&now-at<=lifetime;}
 static bool Near(Supplement value,Header main,long now,long lifetime){
  if(value==null||!Fresh(value.At,now,lifetime))return false;
  int overall=FrameDelta(value.Header.Overall,main.Overall);
  int frame=FrameDelta(value.Header.Frame,main.Frame);
  return overall>=-3&&overall<=3&&frame>=-3&&frame<=3;
 }
 bool InSegment(Supplement value,long now,long lifetime){
  return value!=null&&Fresh(value.At,now,lifetime)&&
   (!segmentStart.HasValue||FrameDelta(value.Header.Overall,segmentStart.Value)>=0);
 }
 static double? F(byte[] b,int o){double v=BitConverter.ToSingle(b,o);return double.IsNaN(v)||double.IsInfinity(v)?(double?)null:v;}
 static object[] Floats(byte[] b,int o,int n){return Enumerable.Range(0,n).Select(i=>(object)F(b,o+4*i)).ToArray();}
 static double[] Dirs(byte[] b,int o){return Enumerable.Range(0,3).Select(i=>(double)BitConverter.ToInt16(b,o+2*i)).ToArray();}
 static Dictionary<string,object> DecodeMotion(byte[] b,Header h){
  return new Dictionary<string,object>{{"frameBefore",(double)h.Overall},{"frame",(double)h.Overall},{"time",h.Time},
   {"speedMs",Floats(b,77,4)},{"ratio",Floats(b,93,4)},{"angle",Floats(b,109,4)},{"fy",Floats(b,125,4)},{"fx",Floats(b,141,4)},
   {"localVelocity",Floats(b,161,3)},{"angularVelocity",Floats(b,173,3)},{"roadWheelAngle",F(b,197)},{"load",Floats(b,201,4)}};
 }
 static int CarOffset(Header h){return 29+h.Player*60;}
 static double CarSpeed(Supplement value){return BitConverter.ToUInt16(value.Data,CarOffset(value.Header));}
 static bool HasCoreSpeed(Dictionary<string,object> raw,Header h,Supplements aux,long now){
  if(NativeMotionTelemetry.HasLocalSpeed(raw))return true;
  if(aux==null)return false;
  if(Near(aux.World,h,now,WorldLifetimeMs)&&NativeMotionTelemetry.IsValidSpeed(aux.World.World["velocity"]))return true;
  return Near(aux.Car,h,now,CarLifetimeMs)&&CarSpeed(aux.Car)<=650;
 }
 bool Reject(){rejected++;return false;}
 public bool Ingest(byte[] b,long now,long? observedUtc=null){lock(gate){
  received++;
  if(b==null||b.Length<29||BitConverter.ToUInt16(b,0)!=2025||b[5]!=1||b[27]>=22)return Reject();
  int id=b[6],size=id==0?1349:id==1?753:id==6?1352:id==7?1239:id==13?273:0;
  if(size==0)return false;
  if(b.Length!=size)return Reject();
  var time=F(b,15);
  if(!time.HasValue||time.Value<0)return Reject();
  var h=new Header{Session=BitConverter.ToUInt64(b,7),Player=b[27],Frame=BitConverter.ToUInt32(b,19),
   Overall=BitConverter.ToUInt32(b,23),Time=time.Value};
  if(retiredSessions.Contains(h.Session))return Reject();
  if(id!=13){
   Supplements target;
   if(main.HasValue&&SamePlayer(main.Value,h)){
    if(segmentStart.HasValue&&FrameDelta(h.Overall,segmentStart.Value)<0)return Reject();
    target=active;
   }else{
    if(pending==null||!SamePlayer(pending.Owner,h))pending=new Supplements(h);
    target=pending;
   }
   target.Add(id,new Supplement(id,h,now,b));accepted++;return true;
  }

  bool sameSession=main.HasValue&&main.Value.Session==h.Session;
  if(sameSession&&FrameDelta(h.Overall,main.Value.Overall)<=0)return Reject();
  bool changedPlayer=sameSession&&main.Value.Player!=h.Player;
  bool rewound=sameSession&&(FrameDelta(h.Frame,main.Value.Frame)<0||h.Time<main.Value.Time);
  bool newIdentity=!main.HasValue||!sameSession||changedPlayer||rewound;
  var next=DecodeMotion(b,h);
  if(newIdentity){
   var candidate=pending!=null&&SamePlayer(pending.Owner,h)?pending:null;
   if(rewound&&!changedPlayer)candidate=active.From(h);
   else if(changedPlayer&&candidate!=null)candidate=candidate.From(h);
   if(!HasCoreSpeed(next,h,candidate,now))return Reject();
   if(main.HasValue&&!sameSession){
    retiredSessions.Enqueue(main.Value.Session);
    if(retiredSessions.Count>8)retiredSessions.Dequeue();
   }
   segmentStart=changedPlayer||rewound?(uint?)h.Overall:null;
   active=candidate??new Supplements(h);
   pending=null;arrivals.Clear();epoch++;
  }
  main=h;motion=next;motionAt=now;receivedAt=observedUtc??now;sequence++;
  arrivals.Enqueue(now);
  while(arrivals.Count>0&&!Fresh(arrivals.Peek(),now,1000))arrivals.Dequeue();
  accepted++;return true;
 }}

 public object Current(long now){lock(gate){
  lastInspectedAt=now;usable=false;
  if(!main.HasValue||!Fresh(motionAt,now,MotionLifetimeMs))return null;
  var h=main.Value;
  var raw=new Dictionary<string,object>(motion);
  var world=active.World;
  if(InSegment(world,now,WorldLifetimeMs)&&Near(world,h,now,WorldLifetimeMs))
   foreach(var field in world.World)raw[field.Key]=field.Value;
  object[] wheels=Enumerable.Range(0,4).Select(i=>(object)new Dictionary<string,object>{{"key",new[]{"FL","FR","RL","RR"}[i]}}).ToArray();
  var g=new Dictionary<string,object>{{"available",true},{"packet",sequence},{"sampleTime",receivedAt},{"wheels",wheels},{"carModel",""}};
  var car=active.Car;
  bool carFresh=InSegment(car,now,CarLifetimeMs)&&Near(car,h,now,CarLifetimeMs);
  g["speedKmh"]=null;g["gas"]=null;g["brake"]=null;g["clutch"]=null;g["gear"]=null;g["rpm"]=null;
  if(carFresh){
   var b=car.Data;int o=CarOffset(car.Header);
   double speed=CarSpeed(car);
   g["speedKmh"]=speed<=650?(double?)speed:null;
   g["gas"]=F(b,o+2);g["brake"]=F(b,o+10);g["clutch"]=b[o+14]/100.0;
   g["gear"]=(int)(sbyte)b[o+15];g["rpm"]=(int)BitConverter.ToUInt16(b,o+16);
   int[] order={2,3,0,1};
   for(int i=0;i<4;i++){
    var w=(Dictionary<string,object>)wheels[i];
    w["pressurePsi"]=F(b,o+40+order[i]*4);w["temperatureC"]=(double)b[o+34+order[i]];
   }
  }
  var status=active.Status;
  int? maxRpm=null,absSetting=null,tcSetting=null;
  if(InSegment(status,now,SlowLifetimeMs)){
   int o=29+status.Header.Player*55;
   maxRpm=BitConverter.ToUInt16(status.Data,o+17);tcSetting=status.Data[o];absSetting=status.Data[o+1];
  }
  var session=active.Session;
  // The F1 25 wire definition only supplies gamePaused for network games.
  g["paused"]=InSegment(session,now,SlowLifetimeMs)&&session.Data[154]==1?(bool?)(session.Data[43]!=0):null;
  g["inMenu"]=null;g["maxRpm"]=maxRpm;
  g["statuses"]=new {absActive=(object)null,tcActive=(object)null,escActive=(object)null,absSetting,tcSetting};
  NativeMotionTelemetry.Enrich(g,raw);
  if(!(g["speedKmh"] is double)||!NativeMotionTelemetry.ValidSpeed((double)g["speedKmh"]))return null;
  g["source"]="UDP-native-motion";
  g["streamEpoch"]=h.Session.ToString()+":"+h.Player+":"+epoch;
  g["transport"]=new {kind="loopback-udp",port=20778,receivedHz=arrivals.Count(a=>Fresh(a,now,1000)),packetFormat=2025};
  usable=true;lastUsableAt=motionAt;
  return g;
 }}

 public void Clear(){lock(gate){usable=false;main=null;motion=null;active=null;pending=null;segmentStart=null;arrivals.Clear();}}
 public Dictionary<string,object> Diagnostics(string error,Tuple<string,long> latestError,out object health){lock(gate){
  long now=(long)(Stopwatch.GetTimestamp()*1000.0/Stopwatch.Frequency);
  bool listening=error==null;
  string state=!listening?(error=="Starting"?"unknown":"unavailable"):!main.HasValue?"waiting":
   !Fresh(motionAt,now,MotionLifetimeMs)?"expired":usable&&now-lastUsableAt<=MotionLifetimeMs?"available":"waiting";
  health=new {state,lastSampleAgeMs=now-lastUsableAt,observedAgeMs=now-lastInspectedAt,
   lastMotionAgeMs=sequence>0?(long?)Math.Max(0,now-motionAt):null,
   latestError=latestError==null?null:latestError.Item1,latestErrorAgeMs=latestError==null?(long?)null:Math.Max(0,now-latestError.Item2)};
  return new Dictionary<string,object>{{"listening",listening},{"port",20778},{"error",error},{"received",received},{"accepted",accepted},{"rejected",rejected}};
 }}
}

static class NativeUdpTelemetry {
 static readonly MotionPacketStream stream=new MotionPacketStream();
 // Null means the listener is open; the startup state is not yet listening.
 static volatile string listenerError="Starting";
 static volatile Tuple<string,long> lastListenerError;
 static long ClockMs(){return (long)(Stopwatch.GetTimestamp()*1000.0/Stopwatch.Frequency);}
 public static object Current(){return stream.Current(ClockMs());}
 public static Dictionary<string,object> Diagnostics(out object health){return stream.Diagnostics(listenerError,lastListenerError,out health);}
 public static void Start(){new Thread(Listen){IsBackground=true,Name="read-only native UDP telemetry"}.Start();}
 static void Listen(){
  while(true){
   try{
    using(var udp=new UdpClient()){
     udp.Client.ExclusiveAddressUse=true;
     udp.Client.Bind(new IPEndPoint(IPAddress.Loopback,20778));
     listenerError=null;
     var remote=new IPEndPoint(IPAddress.Any,0);
     while(true){
      var data=udp.Receive(ref remote);
      if(IPAddress.IsLoopback(remote.Address))stream.Ingest(data,ClockMs(),DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
     }
    }
   }catch(SocketException e){
    string error=e.SocketErrorCode==SocketError.AddressAlreadyInUse?"port-in-use":"udp-socket-error";
    lastListenerError=Tuple.Create(error,ClockMs());listenerError=error;stream.Clear();
    Thread.Sleep(1000);
   }
  }
 }
}
