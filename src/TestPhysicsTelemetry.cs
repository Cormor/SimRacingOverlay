using System;
using System.IO;
using System.Collections.Generic;
using System.Web.Script.Serialization;
class TestPhysicsTelemetry {
 static void Check(bool b,string m){if(!b)throw new Exception(m);}
 static void Set(byte[] b,int o,float v){Array.Copy(BitConverter.GetBytes(v),0,b,o,4);}
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
  Console.WriteLine("PASS: binary offsets, optional tail/static absence, raw units, NaN/infinity, JSON nulls, invalid core, JS handoff.");
 }
}
