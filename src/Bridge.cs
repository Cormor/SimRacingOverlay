using System;
using System.IO;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.IO.MemoryMappedFiles;
using SharpDX.DirectInput;

class Bridge {
 static readonly string root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
 static readonly object gate=new object();
 [ThreadStatic] static JavaScriptSerializer threadJson;
 static JavaScriptSerializer json {get{return threadJson??(threadJson=new JavaScriptSerializer(){MaxJsonLength=1048576});}}
 static readonly TelemetryEventStream events=new TelemetryEventStream(State,sourceOf:PublishedSource);
 static readonly TelemetryEventStream steeringEvents=new TelemetryEventStream(null);
 static readonly AutoResetEvent discoverControllers=new AutoResetEvent(false);
 static volatile Controller[] discoveredControllers;
 static readonly string token=Guid.NewGuid().ToString("N");
 static volatile Settings settings=new Settings(new Dictionary<string,object>());
 static volatile InputSnapshot latestInput;
 static volatile LedObservation latestLed;
 static double? lastLedStamp;
 static double ledDeadline;
 static int port=18764;
 static object Get(Dictionary<string,object> d,string k,object fallback=null){object v;return d!=null&&d.TryGetValue(k,out v)?v:fallback;}
 static Dictionary<string,object> Map(object o){return o as Dictionary<string,object>;}
 static double Number(object o,double fallback=0){double n;return o!=null&&double.TryParse(Convert.ToString(o,System.Globalization.CultureInfo.InvariantCulture),System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out n)&&!double.IsNaN(n)&&!double.IsInfinity(n)?n:fallback;}
 static double Clamp(double n,double a,double b){return Math.Max(a,Math.Min(b,n));}
 // Called on startup and by the file watcher, never by a frame consumer.
 static bool LoadConfig(){
  var file=Path.Combine(root,"settings.json");
  try{
   lock(gate){
    if(!File.Exists(file))return true;
    var time=File.GetLastWriteTimeUtc(file);
    var cfg=json.Deserialize<Dictionary<string,object>>(WatchedFile.ReadText(file));
    if(cfg==null||time!=File.GetLastWriteTimeUtc(file))return false;
    Validate(cfg);
    settings=new Settings(cfg);
    return true;
   }
  }catch{return false;}
 }
 sealed class LedObservation {
  internal readonly Dictionary<string,object> Values;
  internal readonly double ExpiresAt;
  internal LedObservation(Dictionary<string,object> values,double expiresAt){Values=values;ExpiresAt=expiresAt;}
 }
 static bool LoadLed(){
  try{
   var file=Path.Combine(root,"runtime","led-state.json");
   if(!File.Exists(file)){latestLed=null;return true;}
   var values=json.Deserialize<Dictionary<string,object>>(WatchedFile.ReadText(file));
   var stamp=Number(Get(values,"timestamp"),double.NaN);
   var age=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-stamp;
   var now=ClockMs();
   if(!lastLedStamp.HasValue||lastLedStamp.Value!=stamp){
    if(!(age>=0&&age<1500)){latestLed=null;return true;}
    lastLedStamp=stamp;ledDeadline=now+(1500-age);
   }
   latestLed=now<ledDeadline?new LedObservation(values,ledDeadline):null;
   return true;
  }catch{latestLed=null;return false;}
 }
 const uint MoveFileReplaceExisting=0x1;
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)]
 [return:MarshalAs(UnmanagedType.Bool)]
 static extern bool MoveFileExW(string source,string destination,uint flags);

 static void SaveConfig(Dictionary<string,object> incoming){
  lock(gate){
   var next=new Dictionary<string,object>(settings.Values);
   foreach(var pair in incoming)
    if(new[]{"inputs","steeringRange","buttonMap","visualProfile","ledObserver","simHubPort"}.Contains(pair.Key))next[pair.Key]=pair.Value;

   var file=Path.Combine(root,"settings.json");
   var temp=file+"."+Guid.NewGuid().ToString("N")+".tmp";
   try{
    File.WriteAllText(temp,json.Serialize(next),new UTF8Encoding(false));
    var saved=new Settings(next);
    // One same-volume rename for both new and existing settings files.
    if(!MoveFileExW(temp,file,MoveFileReplaceExisting))
     throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    settings=saved;
   }finally{
    try{File.Delete(temp);}
    catch(IOException){}
    catch(UnauthorizedAccessException){}
   }
  }
 }
 static void Main(){
  LoadConfig();
  port=(int)Clamp(Number(Get(settings.Values,"httpPort"),18764),1024,65534);
  bool first;
  using(var mutex=new Mutex(true,"Local\\SimRacingOverlay_"+port,out first)){
   if(!first)return;
   using(new WatchedFile(Path.Combine(root,"settings.json"),LoadConfig))
   using(new WatchedFile(Path.Combine(root,"runtime","led-state.json"),LoadLed)){
    SimHubTelemetry.Start(()=>settings.SimHubPort);NativeUdpTelemetry.Start();
    new Thread(DiscoverControllers){IsBackground=true,Name="DirectInput discovery"}.Start();
    new Thread(Capture){IsBackground=true,Name="DirectInput capture"}.Start();
    var server=new TcpListener(IPAddress.Loopback,port);
    server.Start();
    Console.WriteLine("SimRacingOverlay: http://127.0.0.1:"+port);
    while(true){var client=server.AcceptTcpClient();ThreadPool.QueueUserWorkItem(_=>Serve(client));}
   }
  }
 }
 static int Score(DeviceInstance d){string s=d.InstanceName.ToLowerInvariant();return (d.Type.ToString().IndexOf("Driving",StringComparison.OrdinalIgnoreCase)>=0?100:0)+(new[]{"wheel","base","moza","fanatec","simagic","simucube","thrustmaster","logitech"}.Any(s.Contains)?50:0);}
 static double ClockMs(){return TelemetryEventStream.ClockMs();}
 static void DiscoverControllers(){
  using(var notifications=new ControllerNotifications(discoverControllers))
  using(var direct=new DirectInput()){
   bool available;
   do{
    try{
     var next=direct.GetDevices(DeviceClass.GameControl,DeviceEnumerationFlags.AttachedOnly).OrderByDescending(Score).Select(d=>new Controller(d.InstanceGuid,d.ProductGuid,d.InstanceName,d.Type)).ToArray();
     var prior=discoveredControllers;
     if(prior==null||prior.Length!=next.Length||prior.Where((d,i)=>!d.SameIdentity(next[i])).Any())discoveredControllers=next;
     available=next.Length>0;
    }catch{available=false;}
    if(discoverControllers.WaitOne(notifications.Active&&available?Timeout.Infinite:1500)){
     // A HID arrival can precede DirectInput updating its controller list.
     Thread.Sleep(150);discoverControllers.WaitOne(0);
    }
   }while(true);
  }
 }
 static void UpdateControllers(DirectInput direct,Dictionary<Guid,OpenedController> opened,Controller[] attached){
  foreach(var id in opened.Keys.Where(k=>!attached.Any(d=>d.InstanceGuid==k)).ToArray()){
   var device=opened[id];opened.Remove(id);device.Joystick.Dispose();
  }
  foreach(var device in attached)if(!opened.ContainsKey(device.InstanceGuid)){
   Joystick joystick=null;
   try{
    joystick=new Joystick(direct,device.InstanceGuid);
    joystick.SetCooperativeLevel(IntPtr.Zero,CooperativeLevel.Background|CooperativeLevel.NonExclusive);
    joystick.Properties.AxisMode=DeviceAxisMode.Absolute;
    int axes=ReadAxisMask(joystick);
    joystick.Acquire();
    opened.Add(device.InstanceGuid,new OpenedController(joystick,axes));
   }catch{if(joystick!=null)joystick.Dispose();}
  }
 }
 static void Capture(){
  using(var direct=new DirectInput())using(var clock=new InputCaptureClock()){
   var opened=new Dictionary<Guid,OpenedController>();
   var attached=NoControllers;
   long sequence=0;
   double lastAcquisition=double.NegativeInfinity;
   while(true){
    var started=ClockMs();
    var rebindMs=0.0;
    InputSnapshot snapshot;
    try{
     var latest=discoveredControllers;
     bool retry=opened.Count<attached.Length&&started-lastAcquisition>=1500;
     if(retry)discoverControllers.Set();
     if(latest!=null&&(!ReferenceEquals(latest,attached)||retry)){
      attached=latest;lastAcquisition=started;UpdateControllers(direct,opened,attached);
     }
     var polling=ClockMs();
     rebindMs=polling-started;
     var samples=new DeviceSample[attached.Length];
     for(int i=0;i<attached.Length;i++){
      var device=attached[i];OpenedController handle;
      if(!opened.TryGetValue(device.InstanceGuid,out handle))continue;
      try{
       var before=ClockMs();
       handle.Joystick.Poll();
       var raw=handle.Joystick.GetCurrentState();
       var observed=ClockMs();
       samples[i]=new DeviceSample(device,raw,handle.Axes,observed,observed-before);
      }catch{
       opened.Remove(device.InstanceGuid);handle.Joystick.Dispose();lastAcquisition=ClockMs();
      }
     }
     var completed=ClockMs();
     snapshot=new InputSnapshot(++sequence,completed,attached,samples,settings,rebindMs,completed-polling,"");
    }catch(Exception e){
     // Publish the failure without carrying forward any earlier device reading.
     snapshot=new InputSnapshot(++sequence,ClockMs(),attached,NoSamples,settings,rebindMs,0,e.GetType().Name);
    }
    latestInput=snapshot;
    if(steeringEvents.HasClients)steeringEvents.Publish(json,snapshot.SteeringFrame(ClockMs()));
    clock.WaitNext(steeringEvents.HasClients);
   }
  }
 }
 static readonly PhysicsTelemetry.Session physicsSession=new PhysicsTelemetry.Session();
 static readonly object physicsHealthGate=new object();
 static string physicsHealth="unknown",physicsError;
 static long? physicsObservedAt,physicsSampleAt,physicsErrorAt;
 static object ReportPhysics(object sample,long observed,string state=null,string error=null){
  lock(physicsHealthGate){
   physicsObservedAt=observed;
   var at=physicsSession.LastSampleAt;
   if(at.HasValue)physicsSampleAt=at;
   physicsHealth=state??(sample!=null?"available":observed-physicsSampleAt>PhysicsTelemetry.Session.LifetimeMs?"expired":
    physicsSession.AwaitingAdvance?"waiting":"unavailable");
   if(error!=null){physicsError=error;physicsErrorAt=observed;}
  }
  return sample;
 }
 static object PhysicsDiagnostics(){
  lock(physicsHealthGate){
   long now=(long)ClockMs();
   string state=physicsHealth=="available"&&now-physicsSampleAt>PhysicsTelemetry.Session.LifetimeMs?"expired":physicsHealth;
   return new {state,lastSampleAgeMs=now-physicsSampleAt,observedAgeMs=now-physicsObservedAt,
    latestError=physicsError,latestErrorAgeMs=now-physicsErrorAt};
  }
 }
 static string PublishedSource(object snapshot){
  var game=Map(Get(Map(snapshot),"game"));
  if(!object.Equals(Get(game,"available"),true))return null;
  var source=Get(game,"source") as string;
  switch(source){
   case "UDP-native-motion":case "iRacing-SDK":case "acpmf_physics":
   case "SimHub-generic":case "SimHub-native-motion":return source;
   default:return null;
  }
 }
 static object TelemetryDiagnostics(){
  string source;double? ageMs;var state=events.ReadSelection(out source,out ageMs);
  object udpHealth;
  var result=NativeUdpTelemetry.Diagnostics(out udpHealth);
  result["selection"]=new {state,source,publishedAgeMs=ageMs};
  result["sources"]=new {
   udp=new {selected=Selected(state,source,"UDP-native-motion"),health=udpHealth},
   iRacing=new {selected=Selected(state,source,"iRacing-SDK"),health=IRacingTelemetry.Diagnostics()},
   acr=new {selected=Selected(state,source,"acpmf_physics"),health=PhysicsDiagnostics()},
   simHub=new {selected=Selected(state,source,"SimHub-generic","SimHub-native-motion"),health=SimHubTelemetry.Diagnostics()}
  };
  return result;
 }
 static bool? Selected(string state,string source,string name,string alternative=null){
  return state=="selected"?(bool?)(source==name||source==alternative):state=="no-source"?(bool?)false:null;
 }
 static int I(byte[] data,int offset){return BitConverter.ToInt32(data,offset);}
 static Dictionary<string,object> Game(){
  bool native=true;var sample=TelemetrySourceSelection.Select(NativeUdpTelemetry.Current,ReadSharedMemory,()=>{native=false;return SimHubTelemetry.Current();});
  if(native)SimHubTelemetry.NativeObserved();
  return Map(sample)??Map(json.DeserializeObject(json.Serialize(sample)));
 }
    static object ReadSharedMemory(){var sample=IRacingTelemetry.Current();return TelemetrySourceSelection.Available(sample)?sample:ReadPhysics();}
    static object ReadPhysics() {
        try {
            using(var m=MemoryMappedFile.OpenExisting("Local\\acpmf_physics",MemoryMappedFileRights.Read))
            using(var v=m.CreateViewAccessor(0,800,MemoryMappedFileAccess.Read)) {
                // A single copy prevents fields from being read across different physics packets.
                var data=new byte[800];bool coherent=false;
                for(int attempt=0;attempt<3;attempt++) {
                    int before=v.ReadInt32(0);v.ReadArray(0,data,0,data.Length);
                    if(before==I(data,0)&&before==v.ReadInt32(0)){coherent=true;break;}
                }
                var observed=(long)ClockMs();
                if(!coherent)return ReportPhysics(physicsSession.Current(observed),observed,error:"physics-incoherent");
                var receivedAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                byte[] metadata=null;
                try {
                    using(var sm=MemoryMappedFile.OpenExisting("Local\\acpmf_static",MemoryMappedFileRights.Read))
                    using(var sv=sm.CreateViewAccessor(0,0,MemoryMappedFileAccess.Read)) {
                        metadata=new byte[(int)Math.Min(472,sv.Capacity)];sv.ReadArray(0,metadata,0,metadata.Length);
                    }
                }catch(Exception){}
                return ReportPhysics(physicsSession.Observe(data,metadata,observed,receivedAt),observed);
            }
        }catch(FileNotFoundException){physicsSession.Disconnect();return ReportPhysics(null,(long)ClockMs(),"unavailable");}
        catch(Exception error){
            physicsSession.Disconnect();
            return ReportPhysics(null,(long)ClockMs(),"unavailable",
                error is UnauthorizedAccessException?"physics-access-denied":"physics-read-error");
        }
    }
 static double? GameNumber(Dictionary<string,object> game,string key,double min,double max){
  if(!object.Equals(Get(game,"available"),true))return null;
  double value=Number(Get(game,key),double.NaN);
  return value>=min&&value<=max?(double?)value:null;
 }
 static string InputSource(double? hardware,double? game){return hardware.HasValue?"hardware":game.HasValue?"game":null;}
 static object State(){
  var game=Game();
  var snapshot=latestInput??new InputSnapshot(0,null,discoveredControllers??NoControllers,NoSamples,settings,0,0,"");
  var now=ClockMs();
  var result=ProjectState(snapshot,game,now,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
  var led=latestLed;
  if(led!=null&&now<led.ExpiresAt){
   result["leds"]=led.Values;
   result["ledSource"]=Get(led.Values,"source");
  }
  return result;
 }
 internal static Dictionary<string,object> ProjectState(InputSnapshot snapshot,Dictionary<string,object> game,double now,long timestamp){
  bool live=object.Equals(Get(game,"available"),true);
  var gameSteering=GameNumber(game,"steeringWheelAngle",-20,20)*180/Math.PI;
  var gameThrottle=GameNumber(game,"gas",0,1)*100;
  var gameBrake=GameNumber(game,"brake",0,1)*100;
  var gameHandbrake=GameNumber(game,"handbrake",0,1)*100;
  var result=new Dictionary<string,object>();
  var steering=snapshot.Steering.ValueAt(now);
  var throttle=snapshot.Throttle.ValueAt(now);
  var brake=snapshot.Brake.ValueAt(now);
  var handbrake=snapshot.Handbrake.ValueAt(now);
  var rows=snapshot.Samples.Where(d=>d!=null&&d.IsFresh(now)).Select(d=>d.Wire(now)).ToArray();
  var wheel=snapshot.Steering.Sample;
  if(wheel!=null&&!wheel.IsFresh(now))wheel=null;
  var cfg=snapshot.Settings.Values;
  result["connected"]=rows.Length>0||live;
  result["inputConnected"]=rows.Length>0;
  result["steeringHardware"]=steering.HasValue;
  result["device"]=wheel==null?Get(game,"source"):wheel.Controller.name;
  result["timestamp"]=timestamp;
  result["transport"]=new {epoch=hardwareEpoch,publishedMs=now};
  result["angle"]=steering??gameSteering;
  result["gameSteeringAngle"]=gameSteering;
  result["throttle"]=throttle??gameThrottle;
  result["brake"]=brake??gameBrake;
  result["handbrake"]=handbrake??gameHandbrake;
  result["inputSources"]=new {steering=InputSource(steering,gameSteering),throttle=InputSource(throttle,gameThrottle),
   brake=InputSource(brake,gameBrake),handbrake=InputSource(handbrake,gameHandbrake)};
  result["hardware"]=new {epoch=hardwareEpoch,sequence=snapshot.Sequence,ageMs=now-snapshot.CompletedAt,validForMs=HardwareValidForMs,
   channels=new {steering=snapshot.Steering.Wire(now),throttle=snapshot.Throttle.Wire(now),
    brake=snapshot.Brake.Wire(now),handbrake=snapshot.Handbrake.Wire(now)},error=snapshot.Error};
  result["buttons"]=wheel==null?NoButtons:wheel.Buttons;
  result["knobPositions"]=new int?[4];
  result["game"]=game;
  result["devices"]=rows;
  result["deviceDirectory"]=snapshot.Directory;
  result["inputProfile"]=new {buttonMap=Get(cfg,"buttonMap"),visualProfile=Get(cfg,"visualProfile","generic")};
  result["configToken"]=token;
  result["ledSource"]="rpm-fallback";
  result["error"]=snapshot.Error;
  return result;
 }
 internal static void Validate(Dictionary<string,object> cfg){double range=Number(Get(cfg,"steeringRange"),900);if(range<180||range>2520)throw new ArgumentException("Steering range must be 180..2520");var inputs=Map(Get(cfg,"inputs"));if(inputs!=null)foreach(var e in inputs){if(e.Key=="handbrakeInputs"){var list=e.Value as System.Collections.IEnumerable;if(list==null)throw new ArgumentException("Invalid handbrake mapping");int count=0;foreach(var x in list){var one=new Dictionary<string,object>{{"inputs",new Dictionary<string,object>{{"handbrake",x}}}};Validate(one);if(++count>4)throw new ArgumentException("Too many handbrake inputs");}continue;}var m=Map(e.Value);if(m==null)throw new ArgumentException("Invalid input mapping");if(!new[]{"X","Y","Z","RotationX","RotationY","RotationZ","Slider0","Slider1"}.Contains(Convert.ToString(Get(m,"axis"))))throw new ArgumentException("Unknown input axis");if(Number(Get(m,"max"),65535)-Number(Get(m,"min"),0)<100)throw new ArgumentException("Axis calibration span too small");}}
 static void Serve(TcpClient c){using(c)try{c.ReceiveTimeout=3000;c.SendTimeout=3000;using(var stream=c.GetStream()){var bytes=new System.Collections.Generic.List<byte>();while(bytes.Count<16384){int b=stream.ReadByte();if(b<0)return;bytes.Add((byte)b);int n=bytes.Count;if(n>=4&&bytes[n-4]==13&&bytes[n-3]==10&&bytes[n-2]==13&&bytes[n-1]==10)break;}var lines=Encoding.ASCII.GetString(bytes.ToArray()).Split(new[]{"\r\n"},StringSplitOptions.None);var request=lines[0].Split(' ');if(request.Length<2)return;string method=request[0],url=request[1].Split('?')[0];var headers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);foreach(string l in lines.Skip(1)){int i=l.IndexOf(':');if(i>0)headers[l.Substring(0,i)]=l.Substring(i+1).Trim();}if(method=="GET"&&(url=="/events"||url=="/steering-events")){c.NoDelay=true;(url=="/events"?events:steeringEvents).Serve(stream);return;}byte[] data;string type="application/json; charset=utf-8",status="200 OK";
  if(method=="GET"&&url=="/telemetry-status")data=Encoding.UTF8.GetBytes(json.Serialize(TelemetryDiagnostics()));
  else if(method=="GET"&&url=="/clock")data=Encoding.UTF8.GetBytes("{}");
  else if(method=="GET"&&url=="/state"){
   data=events.ReadHttp();
   if(data==null){status="503 Service Unavailable";data=Encoding.UTF8.GetBytes("{\"connected\":false,\"error\":\"Telemetry snapshot unavailable\"}");}
  }
  else if(method=="GET"&&url=="/api/settings"){data=Encoding.UTF8.GetBytes(json.Serialize(settings.Values));}
  else if(method=="POST"&&url=="/api/settings"){string t,origin;bool auth=headers.TryGetValue("X-Overlay-Token",out t)&&t==token;bool local=!headers.TryGetValue("Origin",out origin)||origin=="http://127.0.0.1:"+port||origin=="http://localhost:"+port;int length;if(!auth||!local){status="403 Forbidden";data=Encoding.UTF8.GetBytes("{}");}else if(!headers.ContainsKey("Content-Length")||!int.TryParse(headers["Content-Length"],out length)||length<2||length>65536){status="413 Payload Too Large";data=Encoding.UTF8.GetBytes("{}");}else{var body=new byte[length];int n=0,r;while(n<length&&(r=stream.Read(body,n,length-n))>0)n+=r;if(n!=length)return;try{var incoming=json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(body));Validate(incoming);SaveConfig(incoming);data=Encoding.UTF8.GetBytes("{\"ok\":true}");}catch(Exception e){status="400 Bad Request";data=Encoding.UTF8.GetBytes(json.Serialize(new{error=e.Message}));}}}
  else if(method=="GET"){var relative=Uri.UnescapeDataString(url).TrimStart('/');if(relative=="")relative="index.html";if(relative=="setup")relative="setup.html";var file=Path.GetFullPath(Path.Combine(root,relative));bool allowed=file.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)&&(file.EndsWith(".html")||file.EndsWith(".js")||file.EndsWith(".css")||file.EndsWith(".svg")||file.EndsWith(".png")||(file.EndsWith(".json")&&relative.StartsWith("assets/")));if(!allowed||!File.Exists(file)){status="404 Not Found";data=Encoding.UTF8.GetBytes("{}");}else{data=File.ReadAllBytes(file);type=file.EndsWith(".js")?"text/javascript":file.EndsWith(".css")?"text/css":file.EndsWith(".svg")?"image/svg+xml":file.EndsWith(".png")?"image/png":file.EndsWith(".json")?"application/json":"text/html; charset=utf-8";}}
  else{status="405 Method Not Allowed";data=Encoding.UTF8.GetBytes("{}");}
  var clockHeaders=method=="GET"&&(url=="/state"||url=="/clock")?
   "X-Overlay-Clock-Ms: "+ClockMs().ToString("R",CultureInfo.InvariantCulture)+"\r\nX-Overlay-Clock-Epoch: "+hardwareEpoch+"\r\n":"";
  var h=Encoding.ASCII.GetBytes("HTTP/1.1 "+status+"\r\nContent-Type: "+type+"\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Length: "+data.Length+"\r\n"+clockHeaders+"Connection: close\r\n\r\n");stream.Write(h,0,h.Length);stream.Write(data,0,data.Length);
 }}catch{}}

 const int HardwareValidForMs=100;
 static readonly string hardwareEpoch=Guid.NewGuid().ToString("N");
 static readonly Controller[] NoControllers=new Controller[0];
 static readonly DeviceSample[] NoSamples=new DeviceSample[0];
 static readonly int[] NoButtons=new int[0];
 static readonly string[] AxisNames={"X","Y","Z","RotationX","RotationY","RotationZ","Slider0","Slider1"};
 static readonly Guid[] AxisTypes={ObjectGuid.XAxis,ObjectGuid.YAxis,ObjectGuid.ZAxis,ObjectGuid.RxAxis,ObjectGuid.RyAxis,ObjectGuid.RzAxis};

 static int ReadAxisMask(Joystick joystick){
  // JoystickState has zero-filled slots for optional axes. Identify actual
  // position objects by type, never by their driver-native byte offset.
  int mask=0,sliders=0;
  foreach(var item in joystick.GetObjects(DeviceObjectTypeFlags.Axis)){
   var aspect=item.Aspect&ObjectAspect.Mask;
   if(aspect!=0&&aspect!=ObjectAspect.Position)continue;
   int index=Array.IndexOf(AxisTypes,item.ObjectType);
   if(index>=0)mask|=1<<index;
   else if(item.ObjectType==ObjectGuid.Slider&&sliders<2){mask|=1<<(6+sliders);sliders++;}
  }
  return mask;
 }

 internal sealed class Controller {
  internal readonly Guid InstanceGuid;
  public readonly string id,productId,name,type;
  internal Controller(Guid instanceGuid,Guid productGuid,string name,DeviceType type){
   InstanceGuid=instanceGuid;
   id=instanceGuid.ToString();productId=productGuid.ToString();
   this.name=name;this.type=type.ToString();
  }
  internal bool SameIdentity(Controller other){
   return InstanceGuid==other.InstanceGuid&&productId==other.productId&&name==other.name&&type==other.type;
  }
 }
 sealed class OpenedController {
  internal readonly Joystick Joystick;
  internal readonly int Axes;
  internal OpenedController(Joystick joystick,int axes){Joystick=joystick;Axes=axes;}
 }
 internal sealed class DeviceSample {
  internal readonly Controller Controller;
  internal readonly double SampleMs,PollMs;
  internal readonly int[] Buttons;
  readonly int axes;
  readonly JoystickState raw;
  internal DeviceSample(Controller controller,JoystickState raw,int axes,double sampleMs,double pollMs){
   Controller=controller;this.raw=raw;this.axes=axes;SampleMs=sampleMs;PollMs=pollMs;
   List<int> buttons=null;
   for(int i=0;i<raw.Buttons.Length;i++)if(raw.Buttons[i]){
    if(buttons==null)buttons=new List<int>();
    buttons.Add(i+1);
   }
   Buttons=buttons==null?NoButtons:buttons.ToArray();
  }
  internal int? Axis(int index){
   if(index<0||(axes&(1<<index))==0)return null;
   switch(index){
    case 0:return raw.X;
    case 1:return raw.Y;
    case 2:return raw.Z;
    case 3:return raw.RotationX;
    case 4:return raw.RotationY;
    case 5:return raw.RotationZ;
    default:return raw.Sliders.Length>index-6?(int?)raw.Sliders[index-6]:null;
   }
  }
  internal bool IsFresh(double now){return now-SampleMs<HardwareValidForMs;}
  internal object Wire(double now){
   var values=new Dictionary<string,int>();
   for(int i=0;i<AxisNames.Length;i++){
    var value=Axis(i);if(value.HasValue)values.Add(AxisNames[i],value.Value);
   }
   return new {id=Controller.id,productId=Controller.productId,name=Controller.name,type=Controller.type,
    axes=values,buttons=Buttons,sampleMs=SampleMs,ageMs=now-SampleMs,pollMs=PollMs};
  }
 }
 internal sealed class Binding {
  internal readonly string DeviceId,ProductId,Axis;
  internal readonly int AxisIndex;
  internal readonly double Min,Max;
  internal readonly bool Invert,Valid;
  internal Binding(Dictionary<string,object> spec){
   DeviceId=Convert.ToString(Get(spec,"deviceId"));ProductId=Convert.ToString(Get(spec,"productId"));
   Axis=Convert.ToString(Get(spec,"axis"));AxisIndex=Array.IndexOf(AxisNames,Axis);
   Min=Number(Get(spec,"min",0),double.NaN);Max=Number(Get(spec,"max",65535),double.NaN);
   object invert=Get(spec,"invert",false);
   bool invertParsed;
   bool invertValid=bool.TryParse(Convert.ToString(invert),out invertParsed);
   Invert=invertParsed;
   double span=Max-Min;
   Valid=AxisIndex>=0&&span>=100&&!double.IsInfinity(span)&&invertValid&&(DeviceId.Length>0||ProductId.Length>0);
  }
  internal int Find(Controller[] directory){
   int match=-1;
   for(int i=0;i<directory.Length;i++){
    var device=directory[i];
    bool product=ProductId.Length>0&&string.Equals(device.productId,ProductId,StringComparison.OrdinalIgnoreCase);
    if(string.Equals(device.id,DeviceId,StringComparison.OrdinalIgnoreCase)&&(ProductId.Length==0||product))return i;
    if(product)match=match==-1?i:-2;
   }
   return match;
  }
  internal static Binding Read(object value){return value==null?null:new Binding(Map(value));}
 }
 internal sealed class Settings {
  internal readonly Dictionary<string,object> Values;
  internal readonly Binding Steering,Throttle,Brake;
  internal readonly Binding[] Handbrakes;
  internal readonly double SteeringRange;
  internal readonly int SimHubPort;
  internal Settings(Dictionary<string,object> values){
   Values=values;
   var inputs=Map(Get(values,"inputs"));
   Steering=Binding.Read(Get(inputs,"steering"));
   Throttle=Binding.Read(Get(inputs,"throttle"));
   Brake=Binding.Read(Get(inputs,"brake"));
   var extra=Get(inputs,"handbrakeInputs") as System.Collections.IList;
   var single=Binding.Read(Get(inputs,"handbrake"));
   Handbrakes=extra!=null?extra.Cast<object>().Select(Binding.Read).ToArray():
    single==null?new Binding[0]:new[]{single};
   SteeringRange=Clamp(Number(Get(values,"steeringRange"),900),180,2520);
   SimHubPort=(int)Clamp(Number(Get(values,"simHubPort"),8888),1024,65535);
  }
 }

 internal sealed class Channel {
  internal static readonly Channel Unmapped=new Channel(null,null,null,null,null,false);
  internal readonly DeviceSample Sample;
  internal readonly double? SampleMs;
  readonly string deviceId,axis;
  internal string DeviceId{get{return deviceId;}}
  readonly double? value;
  readonly bool mapped;
  internal Channel(string deviceId,string axis,DeviceSample sample,double? sampleMs,double? value,bool mapped){
   this.deviceId=deviceId;this.axis=axis;Sample=sample;SampleMs=sampleMs;this.value=value;this.mapped=mapped;
  }
  internal double? AgeAt(double now){return now-SampleMs;}
  internal string StateAt(double now){
   if(!mapped)return "unmapped";
   if(!value.HasValue)return "unavailable";
   return AgeAt(now)>=HardwareValidForMs?"stale":"valid";
  }
  internal double? ValueAt(double now){return StateAt(now)=="valid"?value:null;}
  internal object Wire(double now){return new {state=StateAt(now),deviceId,axis,value=ValueAt(now),ageMs=AgeAt(now)};}
  internal static Channel Bind(Binding binding,Controller[] directory,DeviceSample[] samples,double range,bool steering){
   if(binding==null)return Unmapped;
   int index=binding.Find(directory);
   var id=index>=0?directory[index].id:binding.DeviceId;
   var sample=binding.Valid&&index>=0&&index<samples.Length?samples[index]:null;
   var axis=sample==null?null:sample.Axis(binding.AxisIndex);
   double? value=null;
   if(axis.HasValue){
    double fraction=Clamp((axis.Value-binding.Min)/(binding.Max-binding.Min),0,1);
    if(binding.Invert)fraction=1-fraction;
    value=steering?(fraction-.5)*range:fraction*range;
   }
   return new Channel(string.IsNullOrEmpty(id)?null:id,string.IsNullOrEmpty(binding.Axis)?null:binding.Axis,
    sample,sample==null?(double?)null:sample.SampleMs,value,true);
  }
  internal static Channel Handbrake(Binding[] bindings,Controller[] directory,DeviceSample[] samples){
   if(bindings.Length==0)return Unmapped;
   if(bindings.Length==1&&bindings[0]!=null)return Bind(bindings[0],directory,samples,100,false);
   double total=0,oldest=double.PositiveInfinity;
   foreach(var binding in bindings){
    var channel=Bind(binding,directory,samples,100,false);
    if(!channel.value.HasValue)return new Channel(null,null,null,null,null,true);
    total+=channel.value.Value;oldest=Math.Min(oldest,channel.SampleMs.Value);
   }
   return new Channel(null,null,null,oldest,Clamp(total,0,100),true);
  }
 }
 internal sealed class InputSnapshot {
  internal readonly long Sequence;
  internal readonly double? CompletedAt;
  internal readonly Controller[] Directory;
  internal readonly DeviceSample[] Samples;
  internal readonly Channel Steering,Throttle,Brake,Handbrake;
  internal readonly Settings Settings;
  internal readonly string Error;
  readonly double rebindMs,pollMs;
  internal InputSnapshot(long sequence,double? completedAt,Controller[] directory,DeviceSample[] samples,Settings settings,double rebindMs,double pollMs,string error){
   Sequence=sequence;CompletedAt=completedAt;Directory=directory;Samples=samples;Settings=settings;
   this.rebindMs=rebindMs;this.pollMs=pollMs;Error=error;
   Steering=Channel.Bind(settings.Steering,directory,samples,settings.SteeringRange,true);
   Throttle=Channel.Bind(settings.Throttle,directory,samples,100,false);
   Brake=Channel.Bind(settings.Brake,directory,samples,100,false);
   Handbrake=Channel.Handbrake(settings.Handbrakes,directory,samples);
  }
  internal object SteeringFrame(double now){
   return new {angle=Steering.ValueAt(now),sampleMs=Steering.SampleMs,rebindMs,pollMs,
    epoch=hardwareEpoch,sequence=Sequence,ageMs=Steering.AgeAt(now),validForMs=HardwareValidForMs,
    transport=new {epoch=hardwareEpoch,publishedMs=now},
    state=Steering.StateAt(now),deviceId=Steering.DeviceId};
  }
 }

}

