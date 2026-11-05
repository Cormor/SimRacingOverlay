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
}
