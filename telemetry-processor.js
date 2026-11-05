'use strict';
(function(root){
 // One owner per calculation session. Failed owners never resume frozen
 // history, and failures never replay the sample that caused them.
 class Client {
  constructor({createModel,createWorker=()=>new Worker('telemetry-worker.js'),timeoutMs=400}={}){
   if(typeof createModel!=='function')throw Error('A fresh model factory is required');
   this.createModel=createModel;this.timeoutMs=timeoutMs;this.worker=null;this.model=null;
   this.pending=null;this.id=0;this.session=1;this.context=undefined;this.closed=false;this.mode='worker';this.lastError=null;
   try{
    const worker=createWorker();this.worker=worker;
    worker.onmessage=({data})=>this.receive(worker,data);
    worker.onerror=event=>{event?.preventDefault?.();this.failWorker(worker,'worker-error');};
    worker.onmessageerror=()=>this.failWorker(worker,'worker-message-error');
   }catch(error){this.worker?.terminate?.();this.worker=null;this.mode='main';this.lastError={code:'worker-unavailable',message:this.message(error)};}
  }
  message(error){return String(error?.message||error||'Calculation failed').slice(0,256);}
  failure(code,message,session=this.session){return {ok:false,error:{code,message},session,mode:this.mode};}
  settle(result){const p=this.pending;if(!p)return;clearTimeout(p.timer);this.pending=null;p.resolve(result);}
  receive(worker,data){
   const p=this.pending;if(worker!==this.worker||!p||data?.id!==p.id||data?.session!==p.session)return;
   if(data.ok===true&&data.view&&typeof data.view.fresh==='boolean'&&Number.isFinite(data.costMs)&&data.costMs>=0){
    this.settle({ok:true,view:data.view,costMs:data.costMs,session:p.session,mode:'worker'});return;
   }
   if(data.ok===false&&data.error?.code==='model-error'){
    this.lastError={code:'model-error',message:this.message(data.error.message)};
    this.settle(this.failure('model-error',this.lastError.message,p.session));this.session++;return;
   }
   this.failWorker(worker,'worker-invalid-result');
  }
  failWorker(worker,code){
   if(worker!==this.worker||this.closed)return;
   worker.onmessage=worker.onerror=worker.onmessageerror=null;worker.terminate();this.worker=null;
   this.lastError={code,message:code};this.settle(this.failure(code,code));
   // Start a fresh direct-processing session on the NEXT sample. Degraded
   // mode is observable; there is no hidden move back to an old model.
   this.mode='main';this.model=null;this.session++;
  }
  run(state,now,context=0){
   if(this.closed)return Promise.resolve(this.failure('disposed','Calculation owner has been disposed'));
   if(this.pending)throw Error('Only one telemetry sample may be in flight');
   // Lifecycle transitions are observed before coalescing by the caller.
   // Even A -> B -> A must start new history when B was never processed.
   if(this.context!==context){if(this.context!==undefined)this.session++;this.context=context;this.model=null;}
   if(!this.worker){
    const session=this.session,start=performance.now();
    try{
     if(!this.model)this.model=this.createModel();
     const view=this.model.update(state,now);
     return Promise.resolve({ok:true,view,costMs:performance.now()-start,session,mode:'main'});
    }catch(error){
     this.lastError={code:'model-error',message:this.message(error)};this.model=null;this.session++;
     return Promise.resolve(this.failure('model-error',this.lastError.message,session));
    }
   }
   return new Promise(resolve=>{
    const worker=this.worker,id=++this.id,session=this.session;
    this.pending={id,session,resolve,timer:setTimeout(()=>this.failWorker(worker,'worker-timeout'),this.timeoutMs)};
    try{worker.postMessage({id,session,state,now});}catch{this.failWorker(worker,'worker-send-error');}
   });
  }
  dispose(){
   if(this.closed)return;this.closed=true;
   if(this.worker){this.worker.onmessage=this.worker.onerror=this.worker.onmessageerror=null;this.worker.terminate();this.worker=null;}
   this.model=null;this.settle(this.failure('disposed','Calculation owner has been disposed'));
  }
  status(){return {mode:this.mode,session:this.session,closed:this.closed,lastError:this.lastError&&{...this.lastError}};}
 }
 const api={Client};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TelemetryProcessor=api;
})(typeof window!=='undefined'?window:globalThis);
