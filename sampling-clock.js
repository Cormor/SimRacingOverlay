'use strict';
// Phase-locked deadlines: coarse OS wakeups must not add their rounding on every sample.
class SamplingClock {
 constructor(){this.next=null;this.last=null;this.interval=null;}
 due(now,interval){
  if(!Number.isFinite(now)||!Number.isFinite(interval)||interval<=0)return false;
  if(this.next===null||interval!==this.interval||now<this.last||now-this.next>interval*3||this.next-now>interval*2)this.next=now;
  this.last=now;this.interval=interval;
  if(now<this.next)return false;
  this.next+=interval;
  return true;
 }
}
module.exports={SamplingClock};
