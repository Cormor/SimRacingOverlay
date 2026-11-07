using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;
using SharpDX.DirectInput;

class MappingTest {
 static readonly Guid WheelId=new Guid("00000001-0000-0000-0000-000000000000");
 static readonly Guid PedalId=new Guid("00000002-0000-0000-0000-000000000000");
 static readonly Guid TwinId=new Guid("00000003-0000-0000-0000-000000000000");
 static readonly Guid MissingId=new Guid("00000004-0000-0000-0000-000000000000");
 static readonly Guid WheelProduct=new Guid("00000011-0000-0000-0000-000000000000");
 static readonly Guid PedalProduct=new Guid("00000012-0000-0000-0000-000000000000");
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
 static readonly Dictionary<string,object> NoGame=new Dictionary<string,object>();

 static Bridge.Controller Controller(Guid id,Guid product,string name,DeviceType type){
  return new Bridge.Controller(id,product,name,type);
 }
 static Bridge.DeviceSample Sample(Bridge.Controller device,int rawX,double at,int button=0,int axisMask=1){
  var raw=new JoystickState{X=rawX};
  if(button>0)raw.Buttons[button-1]=true;
  return new Bridge.DeviceSample(device,raw,axisMask,at,.25);
 }
 static Dictionary<string,object> Binding(Guid id,Guid product,bool invert=false){
  return new Dictionary<string,object>{{"deviceId",id.ToString()},{"productId",product.ToString()},
   {"axis","X"},{"min",0},{"max",65536},{"invert",invert}};
 }
 static Bridge.Settings Settings(object steering=null,object throttle=null){
  var inputs=new Dictionary<string,object>{{"steering",steering},{"throttle",throttle}};
  return new Bridge.Settings(new Dictionary<string,object>{{"inputs",inputs},{"steeringRange",900}});
 }
 static Bridge.InputSnapshot Snapshot(long sequence,double end,Bridge.Controller[] directory,Bridge.DeviceSample[] devices,Bridge.Settings settings,string error=""){
  return new Bridge.InputSnapshot(sequence,end,directory,devices,settings,0,0,error);
 }
 static void Check(bool result,string message){
  if(!result)throw new Exception(message);
 }
 static Dictionary<string,object> Wire(object value){return Json.Deserialize<Dictionary<string,object>>(Json.Serialize(value));}
 static Dictionary<string,object> Map(object value){return (Dictionary<string,object>)value;}
 static Dictionary<string,object> Full(Bridge.InputSnapshot frame,double now,Dictionary<string,object> game=null){
  return Wire(Bridge.ProjectState(frame,game??NoGame,now,(long)now));
 }
 static Dictionary<string,object> Channel(Dictionary<string,object> state,string role){
  return Map(Map(Map(state["hardware"])["channels"])[role]);
 }
 static System.Collections.IList List(object value){return (System.Collections.IList)value;}
 static bool Is(object value,string expected){return object.Equals(value,expected);}
 static bool NumberIs(object value,double expected){return value!=null&&Math.Abs(Convert.ToDouble(value)-expected)<1e-9;}

 static void VerifyWatch(){
  string directory=Path.Combine(Path.GetDirectoryName(typeof(MappingTest).Assembly.Location),"watch-"+Guid.NewGuid().ToString("N"));
  string file=Path.Combine(directory,"settings.json"),temp=file+".tmp";
  using(var initial=new ManualResetEvent(false))
  using(var first=new ManualResetEvent(false))
  using(var second=new ManualResetEvent(false)){
   try{
    using(new WatchedFile(file,()=>{
     if(!File.Exists(file)){initial.Set();return true;}
     string text=File.ReadAllText(file);
     if(text=="first")first.Set();
     if(text=="second")second.Set();
     return true;
    })){
     Check(initial.WaitOne(1000),"watcher observes a missing directory without blocking setup");
     Directory.CreateDirectory(directory);
     File.WriteAllText(temp,"first");File.Move(temp,file);
     Check(first.WaitOne(3000),"watcher reconnects after its directory becomes available");
     File.WriteAllText(temp,"second");File.Replace(temp,file,null);
     Check(second.WaitOne(1000),"same-directory atomic replacement triggers a new read");
    }
   }finally{if(Directory.Exists(directory))Directory.Delete(directory,true);}
  }
 }

