using System;
using System.IO;
using System.Collections.Generic;
using System.Web.Script.Serialization;
class TestSimHubTelemetry {
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static void Main(string[] args){
  var json=new JavaScriptSerializer();var d=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(args[0]));
  d["GameRunning"]=true;d["FrameTimeUTC"]="test-frame-1";
  var normalized=json.Deserialize<Dictionary<string,object>>(json.Serialize(SimHubTelemetry.Normalize(d,1000)));
  Check((string)normalized["source"]=="SimHub-generic","wrong source");
  Check(normalized["wheels"]!=null,"missing wheels");Check(SimHubTelemetry.Normalize(d,1010)==null,"duplicate frame must not renew freshness");
  var f1Feedback=new Dictionary<string,object>{{"FrontLeftWheelSlip",-.0125},{"FrontRightWheelSlip",.025},{"RearLeftWheelSlip",-.0375},{"RearRightWheelSlip",.05}};
  var f1New=new Dictionary<string,object>{{"CarModel","F1 25 fixture"},{"SpeedKmh",199.0},{"Throttle",0.0},{"Brake",35.0},{"FeedbackData",f1Feedback}};
  var f1Input=new Dictionary<string,object>{{"GameRunning",true},{"GameName","F12025"},{"FrameTimeUTC","f1-frame-1"},{"NewData",f1New}};
  var f1=json.Deserialize<Dictionary<string,object>>(json.Serialize(SimHubTelemetry.Normalize(f1Input,2000)));
  var f1Wheels=(System.Collections.IList)f1["wheels"];
  Check((string)f1["source"]=="SimHub-generic","game name must not select the adapter");
  Check(Math.Abs(Convert.ToDouble(((Dictionary<string,object>)f1Wheels[0])["slipFeedback"])+.0125)<1e-8,"negative reported feedback must be preserved");
  Check(((Dictionary<string,object>)f1Wheels[0])["ratio"]==null,"untyped feedback must not masquerade as a physical ratio");
  f1Input["GameName"]="F12024";f1Input["FrameTimeUTC"]="f1-frame-2";
  var otherF1=json.Deserialize<Dictionary<string,object>>(json.Serialize(SimHubTelemetry.Normalize(f1Input,2020)));
  Check((string)otherF1["source"]=="SimHub-generic"&&((Dictionary<string,object>)((System.Collections.IList)otherF1["wheels"])[0])["ratio"]==null,"F1 25 slip mapping must not leak into other SimHub games");
  f1Input["GameName"]="F12025";f1Input["FrameTimeUTC"]="f1-frame-3";f1Feedback["FrontLeftWheelSlip"]=double.NaN;
  var invalidF1=json.Deserialize<Dictionary<string,object>>(json.Serialize(SimHubTelemetry.Normalize(f1Input,2040)));
  Check(((Dictionary<string,object>)((System.Collections.IList)invalidF1["wheels"])[0])["ratio"]==null,"invalid F1 slip must remain unavailable, not become zero");
  var native=new Dictionary<string,object>{{"frameBefore",10},{"frame",10},{"worldFrame",10},{"session","fixture"},{"time",2.0},
   {"ratio",new[]{-.1,.2,-.3,.4}},{"angle",new[]{.01,-.02,.03,-.04}},{"load",new[]{1000,2000,3000,4000}},
   {"fx",new[]{100,200,300,400}},{"fy",new[]{10,20,30,40}},{"speedMs",new[]{20,21,22,23}},
   {"localVelocity",new[]{2,0,20}},{"velocity",new[]{-2,0,20}},{"forward",new[]{0,0,32767}},{"right",new[]{32767,0,0}},{"roadWheelAngle",.1},{"accG",new[]{1,0,-.5}}};
  f1Input.Remove("GameName");f1Input["NativeMotion"]=native;
  var decoded=json.Deserialize<Dictionary<string,object>>(json.Serialize(SimHubTelemetry.Normalize(f1Input,2060)));
  var dw=(Dictionary<string,object>)((System.Collections.IList)decoded["wheels"])[0];
  Check((string)decoded["source"]=="SimHub-native-motion"&&Convert.ToDouble(dw["ratio"])==-.3,"native schema detection without any game name; RL/RR/FL/FR conversion");
  Check(Convert.ToDouble(dw["angle"])==-.03&&Convert.ToDouble(dw["fy"])==-30,"native motion-minus-heading and right-positive force normalization");
  Check(Convert.ToDouble(dw["load"])==3000&&Convert.ToDouble(dw["speedMs"])==22,"native loads and SI wheel speed");
  Check(Convert.ToDouble(((System.Collections.IList)decoded["localVelocity"])[0])==-2,"left-positive reported local X must be normalized");
  native["frameBefore"]=11;Check(SimHubTelemetry.Normalize(f1Input,2080)==null,"incoherent property snapshot cannot renew freshness");
  native["frameBefore"]=11;native["frame"]=11;native["fx"]=new object[]{1,2,double.NaN,4};
  decoded=json.Deserialize<Dictionary<string,object>>(json.Serialize(SimHubTelemetry.Normalize(f1Input,2100)));
  dw=(Dictionary<string,object>)((System.Collections.IList)decoded["wheels"])[0];Check(dw["fx"]==null&&Convert.ToDouble(dw["ratio"])==-.3,"one invalid optional force must not suppress the other capabilities");
  var n=(Dictionary<string,object>)d["NewData"];n["SpeedKmh"]=72;n["Throttle"]=65;n["Brake"]=20;n["CarModel"]="Generic fixture";
  d["FrameTimeUTC"]="test-frame-2";var next=SimHubTelemetry.Normalize(d,1020);File.WriteAllText(args[1],json.Serialize(next));
  n["TyrePressureUnit"]="Kpa";n["TyrePressureFrontLeft"]=172.3689;n["Throttle"]=null;n["Brake"]=double.NaN;
  n["AccelerationSurge"]=9.80665;n["AccelerationSway"]=0;n["AccelerationHeave"]=0;
  d["FrameTimeUTC"]="test-frame-3";var checkedData=json.Deserialize<Dictionary<string,object>>(json.Serialize(SimHubTelemetry.Normalize(d,1040)));
  var checkedWheel=(Dictionary<string,object>)((System.Collections.IList)checkedData["wheels"])[0];
  Check(Math.Abs(Convert.ToDouble(checkedWheel["pressurePsi"])-25)<.001,"kPa to psi");
  Check(checkedData["gas"]==null&&checkedData["brake"]==null,"missing/NaN controls must not become zero");
  Check(Math.Abs(Convert.ToDouble(((System.Collections.IList)checkedData["accG"])[2])-1)<.001,"m/s2 to g");
  n["TyrePressureUnit"]="unknown";d["FrameTimeUTC"]="2026-10-19T12:00:01Z";SimHubTelemetry.Normalize(d,1060);
  d["FrameTimeUTC"]="2026-10-19T12:00:00Z";Check(SimHubTelemetry.Normalize(d,1080)==null,"out of order data must not renew freshness");
  d["FrameTimeUTC"]="2026-10-19T12:00:02Z";checkedData=json.Deserialize<Dictionary<string,object>>(json.Serialize(SimHubTelemetry.Normalize(d,1100)));
  checkedWheel=(Dictionary<string,object>)((System.Collections.IList)checkedData["wheels"])[0];Check(checkedWheel["pressurePsi"]==null,"unknown unit must not be guessed");
  d["GameRunning"]="malformed";Check(json.Serialize(SimHubTelemetry.Normalize(d,1120)).Contains("false"),"malformed status");d["GameRunning"]=true;
  d["NewData"]=null;var absent=json.Serialize(SimHubTelemetry.Normalize(d,1030));Check(absent.Contains("false"),"missing game must not appear active");
  Console.WriteLine("PASS: recorded SimHub API normalization; normalized pedal units; four feedback wheels; duplicate frame expiry; missing game; JS handoff fixture saved.");
 }
}
