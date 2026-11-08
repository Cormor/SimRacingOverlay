'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {createStore}=require('./wheel-store');
const validateWheel=require('./wheel-profile').validate;
const componentHost=require('./component-host');
const REPO='Cormor/SimRacingOverlay',API='https://api.github.com/repos/'+REPO+'/releases/latest';
const ALGORITHMS=Object.freeze(['telemetry-context.js','tyre-response.js','steering-advisor.js','reserve.js','grip.js','handling.js','legacy-chassis-response.js','chassis-response.js','suspension-contact.js','realtime-response.js','feedback-research.js','pedal-traction.js','assist.js','g-ball.js']);
const JSON_LIMIT=12*1024*1024,SETUP_LIMIT=768*1024*1024;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fileDigest(file){const hash=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(1024*1024);try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,n));return hash.digest('hex');}finally{fs.closeSync(fd);}}
const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
function version(value){if(typeof value!=='string'||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value))throw Error('版本号必须为三段数字');return value.split('.').map(Number);}
function compare(a,b){const aa=version(a),bb=version(b);for(let i=0;i<3;i++)if(aa[i]!==bb[i])return Math.sign(aa[i]-bb[i]);return 0;}
function plain(target){
 const absolute=path.resolve(target);let part=path.parse(absolute).root;
 for(const item of absolute.slice(part.length).split(path.sep).filter(Boolean)){
  part=path.join(part,item);try{if(fs.lstatSync(part).isSymbolicLink())throw Error('更新目录不能包含符号链接或目录联接');}catch(error){if(error.code!=='ENOENT')throw error;}
 }return absolute;
}
function atomic(file,bytes){
 plain(file);fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
 try{const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}plain(file);fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch{}}
}
function allowedUrl(value,initial=false){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port&&u.port!=='443')throw Error('更新下载地址不受支持');
 if(u.href===API)return u;
 if(u.hostname==='github.com'&&u.pathname.startsWith('/'+REPO+'/releases/download/'))return u;
 if(!initial&&['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))return u;
 throw Error('更新只接受 Cormor/SimRacingOverlay 的正式 Release 资产');
}
// The supplied request is Electron's system-proxy transport. Redirects are checked here.
function fetchAsset(url,{request,limit=JSON_LIMIT,file,progress}={}){
 return new Promise((resolve,reject)=>{
  let done=false,req,res,hop=0,fd=null,bytes=0;const chunks=[],deadline=Date.now()+(file?180000:30000);
  if(file){plain(file);fs.mkdirSync(path.dirname(file),{recursive:true});fd=fs.openSync(file,'wx',0o600);}
  const hash=crypto.createHash('sha256');
  const finish=(error)=>{
   if(done)return;done=true;clearTimeout(timer);if(fd!==null){try{if(!error)fs.fsyncSync(fd);}catch(failure){error=error||failure;}finally{fs.closeSync(fd);fd=null;}}
   if(error){res?.destroy();req?.destroy();if(file)try{fs.unlinkSync(file);}catch{}reject(error);}
   else resolve({bytes:file?null:Buffer.concat(chunks,bytes),sha256:hash.digest('hex'),size:bytes,file});
  };
  const timer=setTimeout(()=>finish(Error('更新下载超时，请重试')),file?180000:30000);
  function visit(value,count){
   let u;try{u=allowedUrl(value,count===0);}catch(error){finish(error);return;}
   const current=++hop,fail=error=>{if(current===hop)finish(error);};
   try{req=request(u,{headers:{'User-Agent':'SimRacingOverlay-updater','Accept':'application/vnd.github+json, application/octet-stream'},timeout:Math.max(1,deadline-Date.now())},incoming=>{
    if(done||current!==hop){incoming.destroy();return;}res=incoming;res.on('error',fail);
    if([301,302,303,307,308].includes(res.statusCode)){
     if(count>=4||!res.headers.location){finish(Error('更新下载重定向无效'));return;}
     let next;try{next=allowedUrl(new URL(res.headers.location,u).href).href;}catch(error){finish(error);return;}
     hop++;res.destroy();visit(next,count+1);return;
    }
    if(res.statusCode!==200){finish(Error('无法获取更新（HTTP '+res.statusCode+'）'));return;}
    const length=res.headers['content-length'];
    if(length!==undefined&&(!/^\d+$/.test(String(length))||Number(length)>limit)){finish(Error('更新资产大小超出允许范围'));return;}
    res.on('data',chunk=>{if(done||current!==hop)return;try{const b=Buffer.from(chunk);bytes+=b.length;if(bytes>limit)throw Error('更新资产大小超出允许范围');hash.update(b);if(fd!==null)fs.writeSync(fd,b);else chunks.push(b);progress?.(bytes,length===undefined?null:Number(length));}catch(error){finish(error);}});
    res.on('end',()=>{if(done||current!==hop)return;if(length!==undefined&&bytes!==Number(length)){finish(Error('更新下载不完整'));return;}finish();});
    res.on('aborted',()=>fail(Error('更新下载中断')));
    res.on('close',()=>{if(!done&&!res.complete&&!res.readableEnded)fail(Error('更新连接已关闭'));});
   });req.on('error',fail);req.on('timeout',()=>fail(Error('更新下载超时，请重试')));}catch(error){finish(error);}
  }visit(url,0);
 });
}
function readActive(root,base){
 try{const file=plain(path.join(root,'assets/modules/active.json'));const a=JSON.parse(fs.readFileSync(file,'utf8'));version(a.version);if(a.baseVersion!==base||!/^\w{64}$/.test(a.generation)||!/^[a-f0-9]{64}$/.test(a.generation)||!['official','local'].includes(a.source))return null;return a;}catch{return null;}
}
function checkedHotfix(input,base){
 if(!input||input.schema!==1||input.kind!=='simracingoverlay-hotfix')throw Error('请选择 SimRacingOverlay 算法 hotfix JSON 包或盘面 JSON');
 version(input.version);if(input.baseVersion!==base)throw Error('此算法包适用于 '+input.baseVersion+'；当前完整版本为 '+base+'，请先安装匹配的完整版本');
 if(!input.files||Array.isArray(input.files)||typeof input.files!=='object')throw Error('算法包缺少 files');
 const files=Object.keys(input.files);if(!files.length||files.length>ALGORITHMS.length)throw Error('算法模块数量无效');
 for(const name of files){if(!ALGORITHMS.includes(name))throw Error('此文件需要完整更新，不能 hotfix：'+name);const code=input.files[name];if(typeof code!=='string'||Buffer.byteLength(code)>2*1024*1024)throw Error('算法模块内容或大小无效：'+name);try{new vm.Script(code,{filename:name});}catch(error){throw Error('算法语法无效：'+name+'：'+error.message);}}
 return {schema:1,kind:input.kind,version:input.version,baseVersion:base,files:Object.fromEntries(files.map(n=>[n,input.files[n]]))};
}
function createUpdateService({root,request,onState=()=>{},beforeApply=async()=>true,applyModules=async()=>{},installSetup=async()=>{throw Error('安装入口不可用');}}={}){
 if(!path.isAbsolute(root)||typeof request!=='function')throw Error('更新服务配置无效');
 const base=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();version(base);
 const directory=plain(path.join(root,'assets/modules')),downloadDir=plain(path.join(root,'runtime/updates'));
 let disposed=false,operation=null,lastCheck=0,releaseData=null,manifest=null,pending=null,setup=null;
 function componentState(){try{const current=componentHost.current(root);return {packages:current.packages.map(p=>({id:p.id,version:p.version,source:p.source})),revision:current.revision,error:null};}catch(error){return {packages:[],error:error.message};}}
 let state={phase:'idle',currentVersion:base,effectiveVersion:base,available:false,release:null,canHotfix:false,canSetup:false,pending:null,active:null,message:'尚未检查更新',error:null,checkedAt:null};
 const snapshot=()=>{const active=readActive(root,base);return JSON.parse(JSON.stringify({...state,components:componentState(),active:active?{version:active.version,source:active.source,files:active.files||[]}:null,effectiveVersion:active?.version||base,officialVersion:active?.source==='official'&&compare(active.version,base)>0?active.version:base}));};
 function publish(patch){if(disposed)return;state={...state,...patch};onState(snapshot());}
 async function run(fn){if(disposed)return {ok:false,error:'更新服务已退出',state:snapshot()};if(operation)return {ok:false,error:'另一项更新操作正在进行',state:snapshot()};const promise=(async()=>{try{await fn();return {ok:true,state:snapshot()};}catch(error){publish({phase:'error',error:error.message,message:error.message});return {ok:false,error:error.message,state:snapshot()};}})();operation=promise;try{return await promise;}finally{if(operation===promise)operation=null;}}
 function asset(name){const a=releaseData?.assets?.find(a=>a.name===name);if(!a||typeof a.browser_download_url!=='string')throw Error('Release 缺少资产：'+name);const u=allowedUrl(a.browser_download_url,true);const prefix='/'+REPO+'/releases/download/'+encodeURIComponent(releaseData.tag_name)+'/';if(!u.pathname.startsWith(prefix)||decodeURIComponent(u.pathname.slice(prefix.length))!==name)throw Error('更新资产不属于当前 Release');return a;}
 function entry(value,kind){if(!value)return null;if(typeof value.name!=='string'||value.name!==path.basename(value.name)||!/^[a-f0-9]{64}$/i.test(value.sha256))throw Error('更新清单校验信息无效');if(kind==='hotfix'&&value.kind!==undefined&&!['algorithm','wheel','components'].includes(value.kind))throw Error('不支持此热更新类型');if(value.kind==='components')version(value.moduleVersion);if(kind==='setup'&&!/^SimRacingOverlay-\d+\.\d+\.\d+-Setup\.exe$/.test(value.name))throw Error('完整更新必须为正式 Setup');asset(value.name);return {name:value.name,sha256:value.sha256.toLowerCase(),kind:['wheel','components'].includes(value.kind)?value.kind:'algorithm',moduleVersion:value.moduleVersion};}
 async function check(force=false){if(!force&&lastCheck&&Date.now()-lastCheck<60000)return {ok:true,state:snapshot()};return run(async()=>{
  publish({phase:'checking',error:null,message:'正在检查正式 Release…'});const result=await fetchAsset(API,{request,limit:1024*1024});if(disposed)return;
  const r=parse(result.bytes);if(r.draft||r.prerelease||typeof r.tag_name!=='string'||!r.tag_name.startsWith('v')||!Array.isArray(r.assets))throw Error('最新 Release 信息无效');const v=r.tag_name.slice(1);version(v);
  releaseData=r;manifest=null;lastCheck=Date.now();const isNew=compare(v,snapshot().officialVersion)>0,release={version:v,url:'https://github.com/'+REPO+'/releases/tag/'+encodeURIComponent(r.tag_name),notes:String(r.body||'').slice(0,20000)};
  // Publish discovery before fetching optional metadata: a failed manifest must not hide a real update.
  publish({release,available:isNew,canSetup:false,canHotfix:false,checkedAt:new Date().toISOString()});
  const meta=r.assets.find(a=>a.name==='update-manifest.json');
  if(meta){const b=await fetchAsset(asset(meta.name).browser_download_url,{request,limit:256*1024});if(disposed)return;const m=parse(b.bytes);if(m.schema!==1||m.version!==v)throw Error('更新清单版本与 Release 不一致');manifest={setup:entry(m.setup,'setup'),hotfix:entry(m.hotfix,'hotfix'),baseVersion:m.baseVersion};}
  else{const candidate=r.assets.find(a=>a.name==='SimRacingOverlay-'+v+'-Setup.exe'&&/^sha256:[a-f0-9]{64}$/i.test(a.digest||''));if(candidate)manifest={setup:entry({name:candidate.name,sha256:candidate.digest.slice(7)},'setup')};}
  const compatible=manifest?.hotfix&&(['wheel','components'].includes(manifest.hotfix.kind)||manifest.baseVersion===base);
  publish({phase:isNew?'available':'current',canSetup:!!manifest?.setup&&compare(v,base)>0,canHotfix:!!compatible&&isNew,message:isNew?(manifest?.setup||compatible?'发现新版本 '+v:'发现新版本 '+v+'；此 Release 未提供受校验更新清单，请打开发布页安装'):'当前版本无需更新',error:null});
 });}
 async function download(kind='setup'){return run(async()=>{
  if(!['setup','hotfix'].includes(kind))throw Error('未知更新类型');const spec=manifest?.[kind];if(!spec)throw Error('此 Release 未提供可直接安装的'+(kind==='setup'?'完整更新':'hotfix'));
  if(kind==='hotfix'&&!['wheel','components'].includes(manifest.hotfix.kind)&&manifest.baseVersion!==base)throw Error('此 hotfix 与当前完整版本不兼容');
  publish({phase:'downloading',pending:null,error:null,message:'正在下载'+(kind==='setup'?'完整更新':'热更新')+'…'});pending=null;
  const a=asset(spec.name);
  if(kind==='setup'){
   fs.mkdirSync(downloadDir,{recursive:true});const temp=path.join(downloadDir,crypto.randomBytes(8).toString('hex')+'.download');
   const data=await fetchAsset(a.browser_download_url,{request,limit:SETUP_LIMIT,file:temp,progress:(received,total)=>publish({receivedBytes:received,totalBytes:total})});
   if(data.sha256!==spec.sha256){fs.unlinkSync(temp);throw Error('完整更新校验失败，请重新下载');}
   if(disposed){fs.unlinkSync(temp);return;}const file=plain(path.join(downloadDir,spec.name));fs.renameSync(temp,file);setup={file,sha256:spec.sha256};publish({phase:'ready',pending:{kind:'setup',source:'official',version:state.release.version,files:[spec.name],name:'完整更新 '+state.release.version,executable:true},message:'完整更新已下载；安装前会保存编辑并退出，完整升级后恢复内置算法。',error:null});
  }else{const data=await fetchAsset(a.browser_download_url,{request});if(data.sha256!==spec.sha256)throw Error('hotfix 校验失败，请重新下载');if(disposed)return;const payload=parse(data.bytes);if(manifest.hotfix.kind==='wheel'){setPending(validateWheel(payload),'official');}else if(manifest.hotfix.kind==='components'){const pack=componentHost.inspectPackage(payload);if(pack.version!==manifest.hotfix.moduleVersion)throw Error('组件包版本与更新清单不一致');setPending(pack,'official');}else{const pack=checkedHotfix(payload,base);if(pack.version!==state.release.version||pack.baseVersion!==manifest.baseVersion)throw Error('hotfix 包与 Release 版本不一致');setPending(pack,'official');}}
 });}
 function setPending(data,source){
  pending={data,source};const component=data.kind==='simracingoverlay-components',wheel=!component&&data.kind!=='simracingoverlay-hotfix';
  const details=component?data.definitions.map(d=>({kind:d.kind,id:d.id,label:d.label})):null;
  publish({phase:'ready',error:null,pending:{kind:component?'components':wheel?'wheel':'hotfix',source,version:wheel?null:data.version,files:wheel?[data.id+'.json']:Object.keys(data.files),name:component?'组件包 '+data.id+' '+data.version:wheel?data.name:'算法 '+data.version,definitions:details,executable:!wheel},message:wheel?'盘面已读取；应用后可在盘面设置中选择':component?'组件包已读取：'+details.map(d=>d.kind+' / '+d.label).join('、')+'。包内含可执行代码，应用后才安装并刷新。':'算法包已读取；应用后会刷新叠加层。算法包包含可执行代码，仅应用你信任的来源。'});
 }

 async function inspectLocal(file){return run(async()=>{pending=null;publish({pending:null,error:null});if(typeof file!=='string'||!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.json')throw Error('请选择本地 JSON 文件');plain(file);const stat=fs.statSync(file);if(!stat.isFile()||stat.size>JSON_LIMIT)throw Error('本地包必须为不超过 12 MiB 的 JSON 文件');const data=parse(fs.readFileSync(file));if(data.kind==='simracingoverlay-components')setPending(componentHost.inspectPackage(data),'local');else if(data.kind==='simracingoverlay-hotfix')setPending(checkedHotfix(data,base),'local');else setPending(validateWheel(data),'local');});}
 async function applyPending(){return run(async()=>{
  const selected=pending;if(!selected)throw Error('请先下载 hotfix 或选择本地包');publish({phase:'applying',error:null,message:'正在保存编辑并应用…'});
  if(await beforeApply()!==true)throw Error('当前编辑尚未保存；完成编辑后重试');if(disposed)return;
  const {data,source}=selected;let componentPrevious=null,componentActivation=null;
  if(data.kind==='simracingoverlay-components'){
   componentPrevious=componentHost.current(root);componentActivation=componentHost.stageActivate(data,{root,source});
  }else if(data.kind!=='simracingoverlay-hotfix'){
   const store=createStore({root,catalog:[],validate:validateWheel,request});store.importLocal(data,source);
  }else{
   // Every generation contains every algorithm. A partial pack inherits the current
   // generation, and never exposes a mix of generations to one renderer/worker pair.
   const previous=source==='local'?readActive(root,base):null,all={};
   for(const name of ALGORITHMS){const file=plain(path.join(root,previous?'assets/modules/'+previous.generation+'/'+name:name));all[name]=Object.hasOwn(data.files,name)?data.files[name]:fs.readFileSync(file,'utf8');}
   const generation=digest(Buffer.from(JSON.stringify(all))),folder=plain(path.join(directory,generation));fs.mkdirSync(folder,{recursive:true});
   for(const [name,code]of Object.entries(all)){const file=plain(path.join(folder,name));if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==code)throw Error('现有模块代际内容发生变化，请重新导入');}else fs.writeFileSync(file,code,{flag:'wx'});}
   atomic(path.join(directory,'active.json'),JSON.stringify({schema:1,baseVersion:base,version:data.version,source,generation,files:Object.keys(data.files)},null,2)+'\n');
  }
  pending=null;publish({phase:'ready',pending:null,message:'模块已安装，正在刷新叠加层…'});
  try{await applyModules(componentActivation?.revision);publish({phase:'idle',available:state.release?compare(state.release.version,snapshot().officialVersion)>0:false,message:componentActivation?'组件包已应用，可在组件设置中选择新增定义。':data.kind==='simracingoverlay-hotfix'?'算法模块已应用。':'盘面已应用，可在盘面设置中选择。',error:null});}catch(error){
   if(componentActivation){
    try{componentHost.restoreSnapshot(root,componentPrevious,componentActivation.revision);await applyModules(componentPrevious.revision);}catch(restoreError){throw Error('组件包未通过运行加载：'+error.message+'；恢复原组合未完成：'+restoreError.message);}
    throw Error('组件包未通过运行加载，已恢复原组合：'+error.message);
   }
   throw Error('模块已安装，刷新未完成：'+error.message+'。请重新打开叠加层。');
  }
 });}
 async function clearModules(){return run(async()=>{publish({phase:'applying',error:null});if(await beforeApply()!==true)throw Error('当前编辑尚未保存；完成编辑后重试');if(disposed)return;const baseline=componentHost.restoreBaseline(root);const file=plain(path.join(directory,'active.json'));if(fs.existsSync(file))fs.unlinkSync(file);await applyModules(baseline.revision);publish({phase:'idle',message:'已恢复当前完整版本内置算法与组件；本地包文件保留。',error:null,available:state.release?compare(state.release.version,base)>0:false});});}
 async function install(){return run(async()=>{if(!setup)throw Error('请先下载完整更新');if(await beforeApply()!==true)throw Error('当前编辑尚未保存；完成编辑后重试');if(disposed)return;plain(setup.file);const hash=fileDigest(setup.file);if(hash!==setup.sha256)throw Error('安装文件已变化，请重新下载');publish({phase:'applying',message:'正在打开安装程序；安装会保存并退出当前叠加层…',error:null});await installSetup(setup.file);publish({phase:'ready',message:'安装程序已打开；请在安装窗口完成升级。'});});}
 return {snapshot,check,download,inspectLocal,applyPending,clearModules,install,dispose(){disposed=true;}};
}
module.exports={createUpdateService,ALGORITHMS,checkedHotfix,compare,fetchAsset};
