using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// One producer for all local viewers. Each writer retains only the latest
// immutable frame, so slow/disconnected viewers cannot queue telemetry history.
sealed class TelemetryEventStream {
 readonly object gate=new object();readonly Func<object> capture;
 byte[] latest;long sequence;int clients;bool started;
 public TelemetryEventStream(Func<object> state){capture=state;}
 static readonly byte[] header=Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n");
 public void Serve(Stream stream){
  stream.Write(header,0,header.Length);
  lock(gate){if(clients++==0)latest=null;if(!started){started=true;new Thread(Produce){IsBackground=true,Name="Overlay snapshot stream"}.Start();}Monitor.PulseAll(gate);}
  try{
   long seen=-1;
   while(true){
    byte[] frame;lock(gate){while(latest==null||sequence==seen)Monitor.Wait(gate);frame=latest;seen=sequence;}
    stream.Write(frame,0,frame.Length);stream.Flush();
   }
  }finally{lock(gate){clients--;Monitor.PulseAll(gate);}}
 }
 void Produce(){
  var json=new JavaScriptSerializer(){MaxJsonLength=1048576};var clock=Stopwatch.StartNew();double next=0,period=1000d/60;
  while(true){
   lock(gate){while(clients==0){Monitor.Wait(gate);next=clock.Elapsed.TotalMilliseconds;}}
   byte[] frame;
   try{frame=Encoding.UTF8.GetBytes("data: "+json.Serialize(capture())+"\n\n");}
   catch{frame=Encoding.UTF8.GetBytes("data: {\"connected\":false,\"error\":\"Telemetry capture failed\"}\n\n");}
   lock(gate){latest=frame;sequence++;Monitor.PulseAll(gate);}
   next+=period;double now=clock.Elapsed.TotalMilliseconds;if(now-next>period*3)next=now;
   Thread.Sleep(Math.Max(1,(int)(next-clock.Elapsed.TotalMilliseconds)));
  }
 }
}
