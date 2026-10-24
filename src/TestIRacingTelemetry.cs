using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Web.Script.Serialization;

class TestIRacingTelemetry {
 static byte[] memory=new byte[16384];static int count,rowAt=8192,fieldAt;static bool tear,tearSession;
 static void Int(int at,int value){Array.Copy(BitConverter.GetBytes(value),0,memory,at,4);}
 static void Text(int at,string value){Array.Copy(Encoding.ASCII.GetBytes(value),0,memory,at,value.Length);}
 static void Add(string name,int type,string unit,double value){
  int p=112+144*count++;Int(p,type);Int(p+4,fieldAt);Int(p+8,1);Text(p+16,name);Text(p+112,unit);
  byte[] b=type==5?BitConverter.GetBytes(value):type==4?BitConverter.GetBytes((float)value):type==1?new[]{(byte)value}:BitConverter.GetBytes((int)value);
  Array.Copy(b,0,memory,rowAt+fieldAt,b.Length);fieldAt+=b.Length;
 }
 static byte[] Read(long at,int size){var b=new byte[size];Array.Copy(memory,at,b,0,size);if(tearSession&&at==6500){Int(12,BitConverter.ToInt32(memory,12)+1);tearSession=false;}if(tear&&at==rowAt){Int(48,99);tear=false;}return b;}
 static Dictionary<string,object> Map(object x){return x as Dictionary<string,object>;}
 static void Check(bool b,string message){if(!b)throw new Exception(message);}
 static void Main(string[] args){
  Int(0,2);Int(4,1);Int(8,60);Int(28,112);Int(32,1);Int(36,256);Int(48,10);Int(52,rowAt);
  Add("Speed",4,"m/s",20);Add("SessionTime",5,"s",50);Add("VelocityX",4,"m/s",20);Add("VelocityY",4,"m/s",-2);Add("VelocityZ",4,"m/s",0);
  Add("Throttle",4,"%",.6);Add("Brake",4,"%",.1);Add("Clutch",4,"%",1);Add("RPM",4,"revs/min",6500);Add("Gear",2,"",3);
  Add("LatAccel",4,"m/s^2",-4.903325);Add("VertAccel",4,"m/s^2",9.80665);Add("LongAccel",4,"m/s^2",0);
  Add("IsOnTrack",1,"",1);Add("IsReplayPlaying",1,"",0);Add("BrakeABSactive",1,"",1);Int(24,count);
  Add("PlayerCarSLFirstRPM",4,"revs/min",6130);Add("PlayerCarSLShiftRPM",4,"revs/min",6690);Add("PlayerCarSLLastRPM",4,"revs/min",6800);Add("PlayerCarSLBlinkRPM",4,"revs/min",7210);Add("ShiftIndicatorPct",4,"%",.5);Int(24,count);
  Add("YawRate",4,"rad/s",.25);Add("SteeringWheelAngle",4,"rad",.5);Add("SteeringWheelTorque",4,"N*m",2);Add("LFshockDefl",4,"m",.05);Add("EngineWarnings",3,"irsdk_EngineWarnings",20);Int(24,count);
  string session="SessionInfo:\n ResultsPositions:\n - CarIdx: 0\n   Position: 1\nDriverInfo:\n DriverCarIdx: 0\n DriverCarRedLine: 7500.000\n Drivers:\n - CarIdx: 1\n   CarPath: wrongcar\n   CarID: 999\n   CarScreenName: Other car\n - CarIdx: 0\n   CarPath: \"toyotagr86\"\n   CarID: 160\n   CarScreenName: \"Toyota GR86\"\n";Text(6500,session);Int(12,1);Int(16,session.Length);Int(20,6500);
  var reader=new IRacingTelemetry(Read);var sample=Map(reader.Poll(1000));
  Check((double)sample["yawRate"]==-.25&&(double)sample["steeringWheelAngle"]==-.5,"right-positive yaw and steering mapping");
  var geometry=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(new JavaScriptSerializer().Serialize(sample["vehicleGeometry"]));
  Check(Convert.ToDouble(geometry["wheelbaseM"])==2.575&&Convert.ToDouble(geometry["steeringRatio"])==13.5,"geometry matches the active driver car, not another driver");
  var identity=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(new JavaScriptSerializer().Serialize(sample["vehicleIdentity"]));
  Check((string)identity["carPath"]=="toyotagr86"&&Convert.ToInt32(identity["carId"])==160&&Convert.ToInt32(identity["driverCarIdx"])==0,"identity is producer metadata of the active car");
  var statuses=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(new JavaScriptSerializer().Serialize(sample["statuses"]));
  Check((bool)statuses["pitLimiterActive"]&&(bool)statuses["oilPressureWarning"]&&!(bool)statuses["engineStalled"],"native flag masks distinguish actual limiting, oil warning and stall");
  var shifts=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(new JavaScriptSerializer().Serialize(sample["shiftLights"]));
  Check((double)sample["maxRpm"]==7500&&Convert.ToDouble(shifts["lastRpm"])==6800,"redline and shift thresholds are independent producer fields");
  Check((string)sample["carModel"]=="Toyota GR86","producer car identity");
  Check((double)sample["speedKmh"]==72,"speed SI conversion");Check((double)sample["sampleTime"]==50000,"producer clock");
  Check(((double[])sample["localVelocity"])[0]==2,"right/up/forward mapping");Check((double)sample["clutch"]==0,"clutch engagement converted to pedal travel");
  Check(object.ReferenceEquals(sample,reader.Poll(1200)),"duplicate uses cached snapshot");Check(reader.Poll(1401)==null,"duplicate does not refresh freshness");
  Int(48,11);Check(reader.Poll(1420)!=null,"recovery");Int(48,12);tear=true;Check((int)Map(reader.Poll(1440))["packet"]==11,"torn ring-buffer copy cannot replace the last coherent snapshot");
  Check(reader.Poll(1460)!=null,"coherent frame after torn copy");
  Int(4,0);Check(reader.Poll(1480)==null,"disconnect");Int(4,1);Int(48,1);sample=Map(reader.Poll(1500));Check(sample!=null,"reconnection and tick reset");
  // Optional field with wrong declared unit affects only itself.
  Text(112+2*144+112,"km/h");Int(4,0);reader.Poll(1520);Int(4,1);Int(48,2);
  var partial=Map(reader.Poll(1540));Check(partial["localVelocity"]==null&&(double)partial["speedKmh"]==72,"unit mismatch remains missing without erasing speed");
  if(args.Length>0)File.WriteAllText(args[0],new JavaScriptSerializer().Serialize(new {connected=true,angle=0,brake=Convert.ToDouble(sample["brake"])*100,throttle=Convert.ToDouble(sample["gas"])*100,handbrake=0,buttons=new int[0],game=sample}));
  Int(32,3);Int(48,100);Int(64,102);Int(68,rowAt+256);Int(80,101);Int(84,rowAt+512);
  Array.Copy(memory,rowAt,memory,rowAt+256,256);Array.Copy(memory,rowAt,memory,rowAt+512,256);
  Check((int)Map(reader.Poll(1560))["packet"]==102,"newest triple-buffer slot is selected independently of array position");
  Array.Copy(BitConverter.GetBytes(float.NaN),0,memory,rowAt+256,4);Int(64,103);
  Check(reader.Poll(1580)==null,"nonfinite core speed is not an available native snapshot");
  Array.Copy(BitConverter.GetBytes(20f),0,memory,rowAt+256,4);Int(48,0);Int(64,1);Int(80,0);
  Array.Clear(memory,112+2*144+112,32);Text(112+2*144+112,"m/s");
  int vx=BitConverter.ToInt32(memory,112+2*144+4),vy=BitConverter.ToInt32(memory,112+3*144+4);
  Int(112+2*144+4,vy);Int(112+3*144+4,vx);
  Check(((double[])Map(reader.Poll(1600))["localVelocity"])[2]==-2,"tick rollback reloads a changed variable table even when dimensions match");
  // A missing optional status remains unknown, rather than reporting that the
  // player is driving or the game is definitely unpaused.
  Array.Clear(memory,112+13*144+16,32);Text(112+13*144+16,"UnrelatedFlag");Int(64,0);Int(48,-1);Int(80,-1);
  var unknown=Map(reader.Poll(1620));Check(unknown["inMenu"]==null&&unknown["paused"]==null,"missing track flag remains null and does not disable independent telemetry");
  Int(12,2);Int(16,0);Int(64,1);Check(Map(reader.Poll(1640))["maxRpm"]==null,"unavailable optional metadata cannot retain a prior car redline");
  Int(16,session.Length);Int(64,2);Check((double)Map(reader.Poll(1660))["maxRpm"]==7500,"metadata recovers independently of core telemetry");
  string other=session.Replace("DriverCarIdx: 0","DriverCarIdx: 1");Text(6500,other);Int(16,other.Length);Int(12,3);Int(64,3);
  var otherCar=Map(reader.Poll(1680));Check(otherCar["vehicleGeometry"]==null&&(string)otherCar["carModel"]=="Other car","switching active car clears previous GR86 geometry despite GR86 elsewhere in the grid");
  string wrongId=session.Replace("CarID: 160","CarID: 999");Text(6500,wrongId);Int(16,wrongId.Length);Int(12,4);Int(64,4);
  Check(Map(reader.Poll(1700))["vehicleGeometry"]==null,"GR86 path alone cannot authorize GR86 parameters");
  string wrongPath=session.Replace("toyotagr86","differentcar");Text(6500,wrongPath);Int(16,wrongPath.Length);Int(12,5);Int(64,5);
  Check(Map(reader.Poll(1720))["vehicleGeometry"]==null,"GR86 ID alone cannot authorize GR86 parameters");
  Text(6500,session);Int(16,session.Length);Int(12,6);Int(64,6);
  Check(Map(reader.Poll(1740))["vehicleGeometry"]!=null,"recognized car metadata can recover");
  Text(6500,other);Int(16,other.Length);Int(12,7);Int(64,7);tearSession=true;
  var tornMeta=Map(reader.Poll(1760));Check(tornMeta["vehicleGeometry"]==null&&tornMeta["maxRpm"]==null&&tornMeta["carModel"]==null,"changed but torn metadata cannot leak previous car geometry into a new physics row");
  Int(64,8);Check(Map(reader.Poll(1780))["vehicleGeometry"]==null,"unrecognized active car remains geometry-unknown after coherent metadata recovery");
  Console.WriteLine("PASS: active-car switch, mixed grid, independent CarPath/CarID identity, unknown-car isolation and torn-metadata geometry clearing.");
  Console.WriteLine("PASS: IRSDK variable-table types/units, SI mapping, clock, zero clutch, repeat/stall/recovery, torn snapshot, triple buffers, nonfinite core, reconnect/table reset and optional-unit isolation.");
 }
}
