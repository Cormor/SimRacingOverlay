using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// One immutable publication per cycle for HTTP and all local event readers.
// Socket writers never hold the producer lock or queue an application history.
sealed class TelemetryEventStream {
 const int HttpWaitMs=100, HttpReuseMs=20, MaximumSseAgeMs=100;
 readonly object gate=new object();
 readonly Func<object> capture;
 readonly Func<object,string> sourceOf;
 readonly int heartbeatMs;
 Frame latest;
 long sequence;
 int clients,httpWaiters;
 bool started;

 sealed class Frame {
  internal readonly byte[] Json,Wire;
  internal readonly double At;
  internal readonly string Source;
  internal readonly bool Failed;
  internal Frame(byte[] json,double at,string source=null,bool failed=false){
   Json=json;At=at;Source=source;Failed=failed;
   Wire=new byte[Prefix.Length+json.Length+2];
   Buffer.BlockCopy(Prefix,0,Wire,0,Prefix.Length);
   Buffer.BlockCopy(json,0,Wire,Prefix.Length,json.Length);
   Wire[Wire.Length-2]=Wire[Wire.Length-1]=(byte)'\n';
  }
 }
 static readonly byte[] Prefix=Encoding.ASCII.GetBytes("data: ");
 static readonly byte[] Header=Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n");
 static readonly byte[] Heartbeat=Encoding.ASCII.GetBytes(": keep-alive\n\n");
 static readonly byte[] Failure=Encoding.UTF8.GetBytes("{\"connected\":false,\"error\":\"Telemetry capture failed\"}");
 internal static double ClockMs(){return Stopwatch.GetTimestamp()*1000.0/Stopwatch.Frequency;}
 public TelemetryEventStream(Func<object> state,int heartbeatMs=1000,Func<object,string> sourceOf=null){
  capture=state;this.heartbeatMs=heartbeatMs;this.sourceOf=sourceOf;
 }
 internal string ReadSelection(out string source,out double? ageMs){
  Frame frame;lock(gate)frame=latest;
  source=null;ageMs=null;
  if(frame==null)return "unknown";
  ageMs=Math.Max(0,ClockMs()-frame.At);
  if(ageMs>=MaximumSseAgeMs)return "expired";
  if(frame.Failed)return "capture-failed";
  source=frame.Source;
  return source==null?"no-source":"selected";
 }
 public bool HasClients{get{lock(gate)return clients!=0;}}

 void StartProducer(){
  if(capture==null||started)return;
  started=true;
  new Thread(Produce){IsBackground=true,Name="Overlay snapshot stream"}.Start();
 }
 public byte[] ReadHttp(){
  if(capture==null)return null;
  lock(gate){
   double now=ClockMs();
   if(latest!=null&&now-latest.At<HttpReuseMs)return latest.Json;
   double until=now+HttpWaitMs;
   long before=sequence;
   httpWaiters++;
   try{
    StartProducer();Monitor.PulseAll(gate);
    while(true){
     now=ClockMs();
     if(sequence!=before&&latest!=null&&now-latest.At<MaximumSseAgeMs)return latest.Json;
     int remaining=(int)Math.Ceiling(until-now);
     if(remaining<=0)return null;
     Monitor.Wait(gate,remaining);
    }
   }finally{httpWaiters--;}
  }
 }
 public void Publish(JavaScriptSerializer json,object snapshot){
  var at=ClockMs();
  Publish(new Frame(Encoding.UTF8.GetBytes(json.Serialize(snapshot)),at));
 }
 void Publish(Frame frame){lock(gate){
  if(capture==null&&clients==0)return;
  latest=frame;sequence++;Monitor.PulseAll(gate);
 }}
 public void Serve(Stream stream){
  stream.Write(Header,0,Header.Length);
  lock(gate){clients++;StartProducer();Monitor.PulseAll(gate);}
  try{
   long seen=-1;
   while(true){
    Frame frame=null;
    lock(gate){
     double until=ClockMs()+heartbeatMs;
     while(true){
      if(latest!=null&&sequence!=seen){
       seen=sequence;
       if(ClockMs()-latest.At<MaximumSseAgeMs){frame=latest;break;}
      }
      int remaining=(int)Math.Ceiling(until-ClockMs());
      if(remaining<=0)break;
      Monitor.Wait(gate,remaining);
     }
    }
    var bytes=frame!=null&&ClockMs()-frame.At<MaximumSseAgeMs?frame.Wire:Heartbeat;
    stream.Write(bytes,0,bytes.Length);
    stream.Flush();
   }
  }finally{lock(gate){clients--;if(clients==0&&capture==null)latest=null;Monitor.PulseAll(gate);}}
 }
 void Produce(){
  var json=new JavaScriptSerializer(){MaxJsonLength=1048576};
  double next=0,period=1000d/60;
  while(true){
   lock(gate){
    while(clients==0&&httpWaiters==0){Monitor.Wait(gate);next=ClockMs();}
   }
   Frame frame;
   try{
    var snapshot=capture();var at=ClockMs();
    frame=new Frame(Encoding.UTF8.GetBytes(json.Serialize(snapshot)),at,sourceOf==null?null:sourceOf(snapshot));
   }catch{frame=new Frame(Failure,ClockMs(),failed:true);}
   Publish(frame);
   next+=period;double now=ClockMs();if(now-next>period*3)next=now;
   Thread.Sleep(Math.Max(1,(int)(next-ClockMs())));
  }
 }
}

// Only the DirectInput thread uses this timer. No global timer resolution change.
sealed class InputCaptureClock : IDisposable {
 const uint HighResolution=2, TimerModifyStateAndSynchronize=0x00100002;
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]
 static extern SafeWaitHandle CreateWaitableTimerEx(IntPtr attributes,string name,uint flags,uint access);
 [DllImport("kernel32.dll")]
 static extern bool SetWaitableTimer(SafeWaitHandle timer,ref long dueTime,int period,IntPtr completion,IntPtr argument,bool resume);
 [DllImport("kernel32.dll")]
 static extern uint WaitForSingleObject(SafeWaitHandle timer,uint milliseconds);

 readonly SafeWaitHandle timer=CreateWaitableTimerEx(IntPtr.Zero,null,HighResolution,TimerModifyStateAndSynchronize);
 readonly long period=Stopwatch.Frequency*8/1000;
 long next;
 public void WaitNext(bool precise){
  if(!precise){next=0;Thread.Sleep(8);return;}
  long now=Stopwatch.GetTimestamp();
  if(next==0||now>=next+period)next=now;
  next+=period;
  long remaining=next-now;
  long due=-Math.Max(1,remaining*10000000/Stopwatch.Frequency);
  if(!timer.IsInvalid&&SetWaitableTimer(timer,ref due,0,IntPtr.Zero,IntPtr.Zero,false)&&WaitForSingleObject(timer,50)==0)return;
  Thread.Sleep(Math.Max(1,(int)Math.Ceiling(remaining*1000.0/Stopwatch.Frequency)));
 }
 public void Dispose(){timer.Dispose();}
}
