using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Text;
using System.Globalization;
using System.Text.RegularExpressions;

// Read-only IRSDK v2 live mapping. Variable names, types and units come from
// the producer's varHeader table, never from a car-specific fixed layout.
sealed class IRacingTelemetry {
 readonly Func<long,int,byte[]> read;
 readonly long connectionEpoch;
 sealed class Variable {public int Type,Offset,Count;public string Unit;}
 readonly Dictionary<string,Variable> variables=new Dictionary<string,Variable>();
 int sessionUpdate=int.MinValue;double? redLine;string carModel;object vehicleGeometry,vehicleIdentity;
 int? tick;int epoch,tableOffset,tableCount,rowLength;long advanced;object cached;
 public IRacingTelemetry(Func<long,int,byte[]> reader,long connectionEpoch=0){read=reader;this.connectionEpoch=connectionEpoch;}
 internal int? Tick{get{return tick;}}
 internal long? LastAdvance{get{return tick.HasValue?(long?)advanced:null;}}
 internal bool Disconnected{get;private set;}
 static int I(byte[] b,int p){return BitConverter.ToInt32(b,p);}
 static string Text(byte[] b,int p,int length){return Encoding.ASCII.GetString(b,p,length).Split('\0')[0];}
 static void Require(bool valid){if(!valid)throw new InvalidOperationException("Invalid IRSDK layout");}
 double? Number(byte[] row,string name,string unit,double lo,double hi){
  Variable v;if(!variables.TryGetValue(name,out v)||v.Unit!=unit||v.Count!=1)return null;
  double n;
  if(v.Type==4)n=BitConverter.ToSingle(row,v.Offset);
  else if(v.Type==5)n=BitConverter.ToDouble(row,v.Offset);
  else if(v.Type==2)n=I(row,v.Offset);
  else return null;
  return !double.IsNaN(n)&&!double.IsInfinity(n)&&n>=lo&&n<=hi?(double?)n:null;
 }
 bool? Flag(byte[] row,string name){Variable v;return variables.TryGetValue(name,out v)&&v.Type==1&&v.Count==1?(bool?)(row[v.Offset]!=0):null;}
 static double[] Vector(double? x,double? y,double? z){return x.HasValue&&y.HasValue&&z.HasValue?new[]{x.Value,y.Value,z.Value}:null;}
 void LoadTable(int count,int offset,int length){
   var table=read(offset,checked(count*144));variables.Clear();
   int[] sizes={1,1,4,4,4,8};
   for(int i=0;i<count;i++){
    int p=i*144,type=I(table,p),at=I(table,p+4),elements=I(table,p+8);
    Require(type>=0&&type<sizes.Length&&at>=0&&elements>0&&elements<=length/sizes[type]&&at<=length-elements*sizes[type]);
    variables.Add(Text(table,p+16,32),new Variable{Type=type,Offset=at,Count=elements,Unit=Text(table,p+112,32)});
   }
   tableOffset=offset;tableCount=count;rowLength=length;tick=null;cached=null;sessionUpdate=int.MinValue;redLine=null;carModel=null;vehicleGeometry=null;vehicleIdentity=null;epoch++;
 }
 void SessionMetadata(byte[] h){
  int update=I(h,12);if(update==sessionUpdate)return;
  // A changed metadata revision may identify a different car. Do not apply
  // the old geometry/redline to a fresh physics row while its YAML is torn.
  redLine=null;carModel=null;vehicleGeometry=null;vehicleIdentity=null;
  int length=I(h,16),offset=I(h,20);if(length<=0||length>1048576||offset<112){redLine=null;carModel=null;vehicleGeometry=null;vehicleIdentity=null;return;}
  try {
   string text=Encoding.UTF8.GetString(read(offset,length));var after=read(0,112);
   if(I(after,12)!=update||I(after,16)!=length||I(after,20)!=offset)return;
   var rpm=Regex.Match(text,@"(?m)^[ \t]*DriverCarRedLine:[ \t]*([0-9.]+)");double n;
   redLine=rpm.Success&&double.TryParse(rpm.Groups[1].Value,NumberStyles.Float,CultureInfo.InvariantCulture,out n)&&n>0&&n<=100000?(double?)n:null;
   var car=Regex.Match(text,@"(?m)^[ \t]*DriverCarScreenName:[ \t]*([^\r\n]+)");carModel=car.Success?car.Groups[1].Value.Trim():null;
   if(carModel!=null&&carModel.Length>120)carModel=null;
   CarGeometry(text);sessionUpdate=update;
  }catch{redLine=null;carModel=null;vehicleGeometry=null;vehicleIdentity=null;}
 }
 uint? Bits(byte[] row,string name,string unit){Variable v;return variables.TryGetValue(name,out v)&&v.Type==3&&v.Count==1&&v.Unit==unit?(uint?)BitConverter.ToUInt32(row,v.Offset):null;}
 static bool? Bit(uint? flags,uint mask){return flags.HasValue?(bool?)((flags.Value&mask)!=0):null;}
 static string Scalar(string value){value=value.Trim();if(value.Length>=2&&((value[0]=='"'&&value[value.Length-1]=='"')||(value[0]=='\''&&value[value.Length-1]=='\'')))value=value.Substring(1,value.Length-2);return value;}
 void CarGeometry(string text){
  vehicleGeometry=null;vehicleIdentity=null;
  var section=Regex.Match(text,@"(?m)^DriverInfo:[ \t]*\r?$");if(!section.Success)return;
  text=text.Substring(section.Index+section.Length);var nextSection=Regex.Match(text,@"(?m)^[A-Za-z][A-Za-z0-9_]*:");if(nextSection.Success)text=text.Substring(0,nextSection.Index);
  var active=Regex.Match(text,@"(?m)^[ \t]*DriverCarIdx:[ \t]*([0-9]+)");if(!active.Success)return;
  var drivers=Regex.Matches(text,@"(?m)^[ \t]*-[ \t]*CarIdx:[ \t]*([0-9]+)[ \t]*\r?$");
  for(int i=0;i<drivers.Count;i++)if(drivers[i].Groups[1].Value==active.Groups[1].Value){
   int start=drivers[i].Index,end=i+1<drivers.Count?drivers[i+1].Index:text.Length;
   string own=text.Substring(start,end-start);
   var path=Regex.Match(own,@"(?m)^[ \t]*CarPath:[ \t]*([^\r\n]+)");
   var id=Regex.Match(own,@"(?m)^[ \t]*CarID:[ \t]*([0-9]+)");
   var name=Regex.Match(own,@"(?m)^[ \t]*CarScreenName:[ \t]*([^\r\n]+)");
   if(name.Success&&name.Groups[1].Value.Trim().Length<=120)carModel=Scalar(name.Groups[1].Value);
   int activeIdx,carId;
   if(path.Success&&id.Success&&int.TryParse(active.Groups[1].Value,out activeIdx)&&int.TryParse(id.Groups[1].Value,out carId))
    vehicleIdentity=new {driverCarIdx=activeIdx,carPath=Scalar(path.Groups[1].Value),carId=carId};
   // Wheelbase: iRacing Toyota GR86 manual (2024-09), 2575 mm.
   // Nominal rack ratio: Toyota GR86 technical description, 13.5:1.
   // A documented nominal geometry reference, NOT a measured grip limit or
   // guessed geometry for an unsupported car. Identity must match both fields.
   if(path.Success&&id.Success&&Scalar(path.Groups[1].Value)=="toyotagr86"&&id.Groups[1].Value=="160")vehicleGeometry=new {wheelbaseM=2.575,steeringRatio=13.5,confidence=.8,source="iRacing-GR86-manual/OEM-nominal-rack",nominal=true};
   break;
  }
 }
 public object Poll(long now,long? observedUtc=null){
  var h=read(0,112);Require(h.Length==112&&I(h,0)==2);
  if((I(h,4)&1)==0){Disconnect();return null;}
  Disconnected=false;
  int count=I(h,24),offset=I(h,28),buffers=I(h,32),length=I(h,36);
  Require(count>0&&count<=4096&&offset>=112&&buffers>=1&&buffers<=4&&length>0&&length<=1048576);
  if(!tick.HasValue||offset!=tableOffset||count!=tableCount||length!=rowLength){
   LoadTable(count,offset,length);
  }
  int best=0;for(int i=1;i<buffers;i++)if(unchecked(I(h,48+i*16)-I(h,48+best*16))>0)best=i;
  int next=I(h,48+best*16),rowOffset=I(h,52+best*16);Require(rowOffset>=112);
  if(tick.HasValue&&next==tick.Value)return now-advanced<=400?cached:null;
  if(tick.HasValue&&unchecked(next-tick.Value)<0)LoadTable(count,offset,length);
  var row=read(rowOffset,length);
  // The producer may have reused this ring-buffer slot while it was copied.
  var after=read(0,112);
  if((I(after,4)&1)==0){Disconnect();return null;}
  if(I(after,48+best*16)!=next||I(after,52+best*16)!=rowOffset||I(after,24)!=count||I(after,28)!=offset||I(after,36)!=length)
   return now-advanced<=400?cached:null;
  tick=next;advanced=now;SessionMetadata(h);
  Func<string,string,double,double,double?> n=(name,unit,lo,hi)=>Number(row,name,unit,lo,hi);
  double? speed=n("Speed","m/s",-200,200),session=n("SessionTime","s",0,1e10);
  if(!speed.HasValue||!session.HasValue){cached=null;return null;}
  var wheels=new object[4];string[] keys={"FL","FR","RL","RR"};
  for(int i=0;i<4;i++){string corner=new[]{"LF","RF","LR","RR"}[i];wheels[i]=new {key=keys[i],angle=(object)null,ratio=(object)null,load=(object)null,fx=(object)null,fy=(object)null,
    shockDeflectionM=n(corner+"shockDefl","m",-1,2),shockVelocityMs=n(corner+"shockVel","m/s",-30,30),rumblePitchHz=n("Tire"+corner+"_RumblePitch","Hz",0,30000)};}
  // IRSDK vehicle axes: X forward, Y left, Z up -> right/up/forward.
  bool? onTrack=Flag(row,"IsOnTrack"),replay=Flag(row,"IsReplayPlaying");
  bool? paused=onTrack==false&&replay==false?(bool?)true:onTrack==true||replay==true?(bool?)false:null;
  uint? warnings=Bits(row,"EngineWarnings","irsdk_EngineWarnings"),flags=Bits(row,"SessionFlags","irsdk_Flags");
  cached=new Dictionary<string,object>{{"available",true},{"telemetryVersion",2},{"source","iRacing-SDK"},{"carModel",carModel},{"maxRpm",redLine},{"vehicleGeometry",vehicleGeometry},{"vehicleIdentity",vehicleIdentity},{"packet",next},{"sampleTime",session.Value*1000},{"receivedAt",observedUtc??now},
   {"streamEpoch",connectionEpoch+":"+epoch+":"+n("SessionUniqueID","",0,int.MaxValue)+":"+n("SessionNum","",0,10000)+":"+n("PlayerCarIdx","",0,1000)},
   {"speedKmh",Math.Abs(speed.Value)*3.6},{"rpm",n("RPM","revs/min",0,100000)},{"gear",n("Gear","",-1,20)},
   {"shiftLights",new {firstRpm=n("PlayerCarSLFirstRPM","revs/min",0,100000),shiftRpm=n("PlayerCarSLShiftRPM","revs/min",0,100000),lastRpm=n("PlayerCarSLLastRPM","revs/min",0,100000),blinkRpm=n("PlayerCarSLBlinkRPM","revs/min",0,100000),indicator=n("ShiftIndicatorPct","%",0,1)}},
   {"gas",n("Throttle","%",0,1)},{"brake",n("Brake","%",0,1)},{"clutch",1-n("Clutch","%",0,1)},{"handbrake",n("HandbrakeRaw","%",0,1)??n("HandBrake","%",0,1)},
   {"localVelocity",Vector(-n("VelocityY","m/s",-250,250),n("VelocityZ","m/s",-250,250),n("VelocityX","m/s",-250,250))},
   {"accGFrame","body"},{"accG",Vector(-n("LatAccel","m/s^2",-294,294)/9.80665,n("VertAccel","m/s^2",-294,294)/9.80665,n("LongAccel","m/s^2",-294,294)/9.80665)},
   {"steeringWheelAngle",-n("SteeringWheelAngle","rad",-20,20)},
   {"yawRate",-n("YawRate","rad/s",-30,30)},{"pitchRate",-n("PitchRate","rad/s",-30,30)},{"rollRate",n("RollRate","rad/s",-30,30)},
   {"steeringShaftTorqueNm",n("SteeringWheelTorque","N*m",-200,200)},
   {"orientation",new {yaw=-n("Yaw","rad",-100,100),pitch=n("Pitch","rad",-10,10),roll=n("Roll","rad",-10,10)}},
   {"paused",paused},{"inMenu",onTrack.HasValue?(bool?)(!onTrack.Value):null},
   {"wheels",wheels},{"capabilities",new {loads=false,forces=false,slipAngle=false,slipRatio=false,bodyVelocity=true,kinematicsProfile="adaptive-steering-v1"}},
   {"statuses",new {absActive=Flag(row,"BrakeABSactive"),tcActive=(object)null,tcSetting=n("dcTractionControl","",0,20),absSetting=n("dcABS","",0,20),escActive=(object)null,
    onPitRoad=Flag(row,"OnPitRoad"),onTrackCar=Flag(row,"IsOnTrackCar"),garageVisible=Flag(row,"IsGarageVisible"),engineWarnings=warnings,pitLimiterActive=Bit(warnings,0x10),revLimiterActive=Bit(warnings,0x20),engineStalled=Bit(warnings,0x08),waterTempWarning=Bit(warnings,0x01),fuelPressureWarning=Bit(warnings,0x02),oilPressureWarning=Bit(warnings,0x04),sessionFlags=flags,trackSurface=n("PlayerTrackSurface","irsdk_TrkLoc",-1,3),trackMaterial=n("PlayerTrackSurfaceMaterial","irsdk_TrkSurf",-1,30)}}};
  return cached;
 }

