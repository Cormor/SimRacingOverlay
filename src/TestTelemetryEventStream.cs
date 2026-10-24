using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Web.Script.Serialization;

class TestTelemetryEventStream {
 sealed class Sink:Stream {
  public List<int> Frames=new List<int>();public int Delay;public bool Failure;
  public override void Write(byte[] b,int at,int n){
   string text=Encoding.UTF8.GetString(b,at,n);if(!text.StartsWith("data: "))return;
   if(Frames.Count>=8)throw new IOException("test viewer disconnected");
   var d=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(text.Substring(6));
   object v;if(d.TryGetValue("n",out v))Frames.Add(Convert.ToInt32(v));else {Failure=true;Frames.Add(-1);}
   if(Delay>0)Thread.Sleep(Delay);
  }
  public override bool CanRead{get{return false;}}public override bool CanWrite{get{return true;}}public override bool CanSeek{get{return false;}}
  public override long Length{get{throw new NotSupportedException();}}public override long Position{get{throw new NotSupportedException();}set{throw new NotSupportedException();}}
  public override void Flush(){}public override int Read(byte[] b,int at,int n){throw new NotSupportedException();}public override long Seek(long n,SeekOrigin origin){throw new NotSupportedException();}public override void SetLength(long n){throw new NotSupportedException();}
 }
 static void Check(bool b,string message){if(!b)throw new Exception(message);}
 static Thread Start(TelemetryEventStream hub,Stream sink){var t=new Thread(()=>{try{hub.Serve(sink);}catch(IOException){}}){IsBackground=true};t.Start();return t;}
 static void FixtureServer(string portFile){
  int n=0;var hub=new TelemetryEventStream(()=>new {connected=true,n=Interlocked.Increment(ref n)});
  var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();File.WriteAllText(portFile,((IPEndPoint)listener.LocalEndpoint).Port.ToString());
  while(true){var client=listener.AcceptTcpClient();ThreadPool.QueueUserWorkItem(_=>{using(client)try{client.NoDelay=true;client.SendTimeout=2000;using(var stream=client.GetStream()){
   var reader=new StreamReader(stream,Encoding.ASCII,false,1024,true);string request=reader.ReadLine(),line;while(!string.IsNullOrEmpty(line=reader.ReadLine())){}
   if(request!=null&&request.StartsWith("GET /events "))hub.Serve(stream);
   else {var body=Encoding.UTF8.GetBytes("<!doctype html><title>Native event stream fixture</title>");var head=Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: "+body.Length+"\r\nConnection: close\r\n\r\n");stream.Write(head,0,head.Length);stream.Write(body,0,body.Length);}
  }}catch(IOException){}});}
 }
 static void Main(string[] args){
  if(args.Length==2&&args[0]=="--serve"){FixtureServer(args[1]);return;}
  int captured=0;var hub=new TelemetryEventStream(()=>new {connected=true,n=Interlocked.Increment(ref captured)});
  var slow=new Sink{Delay=65};var fast=new Sink();var a=Start(hub,slow);var b=Start(hub,fast);
  Check(a.Join(4000)&&b.Join(4000),"viewers complete without deadlocking");
  bool common=false,skipped=false;foreach(int x in slow.Frames)if(fast.Frames.Contains(x))common=true;
  for(int i=1;i<slow.Frames.Count;i++){Check(slow.Frames[i]>slow.Frames[i-1],"stream sequence advances");if(slow.Frames[i]-slow.Frames[i-1]>1)skipped=true;}
  Check(common&&skipped,"viewers share producer snapshots; a slow writer skips old frames");
  int stopped=captured;Thread.Sleep(100);Check(captured<=stopped+1,"producer stops capturing without viewers");
  int attempts=0;var recovery=new TelemetryEventStream(()=>{if(Interlocked.Increment(ref attempts)==1)throw new Exception("fixture failure");return new {connected=true,n=attempts};});
  var errors=new Sink();Check(Start(recovery,errors).Join(4000)&&errors.Failure&&errors.Frames[1]>0,"capture failure emits disconnected state then recovers");
  var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();int port=((IPEndPoint)listener.LocalEndpoint).Port;
  var server=new Thread(()=>{using(var client=listener.AcceptTcpClient())using(var stream=client.GetStream()){
   var request=new StreamReader(stream,Encoding.ASCII,false,1024,true);while(!string.IsNullOrEmpty(request.ReadLine())){}
   try{hub.Serve(stream);}catch(IOException){}
  }}){IsBackground=true};server.Start();
  var http=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:"+port+"/events");http.Proxy=null;http.Timeout=2000;http.ReadWriteTimeout=2000;
  using(var response=(HttpWebResponse)http.GetResponse())using(var reader=new StreamReader(response.GetResponseStream())){
   Check(response.ContentType.StartsWith("text/event-stream"),"native HTTP stream content type");
   for(int i=0;i<2;i++){string line;do{line=reader.ReadLine();}while(line=="");Check(line!=null&&line.StartsWith("data: ")&&line.Contains("\"connected\":true"),"native HTTP frame parses immediately");}
  }
  listener.Stop();Check(server.Join(2000),"closed HTTP viewer releases its writer");
  Console.WriteLine("PASS: one producer shared by viewers; bounded latest-frame delivery; idle suspension; capture failure/recovery; native SSE HTTP framing and disconnect.");
 }
}
