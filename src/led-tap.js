// Observe only MOZA wheel LED frames. No API arguments or return values are changed.
let counts={write:0,ntwrite:0,led:0};
function hook(module,name,bi,ni,key){
const address=Process.getModuleByName(module).getExportByName(name);
Interceptor.attach(address,{
 onEnter(args){
  this.packet=null;
  try {
   counts[key]++;
   const n=args[ni].toUInt32();if(n<7||n>4096)return;
   const a=new Uint8Array(args[bi].readByteArray(n));
   // Only publish wheel LED write groups; never publish arbitrary process writes.
   if(a[0]===0x7e&&((a[2]===0x3f&&a[3]===0x17&&[0x19,0x1a,0x1b,0x1c,0x1d,0x1f,0x27].includes(a[4]))||(a[2]===0x43&&[0x10,0x17].includes(a[3])&&[0x7c,0x7d].includes(a[4])))){this.packet=a.buffer;counts.led++;}
  }catch(e){}
 },
 onLeave(ret){if(this.packet)send({kind:'led',accepted:!ret.isNull()},this.packet);}
});
}
hook('kernelbase.dll','WriteFile',1,2,'write');
hook('ntdll.dll','NtWriteFile',5,6,'ntwrite');
setInterval(()=>send({kind:'counts',counts}),2000);
send({kind:'ready',pid:Process.id});