 void Disconnect(){
  if(!Disconnected)epoch++;
  Disconnected=true;tick=null;cached=null;
 }

 // A mapping owns both the read delegate and its native resources. The
 // connection can therefore retire them together before reopening by name.
 internal sealed class Mapping : IDisposable {
  internal readonly Func<long,int,byte[]> Read;
  readonly Action close;
  internal Mapping(Func<long,int,byte[]> read,Action close){Read=read;this.close=close;}
  public void Dispose(){close();}
  internal static Mapping Open(){
   var mapping=MemoryMappedFile.OpenExisting("Local\\IRSDKMemMapFileName",MemoryMappedFileRights.Read);
   try{
    var view=mapping.CreateViewAccessor(0,0,MemoryMappedFileAccess.Read);
    return new Mapping((at,size)=>{
     Require(at>=0&&at<=view.Capacity-size);
     var bytes=new byte[size];view.ReadArray(at,bytes,0,size);return bytes;
    },()=>{try{view.Dispose();}finally{mapping.Dispose();}});
   }catch{mapping.Dispose();throw;}
  }
 }

 internal sealed class Connection {
  internal const int IdleMs=1000;
  const int StaleMs=400,RetryMs=1000;
  readonly Func<Mapping> open;
  Mapping mapping;
  IRacingTelemetry reader;
  long retryAt,openedAt,lastDemand,connectionEpoch;
  int? probeTick;
  bool confirmed;
  string state="unknown",latestError;
  long? lastSampleAt,latestErrorAt;
  internal Connection(Func<Mapping> open){this.open=open;}

