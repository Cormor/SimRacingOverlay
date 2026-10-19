using System;
using System.IO;
using System.Collections.Generic;
using System.Web.Script.Serialization;
class TestNativeUdpTelemetry {
 static void Check(bool ok,string text){if(!ok)throw new Exception(text);}
 static void F(byte[] b,int o,float v){Array.Copy(BitConverter.GetBytes(v),0,b,o,4);}
 static byte[] Packet(int id,int size,uint frame,ulong session){var b=new byte[size];Array.Copy(BitConverter.GetBytes((ushort)2025),b,2);b[5]=1;b[6]=(byte)id;Array.Copy(BitConverter.GetBytes(session),0,b,7,8);F(b,15,frame/60f);Array.Copy(BitConverter.GetBytes(frame),0,b,23,4);return b;}
 static byte[] Motion(uint frame,ulong session){var b=Packet(13,273,frame,session);for(int i=0;i<4;i++){F(b,77+i*4,20+i);F(b,93+i*4,(i+1)*.1f);F(b,109+i*4,(i+1)*.01f);F(b,125+i*4,100*(i+1));F(b,141+i*4,200*(i+1));F(b,201+i*4,3000+i*100);}F(b,161,2);F(b,169,20);F(b,197,.1f);return b;}
 static Dictionary<string,object> Map(object o){return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(new JavaScriptSerializer().Serialize(o));}
 static void Main(string[] args){
  var s=new MotionPacketStream();
  var world=Packet(0,1349,10,1);F(world,29+12,0);F(world,29+20,20);Array.Copy(BitConverter.GetBytes((short)32767),0,world,29+28,2);Array.Copy(BitConverter.GetBytes((short)32767),0,world,29+30,2);F(world,29+36,1);F(world,29+40,-.5f);s.Ingest(world,1000);
  var car=Packet(6,1352,10,1);F(car,31,.6f);F(car,39,.2f);car[44]=5;Array.Copy(BitConverter.GetBytes((ushort)10000),0,car,45,2);for(int i=0;i<4;i++){F(car,69+i*4,24+i);car[63+i]=80;}s.Ingest(car,1000);
  Check(s.Ingest(Motion(10,1),1000),"native packet accepted");var g=Map(s.Current(1001));var wheels=(System.Collections.IList)g["wheels"];var fl=(Dictionary<string,object>)wheels[0];
  Check((string)g["source"]=="UDP-native-motion"&&Math.Abs(Convert.ToDouble(fl["ratio"])-.3)<1e-6,"wire order and schema normalization");
  Check(Math.Abs(Convert.ToDouble(fl["angle"])+.03)<1e-6&&Convert.ToDouble(fl["fy"])==-300,"native sign normalization");
  Check(Math.Abs(Convert.ToDouble(g["gas"])-.6)<1e-6&&Convert.ToInt32(g["gear"])==5,"native pedals and gear, no slower generic substitution");
  Check(g["roadBasis"]!=null&&g["velocity"]!=null,"matching motion packet exposes actual basis without contact geometry");
  Check(!s.Ingest(Motion(10,1),1010),"duplicates must not renew a native sample");Check(!s.Ingest(Motion(9,1),1011),"late datagrams rejected");
  Check(s.Ingest(Motion(11,1),1016),"next frame accepted");Check(s.Current(1417)==null,"frozen native frame expires even if duplicates arrive");
  Check(!s.Ingest(new byte[100],1418),"truncated packet rejected");var bad=Motion(12,1);bad[0]=0;Check(!s.Ingest(bad,1419),"unknown wire layout is not guessed");
  var optional=Motion(12,1);F(optional,141+8,float.NaN);s.Ingest(optional,1420);g=Map(s.Current(1421));fl=(Dictionary<string,object>)((System.Collections.IList)g["wheels"])[0];Check(fl["fx"]==null&&fl["ratio"]!=null,"optional invalid force does not erase slip");
  Check(s.Ingest(Motion(1,2),1500),"session changes may restart frame numbering");g=Map(s.Current(1501));Check(g["velocity"]==null&&g["gas"]==null,"a new session cannot inherit old world velocity or pedals");
  var pause=Packet(1,753,1,2);pause[43]=1;s.Ingest(pause,1502);Check((bool)Map(s.Current(1503))["paused"],"pause state");
  // Missing UDP channels stay absent, not populated from a slower HTTP snapshot.
  var isolated=new MotionPacketStream();isolated.Ingest(Motion(1,4),2000);
  var onlyMotion=Map(isolated.Current(2001));
  Check(onlyMotion["gas"]==null&&onlyMotion["brake"]==null&&onlyMotion["gear"]==null&&onlyMotion["rpm"]==null,"missing car packet only removes its own fields");
  Check(onlyMotion["maxRpm"]==null&&onlyMotion["paused"]==null&&onlyMotion["inMenu"]==null,"unknown settings/states remain unknown, not HTTP substitutions");
  Check(onlyMotion["speedKmh"]!=null&&onlyMotion["wheels"]!=null,"motion remains usable independently of missing car/session/status packets");
  var resume=Packet(1,753,1,4);resume[43]=0;isolated.Ingest(resume,2002);
  Check(object.Equals(Map(isolated.Current(2003))["paused"],false),"native resume is not OR-ed with a stale HTTP pause");
  if(args.Length>0)File.WriteAllText(args[0],new JavaScriptSerializer().Serialize(g));
  Console.WriteLine("PASS: native wire schema; named wheel order; SI/sign normalization; native pedals; no fabricated geometry; duplicate/out-of-order/truncation handling; per-field failure; expiry; session reset; pause.");
 }
}
