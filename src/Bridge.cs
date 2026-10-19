using System;
using System.IO;
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
 static readonly JavaScriptSerializer json=new JavaScriptSerializer(){MaxJsonLength=1048576};
 static readonly string token=Guid.NewGuid().ToString("N");
 static Dictionary<string,object> config=new Dictionary<string,object>();
 static List<Dictionary<string,object>> devices=new List<Dictionary<string,object>>();
 static DateTime configTime;static int port=18764;static string captureError="";
 static object Get(Dictionary<string,object> d,string k,object fallback=null){object v;return d!=null&&d.TryGetValue(k,out v)?v:fallback;}
 static Dictionary<string,object> Map(object o){return o as Dictionary<string,object>;}
 static double Number(object o,double fallback=0){double n;return o!=null&&double.TryParse(Convert.ToString(o,System.Globalization.CultureInfo.InvariantCulture),System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out n)&&!double.IsNaN(n)&&!double.IsInfinity(n)?n:fallback;}
 static double Clamp(double n,double a,double b){return Math.Max(a,Math.Min(b,n));}
 static void LoadConfig(){var f=Path.Combine(root,"settings.json");if(!File.Exists(f))return;var t=File.GetLastWriteTimeUtc(f);if(t==configTime)return;try{var d=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(f));lock(gate){config=d;configTime=t;}}catch{}}
 static void Main(){LoadConfig();port=(int)Clamp(Number(Get(config,"httpPort"),18764),1024,65534);bool first;using(var m=new Mutex(true,"Local\\SimRacingOverlay_"+port,out first)){if(!first)return;SimHubTelemetry.Start();NativeUdpTelemetry.Start();new Thread(Capture){IsBackground=true}.Start();var server=new TcpListener(IPAddress.Loopback,port);server.Start();Console.WriteLine("SimRacingOverlay: http://127.0.0.1:"+port);while(true){var c=server.AcceptTcpClient();ThreadPool.QueueUserWorkItem(_=>Serve(c));}}}
 static int Score(DeviceInstance d){string s=d.InstanceName.ToLowerInvariant();return (d.Type.ToString().IndexOf("Driving",StringComparison.OrdinalIgnoreCase)>=0?100:0)+(new[]{"wheel","base","moza","fanatec","simagic","simucube","thrustmaster","logitech"}.Any(s.Contains)?50:0);}
 static void Capture(){using(var direct=new DirectInput()){var opened=new Dictionary<Guid,Joystick>();uint scan=0;while(true){try{
  if(unchecked((uint)Environment.TickCount-scan)>=1500||scan==0){scan=unchecked((uint)Environment.TickCount);var attached=direct.GetDevices(DeviceClass.GameControl,DeviceEnumerationFlags.AttachedOnly).OrderByDescending(Score).ToList();foreach(var id in opened.Keys.Where(k=>!attached.Any(d=>d.InstanceGuid==k)).ToArray()){opened[id].Dispose();opened.Remove(id);}foreach(var d in attached)if(!opened.ContainsKey(d.InstanceGuid))try{var j=new Joystick(direct,d.InstanceGuid);j.SetCooperativeLevel(IntPtr.Zero,CooperativeLevel.Background|CooperativeLevel.NonExclusive);j.Properties.AxisMode=DeviceAxisMode.Absolute;j.Acquire();opened.Add(d.InstanceGuid,j);}catch{} }
  var rows=new List<Dictionary<string,object>>();foreach(var item in opened.ToArray())try{item.Value.Poll();var s=item.Value.GetCurrentState();var info=item.Value.Information;var axes=new Dictionary<string,object>{{"X",s.X},{"Y",s.Y},{"Z",s.Z},{"RotationX",s.RotationX},{"RotationY",s.RotationY},{"RotationZ",s.RotationZ},{"Slider0",s.Sliders.Length>0?s.Sliders[0]:0},{"Slider1",s.Sliders.Length>1?s.Sliders[1]:0}};rows.Add(new Dictionary<string,object>{{"id",item.Key.ToString()},{"productId",info.ProductGuid.ToString()},{"name",info.InstanceName},{"axes",axes},{"buttons",s.Buttons.Select((v,i)=>new{v,i}).Where(x=>x.v).Select(x=>x.i+1).ToArray()}});}catch{item.Value.Dispose();opened.Remove(item.Key);}
  lock(gate){devices=rows;captureError="";}
 }catch(Exception e){lock(gate)captureError=e.GetType().Name;}Thread.Sleep(8);}}}
 static int? lastPhysicsPacket;static long lastPhysicsAdvance;
 static int I(byte[] data,int offset){return BitConverter.ToInt32(data,offset);}
 static Dictionary<string,object> Game(){return Map(json.DeserializeObject(json.Serialize(TelemetrySourceSelection.Select(NativeUdpTelemetry.Current,ReadPhysics,SimHubTelemetry.Current))));}
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
                if(!coherent)throw new InvalidDataException("Physics packet changed during read");
                byte[] metadata=null;
                try {
                    using(var sm=MemoryMappedFile.OpenExisting("Local\\acpmf_static",MemoryMappedFileRights.Read))
                    using(var sv=sm.CreateViewAccessor(0,0,MemoryMappedFileAccess.Read)) {
                        metadata=new byte[(int)Math.Min(472,sv.Capacity)];sv.ReadArray(0,metadata,0,metadata.Length);
                    }
                }catch(Exception){}
                long now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();int pkt=I(data,0);
                bool advanced=lastPhysicsPacket.HasValue&&pkt!=lastPhysicsPacket.Value;
                if(!lastPhysicsPacket.HasValue||advanced)lastPhysicsAdvance=now;
                bool established=lastPhysicsPacket.HasValue;
                lastPhysicsPacket=pkt;
                if(!established||now-lastPhysicsAdvance>400)return null;
                return PhysicsTelemetry.Decode(data,metadata,now);
            }
        }catch(Exception){return null;}
    }
 static Dictionary<string,object> FindDevice(List<Dictionary<string,object>> ds,Dictionary<string,object> spec){string id=Convert.ToString(Get(spec,"deviceId"));var d=ds.FirstOrDefault(x=>Convert.ToString(x["id"])==id);if(d!=null)return d;string product=Convert.ToString(Get(spec,"productId"));var matches=ds.Where(x=>product!=""&&Convert.ToString(x["productId"])==product).ToArray();return matches.Length==1?matches[0]:null;}
 static double? Axis(List<Dictionary<string,object>> ds,Dictionary<string,object> spec,bool steering=false){if(spec==null)return null;var d=FindDevice(ds,spec);if(d==null)return null;var axes=Map(d["axes"]);string name=Convert.ToString(Get(spec,"axis"));if(!axes.ContainsKey(name))return null;double min=Number(Get(spec,"min"),0),max=Number(Get(spec,"max"),65535);if(max-min<100)return null;double v=Clamp((Number(axes[name])-min)/(max-min),0,1);if(Convert.ToBoolean(Get(spec,"invert",false)))v=1-v;return steering?(v-.5)*2:v;}
 static object State(){LoadConfig();List<Dictionary<string,object>> ds;Dictionary<string,object> cfg;string error;lock(gate){ds=devices.ToList();cfg=config;error=captureError;}var game=Game();bool live=Convert.ToBoolean(Get(game,"available",false));var maps=Map(Get(cfg,"inputs"));var steeringSpec=Map(Get(maps,"steering"));var wheel=steeringSpec==null?ds.FirstOrDefault():FindDevice(ds,steeringSpec);double? steering=Axis(ds,steeringSpec,true);if(!steering.HasValue&&wheel!=null)steering=(Number(Get(Map(wheel["axes"]),"X"),32767.5)/65535-.5)*2;double range=Clamp(Number(Get(cfg,"steeringRange"),900),180,2520);double gas=Axis(ds,Map(Get(maps,"throttle")))??(live?Number(Get(game,"gas")):0),brake=Axis(ds,Map(Get(maps,"brake")))??(live?Number(Get(game,"brake")):0),hand=Axis(ds,Map(Get(maps,"handbrake")))??(live?Number(Get(game,"handbrake")):0);var extra=Get(maps,"handbrakeInputs") as System.Collections.IEnumerable;if(extra!=null){hand=0;foreach(var x in extra)hand+=Axis(ds,Map(x))??0;}
  var result=new Dictionary<string,object>{{"connected",ds.Count>0||live},{"inputConnected",ds.Count>0},{"device",wheel==null?"SimHub":wheel["name"]},{"timestamp",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()},{"angle",(steering??0)*range/2},{"brake",Clamp(brake*100,0,100)},{"throttle",Clamp(gas*100,0,100)},{"handbrake",Clamp(hand*100,0,100)},{"buttons",wheel==null?new int[0]:wheel["buttons"]},{"knobPositions",new int?[4]},{"game",game},{"devices",ds},{"inputProfile",new{buttonMap=Get(cfg,"buttonMap"),visualProfile=Get(cfg,"visualProfile","generic")}},{"configToken",token},{"ledSource","rpm-fallback"},{"error",error}};
  try{var f=Path.Combine(root,"runtime","led-state.json");var led=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(f));if(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-Number(Get(led,"timestamp"))<1500){result["leds"]=led;result["ledSource"]=Get(led,"source");}}catch{}return result;
 }
 static void Validate(Dictionary<string,object> cfg){double range=Number(Get(cfg,"steeringRange"),900);if(range<180||range>2520)throw new ArgumentException("Steering range must be 180..2520");var inputs=Map(Get(cfg,"inputs"));if(inputs!=null)foreach(var e in inputs){if(e.Key=="handbrakeInputs"){var list=e.Value as System.Collections.IEnumerable;if(list==null)throw new ArgumentException("Invalid handbrake mapping");int count=0;foreach(var x in list){var one=new Dictionary<string,object>{{"inputs",new Dictionary<string,object>{{"handbrake",x}}}};Validate(one);if(++count>4)throw new ArgumentException("Too many handbrake inputs");}continue;}var m=Map(e.Value);if(m==null)throw new ArgumentException("Invalid input mapping");if(!new[]{"X","Y","Z","RotationX","RotationY","RotationZ","Slider0","Slider1"}.Contains(Convert.ToString(Get(m,"axis"))))throw new ArgumentException("Unknown input axis");if(Number(Get(m,"max"),65535)-Number(Get(m,"min"),0)<100)throw new ArgumentException("Axis calibration span too small");}}
 static void Serve(TcpClient c){using(c)try{c.ReceiveTimeout=3000;c.SendTimeout=3000;using(var stream=c.GetStream()){var bytes=new System.Collections.Generic.List<byte>();while(bytes.Count<16384){int b=stream.ReadByte();if(b<0)return;bytes.Add((byte)b);int n=bytes.Count;if(n>=4&&bytes[n-4]==13&&bytes[n-3]==10&&bytes[n-2]==13&&bytes[n-1]==10)break;}var lines=Encoding.ASCII.GetString(bytes.ToArray()).Split(new[]{"\r\n"},StringSplitOptions.None);var request=lines[0].Split(' ');if(request.Length<2)return;string method=request[0],url=request[1].Split('?')[0];var headers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);foreach(string l in lines.Skip(1)){int i=l.IndexOf(':');if(i>0)headers[l.Substring(0,i)]=l.Substring(i+1).Trim();}byte[] data;string type="application/json; charset=utf-8",status="200 OK";
  if(method=="GET"&&url=="/telemetry-status")data=Encoding.UTF8.GetBytes(json.Serialize(NativeUdpTelemetry.Diagnostics()));
  else if(method=="GET"&&url=="/state")data=Encoding.UTF8.GetBytes(json.Serialize(State()));
  else if(method=="GET"&&url=="/api/settings"){LoadConfig();lock(gate)data=Encoding.UTF8.GetBytes(json.Serialize(config));}
  else if(method=="POST"&&url=="/api/settings"){string t,origin;bool auth=headers.TryGetValue("X-Overlay-Token",out t)&&t==token;bool local=!headers.TryGetValue("Origin",out origin)||origin=="http://127.0.0.1:"+port||origin=="http://localhost:"+port;int length;if(!auth||!local){status="403 Forbidden";data=Encoding.UTF8.GetBytes("{}");}else if(!headers.ContainsKey("Content-Length")||!int.TryParse(headers["Content-Length"],out length)||length<2||length>65536){status="413 Payload Too Large";data=Encoding.UTF8.GetBytes("{}");}else{var body=new byte[length];int n=0,r;while(n<length&&(r=stream.Read(body,n,length-n))>0)n+=r;if(n!=length)return;try{var incoming=json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(body));Validate(incoming);lock(gate){foreach(var pair in incoming)if(new[]{"inputs","steeringRange","buttonMap","visualProfile","ledObserver","simHubPort"}.Contains(pair.Key))config[pair.Key]=pair.Value;var f=Path.Combine(root,"settings.json");File.WriteAllText(f+".tmp",json.Serialize(config),new UTF8Encoding(false));File.Copy(f+".tmp",f,true);File.Delete(f+".tmp");configTime=File.GetLastWriteTimeUtc(f);}data=Encoding.UTF8.GetBytes("{\"ok\":true}");}catch(Exception e){status="400 Bad Request";data=Encoding.UTF8.GetBytes(json.Serialize(new{error=e.Message}));}}}
  else if(method=="GET"){var relative=Uri.UnescapeDataString(url).TrimStart('/');if(relative=="")relative="index.html";if(relative=="setup")relative="setup.html";var file=Path.GetFullPath(Path.Combine(root,relative));bool allowed=file.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)&&(file.EndsWith(".html")||file.EndsWith(".js")||file.EndsWith(".css")||file.EndsWith(".svg")||file.EndsWith(".png")||(file.EndsWith(".json")&&relative.StartsWith("assets/")));if(!allowed||!File.Exists(file)){status="404 Not Found";data=Encoding.UTF8.GetBytes("{}");}else{data=File.ReadAllBytes(file);type=file.EndsWith(".js")?"text/javascript":file.EndsWith(".css")?"text/css":file.EndsWith(".svg")?"image/svg+xml":file.EndsWith(".png")?"image/png":file.EndsWith(".json")?"application/json":"text/html; charset=utf-8";}}
  else{status="405 Method Not Allowed";data=Encoding.UTF8.GetBytes("{}");}
  var h=Encoding.ASCII.GetBytes("HTTP/1.1 "+status+"\r\nContent-Type: "+type+"\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Length: "+data.Length+"\r\nConnection: close\r\n\r\n");stream.Write(h,0,h.Length);stream.Write(data,0,data.Length);
 }}catch{}}
}
