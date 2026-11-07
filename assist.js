'use strict';
// Pure read-only telemetry processing. No control, FFB or lighting output.
(function(root){
 const Grip=typeof module!=='undefined'&&module.exports?require('./realtime-response.js'):root.RealtimeResponse;
 const Handling=typeof module!=='undefined'&&module.exports?require('./handling.js').Handling:root.HandlingState.Handling;
 const Context=typeof module!=='undefined'&&module.exports?require('./telemetry-context'):root.TelemetryContext;
 const Suspension=typeof module!=='undefined'&&module.exports?require('./suspension-contact'):root.SuspensionContact;
 const Feedback=typeof module!=='undefined'&&module.exports?require('./feedback-research'):root.FeedbackResearch;
 const PedalTraction=typeof module!=='undefined'&&module.exports?require('./pedal-traction'):root.PedalTraction;
 const RAD=180/Math.PI,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
 const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k);
 const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0),norm=a=>Math.hypot(...a);
 const unit=a=>norm(a)>1e-6?mul(a,1/norm(a)):null;
 const project=(a,n)=>sub(a,mul(n,dot(a,n)));
 const blend=(old,v,dt,tau)=>Number.isFinite(old)?old+(v-old)*(1-Math.exp(-dt/tau)):v;
 const wrap=v=>((v+180)%360+360)%360-180;
 const angleBlend=(old,v,dt)=>Number.isFinite(old)?wrap(old+wrap(v-old)*(1-Math.exp(-dt/80))):v;
 class LateralSlipState {
  constructor(){this.reset();}
  reset(){this.identity=null;this.time=null;this.corners=Array(4).fill(null);}
  update(g,unloaded,loadKnown){
   const identity=JSON.stringify([g.source,g.carModel,g.vehicleIdentity,g.streamEpoch]);
   if(identity!==this.identity){this.reset();this.identity=identity;}
   const time=g.sampleTime;
   const dt=Number.isFinite(time)&&Number.isFinite(this.time)?time-this.time:Infinity;
   this.time=time;
   const speedWeight=clamp(Math.abs(g.speedKmh)/10.8,0,1);
   const motion=speedWeight**2*(3-2*speedWeight);
   return g.wheels.map((w,i)=>{
    if(unloaded[i]||w.contact===false||w.grounded===false||loadKnown[i]&&w.load<40||!Number.isFinite(w.angle)){
     this.corners[i]=null;return null;
    }
    const prior=this.corners[i];
    const lateralForce=w.load>=400&&Number.isFinite(w.fy)?w.fy/w.load:null;
    if(dt!==0||!prior){
     let angle=w.angle;
     // Condition only small angle changes supported by a comparable contact regime.
     const stable=prior&&dt>0&&dt<=90&&Number.isFinite(lateralForce)&&Number.isFinite(prior.lateralForce)&&
      Math.abs(w.load-prior.load)<=.12*prior.load&&Math.abs(lateralForce-prior.lateralForce)<=.04;
     if(stable&&w.angle*prior.measured>=0){
      const tau=35*Math.max(0,1-Math.abs(w.angle-prior.measured)/.02);
      if(tau>0)angle=blend(prior.angle,w.angle,dt,tau);
     }
     this.corners[i]={angle,measured:w.angle,load:w.load,lateralForce};
    }
    // Match the original S1 slip-state scale and low-speed weight.
    const angle=clamp(this.corners[i].angle,-Math.PI/2+.001,Math.PI/2-.001);
    return 1-motion*(1-Math.exp(-((Math.tan(angle)/.14)**2)));
   });
  }
 }
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
  return {wheel,wheelbase,forward,frame:{forward:body,right,heads}};
 }
 const avg=(rows,key)=>rows.reduce((total,row)=>total+row[key],0)/rows.length;
 const spanOf=(rows,key)=>Math.max(...rows.map(row=>row[key]))-Math.min(...rows.map(row=>row[key]));
 function frontObservation(g,raw,unloaded){
  // ACR's signed force convention was checked against world-velocity change in two captures.
  if(g.source!=='acpmf_physics'||g.capabilities?.forces!==true||!raw?.frame||
   !Number.isFinite(g.sampleTime)||!Number.isInteger(g.gear)||g.gear<=0||raw.forward<5||
   !Number.isFinite(g.gas)||!Number.isFinite(g.brake))return null;
  const steer=raw.wheel/RAD,turn=Math.sign(steer),frame=raw.frame;
  if(Math.abs(steer)<.014)return null;
  const wheels=g.wheels.slice(0,2);
  if(wheels.some((w,i)=>unloaded[i]||w.contact===false||w.grounded===false||w.load<400||
   ![w.load,w.fx,w.fy,w.ratio].every(Number.isFinite)))return null;
  const force=wheels.reduce((sum,w,i)=>sum+w.fx*dot(frame.heads[i],frame.right)-w.fy*dot(frame.heads[i],frame.forward),0)*turn;
  const load=wheels[0].load+wheels[1].load;
  return {time:g.sampleTime,turn,steer:Math.abs(steer),force,load,normalized:force/load,
   longL:wheels[0].fx/wheels[0].load,longR:wheels[1].fx/wheels[1].load,
   ratioL:wheels[0].ratio,ratioR:wheels[1].ratio,loadShare:wheels[0].load/load,
   speed:Math.hypot(dot(g.velocity,frame.forward),dot(g.velocity,frame.right)),gas:g.gas,brake:g.brake,
   velocity:g.velocity,frame};
 }
 function pathCurvature(rows,frame,turn){
  const first=rows[0],last=rows.at(-1);
  const course=v=>Math.atan2(dot(v,frame.right),dot(v,frame.forward));
  const distance=(last.time-first.time)/1000*avg(rows,'speed');
  const angle=(course(last.velocity)-course(first.velocity))*RAD;
  return distance>.2?turn*wrap(angle)/RAD/distance:null;
 }
 function frontResponse(rows){
  const first=rows[0],last=rows.at(-1),span=last.time-first.time;
  if(rows.length<4||span<150)return null;
  const edge=Math.min(110,Math.max(60,1.25*span/(rows.length-1)),span*.45);
  const early=rows.filter(row=>row.time-first.time<=edge);
  if(early.length<2)return null;
  const steer=avg(early,'steer');
  const addition=rows.find(row=>row.time>early.at(-1).time&&row.steer>=steer+.009);
  if(!addition)return null;
  const late=rows.filter(row=>row.time>=addition.time+55&&last.time-row.time<=edge);
  if(late.length<2||avg(late,'steer')<steer+.009||last.steer<steer+.009||
   Math.max(...late.map(row=>row.steer))-last.steer>.0035)return null;
  if(spanOf(rows,'load')>.18*avg(early,'load')||spanOf(rows,'loadShare')>.13||
   spanOf(rows,'speed')>Math.max(2,.12*first.speed)||spanOf(rows,'gas')>.16||spanOf(rows,'brake')>.12||
   spanOf(rows,'longL')>.14||spanOf(rows,'longR')>.14||spanOf(rows,'ratioL')>.08||spanOf(rows,'ratioR')>.08)return null;
  const initialPath=pathCurvature(early,first.frame,last.turn),finalPath=pathCurvature(late,first.frame,last.turn);
  const initialForce=avg(early,'force'),finalForce=avg(late,'force'),initialNorm=avg(early,'normalized');
  if(!Number.isFinite(initialPath)||!Number.isFinite(finalPath)||initialForce<300||finalForce<=0||
   rows.some(row=>row.force<=0)||initialPath<.001||finalPath<-.001)return null;
  const forceChange=finalForce-initialForce,normChange=avg(late,'normalized')-initialNorm;
  const forceBand=Math.max(100,.055*initialForce),normBand=Math.max(.018,.055*initialNorm);
  const pathGrew=finalPath-initialPath>Math.max(.0008,.12*initialPath);
  if(forceChange>forceBand&&normChange>normBand&&pathGrew)return 'productive';
  if(pathGrew)return null;
  if(forceChange< -forceBand&&normChange< -normBand)return 'declining';
  if(Math.abs(forceChange)<=forceBand&&Math.abs(normChange)<=normBand)return 'plateau';
  return null;
 }
 class FrontSteeringResponse {
  constructor(){this.reset();}
  reset(){this.key=null;this.rows=[];this.peak=0;this.evidenceAt=null;this.reduction=0;this.view=null;}
  update(g,raw,unloaded,handbrake,now){
   const row=handbrake>1?null:frontObservation(g,raw,unloaded);
   if(!row){this.reset();return null;}
   const key=JSON.stringify([g.source,g.carModel,g.vehicleIdentity,g.streamEpoch,g.gear,row.turn]);
   const prior=this.rows.at(-1),dt=prior?row.time-prior.time:Infinity;
   if(key===this.key&&dt===0)return this.view;
   if(key!==this.key||dt<0||dt>115||row.steer<this.peak-.012){this.reset();this.key=key;}
   this.peak=Math.max(this.peak,row.steer);
   this.rows=this.rows.filter(p=>row.time-p.time<=360).slice(-63);
   this.rows.push(row);
   const evidence=frontResponse(this.rows);
   if(evidence==='plateau'||evidence==='declining')this.evidenceAt=row.time;
   else if(evidence==='productive')this.evidenceAt=null;
   const held=!evidence&&this.evidenceAt!==null&&row.time-this.evidenceAt<=180;
   const target=evidence==='declining'?.70:evidence==='plateau'?.45:held?this.reduction:0;
   this.reduction=this.rows.length===1?0:blend(this.reduction,target,dt,target>this.reduction?45:100);
   this.view={state:evidence??(held?'held':'unknown'),reduction:this.reduction,
    evidenceExpired:!evidence&&!held&&this.evidenceAt!==null,observedAt:now};
   return this.view;
  }
 }
 class Model {
  constructor(){this.contact=new Suspension.Contact();this.feedback=new Feedback.Observer({steering:'state',pedals:null});this.pedalTraction=new PedalTraction.Observer();this.lateralSlip=new LateralSlipState();this.frontSteeringResponse=new FrontSteeringResponse();this.reset();}
  reset(){this.handling=new Handling();this.grip=new Grip.Estimator();this.feedback.reset();this.pedalTraction.reset();this.lateralSlip.reset();this.frontSteeringResponse.reset();this.contact?.reset();this.packet=null;this.advance=null;this.car=null;this.source=null;this.epoch=undefined;this.sourceTime=null;this.loadSupport=[false,false,false,false];this.loadState=Array.from({length:4},()=>({unloaded:false,transition:null}));this.samples=[];this.filtered={};this.cues={};this.trend={candidate:null,since:null,active:null};this.neutral=true;this.view={fresh:false,unloaded:[false,false,false,false]};}
  update(s,now){
   if(!Number.isFinite(now)||now<0){this.car=null;this.reset(0);return this.view;}
   let g=s?.game;
   if(!s?.connected||!g?.available||g.paused===true||g.inMenu===true||!Number.isInteger(g.packet)||!Array.isArray(g.wheels)||g.wheels.length!==4){this.reset(now);return this.view;}
   if((this.car!==null&&this.car!==g.carModel)||(this.source!==null&&this.source!==g.source)||(this.epoch!==undefined&&this.epoch!==g.streamEpoch)||(Number.isFinite(this.sourceTime)&&Number.isFinite(g.sampleTime)&&g.sampleTime<this.sourceTime))this.reset(now);
   this.epoch=g.streamEpoch;this.sourceTime=g.sampleTime;
   this.car=g.carModel;this.source=g.source;
   if(g.packet===this.packet){
    if(this.advance!==null&&now-this.advance>400){this.grip.pause();this.view={fresh:false,unloaded:[false,false,false,false]};this.samples=[];this.filtered={};this.cues={};this.trend={candidate:null,since:null,active:null};}
    return this.view;
   }
   s=Context.sanitize(s);g=s.game;
   if(!g.available){this.reset(now);return this.view;}
   if(this.advance!==null&&now<this.advance){this.car=null;this.reset(now);return this.view;}
   const gap=this.advance===null?0:now-this.advance,dt=gap>0&&gap<250?gap:16;
   if(gap>250){this.grip.pause();this.samples=[];this.filtered={};this.cues={};this.trend={candidate:null,since:null,active:null};this.loadState=Array.from({length:4},()=>({unloaded:false,transition:null}));}
   this.packet=g.packet;this.advance=now;
   const loads=g.wheels.map(w=>w.load),validLoads=loads.map(v=>Number.isFinite(v)&&v>=0&&v<100000),total=loads.reduce((a,v,i)=>a+(validLoads[i]?v:0),0);
   validLoads.forEach((valid,i)=>{if(valid&&loads[i]>=40)this.loadSupport[i]=true;});
   const loadKnownWheels=validLoads.map((valid,i)=>valid&&(this.loadSupport[i]||g.capabilities?.loads===true)),loadKnown=loadKnownWheels.every(Boolean);
   const threshold=clamp(total/Math.max(1,validLoads.filter(Boolean).length)*.025,40,100);
   // Without measured wheel loads, use the directly measured shock deflection:
   // a corner at its full extension with stopped extension velocity is treated
   // as unloaded. Loads, when present, remain authoritative.
   const contact=this.contact.update(g.wheels,Math.abs(g.speedKmh||0)/3.6,now);
   const unloaded=this.loadState.map((st,i)=>{
    if(!loadKnownWheels[i]){const air=contact.available&&contact.airborne[i];st.unloaded=air;st.transition=null;return air;}
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
   const lateralSlip=this.lateralSlip.update(g,unloaded,loadKnownWheels);
   const frontResponse=this.frontSteeringResponse.update(g,raw,unloaded,s.handbrake,now);
   if(steering)steering.gripAssessment=grip.available?'estimated':grip.reason;
   const feedback=this.feedback.update(s,Number.isFinite(g.sampleTime)?g.sampleTime:now,unloaded,steering,loadKnownWheels,grip.vehicleResponse,now);
   const traction=this.pedalTraction.update(s,unloaded,now);
   const drive=traction?.pedal==='drive'?traction:null,brake=traction?.pedal==='brake'?traction:null;
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
   this.view={fresh:true,packet:g.packet,telemetryTime:g.sampleTime,processedAt:now,loadKnown,loadKnownWheels,unloaded,contact,steering,lateral,lateralSlip,frontResponse,drive,brake,decel,grip,feedback};this.view.handling=this.handling.update(s,now,this.view);return this.view;
  }
 }
 const api={Model,geometry};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DrivingAssist=api;
})(typeof window!=='undefined'?window:globalThis);
