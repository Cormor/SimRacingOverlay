'use strict';
// Catalog and package inspection read declarations. New code only runs in HUD/worker.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),vm=require('vm');
const Runtime=require('./component-runtime'),Builtins=require('./component-builtins'),PedalTraction=require('./pedal-traction');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const safeId=/^[a-z][a-z0-9.-]{0,79}$/,safeFile=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}\.js$/;
function plain(file){let current=path.resolve(file);for(;;){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('组件路径不能通过链接：'+current);const parent=path.dirname(current);if(parent===current)break;current=parent;}return file;}
function atomic(file,value){plain(file);fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
function inspectPackage(input){
 if(!input||input.schema!==1||input.kind!=='simracingoverlay-components'||input.apiVersion!==1||!safeId.test(input.id)||!/^\d+\.\d+\.\d+$/.test(input.version))throw Error('组件包身份或API版本无效');
 if(!input.files||typeof input.files!=='object'||Array.isArray(input.files)||!Array.isArray(input.entries)||!input.entries.length||input.entries.length>32||!Array.isArray(input.definitions)||!input.definitions.length)throw Error('组件包缺少入口或定义清单');
 const files=Object.keys(input.files);if(files.length>32||files.length!==input.entries.length||new Set(input.entries).size!==files.length||input.entries.some(n=>!Object.hasOwn(input.files,n)))throw Error('组件入口与文件必须一一对应');
 for(const name of files){const code=input.files[name];if(!safeFile.test(name)||typeof code!=='string'||Buffer.byteLength(code)>2*1024*1024)throw Error('组件脚本名称或大小无效');new vm.Script(code,{filename:name});}
 if(Buffer.byteLength(JSON.stringify(input))>12*1024*1024)throw Error('组件包超过12MiB');
 const seen=new Set();
 for(const d of input.definitions){if(!d||!['component','algorithm','presentation','animation','theme'].includes(d.kind)||!safeId.test(d.id)||typeof d.label!=='string'||typeof d.contract!=='string'||typeof d.version!=='string'||!Array.isArray(d.requires)||!Array.isArray(d.provides)||[...d.requires,...d.provides].some(x=>typeof x!=='string'))throw Error('组件定义清单无效');const key=d.kind+':'+d.id;if(seen.has(key))throw Error('组件定义清单重复');seen.add(key);}
 return JSON.parse(JSON.stringify(input));
}
function readSnapshot(root){
 const file=plain(path.join(root,'assets/components/active.json'));
 if(!fs.existsSync(file))return {schema:1,apiVersion:1,revision:'builtin',generation:'',packages:[],selection:{}};
 const value=JSON.parse(fs.readFileSync(file,'utf8'));
 if(value.schema!==1||value.apiVersion!==1||!/^([a-f0-9]{64})?$/.test(value.generation)||typeof value.revision!=='string'||!Array.isArray(value.packages)||value.packages.some(p=>!safeId.test(p.id)||!Array.isArray(p.entries)||p.entries.some(n=>!safeFile.test(n))))throw Error('组件配置无效，请恢复内置组件');
 return value;
}
function readPackages(root,snapshot){return snapshot.packages.map(meta=>({...meta,kind:'simracingoverlay-components',schema:1,apiVersion:1,files:Object.fromEntries(meta.entries.map(n=>[n,fs.readFileSync(plain(path.join(root,'assets/components',snapshot.generation,meta.id,n)),'utf8')]))}));}
function makeRegistry(packages){
 const registry=Builtins.install(Runtime.createRegistry(),PedalTraction);
 // Catalog and compatibility are data operations. Executable entries are loaded
 // only by the HUD and worker after explicit application.
 for(const pack of packages){inspectPackage(pack);for(const d of pack.definitions)registry.register(d.kind,{...d,
  ...(['algorithm','animation'].includes(d.kind)?{create:()=>{throw Error('目录不执行组件代码');}}:{}),
  ...(d.kind==='presentation'?{draw:()=>{throw Error('目录不绘制组件');}}:{})
 });}
 return registry;
}
function current(root){return readSnapshot(root);}
function stageActivate(input,{root,source='local'}={}){
 const pack=inspectPackage(input),previous=readSnapshot(root),packages=readPackages(root,previous).filter(p=>p.id!==pack.id);packages.push(pack);
 const registry=makeRegistry(packages),selection=registry.validateSelection(previous.selection);if(!selection.ok)throw Error(selection.error+'；请先切换兼容组合');
 const generation=hash(JSON.stringify(packages)),directory=plain(path.join(root,'assets/components',generation));
 for(const item of packages)for(const name of item.entries){const file=plain(path.join(directory,item.id,name));fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==item.files[name])throw Error('组件代际内容发生变化');}else fs.writeFileSync(file,item.files[name],{flag:'wx'});}
 const next={schema:1,apiVersion:1,revision:crypto.randomBytes(16).toString('hex'),generation,selection:selection.selection,packages:packages.map(({files,...meta})=>({...meta,source:meta.id===pack.id?source:meta.source||'local'}))};
 atomic(path.join(root,'assets/components/active.json'),next);return next;
}
function restoreBaseline(root){const next={schema:1,apiVersion:1,revision:crypto.randomBytes(16).toString('hex'),generation:'',selection:{},packages:[]};atomic(path.join(root,'assets/components/active.json'),next);return next;}
function restoreSnapshot(root,previous,expectedRevision){if(readSnapshot(root).revision!==expectedRevision)throw Error('组件配置已变化，不能恢复旧选择');atomic(path.join(root,'assets/components/active.json'),previous);return previous;}
function createService({root,beforeApply=async()=>true,reloadHud=async()=>{}}){
 let busy=false,disposed=false;
 function catalog(){
  try{const snapshot=readSnapshot(root),registry=makeRegistry(readPackages(root,snapshot)),data=registry.catalog(snapshot.selection);
   for(const c of data.components){c.compatibility=[];for(const a of c.algorithms)for(const p of c.presentations)for(const n of c.animations)for(const t of c.themes){const choice={algorithm:a.id,presentation:p.id,animation:n.id,theme:t.id},v=registry.validateSelection({...data.selection,[c.id]:choice});c.compatibility.push({...choice,ok:v.ok,reason:v.error||null});}}
   return {...data,revision:snapshot.revision,packages:snapshot.packages.map(({id,version,source})=>({id,version,source})),error:data.error};
  }catch(error){const data=Builtins.install(Runtime.createRegistry(),PedalTraction).catalog();return {...data,revision:null,error:error.message,packages:[]};}
 }
 async function apply(request){
  if(disposed)return {ok:false,error:'组件服务已退出'};if(busy)return {ok:false,error:'另一项组件更改正在应用'};busy=true;
  try{const snapshot=readSnapshot(root);if(!request||request.revision!==snapshot.revision)throw Error('组件选择已变化，请重新载入后应用');const registry=makeRegistry(readPackages(root,snapshot)),v=registry.validateSelection(request.selection);if(!v.ok)throw Error(v.error);
   if(await beforeApply()!==true)throw Error('请先完成并保存当前编辑');if(disposed)throw Error('组件服务已退出');
   const latest=readSnapshot(root);if(latest.revision!==snapshot.revision)throw Error('组件配置已变化，请重新载入后应用');
   const next={...snapshot,selection:v.selection,revision:crypto.randomBytes(16).toString('hex')};
   atomic(path.join(root,'assets/components/active.json'),next);
   try{await reloadHud(next.revision);}catch(error){
    if(readSnapshot(root).revision!==next.revision)throw Error('组件未能载入；配置已由其它操作更新，已保留更新后的配置：'+error.message);
    atomic(path.join(root,'assets/components/active.json'),snapshot);await reloadHud(snapshot.revision);
    throw Error('组件未能载入，已恢复原组合：'+error.message);
   }
   return {ok:true,catalog:catalog()};
  }catch(error){return {ok:false,error:error.message,catalog:catalog()};}finally{busy=false;}
 }
 return {catalog,apply,dispose(){disposed=true;}};
}
module.exports={createService,inspectPackage,stageActivate,current,restoreBaseline,restoreSnapshot};
