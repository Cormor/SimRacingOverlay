'use strict';
// One immutable selection is shared by the HUD and its worker for their lifetime.
(function(root){
 const names=['telemetry-context.js','tyre-response.js','steering-advisor.js','reserve.js','grip.js','handling.js','legacy-chassis-response.js','chassis-response.js','suspension-contact.js','realtime-response.js','feedback-research.js','pedal-traction.js','assist.js','g-ball.js'];
 const base=new URL('./',root.location.href),params=new URL(root.location.href).searchParams;
 let generation=params.get('modules'),active=null;
 if(generation===null){
  const request=new XMLHttpRequest();
  try{request.open('GET',new URL('assets/modules/active.json',base).href,false);request.send();if(request.status===200||request.status===0&&request.responseText)active=JSON.parse(request.responseText);}catch{}
  generation=active?.generation||'';
 }
 if(generation&&!/^[a-f0-9]{64}$/.test(generation))throw Error('算法模块版本标识无效');
 const resolve=name=>{
  if(!names.includes(name))throw Error('不支持替换此模块：'+name);
  return new URL(generation?'assets/modules/'+generation+'/'+name:name,base).href;
 };
 let components={schema:1,apiVersion:1,revision:'builtin',generation:'',selection:{},packages:[]},componentError=null;
 try{
  if(params.has('components'))components=JSON.parse(params.get('components'));
  else if(typeof document!=='undefined'){
   const request=new XMLHttpRequest();request.open('GET',new URL('assets/components/active.json',base).href,false);request.send();
   if(request.status===200||request.status===0&&request.responseText)components=JSON.parse(request.responseText);
  }
  if(components.schema!==1||components.apiVersion!==1||!/^([a-f0-9]{64})?$/.test(components.generation)||!Array.isArray(components.packages)||components.packages.some(p=>!/^[a-z][a-z0-9.-]{0,79}$/.test(p.id)||!Array.isArray(p.entries)||p.entries.some(n=>!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}\.js$/.test(n))))throw Error('组件配置无效');
 }catch(error){componentError=error.message;components={schema:1,apiVersion:1,revision:'builtin',generation:'',selection:{},packages:[]};}
 const entries=components.packages.flatMap(p=>p.entries.map(n=>new URL('assets/components/'+components.generation+'/'+p.id+'/'+n,base).href));
 const reportComponentError=error=>{componentError=String(error?.message||error||'组件入口载入失败');};
 if(typeof document!=='undefined')root.addEventListener('error',event=>{const url=event.filename||event.target?.src;if(url&&entries.includes(url))reportComponentError(event.message||'组件入口载入失败');},true);
 let finalized=false;
 const stable=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
 function finalizeComponents(){
  if(finalized)return;finalized=true;
  try{
   if(componentError)throw Error(componentError);
   const expected=new Map(components.packages.flatMap(p=>(p.definitions||[]).map(d=>[d.kind+':'+d.id,d])));
   const actualKeys=root.ComponentRuntime.extensionKeys();if(actualKeys.length!==expected.size||actualKeys.some(key=>!expected.has(key)))throw Error('组件注册范围与清单不一致');
   for(const [key,d]of expected){const actual=root.ComponentRuntime.get(d.kind,d.id);if(!actual||actual.contract!==d.contract||actual.version!==d.version||JSON.stringify([...actual.requires].sort())!==JSON.stringify([...d.requires].sort())||JSON.stringify([...actual.provides].sort())!==JSON.stringify([...d.provides].sort()))throw Error('组件实现与声明不一致：'+d.id);
    for(const field of ['execution','components','family','type','defaults','tokens'])if(stable(actual[field]??null)!==stable(d[field]??null))throw Error('组件兼容或样式声明不一致：'+d.id+' / '+field);
   }
   const selected=root.ComponentRuntime.validateSelection(components.selection);if(!selected.ok)throw Error(selected.error);
  }catch(error){componentError=error.message;root.ComponentRuntime=root.ComponentBuiltins.install(root.ComponentRuntime.createRegistry(),root.PedalTraction);components={...components,selection:{}};}
 }
 const api=Object.freeze({names:Object.freeze(names),generation,resolve,componentEntries:entries,finalizeComponents,reportComponentError,get componentSnapshot(){return components;},get componentError(){return componentError;},workerUrl:()=>{const u=new URL('telemetry-worker.js',base);u.searchParams.set('modules',generation);u.searchParams.set('components',JSON.stringify(components));return u.href;}});
 root.SROModules=api;
 if(typeof document!=='undefined')for(const name of names)document.write('<script src="'+resolve(name)+'"><\/script>');
 if(typeof document!=='undefined')for(const url of [new URL('component-runtime.js',base).href,new URL('component-builtins.js',base).href,...entries])document.write('<script src="'+url+'"><\/script>');
})(globalThis);