  internal object Current(long now,long observedUtc){
   CloseIfIdle(now);
   lastDemand=now;
   try{
    if(mapping==null){
     if(now<retryAt)return null;
     mapping=open();openedAt=now;
     reader=new IRacingTelemetry(mapping.Read,++connectionEpoch);
    }
    var sample=reader.Poll(now,observedUtc);
    if(reader.Disconnected||now-(reader.LastAdvance??openedAt)>StaleMs){
     state=reader.Disconnected?"unavailable":"expired";
     Close(now+RetryMs);return null;
    }
    if(!confirmed&&reader.Tick.HasValue){
     int tick=reader.Tick.Value;
     if(!probeTick.HasValue||unchecked(tick-probeTick.Value)<0)probeTick=tick;
     else if(sample!=null&&unchecked(tick-probeTick.Value)>0)confirmed=true;
    }
    bool available=confirmed&&sample!=null;
    state=available?"available":"waiting";
    if(available)lastSampleAt=reader.LastAdvance;
    return confirmed?sample:null;
   }catch(FileNotFoundException){state="unavailable";Close(now+RetryMs);return null;}
   catch(Exception error){
    state="unavailable";latestErrorAt=now;
    latestError=error is UnauthorizedAccessException?"sdk-access-denied":
     error is InvalidOperationException?"invalid-sdk-layout":"sdk-read-error";
    Close(now+RetryMs);return null;
   }
  }

