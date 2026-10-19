using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

// A property-schema adapter: no game-name selection and no fabricated wheel geometry.
// MotionEx wheel arrays are RL, RR, FL, FR; the canonical model is FL, FR, RL, RR.
static class NativeMotionTelemetry {
 static object Get(Dictionary<string,object> d,string k){object v;return d!=null&&d.TryGetValue(k,out v)?v:null;}
 static double? Number(object v,double lo,double hi){double n;if(v==null||!double.TryParse(Convert.ToString(v,System.Globalization.CultureInfo.InvariantCulture),System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out n)||double.IsNaN(n)||double.IsInfinity(n)||n<lo||n>hi)return null;return n;}
 static double? Num(Dictionary<string,object> d,string k,double lo,double hi){return Number(Get(d,k),lo,hi);}
 static double?[] Four(Dictionary<string,object> d,string k,double lo,double hi){var a=Get(d,k) as IList;return a!=null&&a.Count==4?Enumerable.Range(0,4).Select(i=>Number(a[i],lo,hi)).ToArray():null;}
 static double[] Vec(Dictionary<string,object> d,string k,double limit){var a=Get(d,k) as IList;if(a==null||a.Count!=3)return null;var v=Enumerable.Range(0,3).Select(i=>Number(a[i],-limit,limit)).ToArray();return v.All(x=>x.HasValue)?v.Select(x=>x.Value).ToArray():null;}
 static double[] Unit(double[] a){if(a==null)return null;double n=Math.Sqrt(a.Sum(x=>x*x));return n>20000&&n<45000?a.Select(x=>x/n).ToArray():null;}
 public static bool Supported(Dictionary<string,object> r){
  if(!Num(r,"frame",0,uint.MaxValue).HasValue||!Num(r,"time",0,1e9).HasValue)return false;
  return new[]{"ratio","angle","load"}.Any(k=>{var a=Four(r,k,-1e6,1e6);return a!=null&&a.Any(x=>x.HasValue);});
 }
 public static string FrameKey(Dictionary<string,object> r){return "native:"+Convert.ToString(Get(r,"session"))+":"+Convert.ToString(Get(r,"frame"));}
 public static bool Coherent(Dictionary<string,object> r){return Num(r,"frameBefore",0,uint.MaxValue)==Num(r,"frame",0,uint.MaxValue);}
 public static void Enrich(Dictionary<string,object> g,Dictionary<string,object> r){
  var ratios=Four(r,"ratio",-100,1000);var angles=Four(r,"angle",-Math.PI,Math.PI);
  var loads=Four(r,"load",0,100000);var fx=Four(r,"fx",-200000,200000);var fy=Four(r,"fy",-200000,200000);var speed=Four(r,"speedMs",-400,400);
  var source=(object[])g["wheels"];int[] order={2,3,0,1};
  for(int i=0;i<4;i++){
   var w=(Dictionary<string,object>)source[i];int j=order[i];
   w["ratio"]=ratios==null?null:ratios[j];w["angle"]=angles==null?null:-angles[j];w["load"]=loads==null?null:loads[j];
   w["fx"]=fx==null?null:fx[j];w["fy"]=fy==null?null:-fy[j];w["speedMs"]=speed==null?null:speed[j];
   w["ratioKind"]="native-ratio";
  }
  var forward=Unit(Vec(r,"forward",32768));var right=Unit(Vec(r,"right",32768));
  if(forward!=null&&right!=null&&Math.Abs(forward.Zip(right,(a,b)=>a*b).Sum())>.15)right=null;
  var velocity=Vec(r,"velocity",250);var lv=Vec(r,"localVelocity",250);
  var frame=Num(r,"frame",0,uint.MaxValue);var wf=Num(r,"worldFrame",0,uint.MaxValue);
  bool worldFresh=frame.HasValue&&wf.HasValue&&Math.Abs(frame.Value-wf.Value)<=3;
  g["source"]="SimHub-native-motion";g["telemetryVersion"]=2;g["nativePacket"]=frame;g["streamEpoch"]=Get(r,"session");
  g["receivedAt"]=g["sampleTime"];g["sampleTime"]=Num(r,"time",0,1e9)*1000;
  // This schema reports local X / lateral G left-positive, while worldRight and
  // steering input are right-positive. Slip angle is heading-minus-motion.
  // Canonical angle is motion-minus-heading; verified against measured world basis.
  g["localVelocity"]=lv==null?null:new[]{-lv[0],lv[1],lv[2]};g["angularVelocity"]=Vec(r,"angularVelocity",100);
  g["velocity"]=worldFresh?velocity:null;
  g["roadBasis"]=worldFresh&&forward!=null&&right!=null?new {forward=forward,right=right}:null;
  g["roadWheelAngle"]=Num(r,"roadWheelAngle",-Math.PI/2,Math.PI/2);
  var acc=Vec(r,"accG",30);g["accG"]=acc==null?null:new[]{-acc[0],acc[1],acc[2]};
  g["accGFrame"]="body";
  // Continuous native velocity avoids integer-km/h quantization in short derivatives.
  if(worldFresh&&velocity!=null)g["speedKmh"]=Math.Sqrt(velocity.Sum(x=>x*x))*3.6;
  else if(lv!=null)g["speedKmh"]=Math.Sqrt(lv.Sum(x=>x*x))*3.6;
  g["capabilities"]=new {nativeMotion=true,forces=fx!=null&&fy!=null&&fx.Any(x=>x.HasValue)&&fy.Any(x=>x.HasValue),loads=loads!=null,slipRatio=ratios!=null&&ratios.Any(x=>x.HasValue),slipAngle=angles!=null&&angles.Any(x=>x.HasValue),roadOrientation=worldFresh&&forward!=null&&right!=null,linearWheelSpeed=speed!=null&&speed.Any(x=>x.HasValue)};
  g["fieldPolicy"]="schema-detected MotionEx; SI units and FL/FR/RL/RR order; independent optional fields; no synthetic contact geometry";
 }
}
