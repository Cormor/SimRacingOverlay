'use strict';
// Per-wheel full-extension detection from the measured shock deflection.
// This is suspension evidence, not a fabricated contact switch: iRacing's live
// table has shockDefl/shockVel but no per-wheel contact flag or wheel speed.
// A wheel is treated as unloaded when its measured deflection reaches the
// session minimum for that corner and the extension velocity has stopped.
(function(root){
 const finite=Number.isFinite;
 const EXTEND_TOL=0.0015,EXIT_TOL=0.006,VEL_TOL=0.06,EXIT_VEL=0.15,HOLD_MS=33,MIN_SPEED=3,REF_MAX=0.005;
 class Contact {
  constructor(){this.reset();}
  reset(){
   this.min=[Infinity,Infinity,Infinity,Infinity];
   this.since=[null,null,null,null];
   this.state=[false,false,false,false];
   this.seen=[false,false,false,false];
  }
  update(wheels,speed,now){
   if(!Array.isArray(wheels)||wheels.length!==4)return {available:false,airborne:[false,false,false,false],source:'missing-wheels'};
   const moving=finite(speed)&&speed>=MIN_SPEED;
   let available=false;
   for(let i=0;i<4;i++){
    const w=wheels[i]||{},defl=w.shockDeflectionM,vel=w.shockVelocityMs;
    if(!finite(defl)||!finite(vel)){this.since[i]=null;this.state[i]=false;continue;}
    available=true;this.seen[i]=true;
    if(defl<this.min[i])this.min[i]=defl;
    if(!moving||this.min[i]>REF_MAX){this.since[i]=null;this.state[i]=false;continue;}
    if(defl<=REF_MAX&&defl<=this.min[i]+EXTEND_TOL&&Math.abs(vel)<=VEL_TOL){
     if(this.since[i]===null)this.since[i]=now;
     if(now-this.since[i]>=HOLD_MS)this.state[i]=true;
    }else{
     this.since[i]=null;
     if(defl>this.min[i]+EXIT_TOL||vel>EXIT_VEL)this.state[i]=false;
    }
   }
   return {available,airborne:this.state.slice(),source:'suspension-full-extension',
    mins:this.min.map(v=>finite(v)?v:null),seen:this.seen.slice()};
  }
 }
 const api={Contact,EXTEND_TOL,EXIT_TOL,VEL_TOL,MIN_SPEED};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SuspensionContact=api;
})(typeof window!=='undefined'?window:globalThis);
