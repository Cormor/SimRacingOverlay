using System;
using System.Linq;
using System.Text;

// Pure decoder of the already-copied ACR packet. Optional fields never invalidate the core packet.
// Layout cross-checked against two ACR readers; raw temperature/wear fields deliberately have no guessed units.
static class PhysicsTelemetry {
 internal static double? Number(byte[] b,int o,double lo,double hi) {
  if(b==null||o<0||o+4>b.Length)return null;
  double v=BitConverter.ToSingle(b,o);
  return double.IsNaN(v)||double.IsInfinity(v)||v<lo||v>hi?(double?)null:v;
 }
 internal static int? Integer(byte[] b,int o,int lo,int hi) {
  if(b==null||o<0||o+4>b.Length)return null;int v=BitConverter.ToInt32(b,o);return v<lo||v>hi?(int?)null:v;
 }
 static double[] Vector(byte[] b,int o,double bound) {
  var v=Enumerable.Range(0,3).Select(i=>Number(b,o+i*4,-bound,bound)).ToArray();
  return v.All(x=>x.HasValue)?v.Select(x=>x.Value).ToArray():null;
 }
 static string Text(byte[] b,int o,int n) {
  if(b==null||o+n*2>b.Length)return null;
  string s=Encoding.Unicode.GetString(b,o,n*2).Split('\0')[0];return string.IsNullOrWhiteSpace(s)?null:s;
 }
 static bool? Active(byte[] b,int o){int? v=Integer(b,o,0,1);return v.HasValue?(bool?)(v==1):null;}
 public static object Decode(byte[] b,byte[] st,long time) {
  if(b==null||b.Length<672)return new {available=false};
  // ACR keeps incrementing packetId while clearing the complete physics payload in menus.
  // Do not interpret this as four genuinely airborne tyres.
  if(!b.Skip(4).Any(x=>x!=0))return new {available=false,reason="empty-physics-payload"};
  var speed=Number(b,28,0,650);if(!speed.HasValue)return new {available=false};
  var keys=new[]{"FL","FR","RL","RR"};
  var wheels=Enumerable.Range(0,4).Select(i=>new {
   key=keys[i],ratio=Number(b,640+4*i,-10,100),angle=Number(b,656+4*i,-Math.PI,Math.PI),
   combined=Number(b,56+4*i,-100,100),omega=Number(b,104+4*i,-5000,5000),load=Number(b,72+4*i,0,100000),
   mz=Number(b,592+4*i,-100000,100000),fx=Number(b,608+4*i,-200000,200000),fy=Number(b,624+4*i,-200000,200000),
   contactPoint=Vector(b,420+12*i,1e7),contactNormal=Vector(b,468+12*i,1.1),contactHeading=Vector(b,516+12*i,1.1),
   pressurePsi=Number(b,88+4*i,.1,150),temperatureRaw=Number(b,152+4*i,1,600),
   temperatureInnerRaw=Number(b,368+4*i,1,600),temperatureMiddleRaw=Number(b,384+4*i,1,600),temperatureOuterRaw=Number(b,400+4*i,1,600),
   wearRaw=Number(b,120+4*i,0,100),dirtRaw=Number(b,136+4*i,0,100),camberRaw=Number(b,168+4*i,-1.6,1.6),
   suspensionTravelRaw=Number(b,184+4*i,-1,2),suspensionDamageRaw=Number(b,680+4*i,0,100),
   brakeTemperatureRaw=Number(b,348+4*i,1,2500),radius=Number(st,436+4*i,.1,1.2)
  }).ToArray();
  return new {available=true,telemetryVersion=2,optionalVersion=1,packet=BitConverter.ToInt32(b,0),source="acpmf_physics",
   sampleTime=time,carModel=Text(st,68,33),track=Text(st,134,33),sharedMemoryVersion=Text(st,0,15),gameVersion=Text(st,30,15),
   rpm=Integer(b,20,0,30000),gear=Integer(b,16,0,20)-1,speedKmh=speed,maxRpm=Integer(b,588,1,30000)??Integer(st,412,1,30000),
   gas=Number(b,4,0,1),brake=Number(b,8,0,1),clutch=Number(b,364,0,1),nativeSteer=Number(b,24,-100,100),wheels=wheels,
   velocity=Vector(b,32,250),localVelocity=Vector(b,568,250),angularVelocity=Vector(b,296,100),accG=Vector(b,44,30),
   heading=Number(b,208,-7,7),pitch=Number(b,212,-7,7),roll=Number(b,216,-7,7),brakeBias=Number(b,564,0,1),
   airDensity=Number(b,284,.2,2),airTemperatureRaw=Number(b,288,-80,600),roadTemperatureRaw=Number(b,292,-80,600),
   finalFFRaw=Number(b,308,-100,100),
   fieldPolicy="optional finite-range values; raw units/support unconfirmed; no zero-filled force or peak-mu",
   capabilities=new {forces=true,loads=true,slipRatio=true,slipAngle=true,contactGeometry=true},
   statuses=new {absActive=Active(b,676)==true||Number(b,252,0,100)>.01||Number(b,796,0,100)>.01,
    tcActive=Active(b,672)==true||Number(b,204,0,100)>.01,engineRunning=Active(b,780),ignition=Active(b,772),pitLimiter=Active(b,248),
    escActive=(object)null,absSetting=Number(b,252,0,100),tcSetting=Number(b,204,0,100)}};
 }
}
