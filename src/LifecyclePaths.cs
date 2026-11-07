using System;
using System.IO;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

// Windows installation identity: resolve directory junctions before comparing
// our executable, script or integration paths. Also handles a new destination.
public static class OverlayLifecyclePaths {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern uint GetFinalPathNameByHandle(SafeFileHandle file,StringBuilder path,uint capacity,uint flags);
 [DllImport("shell32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern IntPtr CommandLineToArgvW(string commandLine,out int count);
 [DllImport("kernel32.dll")]static extern IntPtr LocalFree(IntPtr memory);
 public static string Canonical(string value) {
  string full=Path.GetFullPath(value),existing=full;
  var tail=new System.Collections.Generic.Stack<string>();
  while(!File.Exists(existing)&&!Directory.Exists(existing)) {
   string parent=Path.GetDirectoryName(existing);
   if(String.IsNullOrEmpty(parent)||parent==existing)throw new DirectoryNotFoundException(full);
   tail.Push(Path.GetFileName(existing));existing=parent;
  }
  using(var handle=CreateFile(existing,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
   if(handle.IsInvalid)throw new Win32Exception(Marshal.GetLastWin32Error(),existing);
   var buffer=new StringBuilder(512);
   uint length=GetFinalPathNameByHandle(handle,buffer,(uint)buffer.Capacity,0);
   if(length==0)throw new Win32Exception(Marshal.GetLastWin32Error(),existing);
   if(length>=buffer.Capacity){buffer.Capacity=(int)length+1;length=GetFinalPathNameByHandle(handle,buffer,(uint)buffer.Capacity,0);if(length==0||length>=buffer.Capacity)throw new IOException("Cannot resolve installation path: "+existing);}
   existing=buffer.ToString();
  }
  if(existing.StartsWith(@"\\?\UNC\",StringComparison.OrdinalIgnoreCase))existing=@"\\"+existing.Substring(8);
  else if(existing.StartsWith(@"\\?\",StringComparison.Ordinal))existing=existing.Substring(4);
  while(tail.Count>0)existing=Path.Combine(existing,tail.Pop());
  return existing.Length>Path.GetPathRoot(existing).Length?existing.TrimEnd(Path.DirectorySeparatorChar):existing;
 }
 public static bool Same(string left,string right) {
  return !String.IsNullOrWhiteSpace(left)&&!String.IsNullOrWhiteSpace(right)&&String.Equals(Canonical(left),Canonical(right),StringComparison.OrdinalIgnoreCase);
 }
 public static string[] Arguments(string line) {
  if(String.IsNullOrWhiteSpace(line))return new string[0];
  int count;IntPtr memory=CommandLineToArgvW(line,out count);
  if(memory==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
  try{var result=new string[count];for(int i=0;i<count;i++)result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory,i*IntPtr.Size));return result;}finally{LocalFree(memory);}
 }
 static bool IsFullPathArgument(string value) {
  if(String.IsNullOrEmpty(value))return false;
  // IsPathRooted also accepts /prefetch:1 and current-drive-relative paths.
  // Our launchers supply a complete drive path or UNC path; argv has no cwd.
  bool drive=value.Length>=3&&((value[0]>='A'&&value[0]<='Z')||(value[0]>='a'&&value[0]<='z'))&&value[1]==':'&&(value[2]=='\\'||value[2]=='/');
  return drive||value.StartsWith(@"\\",StringComparison.Ordinal);
 }
 public static bool HasScript(string line,string script) {
  string name=Path.GetFileName(script);
  foreach(string arg in Arguments(line))if(IsFullPathArgument(arg)&&String.Equals(Path.GetFileName(arg),name,StringComparison.OrdinalIgnoreCase)&&Same(arg,script))return true;
  return false;
 }
 public static string LauncherRoot(string line) {
  string[] args=Arguments(line);
  for(int i=1;i+1<args.Length;i++)if(args[i]=="--root")return Canonical(args[i+1]);
  return args.Length==0?null:Canonical(Path.Combine(Path.GetDirectoryName(args[0]),".."));
 }
 [DllImport("ntdll.dll")]
 static extern int NtQueryInformationProcess(IntPtr process,int info,IntPtr buffer,int length,out int needed);
 static string ProcessCommandLine(System.Diagnostics.Process process) {
  int needed;NtQueryInformationProcess(process.Handle,60,IntPtr.Zero,0,out needed);
  if(needed<=0)throw new Win32Exception("Cannot read process command line: "+process.Id);
  IntPtr buffer=Marshal.AllocHGlobal(needed);
  try {
   int status=NtQueryInformationProcess(process.Handle,60,buffer,needed,out needed);
   if(status!=0)throw new Win32Exception("Cannot read process command line: "+process.Id+" status="+status);
   int length=(ushort)Marshal.ReadInt16(buffer);
   IntPtr text=Marshal.ReadIntPtr(buffer,IntPtr.Size==8?8:4);
   return Marshal.PtrToStringUni(text,length/2);
  }finally{Marshal.FreeHGlobal(buffer);}
 }
 public sealed class ProcessInfo {
  public int ProcessId; public string ExecutablePath; public string CommandLine;
 }
 public static ProcessInfo[] Processes(string executable, bool commandLine) {
  var result=new System.Collections.Generic.List<ProcessInfo>();
  foreach(var process in System.Diagnostics.Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executable))) {
   using(process) {
    try {
     string path=process.MainModule.FileName;
     if(!Same(path,executable))continue;
     string line=null;
     if(commandLine)line=ProcessCommandLine(process);
     result.Add(new ProcessInfo{ProcessId=process.Id,ExecutablePath=path,CommandLine=line});
    }catch(ArgumentException){}catch(InvalidOperationException){}catch(Win32Exception){}
   }
  }
  return result.ToArray();
 }
 [DllImport("iphlpapi.dll",SetLastError=true)]
 static extern uint GetExtendedTcpTable(IntPtr table,ref int size,bool order,int family,int tableClass,uint reserved);
 public sealed class ListenerInfo { public int OwningProcess; }
 public static ListenerInfo[] Listeners(int port) {
  var result=new System.Collections.Generic.List<ListenerInfo>();
  foreach(int family in new[]{2,23}) {
   int size=0;uint code=GetExtendedTcpTable(IntPtr.Zero,ref size,false,family,3,0);
   if(code!=0&&code!=122)throw new Win32Exception((int)code);
   IntPtr buffer=Marshal.AllocHGlobal(size);
   try {
    code=GetExtendedTcpTable(buffer,ref size,false,family,3,0);
    if(code==122){Marshal.FreeHGlobal(buffer);buffer=IntPtr.Zero;buffer=Marshal.AllocHGlobal(size);code=GetExtendedTcpTable(buffer,ref size,false,family,3,0);}
    if(code!=0)throw new Win32Exception((int)code);
    int count=Marshal.ReadInt32(buffer),stride=family==2?24:56,portOffset=family==2?8:20,pidOffset=family==2?20:52;
    for(int row=0;row<count;row++){
     IntPtr item=IntPtr.Add(buffer,4+row*stride);
     int value=Marshal.ReadByte(item,portOffset)*256+Marshal.ReadByte(item,portOffset+1);
     if(value==port)result.Add(new ListenerInfo{OwningProcess=Marshal.ReadInt32(item,pidOffset)});
    }
   }finally{if(buffer!=IntPtr.Zero)Marshal.FreeHGlobal(buffer);}
  }
  return result.ToArray();
 }

}
