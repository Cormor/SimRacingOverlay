const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../overlay.js'),'utf8');
function fixture(withEvents=true){
 let now=0,id=0;const timers=new Map(),events=[],requests=[],jobs=[];
 const ctx=new Proxy({}, {get:()=>()=>{},set:()=>true});
 const sandbox={document:{addEventListener(){},getElementById:()=>({getContext:()=>ctx})},Image:class{},URLSearchParams,location:{search:''},window:{addEventListener(){}},performance:{now:()=>now},AbortController,
  OverlayLayout:{begin(){},group(){},flush(){},capture(){return [];}},DrivingAssist:{Model:class {update(){return {fresh:false};}}},TelemetryProcessor:{Client:class {run(state,at){return new Promise(resolve=>jobs.push({state,at,resolve}));}}},
  setTimeout(fn,delay){timers.set(++id,{fn,delay});return id;},clearTimeout(key){timers.delete(key);},requestAnimationFrame(){},
  fetch(url,options){return new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));},console};
 if(withEvents)sandbox.EventSource=class {constructor(url){this.url=url;events.push(this);}close(){this.closed=true;}emit(packet){this.onmessage({data:JSON.stringify({connected:true,game:{packet}})});}};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
 return {sandbox,timers,events,requests,jobs,setNow:n=>now=n,diag:sandbox.window.overlayDiagnostics};
}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const response=packet=>({ok:true,json:async()=>({connected:true,game:{packet}})});
const finish=job=>job.resolve({view:{fresh:true,packet:job.state.game.packet,processedAt:job.at},costMs:.1,mode:'worker'});
(async()=>{
 const f=fixture();assert.equal(f.events.length,1);assert.equal(f.requests.length,1,'HTTP is available during stream startup');
 const first=f.events[0];first.emit(10);first.emit(11);first.emit(12);
 assert.equal(f.jobs.length,1,'slow processing has one active frame');assert.equal(f.diag.getPerformance().coalescedFrames,1,'only the latest pending frame survives');
 f.requests[0].resolve(response(1));await tick();assert.equal(f.jobs.length,1,'late startup HTTP cannot overwrite live events');
 finish(f.jobs[0]);await tick();assert.equal(f.jobs[1].state.game.packet,12);finish(f.jobs[1]);await tick();assert.equal(f.diag.getState().game.packet,12);
 first.onerror();assert(first.closed);assert.equal(f.diag.getPerformance().transport,'http');first.emit(999);assert.equal(f.jobs.length,2,'closed source cannot deliver');
 f.setNow(1000);vm.runInContext('poll()',f.sandbox);assert.equal(f.requests.length,2);
 const reconnect=[...f.timers.values()].find(t=>t.fn.name==='openStream');reconnect.fn();const second=f.events[1];second.emit(20);
 f.requests[1].resolve(response(13));await tick();finish(f.jobs[2]);await tick();assert.equal(f.diag.getState().game.packet,20,'in-flight fallback cannot overwrite recovered streaming');
 assert.equal(f.jobs.length,3);f.setNow(2601);vm.runInContext('poll()',f.sandbox);assert(second.closed,'silent stream expires');
 f.requests[2].resolve(response(30));await tick();finish(f.jobs[3]);await tick();assert.equal(f.diag.getState().game.packet,30,'silent-stream fallback consumes HTTP');
 const latestReconnect=[...f.timers.values()].filter(t=>t.fn.name==='openStream').at(-1);latestReconnect.fn();const invalid=f.events.at(-1);invalid.onmessage({data:'[]'});assert(invalid.closed,'malformed snapshot returns to fallback');
 const oldServer=fixture(false);assert.equal(oldServer.events.length,0);const timeout=[...oldServer.timers.values()].find(t=>t.delay===1500);timeout.fn();assert(oldServer.requests[0].options.signal.aborted,'hung fallback requests have a deadline');
 oldServer.requests[0].reject(Error('aborted'));await tick();assert.equal(oldServer.diag.getState().connected,false);
 console.log('PASS: stream startup/HTTP fallback; bounded processing/coalescing; stale reply exclusion; disconnect/reconnect; silent/malformed streams; missing EventSource and HTTP timeout.');
})().catch(error=>{console.error(error);process.exitCode=1;});
