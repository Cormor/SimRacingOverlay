'use strict';
// Only trusted, bundled catalog entries can become local data packs. No pack code runs here.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto');
const MAX_BYTES=8*1024*1024,TIMEOUT_MS=20000,MAX_REDIRECTS=4;
const ID=/^[a-z0-9][a-z0-9-]{0,63}$/;
const PREFIX='/Cormor/SimRacingOverlay/releases/download/';
const CDN=new Set(['release-assets.githubusercontent.com','objects.githubusercontent.com']);

function allowedUrl(value,initial=false){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||url.hash)throw Error('盘面下载地址不受信任');
 if(url.hostname==='github.com'&&url.pathname.startsWith(PREFIX)&&url.pathname.length>PREFIX.length)return url;
 if(!initial&&CDN.has(url.hostname))return url;
 throw Error('盘面下载地址不受信任');
}

function safePath(target){
 const absolute=path.resolve(target),parsed=path.parse(absolute);
 let current=parsed.root;
 for(const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  try{if(fs.lstatSync(current).isSymbolicLink())throw Error('盘面缓存路径不能包含符号链接或目录联接');}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return absolute;
}

function checkPng(image){
 const prefix='data:image/png;base64,';
 if(typeof image!=='string'||!image.startsWith(prefix))throw Error('盘面图片必须是 PNG');
 const encoded=image.slice(prefix.length);
 if(!encoded||encoded.length>MAX_BYTES||encoded.length%4!==0||/[^A-Za-z0-9+/=]/.test(encoded))throw Error('盘面 PNG 编码无效');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.toString('base64')!==encoded)throw Error('盘面 PNG 编码无效');
 if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==1315||bytes.readUInt32BE(20)!==1197)throw Error('盘面 PNG 尺寸或文件头无效');
}

function download(start,request=https.get){
 return new Promise((resolve,reject)=>{
  let finished=false,currentRequest=null,currentResponse=null,activeHop=0;
  const deadline=Date.now()+TIMEOUT_MS;
  const finish=(error,data)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   if(error){currentResponse?.destroy();currentRequest?.destroy();reject(error);}else resolve(data);
  };
  const timer=setTimeout(()=>finish(Error('盘面下载超时，请重试')),TIMEOUT_MS);
  function visit(value,redirects){
   if(finished)return;
   const hop=++activeHop,fail=error=>{if(hop===activeHop)finish(error);};
   let url;try{url=allowedUrl(value,redirects===0);}catch(error){finish(error);return;}
   try{
    currentRequest=request(url,{headers:{'User-Agent':'SimRacingOverlay-wheel-pack','Accept':'application/json, application/octet-stream'},timeout:Math.max(1,deadline-Date.now())},response=>{
     if(finished||hop!==activeHop){response.destroy();return;}
     currentResponse=response;
     // A retired redirect connection may fail after the next connection started.
     response.on('error',fail);
     const status=response.statusCode;
     if([301,302,303,307,308].includes(status)){
      const location=response.headers.location;
      if(!location){finish(Error('盘面下载重定向缺少地址'));return;}
      if(redirects>=MAX_REDIRECTS){finish(Error('盘面下载重定向次数过多'));return;}
      let next;try{next=allowedUrl(new URL(location,url).href).href;}catch(error){finish(error);return;}
      activeHop++;currentResponse=null;response.destroy();
      visit(next,redirects+1);return;
     }
     if(status!==200){finish(Error('盘面下载失败，HTTP '+status));return;}
     const declared=response.headers['content-length'];
     if(declared!==undefined&&(!/^\d+$/.test(String(declared))||Number(declared)>MAX_BYTES)){finish(Error('盘面下载文件超过 8 MiB 或长度无效'));return;}
     const chunks=[];let bytes=0;
     response.on('data',chunk=>{
      if(finished||hop!==activeHop)return;chunk=Buffer.from(chunk);bytes+=chunk.length;
      if(bytes>MAX_BYTES){finish(Error('盘面下载文件超过 8 MiB'));return;}chunks.push(chunk);
     });
     response.on('end',()=>{if(finished||hop!==activeHop)return;if(declared!==undefined&&bytes!==Number(declared)){finish(Error('盘面下载不完整'));return;}finish(null,Buffer.concat(chunks,bytes));});
     response.on('aborted',()=>fail(Error('盘面下载中断')));
     response.on('close',()=>{if(!finished&&!response.complete&&!response.readableEnded)fail(Error('盘面下载中断'));});
    });
    currentRequest.on('error',fail);
    currentRequest.on('timeout',()=>fail(Error('盘面下载超时，请重试')));
   }catch(error){fail(error);}
  }
  visit(start,0);
 });
}

