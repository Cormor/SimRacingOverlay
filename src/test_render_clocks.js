'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),base=path.dirname(root);
const repositories=['SimRacingOverlay',...(process.env.OVERLAY_TEST_PAIRED==='1'&&fs.existsSync(path.join(base,'moza_obs_overlay','overlay.js'))?['moza_obs_overlay']:[])];
function fixture(repo){
 let now=0,nextId=0,models=0,gSamples=0,displayEvents=0;
 const timers=new Map(),frames=new Map();
 const ctx=new Proxy({}, {get(o,k){if(k in o)return o[k];if(k==='getTransform')return ()=>({a:1,b:0,c:0,d:1});if(k==='createLinearGradient'||k==='createRadialGradient')return ()=>({addColorStop(){}});return ()=>{};},set(o,k,v){o[k]=v;return true;}});
 const canvas={width:1000,height:850,getContext:()=>ctx};
 const scope={addEventListener(){},Event:class{constructor(type){this.type=type;}},dispatchEvent(event){if(event.type==='overlay-frame')displayEvents++;},URLSearchParams,location:{search:''},Image:class{constructor(){this.complete=true;this.naturalWidth=1315;this.naturalHeight=1197;}},document:{addEventListener(){},getElementById:()=>canvas,createElement:()=>({width:0,height:0,getContext:()=>ctx})},window:{innerWidth:1000,innerHeight:850,devicePixelRatio:1},performance:{now:()=>now},Date:class extends Date{static now(){return 100000+now;}},AbortController,console,
  DrivingAssist:{Model:class{update(s,at){models++;return {fresh:false,processedAt:at,unloaded:[false,false,false,false]};}}},
  GBall:{Model:class{update(){gSamples++;return null;}age(){return null;}}},
  setTimeout(fn,delay){timers.set(++nextId,{fn,at:now+delay});return nextId;},clearTimeout(id){timers.delete(id);},
  requestAnimationFrame(fn){frames.set(++nextId,fn);return nextId;},fetch(){return new Promise(()=>{});}};
 scope.window=scope;scope.innerWidth=1000;scope.innerHeight=850;scope.devicePixelRatio=1;scope.globalThis=scope;vm.createContext(scope);
 for(const file of ['ui-theme.js','dashboard.js','layout.js','component-paint.js',...(repo==='SimRacingOverlay'?['telemetry-clock.js']:[]),'overlay.js'])vm.runInContext(fs.readFileSync(path.join(repo==='SimRacingOverlay'?root:path.join(base,repo),file),'utf8'),scope);
 const run=code=>vm.runInContext(code,scope);
 return {scope,run,timers,frames,setNow:t=>{now=t;},async input(packet,angle=0){scope.incoming={connected:true,angle,brake:0,throttle:0,hardware:{epoch:'fixture',sequence:packet,validForMs:100,ageMs:0,channels:{steering:{state:'valid',value:angle,ageMs:0},brake:{state:'valid',value:0,ageMs:0},throttle:{state:'valid',value:0,ageMs:0}}},buttons:[],leds:{available:true,buttons:Array(20).fill('#000000'),knobs:Array(4).fill('#000000')},game:{available:true,packet,source:'fixture',wheels:[],statuses:{absActive:false}}};await run(repo==='SimRacingOverlay'?'consume(incoming,performance.now())':'acceptState(incoming,performance.now())');},paint(){const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn(now);},tick(){for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}},counts:()=>({models,gSamples,displayEvents,...scope.window.overlayDiagnostics.getPerformance()})};
}
(async()=>{
 const results=[];
 for(const repo of repositories){
  for(const hz of [30,60,144,240]){
   const f=fixture(repo);let input=0;
   for(let t=0;t<1000-1e-6;t+=1000/hz){f.setNow(t);while(input<60&&input*1000/60<=t+1e-6){await f.input(++input,input); }f.paint();}
   while(input<60){f.setNow(input*1000/60);await f.input(++input,input);}f.paint();
   const counts=f.counts();if(repo==='SimRacingOverlay')assert(counts.renders<=Math.min(61,hz+1),'the display uses the latest measured angle without inventing intermediate motion');assert.equal(counts.models,60);assert.equal(counts.gSamples,60);
   assert.equal(counts.prepares,repo==='SimRacingOverlay'?121:61,'raw input and assist completion prepare independently of display Hz');
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
  if(repo==='SimRacingOverlay'){
   f.setNow(3000);
   const observed=(sequence,value,at)=>f.run('observeHardware('+JSON.stringify({epoch:'fixture',sequence,validForMs:100})+','+JSON.stringify({steering:{state:'valid',value,ageMs:0}})+','+at+')');
   observed(1000,0,3000);observed(1001,90,3020);assert.equal(f.run('steeringAt(3030)'),90,'the newest measured angle is shown immediately');
   observed(1002,-90,3030);assert.equal(f.run('steeringAt(3035)'),-90,'reversal has no visual filter or overshoot');
   observed(1003,20,3200);assert.equal(f.run('steeringAt(3200)'),20);assert.equal(f.run('steeringAt(3301)'),0,'expired hardware does not return through an older full snapshot');
   f.setNow(3301);
  }else{
   assert.equal(f.run('visualSteering.at=null;observeSteering({connected:true,angle:0},3000);observeSteering({connected:true,angle:90},3020);steeringAt(3030)'),45);
   const reverse=f.run('observeSteering({connected:true,angle:-90},3030);steeringAt(3035)');assert(reverse>=-90&&reverse<=45);
   assert.equal(f.run('observeSteering({connected:true,angle:20},3200);steeringAt(3200)'),20);
  }
  if(repo==='SimRacingOverlay'){
   const layer=f.scope.overlayDiagnostics.getWheelFace(),models=f.counts().models,prepares=f.counts().prepares,events=f.counts().displayEvents,frameId=f.scope.overlayDiagnostics.getDisplay().frameId;
   f.setNow(3400);f.run("observeHardware({epoch:'fixture',sequence:1100,validForMs:100},{steering:{state:'valid',value:63,ageMs:0}},3400)");f.paint();
   assert.equal(f.scope.overlayDiagnostics.getDisplay().angle,63);assert.equal(f.scope.overlayDiagnostics.getDisplay().pose,63);
   assert.equal(f.scope.overlayDiagnostics.getDisplay().frameId,frameId+1);assert.equal(f.counts().displayEvents,events+1,'actual HUD submission emits one frame event');f.paint();assert.equal(f.counts().displayEvents,events+1,'unchanged frames emit no event');
   assert.equal(f.run('window.DashRenderer.getPerformance().builds'),layer.dashboard.builds+1,'fast angle updates only the small dashboard');
   assert.equal(f.scope.overlayDiagnostics.getWheelFace().photo.builds,layer.photo.builds,'fast angle reuses the static photo layer');
   assert.equal(f.scope.overlayDiagnostics.getWheelFace().lights.builds,layer.lights.builds,'fast angle reuses the light layer');
   assert.equal(f.counts().models,models);assert.equal(f.counts().prepares,prepares,'fast display neither advances the algorithm nor prepares a new scene');
   f.setNow(3501);f.paint();assert.equal(f.scope.overlayDiagnostics.getDisplay().angle,null);assert.equal(f.scope.overlayDiagnostics.getDisplay().pose,0);
   f.setNow(3502);f.run("observeHardware({epoch:'fixture',sequence:1101,validForMs:100},{steering:{state:'valid',value:0,ageMs:0}},3502)");f.paint();
   assert.equal(f.scope.overlayDiagnostics.getDisplay().angle,0,'valid zero repaints after an unknown neutral pose');
  }
  assert.equal(JSON.stringify(f.scope.window.overlayDiagnostics.getState()),raw,'presentation never rewrites raw telemetry');

  await f.input(2);f.paint();assert.equal(f.scope.window.overlayDiagnostics.getUi().waiting,false,'new game packet recovers immediately');
  const rendered=f.counts().renders;f.run('{const l=OverlayLayout.get();l.controls.wheel.x+=20;OverlayLayout.set(l);}');f.paint();assert.equal(f.counts().renders,rendered+1,'layout change invalidates without a telemetry packet');
  if(repo==='moza_obs_overlay'){
   f.run('delete state.leds.knobs;queueScene(performance.now())');f.paint();
   const n=f.counts().renders,modelCalls=f.counts().models;
   f.setNow(1661);f.tick();f.paint();assert.equal(f.counts().renders,n+1,'ambient knobs animate even with real button lighting');assert.equal(f.counts().models,modelCalls);
  }
  const prepared=f.counts().prepares;f.run('OverlayLayout.set(OverlayLayout.get())');assert.equal(f.counts().prepares,prepared,'editor polling identical layout does not invalidate');
  // Lock decisions advance even if the display never submits another frame.
  f.setNow(4000);f.run('state={connected:true,angle:0,game:{available:true,packet:3,speedKmh:50,brake:.9,wheels:[{ratio:-1,omega:0}]}};lastInputAt=performance.now();queueScene(performance.now());');
  f.setNow(4081);f.tick();assert(f.run('lockState[0].until')>=4381,'80ms lock threshold is independent of paint');
 }
 console.log(JSON.stringify(results));
 console.log('PASS: 60 input updates produce exactly 60 model calls at 30/60/144/240 display Hz; bounded latest scene; static pixel reuse; independent timeout/lock clocks; recovery and layout invalidation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
