'use strict';
// Only the face-loading owner is exercised. Drawing, transport, profile validation
// and decoding pixels are separate existing modules; no live bridge is contacted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../overlay.js'),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture(){
 let value={wheel:{faceId:'default'}},nextTimer=0,stopCalls=0,resourceCallback;
 const listeners=[],events=new Map(),requests=[],decodes=new Map(),timers=new Map(),publications=[];
 const ctx=new Proxy({}, {get:()=>()=>{},set:()=>true});
 const scope={console,URLSearchParams,AbortController,Event:class{constructor(type){this.type=type;}},location:{search:'?qa=1'},performance:{now:()=>0},
  document:{getElementById:()=>({getContext:()=>ctx}),addEventListener(){}},
  Image:class{constructor(){this.naturalWidth=1315;this.naturalHeight=1197;}decode(){return decodes.get(this.src)?.promise||Promise.resolve();}},
  TelemetryClock:{Clock:class{}},DrivingAssist:{Model:class{update(){return {};}}},
  OverlayLayout:{get:()=>JSON.parse(JSON.stringify(value)),set(next){if(JSON.stringify(next)!==JSON.stringify(value)){value=JSON.parse(JSON.stringify(next));for(const fn of listeners)fn();}},onChange(fn){listeners.push(fn);}},
  WheelProfiles:{validate:value=>value},desktopOverlay:{onWheelResourcesChanged(fn){resourceCallback=fn;return ()=>{stopCalls++;resourceCallback=null;};}},
  addEventListener(name,fn){(events.get(name)||events.set(name,[]).get(name)).push(fn);},
  dispatchEvent(event){publications.push({type:event.type,face:scope.WheelFaces?.get()});for(const fn of events.get(event.type)||[])fn(event);},
  fetch(url,options){const read=deferred();requests.push({url,options,...read});return read.promise;},
  setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},requestAnimationFrame(){}};
 scope.window=scope;vm.createContext(scope);vm.runInContext(source,scope);vm.runInContext('queueScene=()=>{}',scope);
 const profile=(id,name=id)=>({id,name,image:'image:'+name,controls:[],encoders:[],ledShapes:[],dashboard:null});
 return {scope,requests,decodes,timers,publications,face:()=>scope.WheelFaces.get(),layout:id=>scope.OverlayLayout.set({wheel:{faceId:id}}),resources:ids=>resourceCallback?.(ids),unload:()=>scope.dispatchEvent(new scope.Event('unload')),stopCalls:()=>stopCalls,
  response(index,id,name=id){requests[index].resolve({ok:true,text:async()=>JSON.stringify(profile(id,name))});},missing(index){requests[index].resolve({ok:false});},run:s=>vm.runInContext(s,scope)};
}
(async()=>{
 const checks=[];
 const recovery=fixture();recovery.layout('a');assert.equal(recovery.requests.length,1);recovery.missing(0);await tick();assert.equal(recovery.face().id,'default');assert(recovery.face().error);assert.equal(recovery.face().pending,null);
 recovery.scope.OverlayLayout.set({wheel:{faceId:'a'},position:1});recovery.run('syncFaceLayout()');await tick();assert.equal(recovery.requests.length,1,'same failed generation is not retried by ordinary layout/draw work');
 recovery.resources(['a']);assert.equal(recovery.requests.length,2);recovery.response(1,'a','restored');await tick();assert.equal(recovery.face().name,'restored');assert.equal(recovery.face().error,null);checks.push('failed same ID retries after resource change; ordinary layout does not retry');

 const updating=fixture(),oldDecode=deferred();updating.decodes.set('image:old',oldDecode);let settled=false;
 const selection=updating.scope.WheelFaces.select('a').then(result=>{settled=true;return result;});updating.response(0,'a','old');await tick();assert.equal(settled,false);
 updating.resources(['a']);await tick();assert.equal(updating.requests.length,2);assert.equal(settled,false,'resource replacement keeps the same selection Promise');assert.equal(updating.face().pending,'a');
 updating.response(1,'a','new');assert.equal((await selection).ok,true);assert.equal(updating.face().name,'new');assert.equal(updating.scope.OverlayLayout.get().wheel.faceId,'a');
 oldDecode.resolve();await tick();assert.equal(updating.face().name,'new');await updating.scope.WheelFaces.select('a');assert.equal(updating.face().name,'new');assert.equal(updating.requests.length,2,'old decode cannot refill the new resource cache');checks.push('resource generation changes keep selection ownership and reject old cache writes');

 updating.resources(['a']);await tick();assert.equal(updating.requests.length,3,'successful cached ID is invalidated');updating.missing(2);await tick();assert.equal(updating.face().name,'new','last usable face remains while replacement fails');assert(updating.face().error);updating.resources(['a']);updating.response(3,'a','newer');await tick();assert.equal(updating.face().name,'newer');checks.push('replacement failure preserves visible face and later resource change recovers');

 const late=fixture();const first=late.scope.WheelFaces.select('a'),second=late.scope.WheelFaces.select('b');assert.equal((await first).cancelled,true,'superseded request terminates without waiting for fetch');late.response(1,'b');assert.equal((await second).ok,true);late.missing(0);await tick();assert.equal(late.face().id,'b');assert.equal(late.face().error,null);checks.push('late selection failure cannot replace current face or error');

 const layout=fixture();layout.layout('a');layout.layout('default');await tick();layout.response(0,'a');await tick();assert.equal(layout.face().id,'default');assert.equal(layout.face().pending,null);checks.push('layout reverting to active face cancels the old asynchronous target');

 const unrelated=fixture();const pending=unrelated.scope.WheelFaces.select('a');unrelated.resources(['b']);assert.equal(unrelated.requests[0].options.signal.aborted,false);unrelated.response(0,'a');assert.equal((await pending).ok,true);checks.push('unrelated resource ID does not interrupt current selection');

 const deadline=fixture(),never=deferred();deadline.decodes.set('image:slow',never);const slow=deadline.scope.WheelFaces.select('a');deadline.response(0,'a','slow');await tick();[...deadline.timers.values()].find(x=>x.delay===10000).fn();const timeout=await slow;assert.equal(timeout.ok,false);assert.match(timeout.error,/超时/);never.resolve();await tick();assert.equal(deadline.face().id,'default');assert.equal(deadline.run("faceCache.has('a')"),false);checks.push('decode deadline settles selection and blocks a late cache write');

 const teardown=fixture();const gone=teardown.scope.WheelFaces.select('a');teardown.unload();assert.equal((await gone).cancelled,true);assert.equal(teardown.stopCalls(),1);teardown.resources(['a']);assert.equal(teardown.requests.length,1);teardown.response(0,'a');await tick();assert.equal(teardown.face().id,'default');checks.push('unload cancels selection, unsubscribes resources and rejects late work');
 console.log(JSON.stringify({checks,passed:checks.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
