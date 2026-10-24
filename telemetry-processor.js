'use strict';
(function(root){
 class Client {
  constructor(fallback,create=()=>new Worker('telemetry-worker.js'),eager=false){
   this.fallback=fallback;this.create=create;this.worker=null;this.pending=null;this.id=0;this.samples=0;this.meanCost=0;this.disabled=false;
   if(eager)this.activate();
  }
  activate(){
   if(this.worker||this.disabled)return;
   try{
    this.worker=this.create();
    this.worker.onmessage=({data})=>{const p=this.pending;if(!p||data.id!==p.id)return;clearTimeout(p.timer);this.pending=null;p.resolve({...data,mode:'worker'});};
    this.worker.onerror=()=>this.fail();this.worker.onmessageerror=()=>this.fail();
   }catch{this.worker=null;this.disabled=true;}
  }
  sync(state,now){const start=performance.now();return {view:this.fallback(state,now),costMs:performance.now()-start,mode:'main'};}
  fail(){
   this.worker?.terminate();this.worker=null;this.disabled=true;
   const p=this.pending;if(p){clearTimeout(p.timer);this.pending=null;p.resolve(this.sync(p.state,p.now));}
  }
  run(state,now){
   if(this.pending)throw Error('Only one telemetry sample may be in flight');
   if(!this.worker){
    const result=this.sync(state,now);this.meanCost+=.05*(result.costMs-this.meanCost);
    // At sub-millisecond model cost structured cloning costs more than it saves.
    // Promote sustained expensive workloads, keeping the renderer independent.
    if(++this.samples>=60&&this.meanCost>1.5)this.activate();
    return Promise.resolve(result);
   }
   return new Promise(resolve=>{
    const id=++this.id;this.pending={id,state,now,resolve,timer:setTimeout(()=>this.fail(),1000)};
    try{this.worker.postMessage({id,state,now});}catch{this.fail();}
   });
  }
 }
 const api={Client};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TelemetryProcessor=api;
})(typeof window!=='undefined'?window:globalThis);
