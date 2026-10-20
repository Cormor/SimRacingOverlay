'use strict';
// Pure read-only telemetry processing. No control, FFB or lighting output.
(function(root){
 const Grip=typeof module!=='undefined'&&module.exports?require('./realtime-response.js'):root.RealtimeResponse;
 const Handling=typeof module!=='undefined'&&module.exports?require('./handling.js').Handling:root.HandlingState.Handling;
 const Context=typeof module!=='undefined'&&module.exports?require('./telemetry-context'):root.TelemetryContext;
 const RAD=180/Math.PI,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
 const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k);
 const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0),norm=a=>Math.hypot(...a);
 const unit=a=>norm(a)>1e-6?mul(a,1/norm(a)):null;
 const project=(a,n)=>sub(a,mul(n,dot(a,n)));
 const blend=(old,v,dt,tau)=>Number.isFinite(old)?old+(v-old)*(1-Math.exp(-dt/tau)):v;
 const wrap=v=>((v+180)%360+360)%360-180;
 const angleBlend=(old,v,dt)=>Number.isFinite(old)?wrap(old+wrap(v-old)*(1-Math.exp(-dt/80))):v;
 function geometry(g){
  if(Number.isFinite(g.roadWheelAngle))return {wheel:g.roadWheelAngle*RAD,wheelbase:Number.isFinite(g.wheelbase)?g.wheelbase:null,forward:vec(g.localVelocity)?g.localVelocity[2]:null};
  const w=g.wheels;if(!Array.isArray(w)||w.length!==4||!vec(g.velocity))return null;
  if(w.some(x=>!vec(x.contactPoint)||!vec(x.contactHeading)||norm(x.contactHeading)<.7||norm(x.contactHeading)>1.3))return null;
  const front=mul(add(w[0].contactPoint,w[1].contactPoint),.5),rear=mul(add(w[2].contactPoint,w[3].contactPoint),.5);
  const wheelbase=norm(sub(front,rear)),tracks=[norm(sub(w[0].contactPoint,w[1].contactPoint)),norm(sub(w[2].contactPoint,w[3].contactPoint))];
  if(wheelbase<1||wheelbase>5||tracks.some(v=>v<.6||v>3.5))return null;
  const normals=w.filter(x=>vec(x.contactNormal)&&norm(x.contactNormal)>=.7&&norm(x.contactNormal)<=1.3);
  const n=unit(normals.reduce((a,x)=>add(a,x.contactNormal),[0,0,0]));if(!n)return null;
  const body=unit(project(sub(front,rear),n)),velocity=project(g.velocity,n);
  if(!body)return null;
  // Build anatomical RIGHT from FR-FL / RR-RL, not an assumed world handedness.
  const track=project(add(sub(w[1].contactPoint,w[0].contactPoint),sub(w[3].contactPoint,w[2].contactPoint)),n);
  const right=unit(sub(track,mul(body,dot(track,body))));if(!right)return null;
  const direction=v=>Math.atan2(dot(v,right),dot(v,body))*RAD;
  const heads=w.slice(0,2).map(x=>{let h=unit(project(x.contactHeading,n));if(h&&dot(h,body)<0)h=mul(h,-1);return h;});
  if(heads.some(h=>!h))return null;
  // Steering orientation is geometry, not grip: unloading must not zero its weights.
  const h=unit(add(heads[0],heads[1]));if(!h)return null;
  const wheel=direction(h);if(Math.abs(wheel)>80)return null;
  const forward=vec(g.localVelocity)?g.localVelocity[2]:dot(g.velocity,body);
  return {wheel,wheelbase,forward};
 }
 class Model {
  constructor(options={}){this.storage=options.storage;this.carCache=new Map();this.savedAt=-Infinity;this.reset();}
  reset(now=this.advance??0){this.handling=new Handling();if(this.grip&&this.car){const key=this.source+':'+this.car;this.grip.pause();this.carCache.set(key,this.grip);if(this.carCache.size>6)this.carCache.delete(this.carCache.keys().next().value);this.persist(now);}this.grip=new Grip.Estimator();this.packet=null;this.advance=null;this.car=null;this.source=null;this.epoch=undefined;this.sourceTime=null;this.loadSupport=[false,false,false,false];this.loadState=Array.from({length:4},()=>({unloaded:false,transition:null}));this.samples=[];this.filtered={};this.cues={};this.trend={candidate:null,since:null,active:null};this.neutral=true;this.view={fresh:false,unloaded:[false,false,false,false]};}
  persist(now){
   if(!this.storage||!this.car||!this.grip)return;
   try{this.storage.setItem('moza-grip-v1:'+this.source+':'+this.car,JSON.stringify(this.grip.snapshot(now)));}catch{}
  }
  update(s,now){
   if(!Number.isFinite(now)||now<0){this.car=null;this.reset(0);return this.view;}
   s=Context.sanitize(s);const g=s.game;
   if(!s.connected||!g?.available||g.paused===true||g.inMenu===true||!Number.isInteger(g.packet)||!Array.isArray(g.wheels)||g.wheels.length!==4){this.reset(now);return this.view;}
   if((this.car!==null&&this.car!==g.carModel)||(this.source!==null&&this.source!==g.source)||(this.epoch!==undefined&&this.epoch!==g.streamEpoch)||(Number.isFinite(this.sourceTime)&&Number.isFinite(g.sampleTime)&&g.sampleTime<this.sourceTime))this.reset(now);
   this.epoch=g.streamEpoch;this.sourceTime=g.sampleTime;
   if(this.car===null&&g.carModel){const key=g.source+':'+g.carModel;if(this.carCache.has(key))this.grip=this.carCache.get(key);else if(this.storage){try{this.grip.restore(JSON.parse(this.storage.getItem('moza-grip-v1:'+key)),now);}catch{}}}
   this.car=g.carModel;this.source=g.source;
   if(g.packet===this.packet){
    if(this.advance!==null&&now-this.advance>400){this.grip.pause();this.view={fresh:false,unloaded:[false,false,false,false]};this.samples=[];this.filtered={};this.cues={};this.trend={candidate:null,since:null,active:null};}
    return this.view;
   }
   if(this.advance!==null&&now<this.advance){this.car=null;this.carCache.clear();this.reset(now);return this.view;}
   const gap=this.advance===null?0:now-this.advance,dt=gap>0&&gap<250?gap:16;
   if(gap>250){this.grip.pause();this.samples=[];this.filtered={};this.cues={};this.trend={candidate:null,since:null,active:null};this.loadState=Array.from({length:4},()=>({unloaded:false,transition:null}));}
   this.packet=g.packet;this.advance=now;
   const loads=g.wheels.map(w=>w.load),validLoads=loads.map(v=>Number.isFinite(v)&&v>=0&&v<100000),total=loads.reduce((a,v,i)=>a+(validLoads[i]?v:0),0);
   validLoads.forEach((valid,i)=>{if(valid&&loads[i]>=40)this.loadSupport[i]=true;});
   const loadKnownWheels=validLoads.map((valid,i)=>valid&&(this.loadSupport[i]||g.capabilities?.loads===true)),loadKnown=loadKnownWheels.every(Boolean);
   const threshold=clamp(total/Math.max(1,validLoads.filter(Boolean).length)*.025,40,100);
   const unloaded=this.loadState.map((st,i)=>{
    if(!loadKnownWheels[i]){st.unloaded=false;st.transition=null;return false;}
    const next=st.unloaded?loads[i]<threshold*2.5:loads[i]<threshold;
    if(next===st.unloaded)st.transition=null;
    else{if(st.transition===null)st.transition=now;if(now-st.transition>=(next?60:40)){st.unloaded=next;st.transition=null;}}
    return st.unloaded;
   });
   // Wheel orientation stays measurable during unloading; grip estimates still require supported loads.
   const raw=geometry(g);
   let steering=null;
   const moving=Math.abs(g.speedKmh)>=10&&Number.isFinite(g.speedKmh);
   const axle=(start)=>{
    const weighted=loadKnownWheels.slice(start,start+2).every(Boolean);
    const list=g.wheels.slice(start,start+2).filter((w,j)=>!unloaded[start+j]&&(!loadKnownWheels[start+j]||w.load>=threshold*2.5)&&Number.isFinite(w.angle)&&Math.abs(w.angle)<=Math.PI/2);
    return list.length?list.reduce((a,w)=>a+w.angle*(weighted?w.load:1),0)/list.reduce((a,w)=>a+(weighted?w.load:1),0)*RAD:null;
   };
   const nativeFront=axle(0),nativeRear=axle(2);
   const lateral=moving?{front:nativeFront,rear:nativeRear}:{front:null,rear:null};
   for(const key of ['front','rear']){
    if(lateral[key]!==null){this.filtered[key]=lateral[key];}
    else delete this.filtered[key];
   }
   const forward=vec(g.localVelocity)?g.localVelocity[2]:raw?.forward,speed=Math.abs(forward);
   if(Number.isFinite(forward)){
    let delta=null,mode='unavailable',source=null;
    if(speed<=.6&&raw){delta=raw.wheel;mode='static';source='wheel-direction-versus-stationary-body';}
    else if(nativeFront!==null){
     const t=clamp((speed-.6)/2.4,0,1),weight=t*t*(3-2*t);
     // Native SlipAngle is contact-patch movement relative to tyre heading; negate for heading minus movement.
     delta=raw&&speed<3?raw.wheel*(1-weight)-nativeFront*weight:-nativeFront;
     mode=forward<0?'reverse':speed<3?'low_speed':'dynamic';source='native-front-contact-slip-angle';
    }
    if(delta!==null){
     this.filtered.delta=delta;
     const magnitude=Math.abs(this.filtered.delta),enter=mode==='static' ? .15 : .7,exit=mode==='static' ? .3 : 1.2;
     if(magnitude<=enter)this.neutral=true;else if(magnitude>=exit)this.neutral=false;
     steering={wheel:raw?.wheel??null,wheelbase:raw?.wheelbase??null,delta:this.filtered.delta,neutral:this.neutral,mode,source};
    }else delete this.filtered.delta;
   }
   // Slip angle is not remaining grip. Do not infer tyre saturation from a fixed angle
   // or a front/rear angle difference without a calibrated force-versus-slip relationship.
   if(steering){steering.trend=null;steering.gripAssessment='unavailable';steering.unloaded=unloaded.some(Boolean);}
   // Physics derivatives use the producer clock; arrival time only owns freshness/UI.
   const grip=this.grip.update(s,Number.isFinite(g.sampleTime)?g.sampleTime:now,unloaded,steering,loadKnownWheels);
   if(steering)steering.gripAssessment=grip.available?'estimated':grip.reason;
   const drive=grip.driveCue,brake=grip.brakeCue;
   let decel=null;
   if(Number.isFinite(g.sampleTime)&&Number.isFinite(g.speedKmh)){
    const t=g.sampleTime;
    if(this.samples.length&&(t<=this.samples.at(-1).t||t-this.samples.at(-1).t>250))this.samples=[];
    this.samples.push({t,v:g.speedKmh/3.6});this.samples=this.samples.filter(x=>t-x.t<=100);
    const span=t-this.samples[0].t;
    if(span>=40&&this.samples.length>=2){
     const mt=this.samples.reduce((a,x)=>a+(x.t-t)/1000,0)/this.samples.length,mv=this.samples.reduce((a,x)=>a+x.v,0)/this.samples.length;
     let numerator=0,denominator=0;for(const x of this.samples){const dt=(x.t-t)/1000-mt;numerator+=dt*(x.v-mv);denominator+=dt*dt;}
     const value=-numerator/denominator/9.80665;
     if(Number.isFinite(value)&&Math.abs(value)<10){this.filtered.decel=value;if(g.brake>.05&&g.speedKmh>5)decel=this.filtered.decel;}
    }
   }else{this.samples=[];delete this.filtered.decel;}
   if(now-this.savedAt>3000){this.persist(now);this.savedAt=now;}
   this.view={fresh:true,packet:g.packet,telemetryTime:g.sampleTime,processedAt:now,loadKnown,loadKnownWheels,unloaded,steering,lateral,drive,brake,decel,grip};this.view.handling=this.handling.update(s,now,this.view);return this.view;
  }
 }
 const api={Model,geometry};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DrivingAssist=api;
})(typeof window!=='undefined'?window:globalThis);
