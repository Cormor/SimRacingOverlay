using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Web.Script.Serialization;
class TestSimHubTelemetry {
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static readonly SimHubTelemetry.FrameCache MainFrames=new SimHubTelemetry.FrameCache();
 static object Accept(Dictionary<string,object> data,long now){return MainFrames.Observe(data,now,now+10000,"fixture");}
 static Dictionary<string,object> Map(JavaScriptSerializer json,object sample){
  return json.Deserialize<Dictionary<string,object>>(json.Serialize(sample));
 }
 sealed class Endpoint : IDisposable {
  readonly TcpListener listener=new TcpListener(IPAddress.Loopback,0);
  readonly Thread server;
  internal readonly ManualResetEvent Requested=new ManualResetEvent(false);
  internal readonly ManualResetEvent Reply=new ManualResetEvent(false);
  internal int Port{get{return ((IPEndPoint)listener.LocalEndpoint).Port;}}
  internal Endpoint(int speed){
   listener.Start();
   server=new Thread(()=>{
    try{
     using(var client=listener.AcceptTcpClient())
     using(var stream=client.GetStream())
     using(var reader=new StreamReader(stream,Encoding.ASCII)){
      string line;do{line=reader.ReadLine();}while(!string.IsNullOrEmpty(line));
      Requested.Set();Reply.WaitOne(1000);
      var json="{\"GameRunning\":true,\"FrameTimeUTC\":\"frame-"+speed+"\",\"NewData\":{\"SpeedKmh\":"+speed+"}}";
      var bytes=Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: "+json.Length+"\r\nConnection: close\r\n\r\n"+json);
      stream.Write(bytes,0,bytes.Length);
     }
    }catch(SocketException){}catch(IOException){}
   }){IsBackground=true};
   server.Start();
  }
  public void Dispose(){Reply.Set();listener.Stop();server.Join(1500);Requested.Dispose();Reply.Dispose();}
 }
 static void Main(string[] args){
  var json=new JavaScriptSerializer();var d=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(args[0]));
  d["GameRunning"]=true;d["FrameTimeUTC"]="test-frame-1";
  var normalized=json.Deserialize<Dictionary<string,object>>(json.Serialize(Accept(d,1000)));
  Check((string)normalized["source"]=="SimHub-generic","wrong source");
  Check(normalized["wheels"]!=null,"missing wheels");Check(Accept(d,1010)==null,"duplicate frame must not renew freshness");
  var f1Feedback=new Dictionary<string,object>{{"FrontLeftWheelSlip",-.0125},{"FrontRightWheelSlip",.025},{"RearLeftWheelSlip",-.0375},{"RearRightWheelSlip",.05}};
  var f1New=new Dictionary<string,object>{{"CarModel","F1 25 fixture"},{"SpeedKmh",199.0},{"Throttle",0.0},{"Brake",35.0},{"FeedbackData",f1Feedback}};
  var f1Input=new Dictionary<string,object>{{"GameRunning",true},{"GameName","F12025"},{"FrameTimeUTC","f1-frame-1"},{"NewData",f1New}};
  var f1=json.Deserialize<Dictionary<string,object>>(json.Serialize(Accept(f1Input,2000)));
  var f1Wheels=(System.Collections.IList)f1["wheels"];
  Check((string)f1["source"]=="SimHub-generic","game name must not select the adapter");
  Check(Math.Abs(Convert.ToDouble(((Dictionary<string,object>)f1Wheels[0])["slipFeedback"])+.0125)<1e-8,"negative reported feedback must be preserved");
  Check(((Dictionary<string,object>)f1Wheels[0])["ratio"]==null,"untyped feedback must not masquerade as a physical ratio");
  f1Input["GameName"]="F12024";f1Input["FrameTimeUTC"]="f1-frame-2";
  var otherF1=json.Deserialize<Dictionary<string,object>>(json.Serialize(Accept(f1Input,2020)));
  Check((string)otherF1["source"]=="SimHub-generic"&&((Dictionary<string,object>)((System.Collections.IList)otherF1["wheels"])[0])["ratio"]==null,"F1 25 slip mapping must not leak into other SimHub games");
  f1Input["GameName"]="F12025";f1Input["FrameTimeUTC"]="f1-frame-3";f1Feedback["FrontLeftWheelSlip"]=double.NaN;
  var invalidF1=json.Deserialize<Dictionary<string,object>>(json.Serialize(Accept(f1Input,2040)));
  Check(((Dictionary<string,object>)((System.Collections.IList)invalidF1["wheels"])[0])["ratio"]==null,"invalid F1 slip must remain unavailable, not become zero");
  var native=new Dictionary<string,object>{{"frameBefore",10},{"frame",10},{"worldFrame",10},{"session","fixture"},{"time",2.0},
   {"ratio",new[]{-.1,.2,-.3,.4}},{"angle",new[]{.01,-.02,.03,-.04}},{"load",new[]{1000,2000,3000,4000}},
   {"fx",new[]{100,200,300,400}},{"fy",new[]{10,20,30,40}},{"speedMs",new[]{20,21,22,23}},
   {"localVelocity",new[]{2,0,20}},{"velocity",new[]{-2,0,20}},{"forward",new[]{0,0,32767}},{"right",new[]{32767,0,0}},{"roadWheelAngle",.1},{"accG",new[]{1,0,-.5}}};
  f1Input.Remove("GameName");f1Input["NativeMotion"]=native;
  var decoded=json.Deserialize<Dictionary<string,object>>(json.Serialize(Accept(f1Input,2060)));
  var dw=(Dictionary<string,object>)((System.Collections.IList)decoded["wheels"])[0];
  Check((string)decoded["source"]=="SimHub-native-motion"&&Convert.ToDouble(dw["ratio"])==-.3,"native schema detection without any game name; RL/RR/FL/FR conversion");
  Check(Convert.ToDouble(dw["angle"])==-.03&&Convert.ToDouble(dw["fy"])==-30,"native motion-minus-heading and right-positive force normalization");
  Check(Convert.ToDouble(dw["load"])==3000&&Convert.ToDouble(dw["speedMs"])==22,"native loads and SI wheel speed");
  Check(Convert.ToDouble(((System.Collections.IList)decoded["localVelocity"])[0])==-2,"left-positive reported local X must be normalized");
  native["frameBefore"]=11;Check(Accept(f1Input,2080)==null,"incoherent property snapshot cannot renew freshness");
  native["frameBefore"]=11;native["frame"]=11;native["fx"]=new object[]{1,2,double.NaN,4};
  decoded=json.Deserialize<Dictionary<string,object>>(json.Serialize(Accept(f1Input,2100)));
  dw=(Dictionary<string,object>)((System.Collections.IList)decoded["wheels"])[0];Check(dw["fx"]==null&&Convert.ToDouble(dw["ratio"])==-.3,"one invalid optional force must not suppress the other capabilities");
  var n=(Dictionary<string,object>)d["NewData"];n["SpeedKmh"]=72;n["Throttle"]=65;n["Brake"]=20;n["CarModel"]="Generic fixture";
  d["FrameTimeUTC"]="test-frame-2";var next=Accept(d,1020);File.WriteAllText(args[1],json.Serialize(next));
  n["TyrePressureUnit"]="Kpa";n["TyrePressureFrontLeft"]=172.3689;n["Throttle"]=null;n["Brake"]=double.NaN;
  n["AccelerationSurge"]=9.80665;n["AccelerationSway"]=0;n["AccelerationHeave"]=0;
  d["FrameTimeUTC"]="test-frame-3";var checkedData=json.Deserialize<Dictionary<string,object>>(json.Serialize(Accept(d,1040)));
  var checkedWheel=(Dictionary<string,object>)((System.Collections.IList)checkedData["wheels"])[0];
  Check(Math.Abs(Convert.ToDouble(checkedWheel["pressurePsi"])-25)<.001,"kPa to psi");
  Check(checkedData["gas"]==null&&checkedData["brake"]==null,"missing/NaN controls must not become zero");
  Check(Math.Abs(Convert.ToDouble(((System.Collections.IList)checkedData["accG"])[2])-1)<.001,"m/s2 to g");
  n["TyrePressureUnit"]="unknown";d["FrameTimeUTC"]="2026-10-19T12:00:01Z";Accept(d,1060);
  d["FrameTimeUTC"]="2026-10-19T12:00:00Z";Check(Accept(d,1080)==null,"out of order data must not renew freshness");
  d["FrameTimeUTC"]="2026-10-19T12:00:02Z";checkedData=json.Deserialize<Dictionary<string,object>>(json.Serialize(Accept(d,1100)));
  checkedWheel=(Dictionary<string,object>)((System.Collections.IList)checkedData["wheels"])[0];Check(checkedWheel["pressurePsi"]==null,"unknown unit must not be guessed");
  d["GameRunning"]="malformed";Check(json.Serialize(Accept(d,1120)).Contains("false"),"malformed status");d["GameRunning"]=true;
  d["NewData"]=null;var absent=json.Serialize(Accept(d,1030));Check(absent.Contains("false"),"missing game must not appear active");
  var frames=new SimHubTelemetry.FrameCache();
  var feed=new Dictionary<string,object>{{"GameRunning",true},{"SessionId","session-a"},{"GameName","game"},
   {"FrameTimeUTC","2026-10-19T12:00:01Z"},{"NewData",new Dictionary<string,object>{{"CarModel","Car A"},{"SpeedKmh",70}}}};
  var start=frames.Observe(feed,2000,9000,"api:8888");
  var startWire=Map(json,start);
  Check(Convert.ToInt64(startWire["sampleTime"])==2000&&Convert.ToInt64(startWire["receivedAt"])==9000,
   "generic sample uses local observation clock and a separate UTC receipt");
  Check(frames.Observe(feed,2900,8000,"api:8888")==null&&object.ReferenceEquals(frames.Current(2999),start),
   "repeat HTTP frame retains its original sample, including during UTC rollback");
  Check(!(bool)Map(json,frames.Current(3000))["available"]&&frames.Observe(feed,3010,9800,"api:8888")==null,
   "expired HTTP frame cannot resurrect from rereading the same source");
  feed["FrameTimeUTC"]="2026-10-19T12:00:00Z";
  Check(frames.Observe(feed,3020,9810,"api:8888")==null,"late older HTTP frame cannot resurrect expired same-session cache");
  feed["FrameTimeUTC"]="2026-10-19T12:00:02Z";
  var resumed=Map(json,frames.Observe(feed,3030,9820,"api:8888"));
  Check(!object.Equals(resumed["streamEpoch"],startWire["streamEpoch"]),"new frame after expiry starts a new continuity epoch");
  Check(!(bool)Map(json,frames.Current(3100,3090))["available"],"a recent native selection invalidates pre-handover backup");
  feed["FrameTimeUTC"]="2026-10-19T12:00:03Z";
  var handover=Map(json,frames.Observe(feed,3110,9900,"api:8888",3090));
  Check(!object.Equals(handover["streamEpoch"],resumed["streamEpoch"]),"a post-native fallback starts a new continuity epoch");
  feed["SessionId"]="session-b";feed["FrameTimeUTC"]="2026-10-19T11:00:01Z";
  var changed=Map(json,frames.Observe(feed,3120,9910,"api:8888",3090));
  Check(!object.Equals(changed["streamEpoch"],handover["streamEpoch"]),"confirmed identity change may restart the producer's ordering clock");
  feed["GameRunning"]=false;
  Check(!(bool)Map(json,frames.Observe(feed,3130,9920,"api:8888"))["available"],"explicit stop clears cache");
  feed["GameRunning"]=true;
  Check(frames.Observe(feed,3140,9930,"api:8888")==null,"the identical stopped frame cannot revive a source");
  feed["FrameTimeUTC"]="2026-10-19T10:00:00Z";
  Check(frames.Observe(feed,3150,9940,"api:8888")==null&&
   frames.Observe(feed,3160,9950,"api:8888")==null,"lower generic clock after stop needs a distinct advancing frame");
  feed["FrameTimeUTC"]="2026-10-19T10:00:01Z";
  var genericRestart=Map(json,frames.Observe(feed,3170,9960,"api:8888"));
  Check((bool)genericRestart["available"]&&!object.Equals(changed["streamEpoch"],genericRestart["streamEpoch"]),
   "generic UTC rollback can recover with advancing producer evidence");
  var nativeFrames=new SimHubTelemetry.FrameCache();
  native["frameBefore"]=100;native["frame"]=100;native["time"]=10.0;
  var nativeStart=Map(json,nativeFrames.Observe(f1Input,4000,11000,"probe:8888"));
  native["frameBefore"]=5;native["frame"]=5;native["time"]=.5;
  Check(nativeFrames.Observe(f1Input,4010,11010,"probe:8888")==null&&
   (bool)Map(json,nativeFrames.Current(4010))["available"],"a low packet while healthy is simply late");
  Check(nativeFrames.Observe(f1Input,5000,12000,"probe:8888")==null&&
   !(bool)Map(json,nativeFrames.Current(5000))["available"],"a lone lower packet cannot revive expired native fallback");
  Check(nativeFrames.Observe(f1Input,5010,12010,"probe:8888")==null,"repeated restart probe is not forward progression");
  native["frameBefore"]=6;native["frame"]=6;native["time"]=.6;
  var nativeRestart=Map(json,nativeFrames.Observe(f1Input,5020,12020,"probe:8888"));
  Check((bool)nativeRestart["available"]&&!object.Equals(nativeStart["streamEpoch"],nativeRestart["streamEpoch"])&&
   Convert.ToInt32(nativeRestart["nativePacket"])==6,"a second coherent forward frame establishes a new same-identity epoch.");
  using(var oldPort=new Endpoint(41))
  using(var newPort=new Endpoint(72)){
   int selected=oldPort.Port;
   SimHubTelemetry.Start(()=>Volatile.Read(ref selected));
   Check(!oldPort.Requested.WaitOne(100),"without snapshot demand SimHub does not poll");
   Check(!(bool)Map(json,SimHubTelemetry.Current())["available"]&&oldPort.Requested.WaitOne(1000),"first demand wakes the backup without blocking on HTTP");
   Volatile.Write(ref selected,newPort.Port);
   Check(!(bool)Map(json,SimHubTelemetry.Current())["available"],"a changed port invalidates previous demand");
   oldPort.Reply.Set();
   Check(newPort.Requested.WaitOne(1000),"changed port becomes the next request target");
   Check(!(bool)Map(json,SimHubTelemetry.Current())["available"],"late old-port response was not published");
   newPort.Reply.Set();
   Dictionary<string,object> accepted=null;
   for(int i=0;i<30;i++){
    var sample=Map(json,SimHubTelemetry.Current());
    if((bool)sample["available"]){accepted=sample;break;}
    Thread.Sleep(15);
   }
   Check(accepted!=null&&Convert.ToInt32(accepted["speedKmh"])==72,"only the current port publishes a valid fallback");
   SimHubTelemetry.NativeObserved();
   Check(!(bool)Map(json,SimHubTelemetry.Current())["available"],"native reappearance immediately retires the cached backup");
  }
  Console.WriteLine("PASS: recorded SimHub API normalization; normalized pedal units; four feedback wheels; duplicate frame expiry; native handover; session identity, stop and native restart probe; missing game; demand, changed port and late HTTP rejection; JS handoff fixture saved.");
 }
}
