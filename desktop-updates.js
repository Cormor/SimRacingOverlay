'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {createStore}=require('./wheel-store');
const validateWheel=require('./wheel-profile').validate;
const componentHost=require('./component-host');
const {APP_ID}=require('./desktop-config.cjs');
const {createReleaseChannel,compare}=require('./tools/vendor/update/lixing-update.cjs');
const {watchFiles}=require('./desktop-files');
const REPO='Cormor/SimRacingOverlay';
const ALGORITHMS=Object.freeze(['telemetry-context.js','tyre-response.js','steering-advisor.js','reserve.js','grip.js','handling.js','legacy-chassis-response.js','chassis-response.js','suspension-contact.js','realtime-response.js','feedback-research.js','pedal-traction.js','assist.js','g-ball.js']);
const JSON_LIMIT=12*1024*1024;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
function version(value){if(typeof value!=='string'||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value))throw Error('版本号必须为三段数字');return value.split('.').map(Number);}
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
function readActive(dataRoot,base){
 try{const file=plain(path.join(dataRoot,'assets/modules/active.json'));const a=JSON.parse(fs.readFileSync(file,'utf8'));version(a.version);if(a.baseVersion!==base||!/^[a-f0-9]{64}$/.test(a.generation)||!['official','local'].includes(a.source))return null;return a;}catch{return null;}
}
function checkedHotfix(input,base){
 if(!input||input.schema!==1||input.kind!=='simracingoverlay-hotfix')throw Error('请选择 SimRacingOverlay 算法、组件或盘面 JSON 包');
 version(input.version);if(input.baseVersion!==base)throw Error('此算法包适用于 '+input.baseVersion+'；当前完整版本为 '+base+'，请先安装匹配的完整版本');
 if(!input.files||Array.isArray(input.files)||typeof input.files!=='object')throw Error('算法包缺少文件清单');
 const files=Object.keys(input.files);if(!files.length||files.length>ALGORITHMS.length)throw Error('算法模块数量无效');
 for(const name of files){if(!ALGORITHMS.includes(name))throw Error('此文件需要完整更新，无法热更新：'+name);const code=input.files[name];if(typeof code!=='string'||Buffer.byteLength(code)>2*1024*1024)throw Error('算法模块内容或大小无效：'+name);try{new vm.Script(code,{filename:name});}catch(error){throw Error('算法语法无效：'+name+'：'+error.message);}}
 return {schema:1,kind:input.kind,version:input.version,baseVersion:base,files:Object.fromEntries(files.map(n=>[n,input.files[n]]))};
}
function createUpdateService({root,dataRoot=root,request,onState=()=>{},beforeApply=async()=>true,applyModules=async()=>{},installSetup=async()=>{throw Error('安装入口不可用');}}={}){
 if(!path.isAbsolute(root)||typeof request!=='function')throw Error('更新服务配置无效');
 const base=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();version(base);
 const directory=plain(path.join(dataRoot,'assets/modules')),downloadDir=plain(path.join(dataRoot,'runtime/updates'));
 const channel=createReleaseChannel({
  appId:APP_ID,repo:REPO,currentVersion:base,platform:'win32',arch:'x64',channel:'stable',
  certificate:fs.readFileSync(path.join(__dirname,'tools/vendor/update/release-certificate.cer')),
  downloadDir,request,setupName:version=>'SimRacingOverlay-'+version+'-Setup.exe',
  hotfixKinds:['algorithm','wheel','components'],
 });
 let disposed=false,operation=null,lastCheck=0,pending=null,setup=null,installAttempt=null,stopWatchingInstall=null;
 const receiptFile=plain(path.join(root,'runtime/updates/install-state.json'));
 function componentState(){try{const current=componentHost.current(dataRoot);return {packages:current.packages.map(p=>({id:p.id,version:p.version,source:p.source})),revision:current.revision,error:null};}catch(error){return {packages:[],error:error.message};}}
 let state={phase:'idle',currentVersion:base,effectiveVersion:base,available:false,verified:false,release:null,canHotfix:false,canSetup:false,pending:null,active:null,message:'尚未检查更新',error:null,checkedAt:null};
 const snapshot=()=>{const active=readActive(dataRoot,base);return JSON.parse(JSON.stringify({...state,components:componentState(),active:active?{version:active.version,source:active.source,files:active.files||[]}:null,effectiveVersion:active?.version||base,officialVersion:active?.schema===2&&active.source==='official'&&compare(active.version,base)>0?active.version:base}));};
 function publish(patch){if(disposed)return;state={...state,...patch};onState(snapshot());}
 function readReceipt(){try{const value=parse(fs.readFileSync(receiptFile));if(value.schema!==1||typeof value.attemptId!=='string'||!/^[a-f0-9]{32}$/.test(value.attemptId))return null;version(value.version);return value;}catch{return null;}}
 function stopInstallWatch(){stopWatchingInstall?.();stopWatchingInstall=null;}
 function installState(value){return {phase:value.phase,attemptId:value.attemptId,version:value.version,message:String(value.message||''),copied:Number.isSafeInteger(value.copied)?value.copied:null,total:Number.isSafeInteger(value.total)?value.total:null};}
 const previousInstall=readReceipt();
 if(previousInstall){
  if(previousInstall.phase==='restarting'&&previousInstall.version===base){
   previousInstall.phase='completed';previousInstall.message='已更新到 '+base+'，应用已重新启动。';previousInstall.completedAt=new Date().toISOString();
   atomic(receiptFile,JSON.stringify(previousInstall,null,2)+'\n');
  }
  state.installation=installState(previousInstall);
  if(previousInstall.phase==='error'){state.phase='error';state.error=previousInstall.message;state.message=previousInstall.message;}
  else if(previousInstall.phase==='completed'){state.message=previousInstall.message;}
 }
 function readInstallProgress(attempt){
  if(disposed||installAttempt!==attempt)return;
  const value=readReceipt();if(!value||value.attemptId!==attempt.attemptId||value.version!==attempt.version)return;
  if(value.phase==='error'){stopInstallWatch();installAttempt=null;publish({phase:'error',installation:installState(value),error:value.message,message:value.message});}
  else publish({phase:'installing',installation:installState(value),error:null,message:value.message});
 }
 async function run(fn){if(disposed)return {ok:false,error:'更新服务已退出',state:snapshot()};if(operation||installAttempt)return {ok:false,error:'另一项更新操作正在进行',state:snapshot()};const promise=(async()=>{try{publish({result:null});await fn();return {ok:true,state:snapshot()};}catch(error){publish({phase:'error',error:error.message,message:error.message});return {ok:false,error:error.message,state:snapshot()};}})();operation=promise;try{return await promise;}finally{if(operation===promise)operation=null;}}
 async function check(force=false){if(!force&&(setup||pending?.staged||lastCheck&&Date.now()-lastCheck<60000))return {ok:true,state:snapshot()};return run(async()=>{
  if(setup||pending?.staged){
   setup=null;pending=null;
   publish({pending:null});
  }
  publish({phase:'checking',error:null,message:'正在检查正式 Release…'});
  const result=await channel.discover(snapshot().officialVersion);
  if(disposed)return;
  const {release,available,verified,canSetup,canHotfix,trustError}=result;
  lastCheck=Date.now();
  const message=trustError
   ? '发行清单验证失败：'+trustError
   : available?'发现新版本 '+release.version:'当前版本无需更新';
  publish({release,available,verified,canSetup,canHotfix,checkedAt:new Date().toISOString(),
   phase:trustError?'error':available?'available':'current',message,error:trustError?message:null});
 });}
 async function download(kind='setup'){return run(async()=>{
  if(!['setup','hotfix'].includes(kind))throw Error('未知更新类型');
  publish({phase:'downloading',pending:null,receivedBytes:0,totalBytes:null,error:null,message:'正在下载'+(kind==='setup'?'完整更新':'热更新')+'…'});
  pending=null;
  if(kind==='setup')setup=null;
  const staged=await channel.download(kind,(received,total)=>publish({receivedBytes:received,totalBytes:total}));
  if(disposed)return;
  const {spec,version}=staged;
  if(kind==='setup'){
   setup=staged;
   publish({phase:'ready',pending:{kind:'setup',source:'official',version,files:[spec.name],name:'完整更新 '+version,executable:true},message:'完整更新已下载；安装前会保存编辑并退出，完整升级后恢复内置算法。',error:null});
   return;
  }
  const payload=parse(await channel.verifyHotfix(staged));
  if(disposed)return;
  if(spec.kind==='wheel')setPending(validateWheel(payload),'official',staged);
  else if(spec.kind==='components'){
   const pack=componentHost.inspectPackage(payload);
   if(pack.version!==spec.moduleVersion)throw Error('组件包版本与更新清单不一致');
   setPending(pack,'official',staged);
  }else{
   const pack=checkedHotfix(payload,base);
   if(pack.version!==version||pack.baseVersion!==spec.baseVersion)throw Error('热更新包与发布版本不一致');
   setPending(pack,'official',staged);
  }
 });}
 function setPending(data,source,staged=null){
  pending={data,source,staged};const component=data.kind==='simracingoverlay-components',wheel=!component&&data.kind!=='simracingoverlay-hotfix';
  const details=component?data.definitions.map(d=>({kind:d.kind,id:d.id,label:d.label})):null;
  publish({phase:'ready',error:null,pending:{kind:component?'components':wheel?'wheel':'hotfix',source,version:wheel?null:data.version,files:wheel?[data.id+'.json']:Object.keys(data.files),name:component?'组件包 '+data.id+' '+data.version:wheel?data.name:'算法 '+data.version,definitions:details,executable:!wheel},message:wheel?'盘面已读取；应用后可在盘面设置中选择':component?'组件包已读取：'+details.map(d=>d.kind+' / '+d.label).join('、')+'。包内含可执行代码，应用后才安装并刷新。':'算法包已读取；应用后会刷新叠加层。算法包包含可执行代码，仅应用你信任的来源。'});
 }

 async function inspectLocal(file){return run(async()=>{pending=null;publish({pending:null,error:null});if(typeof file!=='string'||!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.json')throw Error('请选择本地 JSON 文件');plain(file);const stat=fs.statSync(file);if(!stat.isFile()||stat.size>JSON_LIMIT)throw Error('本地包必须为不超过 12 MiB 的 JSON 文件');const data=parse(fs.readFileSync(file));if(data.kind==='simracingoverlay-components')setPending(componentHost.inspectPackage(data),'local');else if(data.kind==='simracingoverlay-hotfix')setPending(checkedHotfix(data,base),'local');else setPending(validateWheel(data),'local');});}
 async function applyPending(){return run(async()=>{
  const selected=pending;if(!selected)throw Error('请先下载热更新或导入本地包');publish({phase:'applying',error:null,message:'正在保存编辑并应用…'});
  if(await beforeApply()!==true)throw Error('当前编辑尚未保存；完成编辑后重试');if(disposed)return;
  if(selected.staged)channel.verifyHotfix(selected.staged);
  const {data,source}=selected;let componentPrevious=null,componentActivation=null;
  if(data.kind==='simracingoverlay-components'){
   componentPrevious=componentHost.current(dataRoot);componentActivation=componentHost.stageActivate(data,{root:dataRoot,source});
  }else if(data.kind!=='simracingoverlay-hotfix'){
   const store=createStore({root:dataRoot,catalog:[],validate:validateWheel,request});store.importLocal(data,source);
  }else{
   // Every generation contains every algorithm. A partial pack inherits the current
   // generation, and never exposes a mix of generations to one renderer/worker pair.
   const previous=source==='local'?readActive(dataRoot,base):null,all={};
   for(const name of ALGORITHMS){const file=plain(previous?path.join(directory,previous.generation,name):path.join(root,name));all[name]=Object.hasOwn(data.files,name)?data.files[name]:fs.readFileSync(file,'utf8');}
   const generation=digest(Buffer.from(JSON.stringify(all))),folder=plain(path.join(directory,generation));fs.mkdirSync(folder,{recursive:true});
   for(const [name,code]of Object.entries(all)){const file=plain(path.join(folder,name));if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==code)throw Error('现有模块代际内容发生变化，请重新导入');}else fs.writeFileSync(file,code,{flag:'wx'});}
   atomic(path.join(directory,'active.json'),JSON.stringify({schema:source==='official'?2:1,baseVersion:base,version:data.version,source,generation,files:Object.keys(data.files)},null,2)+'\n');
  }
  pending=null;publish({phase:'ready',pending:null,message:'模块已安装，正在刷新叠加层…'});
  try{await applyModules(componentActivation?.revision);publish({phase:'idle',result:componentActivation?'components-applied':data.kind==='simracingoverlay-hotfix'?'algorithms-applied':'wheel-applied',available:state.release?compare(state.release.version,snapshot().officialVersion)>0:false,message:componentActivation?'组件包已应用，可在组件设置中选择新增定义。':data.kind==='simracingoverlay-hotfix'?'算法模块已应用。':'盘面已应用，可在盘面设置中选择。',error:null});}catch(error){
   if(componentActivation){
    try{componentHost.restoreSnapshot(dataRoot,componentPrevious,componentActivation.revision);await applyModules(componentPrevious.revision);}catch(restoreError){throw Error('组件包未通过运行加载：'+error.message+'；恢复原组合未完成：'+restoreError.message);}
    throw Error('组件包未通过运行加载，已恢复原组合：'+error.message);
   }
   throw Error('模块已安装，刷新未完成：'+error.message+'。请重新打开叠加层。');
  }
 });}
 async function clearModules(){return run(async()=>{publish({phase:'applying',error:null});if(await beforeApply()!==true)throw Error('当前编辑尚未保存；完成编辑后重试');if(disposed)return;const baseline=componentHost.restoreBaseline(dataRoot);const file=plain(path.join(directory,'active.json'));if(fs.existsSync(file))fs.unlinkSync(file);await applyModules(baseline.revision);publish({phase:'idle',result:'defaults-restored',message:'已恢复默认算法与组件，本地包文件保留。',error:null,available:state.release?compare(state.release.version,base)>0:false});});}
 async function install(){return run(async()=>{
  if(!setup)throw Error('请先下载完整更新');if(await beforeApply()!==true)throw Error('当前编辑尚未保存；完成编辑后重试');if(disposed)return;
  const file=await channel.verifySetup(setup);
  if(disposed)return;
  const attempt={attemptId:crypto.randomBytes(16).toString('hex'),version:setup.version};installAttempt=attempt;
  const initial={schema:1,...attempt,phase:'preparing',message:'正在准备更新；完成后将自动重启。',updatedAt:new Date().toISOString()};
  publish({phase:'installing',installation:installState(initial),message:initial.message,error:null});
  try{
   fs.mkdirSync(path.dirname(receiptFile),{recursive:true});
   stopWatchingInstall=watchFiles(path.dirname(receiptFile),[path.basename(receiptFile)],()=>readInstallProgress(attempt),error=>publish({message:error.message}));
   await installSetup(file,attempt,(code)=>{
    if(disposed||installAttempt!==attempt)return;
    readInstallProgress(attempt);
    if(installAttempt===attempt&&code!==0){stopInstallWatch();installAttempt=null;const failed={...initial,phase:'error',message:code===2?'另一个更新任务正在进行，请等待应用重新启动。':'更新进程已退出，退出码 '+code+'。请重试更新。'};const receipt=readReceipt();if(!receipt||receipt.attemptId===attempt.attemptId||['completed','error'].includes(receipt.phase))atomic(receiptFile,JSON.stringify(failed,null,2)+'\n');publish({phase:'error',installation:installState(failed),message:failed.message,error:failed.message});}
   });
   if(disposed||installAttempt!==attempt)return;
   readInstallProgress(attempt);
  }catch(error){stopInstallWatch();installAttempt=null;const failed={...initial,phase:'error',message:error.message};const receipt=readReceipt();if(!receipt||receipt.attemptId===attempt.attemptId||['completed','error'].includes(receipt.phase))atomic(receiptFile,JSON.stringify(failed,null,2)+'\n');throw error;}
 });}

 return {snapshot,check,download,inspectLocal,applyPending,clearModules,install,dispose(){disposed=true;stopInstallWatch();installAttempt=null;}};
}
module.exports={createUpdateService,ALGORITHMS,checkedHotfix,compare};