  internal void CloseIfIdle(long now){
   if(mapping!=null&&now-lastDemand>=IdleMs){state="not-requested";Close(now);}
  }
  internal object Diagnostics(long now){
   string health=state=="available"&&now-lastSampleAt>StaleMs?"expired":
    state!="unknown"&&now-lastDemand>=IdleMs?"not-requested":state;
   return new {state=health,lastSampleAgeMs=now-lastSampleAt,
    observedAgeMs=state=="unknown"?(long?)null:now-lastDemand,latestError,latestErrorAgeMs=now-latestErrorAt};
  }
  internal int IdleDelay(long now){return mapping==null?Timeout.Infinite:(int)Math.Max(1,IdleMs-(now-lastDemand));}

  void Close(long nextAttempt){
   var old=mapping;
   mapping=null;reader=null;probeTick=null;confirmed=false;retryAt=nextAttempt;
   if(old!=null)old.Dispose();
  }
 }

 static readonly object gate=new object();
 static readonly Connection connection=new Connection(Mapping.Open);
 static readonly Timer idleTimer=new Timer(CheckIdle,null,Timeout.Infinite,Timeout.Infinite);
 static bool idleCheckScheduled;
 static long ClockMs(){return (long)(Stopwatch.GetTimestamp()*1000.0/Stopwatch.Frequency);}
 static void CheckIdle(object unused){lock(gate){
  long now=ClockMs();
  connection.CloseIfIdle(now);
  int delay=connection.IdleDelay(now);
  idleTimer.Change(delay,Timeout.Infinite);
  idleCheckScheduled=delay!=Timeout.Infinite;
 }}
 public static object Diagnostics(){lock(gate)return connection.Diagnostics(ClockMs());}
 public static object Current(){lock(gate){
  long now=ClockMs();
  var sample=connection.Current(now,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
  int delay=connection.IdleDelay(now);
  if(!idleCheckScheduled&&delay!=Timeout.Infinite){
   idleTimer.Change(delay,Timeout.Infinite);idleCheckScheduled=true;
  }
  return sample;
 }}
}
