using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Web.Script.Serialization;
class TestPhysicsTelemetry {
 static void Check(bool b,string m){if(!b)throw new Exception(m);}
 static void Set(byte[] b,int o,float v){Array.Copy(BitConverter.GetBytes(v),0,b,o,4);}
 static void Packet(byte[] b,int value){Array.Copy(BitConverter.GetBytes(value),0,b,0,4);}
 static Dictionary<string,object> Map(JavaScriptSerializer json,object sample){
  return json.Deserialize<Dictionary<string,object>>(json.Serialize(sample));
 }
 static void Main(string[] args){
  var j=new JavaScriptSerializer();var b=new byte[800];var st=new byte[472];Set(b,28,72);Set(b,4,.6f);Set(b,8,.2f);
  for(int i=0;i<4;i++){Set(b,72+i*4,3000);Set(b,88+i*4,25);Set(b,152+i*4,300);Set(b,624+i*4,1000);Set(b,656+i*4,.03f);Set(st,436+i*4,.3f);}
  var d=j.Deserialize<Dictionary<string,object>>(j.Serialize(PhysicsTelemetry.Decode(b,st,1000)));
  Check((bool)d["available"],"valid packet");Check(j.Serialize(PhysicsTelemetry.Decode(new byte[800],st,1000)).Contains("empty-physics-payload"),"empty physics page must not be airborne");var w=(Dictionary<string,object>)((System.Collections.IList)d["wheels"])[0];
  Check(Convert.ToDouble(w["pressurePsi"])==25,"pressure offset");Check(Convert.ToDouble(w["temperatureRaw"])==300,"raw temperature not guessed");
  Check(w["radius"]!=null,"static radius");
  File.WriteAllText(args[0],j.Serialize(PhysicsTelemetry.Decode(b,st,1000)));
  Set(b,88,float.NaN);Set(b,624,float.PositiveInfinity);Set(b,152,0);Set(b,44,float.NaN);
  d=j.Deserialize<Dictionary<string,object>>(j.Serialize(PhysicsTelemetry.Decode(b,null,1010)));w=(Dictionary<string,object>)((System.Collections.IList)d["wheels"])[0];
  Check((bool)d["available"],"bad optional values must not discard core");
  Check(w["pressurePsi"]==null&&w["fy"]==null&&w["temperatureRaw"]==null&&w["radius"]==null&&d["accG"]==null,"bad or absent fields are null");
  Check(j.Serialize(PhysicsTelemetry.Decode(new byte[32],st,0)).Contains("false"),"short core rejected");
  var shortPacket=new byte[672];Array.Copy(b,shortPacket,672);Check(j.Serialize(PhysicsTelemetry.Decode(shortPacket,null,0)).Contains("\"available\":true"),"optional tail can be absent");
  Set(b,28,float.NaN);Check(j.Serialize(PhysicsTelemetry.Decode(b,st,0)).Contains("false"),"invalid speed rejected");
  Set(b,28,72);
  var session=new PhysicsTelemetry.Session();
  Packet(b,100);
  Check(session.Observe(b,st,1100,6000)==null&&session.Observe(b,st,1120,6020)==null,"first valid packet and its repeat cannot claim an active mapping");
  Packet(b,101);
  var active=session.Observe(b,st,1130,6030);
  var activeWire=Map(j,active);
  Check(Convert.ToInt32(activeWire["packet"])==101&&
   (string)activeWire["sampleTimeKind"]=="bridge-observed-monotonic"&&
   Convert.ToInt64(activeWire["sampleTime"])==1130&&Convert.ToInt64(activeWire["receivedAt"])==6030,
   "ACR distinguishes monotonic observation and UTC receive time.");
  Check(object.ReferenceEquals(active,session.Observe(b,st,1300,5800))&&object.ReferenceEquals(active,session.Current(1530)),
   "repeat preserves payload, packet identity and original timestamps even when UTC changes");
  Check(session.Current(1531)==null&&session.Observe(b,st,1532,6200)==null,"expired mapping must prove progression again");
  Packet(b,102);var recovered=Map(j,session.Observe(b,st,1540,6208));
  Check(!object.Equals(activeWire["streamEpoch"],recovered["streamEpoch"]),"long stall creates a new epoch");
  Packet(b,99);Check(session.Observe(b,st,1550,6218)==null,"real packet rollback cannot extend the old session");
  Packet(b,100);var restarted=Map(j,session.Observe(b,st,1560,6228));
  Check(!object.Equals(recovered["streamEpoch"],restarted["streamEpoch"]),"true rollback creates a distinct epoch");

  session.Disconnect();
  Packet(b,int.MaxValue);Check(session.Observe(b,st,1570,6238)==null,"missing mapping clears cached motion");
  Packet(b,int.MinValue);var wrap=Map(j,session.Observe(b,st,1580,6248));
  Packet(b,int.MinValue+1);var afterWrap=Map(j,session.Observe(b,st,1590,6258));
  Check(object.Equals(wrap["streamEpoch"],afterWrap["streamEpoch"]),"signed 32-bit boundary is forward packet progression");
  Array.Copy(Encoding.Unicode.GetBytes("Car A"),0,st,68,10);
  Packet(b,int.MinValue+2);var identified=Map(j,session.Observe(b,st,1600,6268));
  Check(object.Equals(afterWrap["streamEpoch"],identified["streamEpoch"]),"first known car identity does not invent a session change");
  Array.Copy(Encoding.Unicode.GetBytes("Car B"),0,st,68,10);
  Check(session.Observe(b,st,1610,6278)==null,"confirmed car change cannot reuse the prior car's packet");
  Packet(b,int.MinValue+3);var changedCar=Map(j,session.Observe(b,st,1620,6288));
  Check(!object.Equals(identified["streamEpoch"],changedCar["streamEpoch"]),"confirmed car change has a new epoch");
  Check(session.Observe(new byte[800],st,1630,6298)==null&&session.Current(1630)==null,"menu's empty payload immediately retires prior motion");
  Console.WriteLine("PASS: binary offsets, optional tail/static absence, raw units, NaN/infinity, JSON nulls, invalid core, JS handoff, observed clock, session expiry, rollback/wrap, identity and disconnect.");
 }
}