function createStore({root,catalog,validate,request}={}){
 if(typeof root!=='string'||!path.isAbsolute(root)||!Array.isArray(catalog)||typeof validate!=='function')throw Error('盘面存储配置无效');
 safePath(root);
 const entries=new Map(),inflight=new Map(),directory=path.join(root,'assets','wheel-packs');
 for(const value of catalog){
  if(!value||!ID.test(value.id)||value.id==='default'||typeof value.name!=='string'||value.name.length<1||value.name.length>120||!/^[a-f0-9]{64}$/i.test(value.sha256)||entries.has(value.id))throw Error('盘面目录条目无效');
  const url=allowedUrl(value.url,true).href;
  entries.set(value.id,Object.freeze({id:value.id,name:value.name,url,sha256:value.sha256.toLowerCase()}));
 }
 function entry(id){if(typeof id!=='string'||!entries.has(id))throw Error('未找到可下载盘面');return entries.get(id);}
 function checked(bytes,item){
  if(bytes.length>MAX_BYTES)throw Error('盘面文件超过 8 MiB');
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('盘面文件校验失败，请重试下载');
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(data?.id!==item.id)throw Error('盘面文件标识与目录不一致');
  checkPng(data.image);
  const validated=validate(data);if(validated===false)throw Error('盘面数据无效');
  return validated&&typeof validated==='object'?validated:data;
 }
 function read(id){
  const item=entry(id),file=path.join(directory,item.id+'.json');
  try{
   safePath(file);
   const stat=fs.statSync(file);if(!stat.isFile()||stat.size>MAX_BYTES)return null;
   return checked(fs.readFileSync(file),item);
  }catch{return null;}
 }
 function list(){return [...entries.values()].map(item=>({id:item.id,name:item.name,installed:read(item.id)!==null,sha256:item.sha256}));}
 async function installPack(item){
  if(read(item.id)!==null)return {ok:true,id:item.id};
  const bytes=await download(item.url,request);
  checked(bytes,item);
  safePath(directory);fs.mkdirSync(directory,{recursive:true});safePath(directory);
  const target=safePath(path.join(directory,item.id+'.json'));
  const temp=target+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
  let created=false;
  try{
   const fd=fs.openSync(temp,'wx',0o600);created=true;
   try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   safePath(target);fs.renameSync(temp,target);created=false;
  }finally{if(created)try{fs.unlinkSync(temp);}catch{}}
  return {ok:true,id:item.id};
 }
 function install(id){
  let item;try{item=entry(id);}catch(error){return Promise.reject(error);}
  if(inflight.has(id))return inflight.get(id);
  const promise=installPack(item).finally(()=>inflight.delete(id));
  inflight.set(id,promise);return promise;
 }
 return {install,list,read};
}

// Bridge Chromium's proxy-aware transport into the same bounded, per-hop downloader.
// Creating this factory is safe before app.ready; net.request runs only on install.
function createElectronRequest(net){
 if(typeof net?.request!=='function')throw Error('Electron网络接口无效');
 return (url,options,callback)=>{
  const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
  const handle=new EventEmitter();let stopped=false,response=null;
  const request=net.request({url:String(url),method:'GET',redirect:'manual',credentials:'omit',useSessionCookies:false});
  handle.destroy=()=>{if(stopped)return;stopped=true;response?.destroy();request.abort();};
  request.on('error',error=>{if(!stopped)handle.emit('error',error);});
  request.on('redirect',(status,_method,next)=>{
   if(stopped)return;stopped=true;
   const redirect=new PassThrough();redirect.statusCode=status;redirect.headers={location:next};
   // Never follow here: the store validates the destination and opens the next hop.
   try{callback(redirect);}finally{request.abort();}
  });
  request.on('response',incoming=>{
   if(stopped)return;
   response=new PassThrough();response.statusCode=incoming.statusCode;response.headers=incoming.headers;
   response.on('close',()=>{if(!response.complete)handle.destroy();});
   incoming.on('end',()=>{if(!stopped){response.complete=true;response.end();}});
   incoming.on('error',error=>{if(!stopped)response.destroy(error);});
   incoming.on('aborted',()=>{if(!stopped)response.emit('aborted');});
   incoming.on('close',()=>{if(!stopped&&!response.complete)response.destroy(Error('盘面下载连接已关闭'));});
   callback(response);
   incoming.on('data',chunk=>{if(!stopped)response.write(chunk);});
  });
  // In the shipped runtime ClientRequest's Writable close follows finish, before headers.
  // Response close/error and the store's total deadline own network completion.
  request.on('abort',()=>{if(!stopped)handle.emit('error',Error('盘面下载已取消'));});
  for(const [key,value] of Object.entries(options.headers||{}))request.setHeader(key,value);
  request.end();return handle;
 };
}

module.exports={createStore,createElectronRequest};
