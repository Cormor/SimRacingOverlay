using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// The Electron main process owns all window changes. This process observes
// native order and follows the lifetime of its private stdin pipe.
static class HudWindowLayer {
 const uint Reorder=0x8004, Show=0x8002, LocationChange=0x800B;
 const uint Check=0x8001, Presentation=0x8002, Completed=0x8003, Quit=0x0012;
 const int ObjIdClient=-4, ObjIdWindow=0, ExStyle=-20, Topmost=8;
 const uint Previous=3;
 static IntPtr hud, desktop;
 static uint pid, hudThread, observerThread;
 static IntPtr lastMonitor;
 static int generation, nextRequest, inFlight;
 static bool enabled, dirty, checkQueued;
 static readonly StringBuilder className=new StringBuilder(64);

 [StructLayout(LayoutKind.Sequential)]
 struct Message {
  public IntPtr hwnd;
  public uint message;
  public UIntPtr wParam;
  public IntPtr lParam;
  public uint time;
  public int x, y;
  public uint reserved;
 }

 delegate void WinEvent(IntPtr hook,uint evt,IntPtr hwnd,int idObject,int idChild,uint thread,uint time);
 [DllImport("user32.dll")]
 static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,WinEvent callback,uint process,uint thread,uint flags);
 [DllImport("user32.dll")]
 static extern bool UnhookWinEvent(IntPtr hook);
 [DllImport("user32.dll")]
 static extern IntPtr GetDesktopWindow();
 [DllImport("user32.dll")]
 static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint process);
 [DllImport("user32.dll")]
 static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")]
 static extern bool IsIconic(IntPtr hwnd);
 [DllImport("user32.dll",EntryPoint="GetWindowLongW")]
 static extern int GetWindowLong(IntPtr hwnd,int index);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]
 static extern int GetClassName(IntPtr hwnd,StringBuilder name,int size);
 [DllImport("user32.dll")]
 static extern IntPtr MonitorFromWindow(IntPtr hwnd,uint flags);
 [DllImport("user32.dll")]
 static extern IntPtr GetWindow(IntPtr hwnd,uint relation);
 [DllImport("kernel32.dll")]
 static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")]
 static extern bool PeekMessage(out Message msg,IntPtr hwnd,uint min,uint max,uint remove);
 [DllImport("user32.dll")]
 static extern int GetMessage(out Message msg,IntPtr hwnd,uint min,uint max);
 [DllImport("user32.dll")]
 static extern IntPtr DispatchMessage(ref Message msg);
 [DllImport("user32.dll")]
 static extern bool PostThreadMessage(uint thread,uint msg,UIntPtr wParam,IntPtr lParam);

 static bool IsTaskbar(IntPtr hwnd) {
  if(GetClassName(hwnd,className,className.Capacity)==0)return false;
  string name=className.ToString();
  return name=="Shell_TrayWnd"||name=="Shell_SecondaryTrayWnd";
 }

 static string NeededRepair() {
  uint owner;
  if(!enabled||GetWindowThreadProcessId(hud,out owner)==0||owner!=pid||!IsWindowVisible(hud)||IsIconic(hud))return null;
  if((GetWindowLong(hud,ExStyle)&Topmost)==0)return "restore";
  IntPtr monitor=MonitorFromWindow(hud,0);
  if(monitor==IntPtr.Zero)return null;
  // Walk only the HWNDs ahead of the HUD. A changing z-order can invalidate
  // links during this walk. The next desktop reorder supplies a new sample.
  var visited=new HashSet<IntPtr>();
  for(IntPtr window=GetWindow(hud,Previous);window!=IntPtr.Zero&&visited.Add(window);window=GetWindow(window,Previous)){
   if(IsWindowVisible(window)&&IsTaskbar(window)&&MonitorFromWindow(window,0)==monitor)return "raise";
  }
  return null;
 }

 static void QueueCheck() {
  if(enabled&&dirty&&inFlight==0&&!checkQueued)
   checkQueued=PostThreadMessage(observerThread,Check,UIntPtr.Zero,IntPtr.Zero);
 }

 static void CheckOrder() {
  checkQueued=false;
  if(!enabled||!dirty||inFlight!=0)return;
  dirty=false;
  string repair=NeededRepair();
  if(repair==null)return;
  inFlight=++nextRequest;
  Console.WriteLine("{0} {1} {2}",inFlight,generation,repair);
 }

 static void OnWindowEvent(IntPtr hook,uint evt,IntPtr hwnd,int idObject,int idChild,uint thread,uint time) {
  if(!enabled||idChild!=0||hwnd==IntPtr.Zero)return;
  if(evt==Reorder){
   // USER32 reports top-level reorders on the desktop's client object.
   // The HUD thread's own reorders cannot trigger another attempt.
   if(hwnd!=desktop||idObject!=ObjIdClient||thread==hudThread)return;
  }else{
   if(idObject!=ObjIdWindow)return;
   if(hwnd==hud){
    if(evt==LocationChange){
     IntPtr monitor=MonitorFromWindow(hud,0);
     if(monitor==lastMonitor)return;
     lastMonitor=monitor;
    }
   }else if(!IsTaskbar(hwnd))return;
  }
  // A second shell reorder may arrive before we ever sample a clean state.
  // Keep it pending until Electron acknowledges the first attempt.
  dirty=true;
  QueueCheck();
 }

 static void ReadPresentation() {
  try{
   string line;
   while((line=Console.ReadLine())!=null){
    string[] parts=line.Split(' ');
    int number;
    if(parts.Length!=2||!Int32.TryParse(parts[1],out number)||number<=0)continue;
    UIntPtr value=new UIntPtr((uint)number);
    if(parts[0]=="done")PostThreadMessage(observerThread,Completed,value,IntPtr.Zero);
    else if(parts[0]=="on"||parts[0]=="off")
     PostThreadMessage(observerThread,Presentation,value,parts[0]=="on"?new IntPtr(1):IntPtr.Zero);
   }
  }finally{
   PostThreadMessage(observerThread,Quit,UIntPtr.Zero,IntPtr.Zero);
  }
 }

 static int Main(string[] args) {
  long handle;
  uint owner;
  if(args.Length!=2||!uint.TryParse(args[0],out pid)||!long.TryParse(args[1],out handle)||handle<=0)return 2;
  hud=new IntPtr(handle);
  hudThread=GetWindowThreadProcessId(hud,out owner);
  if(hudThread==0||owner!=pid)return 2;
  desktop=GetDesktopWindow();
  observerThread=GetCurrentThreadId();
  Message msg;
  PeekMessage(out msg,IntPtr.Zero,0,0,0);
  WinEvent callback=OnWindowEvent;
  var hooks=new[]{
   SetWinEventHook(Reorder,Reorder,IntPtr.Zero,callback,0,0,0),
   SetWinEventHook(Show,Show,IntPtr.Zero,callback,0,0,0),
   SetWinEventHook(LocationChange,LocationChange,IntPtr.Zero,callback,0,0,0)
  };
  try{
   foreach(IntPtr hook in hooks)if(hook==IntPtr.Zero)return 3;
   new Thread(ReadPresentation){IsBackground=true}.Start();
   int result;
   while((result=GetMessage(out msg,IntPtr.Zero,0,0))>0){
    if(msg.hwnd==IntPtr.Zero&&msg.message==Check)CheckOrder();
    else if(msg.hwnd==IntPtr.Zero&&msg.message==Presentation){
     generation=(int)msg.wParam.ToUInt32();
     enabled=msg.lParam!=IntPtr.Zero;
     lastMonitor=enabled?MonitorFromWindow(hud,0):IntPtr.Zero;
     dirty=enabled;
     QueueCheck();
    }else if(msg.hwnd==IntPtr.Zero&&msg.message==Completed){
     if(inFlight==(int)msg.wParam.ToUInt32()){
      inFlight=0;
      QueueCheck();
     }
    }else DispatchMessage(ref msg);
   }
   return result==0?0:4;
  }finally{
   foreach(IntPtr hook in hooks)if(hook!=IntPtr.Zero)UnhookWinEvent(hook);
   GC.KeepAlive(callback);
  }
 }
}
