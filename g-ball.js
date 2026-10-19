'use strict';
(function(root){
 const Context=typeof module!=='undefined'&&module.exports?require('./telemetry-context'):root.TelemetryContext;
 const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite),add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),unit=a=>{const n=Math.hypot(...a);return n>.01?mul(a,1/n):null;};
 class Model{
  constructor(storage=null,wallNow=()=>Date.now()){this.storage=storage;this.wallNow=wallNow;this.reset();try{this.restoreStored(storage?.getItem('moza-g-last'));}catch{}}
  reset(){this.samples=[];this.recentG=[];this.supported=[];this.trail=[];this.envelope=Array(72).fill(0);this.peak=0;this.current=null;this.packet=null;this.lastAdvance=null;this.lastSampleAt=null;this.key=null;this.savedAt=-Infinity;this.noDataSince=null;this.viewNow=0;this.pendingRestore=null;}
  clearTelemetry(now){
   if(this.packet!==null||this.lastAdvance!==null||this.peak>0||this.current||this.trail.length||this.samples.length){const key=this.key;this.reset();this.key=key;this.viewNow=now;this.persist(true);}
   return this.view(now);
  }
  clearPeak(){this.peak=0;this.envelope.fill(0);this.trail=[];this.supported=[];this.persist();}
  restoreStored(key){
   if(!key||!this.storage)return;try{const s=JSON.parse(this.storage.getItem('moza-g-peak:'+key)||'null');if(!s||!(s.expiresAt>this.wallNow())||!Number.isFinite(s.peak)||s.peak<0||s.peak>20||!Array.isArray(s.envelope)||s.envelope.length!==72||!s.envelope.every(v=>Number.isFinite(v)&&v>=0&&v<=20))return;
    this.key=key;this.peak=s.peak;this.envelope=s.envelope;this.current=s.current&&['lateral','longitudinal','magnitude'].every(k=>Number.isFinite(s.current[k]))?s.current:null;this.pendingRestore={remaining:Math.min(30000,s.expiresAt-this.wallNow()),trail:(Array.isArray(s.trail)?s.trail:[]).filter(p=>['lateral','longitudinal','magnitude','age'].every(k=>Number.isFinite(p[k]))).slice(-120)};
   }catch{}
  }
  persist(expired=false){if(this.key&&this.storage)try{const reference=this.noDataSince??this.viewNow,remaining=this.noDataSince===null?30000:Math.max(0,30000-(this.viewNow-this.noDataSince));this.storage.setItem('moza-g-last',this.key);this.storage.setItem('moza-g-peak:'+this.key,JSON.stringify({peak:this.peak,envelope:this.envelope,current:this.current,expiresAt:expired?0:this.wallNow()+remaining,trail:this.trail.map(p=>({...p,age:Math.max(0,reference-p.t)}))}));}catch{}}
  noData(now){
   if(this.noDataSince===null){this.noDataSince=now;this.samples=[];this.recentG=[];this.supported=[];this.persist();}
   if(now-this.noDataSince>=30000)return this.clearTelemetry(now);
   return this.view(now);
  }
  update(g,now){
   this.viewNow=now;
   if(this.pendingRestore){const cached=this.pendingRestore;this.pendingRestore=null;this.noDataSince=now-(30000-cached.remaining);this.trail=cached.trail.map(p=>({...p,t:this.noDataSince-p.age}));}
   const zeroPayload=g?.available===true&&g.speedKmh===0&&g.rpm===0&&vec(g.velocity)&&g.velocity.every(v=>v===0)&&g.wheels?.length===4&&g.wheels.every(w=>w.load===0&&w.fx===0&&w.fy===0&&vec(w.contactPoint)&&w.contactPoint.every(v=>v===0));
   if(!g?.available||(!vec(g.velocity)&&!(g.accGFrame==='body'&&vec(g.accG)))||zeroPayload)return this.noData(now);
   if(now<(this.lastAdvance??0))this.clearTelemetry(now);
   const key=g?.available?String(g.source)+':'+String(g.carModel):this.key;
   if(key!==this.key){this.reset();this.key=key;this.viewNow=now;this.restoreStored(key);if(this.pendingRestore){const c=this.pendingRestore;this.pendingRestore=null;this.noDataSince=now-(30000-c.remaining);this.trail=c.trail.map(p=>({...p,t:this.noDataSince-p.age}));}}
   if((Number.isInteger(g.packet)&&Number.isInteger(this.packet)&&g.packet<this.packet)||(Number.isFinite(g.sampleTime)&&this.lastSampleAt!==null&&g.sampleTime<this.lastSampleAt)){this.samples=[];this.recentG=[];this.supported=[];this.packet=null;this.lastSampleAt=null;}
   if(g.packet===this.packet){if(now-this.lastAdvance>250)return this.noData(now);return this.view(now);}
   if((this.noDataSince!==null&&now-this.noDataSince>=30000)||(this.lastAdvance!==null&&now-this.lastAdvance>=30000))this.clearTelemetry(now);
   const gap=this.lastAdvance===null?Infinity:now-this.lastAdvance;this.lastAdvance=now;this.packet=g.packet;
   if(gap>150||gap<=0){this.samples=[];this.recentG=[];this.supported=[];this.current=null;}
   const sampleAt=Number.isFinite(g.sampleTime)?g.sampleTime:now;this.lastSampleAt=sampleAt;
   if(this.samples.length&&sampleAt<=this.samples.at(-1).t)this.samples=[];
   if(vec(g.velocity)){this.samples.push({t:sampleAt,v:g.velocity.slice()});this.samples=this.samples.filter(s=>sampleAt-s.t<=100);}else this.samples=[];
   const basis=Context.roadBasis(g),canDifferentiate=basis&&this.samples.length>=3&&sampleAt-this.samples[0].t>=35;
   if(!canDifferentiate&&!(g.accGFrame==='body'&&vec(g.accG))){this.current=null;return this.view(now);}
   const median=vs=>vs.sort((a,b)=>a-b)[Math.floor(vs.length/2)];
   // Theil-Sen derivative: a single bad velocity sample cannot dominate the 100ms slope.
   const a=canDifferentiate?[0,1,2].map(axis=>{const slopes=[];for(let i=0;i<this.samples.length;i++)for(let j=i+1;j<this.samples.length;j++){const dt=this.samples[j].t-this.samples[i].t;if(dt>=15)slopes.push((this.samples[j].v[axis]-this.samples[i].v[axis])/dt*1000/9.80665);}return median(slopes);}):null;
   this.measurementSource=canDifferentiate?'world-velocity derivative, <=100ms, measured body basis':'reported body planar g';
   const lateral=canDifferentiate?dot(a,basis.right):g.accG[0],longitudinal=canDifferentiate?dot(a,basis.forward):g.accG[2],magnitude=Math.hypot(lateral,longitudinal);
   if(!Number.isFinite(magnitude)||magnitude>20){this.samples=[];this.recentG=[];this.supported=[];return this.noData(now);}
   this.noDataSince=null;
   const cadence=Number.isFinite(gap)?Math.min(150,Math.max(1,gap)):16;
   this.recentG.push({lateral,longitudinal,magnitude,t:now});this.recentG=this.recentG.filter(p=>now-p.t<=Math.max(80,cadence*1.1)).slice(-3);
   const target={lateral:median(this.recentG.map(p=>p.lateral)),longitudinal:median(this.recentG.map(p=>p.longitudinal))};
   const representative=this.recentG.reduce((best,p)=>Math.hypot(p.lateral-target.lateral,p.longitudinal-target.longitudinal)<Math.hypot(best.lateral-target.lateral,best.longitudinal-target.longitudinal)?p:best);
   this.current={lateral:representative.lateral,longitudinal:representative.longitudinal,magnitude:representative.magnitude};
   this.supported.push({...this.current,t:now});this.supported=this.supported.filter(p=>now-p.t<=Math.max(80,cadence*2.1));
   // Peak envelope needs at least 60ms / four observations; lower quartile suppresses isolated spikes.
   if(this.supported.length>=(cadence>=40?2:4)&&now-this.supported[0].t>=60){const sorted=this.supported.slice().sort((a,b)=>a.magnitude-b.magnitude),stable=sorted[Math.floor(sorted.length*.25)];this.peak=Math.max(this.peak,stable.magnitude);
    if(stable.magnitude>.005){const bin=Math.round((Math.atan2(stable.longitudinal,stable.lateral)+Math.PI)/(Math.PI*2)*72)%72;this.envelope[bin]=Math.max(this.envelope[bin],stable.magnitude);}
   }
   if(now-this.savedAt>=1000){this.persist();this.savedAt=now;}
   this.trail.push({...this.current,t:now});this.trail=this.trail.filter(p=>now-p.t<=1800).slice(-120);return this.view(now);
  }
  view(now){
   // Keep angular order AND untouched sectors at radius zero. No convex hull bridges unvisited directions.
   const peakOutline=this.envelope.map((value,i)=>{const a=i/72*Math.PI*2-Math.PI;return {x:Math.cos(a)*value,y:Math.sin(a)*value};});
   return {peakOutline,peakHull:peakOutline,current:this.current,peak:this.peak,scale:Math.min(1.2,Math.max(.4,Math.ceil((this.peak-1e-8)*5)/5)),envelope:this.envelope.slice(),trail:this.trail.filter(p=>(this.noDataSince??now)-p.t<=1800),source:this.measurementSource||'world-velocity derivative, <=100ms, projected onto vehicle road plane'};}
 }
 const api={Model};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GBall=api;
})(typeof window!=='undefined'?window:globalThis);
