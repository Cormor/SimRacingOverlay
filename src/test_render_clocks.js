'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),base=path.dirname(root);
const repositories=['SimRacingOverlay',...(fs.existsSync(path.join(base,'moza_obs_overlay','overlay.js'))?['moza_obs_overlay']:[])];
function fixture(repo){
 let now=0,nextId=0,models=0,gSamples=0;
 const timers=new Map(),frames=new Map();
 const ctx=new Proxy({}, {get(o,k){if(k in o)return o[k];if(k==='createLinearGradient'||k==='createRadialGradient')return ()=>({addColorStop(){}});return ()=>{};},set(o,k,v){o[k]=v;return true;}});
 const canvas={width:1000,height:850,getContext:()=>ctx};
 const scope={addEventListener(){},URLSearchParams,location:{search:''},Image:class{},document:{addEventListener(){},getElementById:()=>canvas},window:{innerWidth:1000,innerHeight:850,devicePixelRatio:1},performance:{now:()=>now},Date:class extends Date{static now(){return 100000+now;}},AbortController,console,
  DrivingAssist:{Model:class{update(s,at){models++;return {fresh:false,processedAt:at,unloaded:[false,false,false,false]};}}},
  GBall:{Model:class{update(){gSamples++;return null;}age(){return null;}}},
  setTimeout(fn,delay){timers.set(++nextId,{fn,at:now+delay});return nextId;},clearTimeout(id){timers.delete(id);},
  requestAnimationFrame(fn){frames.set(++nextId,fn);return nextId;},fetch(){return new Promise(()=>{});}};
 scope.window=scope;scope.innerWidth=1000;scope.innerHeight=850;scope.devicePixelRatio=1;scope.globalThis=scope;vm.createContext(scope);
 for(const file of ['layout.js','component-paint.js','overlay.js'])vm.runInContext(fs.readFileSync(path.join(repo==='SimRacingOverlay'?root:path.join(base,repo),file),'utf8'),scope);
 const run=code=>vm.runInContext(code,scope);
 return {scope,run,timers,frames,setNow:t=>{now=t;},async input(packet,angle=0){scope.incoming={connected:true,angle,brake:0,throttle:0,buttons:[],leds:{available:true,buttons:Array(20).fill('#000000'),knobs:Array(4).fill('#000000')},game:{available:true,packet,source:'fixture',wheels:[],statuses:{absActive:false}}};await run(repo==='SimRacingOverlay'?'consume(incoming,performance.now())':'acceptState(incoming,performance.now())');},paint(){const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn(now);},tick(){for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}},counts:()=>({models,gSamples,...scope.window.overlayDiagnostics.getPerformance()})};
}
(async()=>{
 const results=[];
 for(const repo of repositories){
  for(const hz of [30,60,144,240]){
   const f=fixture(repo);let input=0;
   for(let t=0;t<1000-1e-6;t+=1000/hz){f.setNow(t);while(input<60&&input*1000/60<=t+1e-6){await f.input(++input,input); }f.paint();}
   while(input<60){f.setNow(input*1000/60);await f.input(++input,input);}f.paint();
   const counts=f.counts();if(hz>=144)assert(counts.renders>=hz*.9,'intermediate steering frames follow high-refresh presentation');assert.equal(counts.models,60);assert.equal(counts.gSamples,60);
   assert.equal(counts.prepares,61,'one startup preparation plus one per input, independent of display Hz');
   results.push({repo,hz,inputs:input,models:counts.models,prepares:counts.prepares,renders:counts.renders});
  }
  const f=fixture(repo);await f.input(1);f.paint();
  f.setNow(20);await f.input(1);f.paint();
  const staticPaints=f.scope.window.overlayDiagnostics.getPaint().composites;
  f.setNow(60);f.tick();f.paint();
  assert.equal(f.scope.window.overlayDiagnostics.getPaint().composites,staticPaints,'unchanged visible content retains all pixels');
  const before=f.counts();
  f.setNow(1601);f.tick();f.paint();assert.equal(f.scope.window.overlayDiagnostics.getUi().waiting,true,'frozen game packet expires on its own clock');
  assert.equal(f.counts().models,before.models,'timeout handling never reprocesses telemetry');
  const raw=JSON.stringify(f.scope.window.overlayDiagnostics.getState());
  assert.equal(f.run('visualSteering.at=null;observeSteering({connected:true,angle:0},3000);observeSteering({connected:true,angle:90},3020);steeringAt(3030)'),45,'intermediate display angle is interpolated without a new input');
  const reverse=f.run('observeSteering({connected:true,angle:-90},3030);steeringAt(3035)');assert(reverse>=-90&&reverse<=45,'reversal never overshoots');
  assert.equal(f.run('observeSteering({connected:true,angle:20},3200);steeringAt(3200)'),20,'long sampling gaps snap to fresh input');
  assert.equal(JSON.stringify(f.scope.window.overlayDiagnostics.getState()),raw,'display interpolation never rewrites raw telemetry');

  await f.input(2);f.paint();assert.equal(f.scope.window.overlayDiagnostics.getUi().waiting,false,'new game packet recovers immediately');
  const rendered=f.counts().renders;f.run('{const l=OverlayLayout.get();l.controls.wheel.x+=20;OverlayLayout.set(l);}');f.paint();assert.equal(f.counts().renders,rendered+1,'layout change invalidates without a telemetry packet');
  if(repo==='moza_obs_overlay'){
   f.run('delete state.leds.knobs;queueScene(performance.now())');f.paint();
   const n=f.counts().renders,modelCalls=f.counts().models;
   f.setNow(1661);f.tick();f.paint();assert.equal(f.counts().renders,n+1,'ambient knobs animate even with real button lighting');assert.equal(f.counts().models,modelCalls);
  }
  const prepared=f.counts().prepares;f.run('OverlayLayout.set(OverlayLayout.get())');assert.equal(f.counts().prepares,prepared,'editor polling identical layout does not invalidate');
  // Lock decisions advance even if the display never submits another frame.
  f.setNow(2000);f.run('state={connected:true,angle:0,game:{available:true,packet:3,speedKmh:50,brake:.9,wheels:[{ratio:-1,omega:0}]}};lastGood=Date.now();queueScene(performance.now());');
  f.setNow(2081);f.tick();assert(f.run('lockState[0].until')>=2381,'80ms lock threshold is independent of paint');
 }
 console.log(JSON.stringify(results));
 console.log('PASS: 60 input updates produce exactly 60 model calls at 30/60/144/240 display Hz; bounded latest scene; static pixel reuse; independent timeout/lock clocks; recovery and layout invalidation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
