'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../overlay.js'),'utf8');
function fixture(withEvents=true){
 let now=0,id=0,gSamples=0;const timers=new Map(),events=[],requests=[],jobs=[];
 const ctx=new Proxy({}, {get:()=>()=>{},set:()=>true});
 const sandbox={document:{addEventListener(){},getElementById:()=>({getContext:()=>ctx})},Image:class{},URLSearchParams,location:{search:''},window:{addEventListener(){}},performance:{now:()=>now},AbortController,
  OverlayLayout:{begin(){},group(){},flush(){},capture(){return [];}},DrivingAssist:{Model:class {update(){return {fresh:false};}}},
  TelemetryProcessor:{Client:class {run(state,at,context){return new Promise(resolve=>jobs.push({state,at,context,resolve}));}status(){return {mode:'worker',session:1};}dispose(){}}},
  GBall:{Model:class {update(){gSamples++;return null;}age(){return null;}}},
  setTimeout(fn,delay){timers.set(++id,{fn,delay});return id;},clearTimeout(key){timers.delete(key);},requestAnimationFrame(){},
  TelemetryClock:require('../telemetry-clock'),fetch(url,options){return new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));},console};
 if(withEvents)sandbox.EventSource=class {constructor(url){this.url=url;events.push(this);}close(){this.closed=true;}emit(packet,extra={}){this.onmessage({data:JSON.stringify({connected:true,transport:{epoch:'fixture',publishedMs:now+1000},game:{packet},...extra})});}};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);vm.runInContext("transportClock.observe('fixture',999,0,0)",sandbox);
 return {sandbox,timers,events,requests,jobs,setNow:n=>now=n,gSamples:()=>gSamples,diag:sandbox.window.overlayDiagnostics,run:s=>vm.runInContext(s,sandbox),stream:()=>events.filter(x=>x.url==='/events').at(-1)};
}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const response=(packet,at=0)=>({ok:true,json:async()=>({connected:true,transport:{epoch:'fixture',publishedMs:at+1000},game:{packet}})});
const finish=job=>job.resolve({ok:true,view:{fresh:true,packet:job.state.game.packet,processedAt:job.at},costMs:.1,mode:'worker'});
const reconnect=f=>[...f.timers.values()].filter(t=>t.fn.name==='openStream').at(-1).fn();
(async()=>{
 const f=fixture();assert.equal(f.events.length,2);assert.equal(f.requests.length,1);
 const first=f.stream();first.emit(10,{throttle:10});first.emit(11,{throttle:20});first.emit(12,{throttle:30});
 assert.equal(f.jobs.length,1);assert.equal(f.diag.getPerformance().coalescedFrames,1);
 assert.equal(f.diag.getState().throttle,30,'raw input is current while the first model job is still pending');assert.equal(f.gSamples(),3);
 f.requests[0].resolve(response(1));await tick();assert.equal(f.jobs.length,1);
 finish(f.jobs[0]);await tick();assert.equal(f.diag.getState().game.packet,12,'model completion never rewrites the raw snapshot');assert.equal(f.jobs[1].state.game.packet,12);
 finish(f.jobs[1]);await tick();assert.equal(f.diag.getAssist().packet,12);assert.equal(f.gSamples(),3,'derived results never sample G-force twice');
 first.onerror();assert(first.closed);first.emit(999);assert.equal(f.jobs.length,2);
 f.setNow(1000);f.run('poll()');reconnect(f);const second=f.stream();second.emit(20);
 f.requests[1].resolve(response(13));await tick();finish(f.jobs[2]);await tick();assert.equal(f.diag.getState().game.packet,20);
 f.setNow(2601);f.run('poll()');assert(second.closed);f.requests[2].resolve(response(30,2601));await tick();finish(f.jobs[3]);await tick();assert.equal(f.diag.getState().game.packet,30);
 reconnect(f);const invalid=f.stream();invalid.onmessage({data:'[]'});assert(invalid.closed);
 const oldServer=fixture(false);const timeout=[...oldServer.timers.values()].find(t=>t.delay===1500);timeout.fn();assert(oldServer.requests[0].options.signal.aborted);
 oldServer.requests[0].reject(Error('aborted'));await tick();assert.equal(oldServer.diag.getState().connected,false);
 // HTTP was already computing when SSE took ownership: guard the RESULT too.
 const epochs=fixture();epochs.requests[0].resolve(response(1));await tick();assert.equal(epochs.jobs.length,1);
 epochs.stream().emit(2);finish(epochs.jobs[0]);await tick();assert.equal(epochs.diag.getState().game.packet,2);assert.equal(epochs.diag.getAssist().fresh,false);
 finish(epochs.jobs[1]);await tick();assert.equal(epochs.diag.getAssist().packet,2);assert.equal(epochs.diag.getPerformance().discardedResults,1);
 // New car and stale completion cannot bring back the old car's cues or age.
 const context=fixture();context.stream().emit(1,{game:{packet:1,carModel:'A'}});context.stream().emit(2,{game:{packet:2,carModel:'B'}});
 finish(context.jobs[0]);await tick();assert.equal(context.diag.getAssist().fresh,false);finish(context.jobs[1]);await tick();assert.equal(context.diag.getAssist().packet,2);
 const lifecycle=fixture();lifecycle.stream().emit(1,{game:{packet:1,carModel:'A',paused:false}});lifecycle.stream().emit(2,{game:{packet:2,carModel:'A',paused:true}});lifecycle.stream().emit(3,{game:{packet:3,carModel:'A',paused:false}});
 finish(lifecycle.jobs[0]);await tick();assert.equal(lifecycle.jobs[1].state.game.packet,3);assert(lifecycle.jobs[1].context>lifecycle.jobs[0].context,'coalescing a pause frame preserves the lifecycle transition');
 const identity=fixture();identity.stream().emit(1,{game:{packet:1,carModel:'same',vehicleIdentity:{id:'A'}}});identity.stream().emit(2,{game:{packet:2,carModel:'same',vehicleIdentity:{id:'B'}}});finish(identity.jobs[0]);await tick();assert(identity.jobs[1].context>identity.jobs[0].context);
 const stale=fixture();stale.stream().emit(1);stale.setNow(500);finish(stale.jobs[0]);await tick();assert.equal(stale.diag.getAssist().fresh,false);assert.equal(stale.run('lastInputAt'),0);
 // Calculation failure leaves the valid data transport and raw inputs alive.
 const failed=fixture();const healthyStream=failed.stream();healthyStream.emit(1,{brake:70});failed.jobs[0].resolve({ok:false,error:{code:'model-error',message:'fixture failure'},mode:'worker'});await tick();
 assert(!healthyStream.closed);assert.equal(failed.diag.getState().brake,70);assert.equal(failed.diag.getPerformance().errors,0);assert.equal(failed.diag.getPerformance().processingErrors,1);
 healthyStream.emit(2);finish(failed.jobs[1]);await tick();assert.equal(failed.diag.getAssist().packet,2);
 // Both native routes share capture identity; duplicates cannot extend life.
 const h=fixture();h.run("observeHardware({epoch:'A',sequence:1,ageMs:10,validForMs:100},{steering:{state:'valid',value:20,ageMs:10}},0)");
 assert.equal(h.run('steeringAt(80)'),20);h.run("observeHardware({epoch:'A',sequence:1,ageMs:0,validForMs:100},{steering:{state:'valid',value:99,ageMs:0}},80)");assert.equal(h.run('steeringAt(91)'),0);assert.equal(h.run('steeringValue(91)'),null,'neutral drawing pose is not a valid zero reading');
 h.run("observeSteering({game:{available:true},gameSteeringAngle:45,hardware:{epoch:'A',sequence:0,ageMs:0,validForMs:100,channels:{steering:{state:'valid',value:99}}}},90)");assert.equal(h.run('steeringAt(91)'),45);
 h.run("observeHardware({epoch:'B',sequence:1,ageMs:0,validForMs:100},{steering:{state:'valid',value:30,ageMs:0}},100);observeHardware({epoch:'A',sequence:99,ageMs:0,validForMs:100},{steering:{state:'valid',value:99,ageMs:0}},110)");assert.equal(h.run('steeringAt(120)'),30);
 const status=fixture();status.stream().emit(1,{hardware:{epoch:'C',sequence:1,ageMs:5,validForMs:100,channels:{steering:{state:'valid',deviceId:'wheel',value:0,ageMs:5}}},devices:[{id:'wheel',ageMs:5,buttons:[17]}]});
 status.setNow(20);assert.equal(status.diag.getHardwareStatus().hardware.channels.steering.ageMs,25);assert.equal(status.diag.getHardwareStatus().devices.length,1);assert.deepEqual(Array.from(status.run('displayInputs(state,performance.now()).buttons')),[17]);
 status.setNow(80);status.stream().emit(2,{hardware:{epoch:'C',sequence:1,ageMs:0,validForMs:100,channels:{steering:{state:'valid',value:99,ageMs:0}}},devices:[{id:'wheel',ageMs:0}]});
 status.setNow(100);assert.equal(status.diag.getHardwareStatus().devices.length,0,'duplicate capture cannot refresh the tray summary');assert.equal(status.diag.getHardwareStatus().hardware.channels.steering.state,'stale');status.run("observeHardware({epoch:'C',sequence:2,validForMs:100},{steering:{state:'valid',value:10,ageMs:0}},100)");assert.deepEqual(Array.from(status.run('displayInputs(state,performance.now()).buttons')),[],'fresh fast angle cannot renew old button data');
 // Queue delay precedes the callback. Increasing sequences cannot make it fresh.
 const delayed=fixture();delayed.setNow(250);
 delayed.stream().emit(1,{transport:{epoch:'fixture',publishedMs:1100},hardware:{epoch:'fixture',sequence:1,validForMs:100,ageMs:3,channels:{steering:{state:'valid',deviceId:'wheel',value:90,ageMs:3}}},devices:[{id:'wheel',ageMs:3,buttons:[17]}]});
 assert.equal(delayed.jobs[0].at,100,'model uses projected publication time, not the delayed callback');
 assert.equal(delayed.run('steeringValue(performance.now())'),null);assert.equal(delayed.diag.getHardwareStatus().devices.length,0);
 const fast=delayed.events.find(e=>e.url==='/steering-events');
 fast.onmessage({data:JSON.stringify({transport:{epoch:'fixture',publishedMs:1110},epoch:'fixture',sequence:2,validForMs:100,ageMs:0,state:'valid',angle:100})});
 assert.equal(delayed.run('steeringValue(performance.now())'),null,'an old fast message cannot restart freshness');
 delayed.setNow(260);fast.onmessage({data:JSON.stringify({transport:{epoch:'fixture',publishedMs:1260},epoch:'fixture',sequence:3,validForMs:100,ageMs:0,state:'valid',angle:110})});
 assert.equal(delayed.run('steeringValue(performance.now())'),110,'current fast input remains immediate');
 delayed.setNow(550);delayed.stream().emit(2,{transport:{epoch:'fixture',publishedMs:1100}});assert.equal(delayed.jobs.length,1,'expired publication never enters the calculation queue');
 const backlog=fixture(),blocked=backlog.stream();blocked.emit(1);backlog.setNow(500);blocked.emit(2,{transport:{epoch:'fixture',publishedMs:1050}});
 assert.equal(backlog.run('streamLast'),0,'old traffic does not renew the accepted stream lifetime');backlog.run('poll()');assert(blocked.closed,'a connected but stale stream releases ownership to HTTP');
 const recalibrated=fixture();recalibrated.stream().emit(1,{hardware:{epoch:'fixture',sequence:1,validForMs:100,channels:{steering:{state:'valid',value:33,ageMs:0}}}});
 recalibrated.setNow(100);recalibrated.run("acceptClock({headers:{get:key=>key==='X-Overlay-Clock-Epoch'?'new-process':'1099'}},100,100)");
 assert.equal(recalibrated.run('steeringValue(performance.now())'),null,'a clock session change immediately invalidates old timed inputs');
 finish(recalibrated.jobs[0]);await tick();assert.equal(recalibrated.diag.getAssist().fresh,false,'a pre-calibration worker result cannot commit before another frame arrives');
 const recovered=fixture();recovered.stream().emit(1);recovered.run("resetTransportClock();requestClock('fixture',performance.now())");
 const beforeRecovery=recovered.requests.at(-1);recovered.run("resetTransportClock();requestClock('fixture',performance.now())");const afterRecovery=recovered.requests.at(-1);
 assert(beforeRecovery.options.signal.aborted);const headers={get:key=>key==='X-Overlay-Clock-Epoch'?'fixture':'999'};
 beforeRecovery.resolve({ok:true,headers});await tick();assert.equal(recovered.run('transportClock.anchor'),null,'pre-recovery clock response cannot restore the anchor');
 assert.equal(recovered.run('clockRequest!==null'),true,'old finally does not release newer request');assert.equal(recovered.run('clockRetryAt'),0);
 afterRecovery.resolve({ok:true,headers});await tick();assert(recovered.run('transportClock.anchor!==null'),'same process epoch can reanchor after recovery');
 recovered.requests[0].resolve({...response(99),headers:{get:key=>key==='X-Overlay-Clock-Epoch'?'old-response':'20'}});await tick();assert.equal(recovered.run('transportClock.anchor.epoch'),'fixture','pre-recovery state response cannot recalibrate');
 finish(recovered.jobs[0]);await tick();assert.equal(recovered.diag.getAssist().fresh,false);
 console.log('PASS: raw input/G-force ownership, bounded model queue, feed/context/staleness result guards, separate failure domains, capture plus transport age, HTTP/SSE fallback and reconnect.');
})().catch(error=>{console.error(error);process.exitCode=1;});