// The last good snapshot is owned by the reader. Only a file change, a
// missed-notification recovery, or an incomplete read schedules more I/O.
sealed class WatchedFile : IDisposable {
 readonly object gate=new object();
 readonly string file;
 readonly Func<bool> read;
 readonly Timer timer;
 FileSystemWatcher watcher;
 bool reconnect=true,disposed;
 int retries;
 internal static string ReadText(string file){
  using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read|FileShare.Delete))
  using(var reader=new StreamReader(stream,Encoding.UTF8))return reader.ReadToEnd();
 }
 internal WatchedFile(string file,Func<bool> read){
  this.file=file;this.read=read;
  timer=new Timer(Refresh,null,Timeout.Infinite,Timeout.Infinite);
  timer.Change(0,Timeout.Infinite);
 }
 void Changed(object sender,FileSystemEventArgs args){Schedule(sender,false);}
 void Renamed(object sender,RenamedEventArgs args){Schedule(sender,false);}
 void Failed(object sender,ErrorEventArgs args){Schedule(sender,true);}
 void Schedule(object sender,bool failed){lock(gate){
  if(disposed||!ReferenceEquals(sender,watcher))return;
  reconnect|=failed;retries=0;
  timer.Change(failed?250:40,Timeout.Infinite);
 }}
 void Refresh(object unused){lock(gate){
  if(disposed)return;
  if(reconnect){
   if(watcher!=null){watcher.Dispose();watcher=null;}
   try{
    watcher=new FileSystemWatcher(Path.GetDirectoryName(file),Path.GetFileName(file)){
     NotifyFilter=NotifyFilters.FileName|NotifyFilters.LastWrite|NotifyFilters.Size};
    watcher.Changed+=Changed;watcher.Created+=Changed;watcher.Deleted+=Changed;
    watcher.Renamed+=Renamed;watcher.Error+=Failed;
    watcher.EnableRaisingEvents=true;
    reconnect=false;
   }catch{timer.Change(1000,Timeout.Infinite);}
  }
  if(!read()&&!reconnect&&retries++<2)timer.Change(150,Timeout.Infinite);
 }}
 public void Dispose(){lock(gate){
  disposed=true;timer.Dispose();
  if(watcher!=null){watcher.Dispose();watcher=null;}
 }}
}

