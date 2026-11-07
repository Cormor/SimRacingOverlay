'use strict';
// Relate the bridge's monotonic clock to this browser's clock using a local
// request interval. Never subtract two clocks merely because both use ms.
// Active sessions assume a constant offset, not arbitrary clock drift. Repeated
// observations check compatibility; page recovery explicitly discards the anchor.
(function(root){
 class Clock {
  constructor(){this.anchor=null;this.generation=0;this.retired=new Set();}
  observe(epoch,serverMs,start,end){
   if(typeof epoch!=='string'||!epoch||![serverMs,start,end].every(Number.isFinite)||
      start<0||end<start||end-start>50||this.retired.has(epoch))return false;
   // One millisecond accounts for timestamp serialization/browser precision.
   const lower=start-serverMs-1,upper=end-serverMs+1,old=this.anchor;
   if(old&&old.epoch===epoch&&end>=old.checkedAt&&end-old.checkedAt<60000&&
      lower<=old.upper&&upper>=old.lower){old.checkedAt=end;return true;}
   if(old&&old.epoch!==epoch){this.retired.add(old.epoch);if(this.retired.size>16)this.retired.delete(this.retired.values().next().value);}
   this.anchor={epoch,lower,upper,checkedAt:end};this.generation++;return true;
  }
  reset(){this.anchor=null;this.generation++;}
  locate(meta,receivedAt){
   const a=this.anchor;
   if(!a||meta?.epoch!==a.epoch||!Number.isFinite(meta.publishedMs)||!Number.isFinite(receivedAt)||
      receivedAt<a.checkedAt||receivedAt-a.checkedAt>=60000)return null;
   // Keeping the lower offset fixed within a clock session preserves sample
   // order. Under the constant-offset assumption its age includes queue time
   // conservatively; interval overlap alone is not proof against clock drift.
   const at=meta.publishedMs+a.lower,ageMs=receivedAt-at;
   return ageMs>=0?{at,ageMs,generation:this.generation}:null;
  }
  needsObservation(epoch,now){return !this.anchor||this.anchor.epoch!==epoch||now-this.anchor.checkedAt>=30000;}
  status(){return this.anchor?{epoch:this.anchor.epoch,generation:this.generation,uncertaintyMs:this.anchor.upper-this.anchor.lower,checkedAt:this.anchor.checkedAt}:null;}
 }
 const api={Clock};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TelemetryClock=api;
})(typeof window!=='undefined'?window:globalThis);