 static void Main(){
  var wheel=Controller(WheelId,WheelProduct,"wheel",DeviceType.FirstPerson);
  var pedal=Controller(PedalId,PedalProduct,"pedal",DeviceType.Driving);
  var twin=Controller(TwinId,PedalProduct,"other pedal",DeviceType.Driving);
  var directory=new[]{wheel,pedal};
  var readings=new[]{Sample(wheel,32768,1000,7),Sample(pedal,65536,1050)};
  var bindings=Settings(Binding(WheelId,WheelProduct),Binding(PedalId,PedalProduct,true));
  var frame=Snapshot(12,1051,directory,readings,bindings);

  var state=Full(frame,1099);
  var fast=Wire(frame.SteeringFrame(1099));
  Check(NumberIs(state["angle"],0)&&NumberIs(fast["angle"],0)&&NumberIs(state["throttle"],0),
   "Zero steering and inverted separate-pedal zero remain measured numeric zeros.");
  Check(Is(Map(state["inputSources"])["steering"],"hardware")&&Is(Channel(state,"throttle")["state"],"valid"),
   "Measured steering and pedal values are marked as physical inputs.");
  var fastTransport=Map(fast["transport"]);var stateTransport=Map(state["transport"]);
  Check(object.Equals(fastTransport["epoch"],stateTransport["epoch"])&&NumberIs(fastTransport["publishedMs"],1099)&&
   NumberIs(stateTransport["publishedMs"],1099),"both transport stamps share the actual projection clock");
  Check(NumberIs(fast["sequence"],12)&&object.Equals(fast["epoch"],Map(state["hardware"])["epoch"])&&
   object.Equals(fast["sequence"],Map(state["hardware"])["sequence"])&&NumberIs(fast["ageMs"],99)&&
   NumberIs(Channel(state,"steering")["ageMs"],99)&&NumberIs(fast["sampleMs"],1000),
   "Both endpoints use the same capture sequence and the actual wheel read time.");
  Check(NumberIs(List(state["buttons"])[0],7)&&Is(Map(List(state["deviceDirectory"])[0])["type"],"FirstPerson")&&
   Is(Map(List(state["devices"])[0])["type"],"FirstPerson"),"Verified device identity and fresh buttons are carried by the wire contract.");
  Check(NumberIs(Map(List(state["devices"])[0])["pollMs"],.25)&&NumberIs(Map(List(state["devices"])[1])["ageMs"],49),
   "Each device publishes its own sample age and polling cost.");

  state=Full(frame,1100);fast=Wire(frame.SteeringFrame(1100));
  Check(state["angle"]==null&&fast["angle"]==null&&Is(fast["state"],"stale")&&
   Is(Channel(state,"steering")["state"],"stale")&&NumberIs(fast["ageMs"],100)&&NumberIs(Map(state["hardware"])["sequence"],12),
   "Exact 100 ms expiry invalidates both outputs without changing sequence.");
  Check(List(state["buttons"]).Count==0&&List(state["devices"]).Count==1&&
   List(state["deviceDirectory"]).Count==2&&NumberIs(state["throttle"],0)&&NumberIs(Channel(state,"throttle")["ageMs"],50),
   "The old wheel and buttons expire while a newer pedal stays usable; discovery remains separate.");

  var game=new Dictionary<string,object>{{"available",true},{"steeringWheelAngle",0.25},{"gas",0.0}};
  state=Full(frame,1100,game);
  Check(NumberIs(state["angle"],0.25*180/Math.PI)&&NumberIs(state["gameSteeringAngle"],0.25*180/Math.PI)&&
   Is(Map(state["inputSources"])["steering"],"game")&&object.Equals(state["steeringHardware"],false),
   "An expired wheel falls back only to the actual game angle and marks its source.");
  game.Remove("steeringWheelAngle");game["nativeSteer"]=0.25;
  state=Full(frame,1100,game);
  Check(state["angle"]==null&&state["gameSteeringAngle"]==null&&Map(state["inputSources"])["steering"]==null,
   "A noncanonical steering field does not turn into a physical angle.");

  var unmapped=Snapshot(13,1051,directory,readings,Settings());
  state=Full(unmapped,1060);
  Check(state["angle"]==null&&state["throttle"]==null&&Is(Channel(state,"steering")["state"],"unmapped")&&
   List(state["buttons"]).Count==0&&List(state["devices"]).Count==2,
   "An attached device without a binding still exposes raw inputs for learning, never a guessed steering angle.");
  var missingAxis=Snapshot(14,1051,directory,new[]{Sample(wheel,32768,1050,0,0),readings[1]},bindings);
  Check(Is(Channel(Full(missingAxis,1060),"steering")["state"],"unavailable")&&
   Wire(missingAxis.SteeringFrame(1060))["angle"]==null,"An absent physical axis is unavailable even when the joystick state has a default value.");

  var unique=Snapshot(15,1051,directory,readings,Settings(throttle:Binding(MissingId,PedalProduct)));
  state=Full(unique,1060);
  Check(NumberIs(state["throttle"],100)&&Is(Channel(state,"throttle")["deviceId"],PedalId.ToString()),
   "A single instance of an explicitly configured product can follow a changed port.");
  var twins=new[]{wheel,pedal,twin};
  var twinReadings=new[]{readings[0],readings[1],Sample(twin,0,1050)};
  var ambiguous=Snapshot(16,1051,twins,twinReadings,Settings(throttle:Binding(MissingId,PedalProduct)));
  state=Full(ambiguous,1060);
  Check(state["throttle"]==null&&Is(Channel(state,"throttle")["state"],"unavailable"),
   "Product fallback does not guess between two identical devices.");
  var explicitId=Snapshot(17,1051,twins,twinReadings,Settings(throttle:Binding(TwinId,PedalProduct)));
  Check(NumberIs(Full(explicitId,1060)["throttle"],0),"The explicitly bound instance wins with an identical product present.");

  var failure=Snapshot(18,1052,directory,new Bridge.DeviceSample[0],bindings,"IOException");
  state=Full(failure,1052);
  fast=Wire(failure.SteeringFrame(1052));
  Check(List(state["devices"]).Count==0&&List(state["buttons"]).Count==0&&state["angle"]==null&&fast["angle"]==null&&
   Is(state["error"],"IOException")&&Is(fast["state"],"unavailable")&&NumberIs(fast["sequence"],18),
   "A failure frame carries its error and no inputs from the earlier successful snapshot.");

  var invalid=Binding(PedalId,PedalProduct);
  invalid["max"]=1;
  var invalidSettings=new Dictionary<string,object>{{"inputs",new Dictionary<string,object>{
   {"handbrakeInputs",new object[]{invalid}}}}};
  bool rejected=false;
  try{Bridge.Validate(invalidSettings);}catch(ArgumentException){rejected=true;}
  Check(rejected,"Invalid handbrake calibration is rejected before publication.");

  VerifyWatch();
  Console.WriteLine("PASS: physical zero, unknown axes, explicit and ambiguous bindings, per-device expiry, native/state agreement, game fallback, failure clearing, clock envelope, and file-watch recovery.");
 }
}