// Windows sends interface changes without enumerating connected controllers every few seconds.
sealed class ControllerNotifications : IDisposable {
 [StructLayout(LayoutKind.Explicit,Size=416)]
 struct Filter {
  [FieldOffset(0)] public uint Size;
  // Flags, device-interface filter type and reserved bytes are all zero.
  [FieldOffset(16)] public Guid ClassGuid;
 }
 delegate uint Callback(IntPtr notification,IntPtr context,uint action,IntPtr data,uint size);
 [DllImport("cfgmgr32.dll")]
 static extern uint CM_Register_Notification(ref Filter filter,IntPtr context,Callback callback,out IntPtr notification);
 [DllImport("cfgmgr32.dll")]
 static extern uint CM_Unregister_Notification(IntPtr notification);
 readonly Callback callback;
 readonly IntPtr handle;
 public bool Active{get{return handle!=IntPtr.Zero;}}
 public ControllerNotifications(AutoResetEvent changed){
  callback=(notification,context,action,data,size)=>{changed.Set();return 0;};
  var filter=new Filter{Size=(uint)Marshal.SizeOf(typeof(Filter)),ClassGuid=new Guid("4d1e55b2-f16f-11cf-88cb-001111000030")};
  IntPtr registration;
  try{if(CM_Register_Notification(ref filter,IntPtr.Zero,callback,out registration)==0)handle=registration;}
  catch(EntryPointNotFoundException){}
 }
 public void Dispose(){
  if(Active)CM_Unregister_Notification(handle);
  GC.KeepAlive(callback);
 }
}
