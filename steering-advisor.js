'use strict';
// Combined-slip steering counterfactual. Read-only: never sends wheel or pedal input.
(function(root){
 const R=180/Math.PI,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
 const median=a=>{const v=[...a].sort((x,y)=>x-y);return v[Math.floor(v.length/2)];};
 function force(k,a,cx,cy,mu){
  const x=cx*Math.abs(k),y=cy*Math.tan(Math.abs(a)),d=Math.hypot(x,y);
  if(d<1e-8)return {x:0,y:0};
  const p=clamp(d/(3*mu),0,1),q=mu*p*(3-3*p+p*p);
  return {x:q*x/d,y:q*y/d};
 }
 function retainedAngle(k,a,cx,cy,mu,keep=.97){
  const target=force(k,a,cx,cy,mu).y*keep;let lo=0,hi=a;
  for(let i=0;i<18;i++){const mid=(lo+hi)/2;if(force(k,mid,cx,cy,mu).y<target)lo=mid;else hi=mid;}
  return hi;
 }
 function retainedKappa(k,a,cx,cy,mu,keep=.97){
  const target=force(k,a,cx,cy,mu).x*keep;let lo=0,hi=k;
  for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(force(mid,a,cx,cy,mu).x<target)lo=mid;else hi=mid;}
  return hi;
 }
 class Advisor {
  constructor(){this.ratios=[];this.ratioStamp=-Infinity;this.pause();}
  pause(){this.positions=[];this.lastPosition=null;this.lastNow=null;this.turn=0;this.turnSince=0;this.onSince=null;this.offSince=null;this.action=false;this.needle=0;this.trend=[];this.lastRapidSteer=-Infinity;this.motion={active:false,state:'unconfirmed'};}
  observe(g,now){
   const points=g.wheels?.map(w=>w.contactPoint),valid=points?.length===4&&points.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite));
   if(!valid){this.motion={active:false,state:'position-unavailable'};return this.motion;}
   const p=[0,1,2].map(i=>points.reduce((a,v)=>a+v[i],0)/4),prev=this.lastPosition,dt=prev?(now-prev.time)/1000:0;
   if(prev&&dt>0&&dt<.5){const distance=Math.hypot(...sub(p,prev.p)),expected=Math.abs(g.speedKmh||0)/3.6*dt;
    if(distance>Math.max(8,expected*3+2)){this.pause();this.motion={active:false,state:'teleport'};}
   }
   this.lastPosition={p,time:now};this.positions.push({p,time:now});this.positions=this.positions.filter(v=>now-v.time<=300);
   const first=this.positions[0],span=(now-first.time)/1000,travel=Math.hypot(...sub(p,first.p));
   const speed=span>.06?travel/span:0;
   this.motion={active:span>.06&&g.speedKmh>10&&speed>2.5,state:span<=.06?'unconfirmed':g.speedKmh<=10||speed<=2.5?'stationary':'moving',observedSpeed:speed,spanMs:span*1000};
   return this.motion;
  }
  knowledge(tire,w,now){
   const f=tire?.fit,ref=tire?.reference;
   const fitOk=f&&now-f.time<180000&&w.load/f.load>.5&&w.load/f.load<2&&f.c>3&&f.c<180;
   const loadTrust=fitOk?clamp(1-Math.max(0,Math.abs(Math.log(w.load/f.load))-.15)*1.3,.2,1):0;
   const fc=fitOk?(f.stiffnessConfidence??f.confidence)*loadTrust*Math.exp(-Math.max(0,now-f.time-30000)/120000):0;
   const rc=ref&&now-ref.time<180000?Math.min(.8,ref.count/25)*(ref.trust??1)*Math.exp(-Math.max(0,now-ref.time-30000)/120000):0;
   if(fc>=rc&&fc>.28)return {c:f.c,confidence:fc,method:'force-slip-stiffness'};
   if(rc>.28)return {c:ref.c,confidence:rc,method:'linear-stiffness'};
   return null;
  }
  update(s,now,unloaded,steering,latTires,longTires,context=null){
   const g=s.game,wheels=g.wheels,motion=this.motion,dt=this.lastNow===null?20:clamp(now-this.lastNow,1,100);this.lastNow=now;
   const delta=steering?.wheel;
   if(!Number.isFinite(delta)||Math.abs(delta)<.12)this.turn=0;
   else if(Math.abs(delta)>.35&&Math.sign(delta)!==this.turn){this.turn=Math.sign(delta);this.turnSince=now;this.onSince=null;this.action=false;this.needle=0;}
   const turn=this.turn,forward=g.localVelocity?.[2],handbrake=s.handbrake>1;
   this.ratios=this.ratios.filter(v=>now-v.time<30000&&!context?.states?.[v.wheel]?.changed);
   if(motion.active&&context?.learningAllowed!==false&&now-this.ratioStamp>=80){
    this.ratioStamp=now;
    for(let i=0;i<4;i++){const w=wheels[i],a=Math.abs(Math.tan(w.angle)),k=Math.abs(w.ratio),qx=Math.abs(w.fx)/Math.max(1,w.load),qy=Math.abs(w.fy)/Math.max(1,w.load);
     if(!unloaded[i]&&w.load>200&&a>.012&&a<.5&&k>.008&&k<.3&&qx>.06&&qy>.06){const ratio=qy*k/(qx*a);if(ratio>.2&&ratio<5)this.ratios.push({time:now,value:Math.log(ratio),axle:i<2?0:1,wheel:i});}
    }
   }
   this.ratios=this.ratios.slice(-1500);
   const wheelRatios=[0,1,2,3].map(wheel=>{
    const values=this.ratios.filter(v=>v.wheel===wheel).map(v=>v.value),middle=values.length?median(values):0;
    const spread=values.length?median(values.map(v=>Math.abs(v-middle))):1;
    return {ratio:Math.exp(middle),confidence:Math.sqrt(Math.min(1,values.length/18))*clamp(1-spread/.50,0,1)};
   });
   // Axle summaries are diagnostics only. Each wheel consumes its OWN longitudinal/lateral ratio.
   const ratioModels=[0,1].map(a=>({ratio:(wheelRatios[a*2].ratio+wheelRatios[a*2+1].ratio)/2,confidence:Math.min(wheelRatios[a*2].confidence,wheelRatios[a*2+1].confidence)}));
   const {ratio,confidence:ratioConfidence}=ratioModels[0];
   const alive=[0,1].filter(i=>!unloaded[i]&&wheels[i].load>200&&Number.isFinite(wheels[i].angle)&&Number.isFinite(wheels[i].fy)),total=alive.reduce((a,i)=>a+wheels[i].load,0),estimates=[],pedalEvidence=[],axisSelection=[];
   const allAlive=[0,1,2,3].filter(i=>!unloaded[i]&&wheels[i].load>200&&['angle','ratio','fx','fy'].every(k=>Number.isFinite(wheels[i][k])));
   for(const i of allAlive){
    const {ratio,confidence:ratioConfidence}=wheelRatios[i];
    const axleTotal=allAlive.filter(j=>(j<2)===(i<2)).reduce((sum,j)=>sum+wheels[j].load,0);
    const w=wheels[i],kx=this.knowledge(longTires[i],w,now);let ky=this.knowledge(latTires[i],w,now),cx=kx;
    const selection={wheel:i,longitudinal:kx,lateral:ky,modelRejection:null};axisSelection.push(selection);
    const qx=Math.abs(w.fx)/w.load,qy=Math.abs(w.fy)/w.load;
    const longitudinalLocal=context?.learningAllowed!==false?longTires[i]?.local?.({...w,angle:Math.atan(w.ratio),ratio:Math.tan(w.angle),fy:w.fx,fx:w.fy,mz:0},now):null;
    if(longitudinalLocal?.confidence>=.6&&longitudinalLocal.retentionSupported&&longitudinalLocal.fraction>.10&&Math.abs(w.ratio)>.02){
     pedalEvidence.push({wheel:i,kind:w.ratio>0&&w.fx>0?'drive':w.ratio<0&&w.fx<0?'brake':null,confidence:longitudinalLocal.confidence,
      fraction:longitudinalLocal.fraction,weight:w.load/axleTotal,method:'observed-longitudinal-retention',postPeak:longitudinalLocal.pastPeak});
    }
    // Direction of the combined force identifies Cy/Cx even while the front wheels are driven or braked.
    if(kx&&ratioConfidence>.45&&(!ky||Math.min(kx.confidence,ratioConfidence)>ky.confidence))ky={c:kx.c*ratio,confidence:Math.min(kx.confidence,ratioConfidence),method:'combined-force-direction'};
    if(kx&&!ky&&Math.abs(w.angle)<.008&&Math.abs(w.fy)/w.load<.06)ky={c:kx.c,confidence:kx.confidence,method:'negligible-lateral-demand'};
    if(ky&&!cx&&ratioConfidence>.45)cx={c:ky.c/ratio,confidence:Math.min(ky.confidence,ratioConfidence),method:'combined-force-direction'};
    if(ky&&!cx&&Math.abs(w.ratio)<.008&&Math.abs(w.fx)/w.load<.05)cx={c:ky.c,confidence:ky.confidence,method:'negligible-longitudinal-demand'};
    // Select only the axes needed by the measured force. A weak-but-present optional
    // axis must not disable a stronger pure-axis estimate (missing/weak/strong is monotone).
    const negligibleLong=!!ky&&qx<.05&&qx<Math.max(.015,qy*.10)&&Math.abs(w.ratio)<.02&&(!cx||cx.confidence<ky.confidence||cx.method==='negligible-longitudinal-demand');
    const negligibleLat=!!kx&&qy<.06&&qy<Math.max(.015,qx*.10)&&Math.abs(w.angle)<.012&&(!ky||ky.confidence<kx.confidence||ky.method==='negligible-lateral-demand');
    if(negligibleLong)cx={c:ky.c,confidence:ky.confidence,method:'negligible-longitudinal-force'};
    if(negligibleLat)ky={c:kx.c,confidence:kx.confidence,method:'negligible-lateral-force'};
    Object.assign(selection,{selectedLongitudinal:cx,selectedLateral:ky,negligibleLong,negligibleLat});
    const local=context?.learningAllowed!==false?latTires[i]?.local?.(w,now):null;
    let localEstimate=null;
    if(local&&local.confidence>=.6&&local.covered&&(local.retentionSupported||local.postPeak||local.plateau)){
     const a=Math.abs(w.angle),qy=Math.abs(w.fy)/w.load;
     localEstimate={wheel:i,load:w.load,confidence:local.confidence,stiffnessSource:'observed-local-response',eta:local.fraction>.10?.4:.9,
      fraction:local.fraction,alpha:a*R,retainAngle:local.retainAngle*R,reduction:local.reduction*R,pedalBenefit:0,marginal:local.slope,
      weight:w.load/axleTotal,forwardSlip:-(w.angle*R),positiveDrive:w.ratio>.02&&w.fx>0,braking:w.ratio<-.02&&w.fx<0,
      empirical:{peak:local.peak,current:qy,postPeak:local.postPeak,bins:local.bins}};
     estimates.push(localEstimate);
    }
    if(!cx||!ky){selection.modelRejection='required-axis-unavailable';continue;}
    const confidence=Math.min(cx.confidence,ky.confidence),a=Math.abs(w.angle),k=Math.abs(w.ratio),modelK=negligibleLong?0:k,modelA=negligibleLat?0:a;
    if((a<.006&&k<.015)||!Number.isFinite(k)||confidence<.36){selection.modelRejection=confidence<.36?'required-axis-low-confidence':'insufficient-slip';continue;}
    const dx=cx.c*modelK,dy=ky.c*Math.tan(modelA),d=Math.hypot(dx,dy),q=Math.hypot(qx,qy),eta=d>1e-6?q/d:1;
    if(q<.04||d<.05){selection.modelRejection='insufficient-force';continue;}
    const alignment=(qx*dx+qy*dy)/(q*d);
    if(alignment<.90){selection.modelRejection='force-direction-mismatch';continue;}
    const e=clamp(eta,1/3,1),x=clamp((3-Math.sqrt(Math.max(0,12*e-3)))/2,0,1);
    const mu=eta<=1/3?q:x>.02?d/(3*x):Math.max(q*3,3);
    const keep=negligibleLat?a:retainedAngle(modelK,a,cx.c,ky.c,mu),fraction=a>.0001?clamp((a-keep)/a-.035,0,1):0;
    const moreLat=force(modelK*.65,modelA,cx.c,ky.c,mu).y,baseline=force(modelK,modelA,cx.c,ky.c,mu).y;
    const pedalBenefit=baseline>.03?clamp(moreLat/baseline-1,0,2):0;
    const keepK=negligibleLong?k:retainedKappa(k,modelA,cx.c,ky.c,mu),longitudinalFraction=k>.015?clamp(1-keepK/k-.035,0,1):0;
    const marginal=eta+(dy*dy/(d*d))*(Math.max(0,1-d/(3*mu))**2-eta);
    if(localEstimate){localEstimate.pedalBenefit=pedalBenefit;localEstimate.longitudinalFraction=longitudinalFraction;localEstimate.driveEta=eta;localEstimate.driveConfidence=confidence;}
    else estimates.push({wheel:i,load:w.load,confidence,cx:cx.c,cy:ky.c,stiffnessSource:ky.method,longitudinalPolicy:negligibleLong?'negligible-measured-force':'model',lateralPolicy:negligibleLat?'negligible-measured-force':'model',eta,mu,
     fraction,alpha:a*R,retainAngle:keep*R,reduction:(a-keep)*R,pedalBenefit,longitudinalFraction,marginal,weight:w.load/axleTotal,
     forwardSlip:-(w.angle*R),positiveDrive:w.ratio>.02&&w.fx>0,braking:w.ratio<-.02&&w.fx<0});
   }
   const reliable=estimates.filter(e=>e.weight>=.30&&e.confidence>=.45);
   const supported=reliable.filter(e=>e.wheel<2),chosen=supported.reduce((a,b)=>!a||b.fraction>a.fraction?b:a,null);
   const frontAlpha=total?alive.reduce((a,i)=>a+Math.abs(wheels[i].angle)*wheels[i].load/total,0):0;
   const rear=wheels.slice(2).filter((w,i)=>!unloaded[i+2]&&w.load>200&&Number.isFinite(w.angle)),rearTotal=rear.reduce((a,w)=>a+w.load,0);
   const rearAlpha=rearTotal?rear.reduce((a,w)=>a+Math.abs(w.angle)*w.load/rearTotal,0):0;
   const rearDominant=rearAlpha>Math.max(.14,frontAlpha*1.4);
   const signedAlpha=total?alive.reduce((a,i)=>a-wheels[i].angle*wheels[i].load/total,0)*R:0;
   const sameTurn=turn!==0&&turn*signedAlpha>.2;
   const bodyYaw=Array.isArray(g.angularVelocity)&&Number.isFinite(g.angularVelocity[1])?-g.angularVelocity[1]:null;
   const wheelbase=steering?.wheelbase;
   const geometric=Number.isFinite(delta)&&wheelbase>1&&forward>3?Math.tan(delta/R)/wheelbase:null;
   const actual=bodyYaw!==null&&forward>3?bodyYaw/forward:null;
   const yawDeficit=geometric!==null&&actual!==null&&Math.abs(geometric)>.0002?clamp(1-actual/geometric,-2,2):null;
   const frontForce=total?alive.reduce((a,i)=>a+Math.abs(wheels[i].fy),0)/total:0;
   const previous=this.trend.at(-1);
   if(previous&&now>previous.time&&Math.abs(Math.abs(delta||0)-previous.delta)/(now-previous.time)*1000>18)this.lastRapidSteer=now;
   this.trend.push({time:now,delta:Math.abs(delta||0),force:frontForce,load:total});this.trend=this.trend.filter(v=>now-v.time<260);
   const first=this.trend[0],span=(now-first.time)/1000,forceGrowth=span>.10?(frontForce-first.force)/span:Infinity;
   const steerStable=span>.10&&Math.abs(Math.abs(delta||0)-first.delta)<Math.max(.5,Math.abs(delta||0)*.1);
   const stableLoad=this.trend.length>=3&&Math.min(...this.trend.map(p=>p.load))>Math.max(...this.trend.map(p=>p.load))*.8;
   // A well-supported, low-gain force response can settle before the driver's hands stop moving.
   // Keep the normal transient veto unless force, load and model evidence all agree.
   const saturationSettled=now-this.turnSince>=180&&span>=.16&&stableLoad&&chosen?.confidence>=.65&&chosen.eta<.5&&chosen.fraction>.15&&frontForce>.25&&forceGrowth<.15;
   const responseSettled=now-this.turnSince>=160&&now-this.lastRapidSteer>=100&&(steerStable||forceGrowth<.6)||!!saturationSettled;
   const yawReversal=turn!==0&&bodyYaw!==null&&turn*bodyYaw<-.15;
   const rearRotation=rearAlpha>.06&&yawDeficit!==null&&yawDeficit<-.5;
   const usable=motion.active&&context?.actionAllowed!==false&&forward>3&&!handbrake&&sameTurn&&!rearDominant&&!yawReversal&&!rearRotation;
   const gripLow=usable&&supported.some(e=>e.eta<.6&&e.alpha>1.2);
   const reduction=chosen?Math.min(chosen.reduction,Math.abs(delta||0)*.85):0;
   // Local front-force evidence and whole-body yaw answer different questions.
   // Only a supported non-productive front response can bypass the ordinary yaw deficit check.
   const frontEvidence=!!chosen&&chosen.confidence>=.6&&chosen.fraction>.10&&(
    !!chosen.empirical||chosen.eta<.5&&chosen.marginal<.15&&frontForce>.25&&forceGrowth<.6);
   const yawCompatible=yawDeficit!==null&&yawDeficit>.06||frontEvidence;
   const candidate=usable&&responseSettled&&chosen&&chosen.fraction>.10&&reduction>Math.max(.10,Math.abs(delta||0)*.04)&&yawCompatible;
   if(candidate){this.offSince=null;if(this.onSince===null)this.onSince=now;if(now-this.onSince>=120)this.action=true;}
   else {this.onSince=null;if(this.offSince===null)this.offSince=now;if(now-this.offSince>=160)this.action=false;}
   if(!usable){this.action=false;this.onSince=null;this.offSince=null;}
   const pressure=usable&&chosen?clamp((chosen.fraction-.035)/.35,0,1):0;
   const indication=usable&&responseSettled&&pressure>.03&&yawCompatible;
   const target=indication?turn*Math.sqrt(pressure):0;this.needle+=(target-this.needle)*(1-Math.exp(-dt/(indication?90:120)));
   if(!usable)this.needle=0;
   const supportedPedals=pedalEvidence.filter(e=>e.kind&&e.weight>=.30);
   const driveCounterfactual=reliable.filter(e=>e.positiveDrive&&(e.pedalBenefit>.08||e.longitudinalFraction>.10)&&(e.driveEta??e.eta)<.65&&(e.driveConfidence??e.confidence)>=.45);
   const brakeCounterfactual=reliable.filter(e=>e.braking&&(e.pedalBenefit>.08&&e.alpha>.5||e.longitudinalFraction>.10)&&(e.driveEta??e.eta)<.65&&(e.driveConfidence??e.confidence)>=.45);
   const pedalUsable=motion.active&&context?.actionAllowed!==false&&forward>3&&!handbrake;
   const lift=pedalUsable&&g.gas>.18&&g.brake<.1&&(driveCounterfactual.length>0||supportedPedals.some(e=>e.kind==='drive'));
   const brakeRelease=pedalUsable&&g.brake>.08&&g.gas<.1&&(brakeCounterfactual.length>0||supportedPedals.some(e=>e.kind==='brake'));
   const brakeSeverity=Math.max(0,...brakeCounterfactual.map(e=>clamp(Math.max(e.longitudinalFraction||0,e.pedalBenefit/.5),.15,1)),...supportedPedals.filter(e=>e.kind==='brake').map(e=>e.fraction));
   return {gripLow:!!gripLow,easeSteering:!!this.action,indication:!!indication,needle:Math.abs(this.needle)<.012?0:this.needle,
    steeringPressure:pressure,confidence:chosen?.confidence??0,turnIntent:turn,lift,brakeRelease,brakeSeverity,steeringReduction:reduction,
    advisor:{method:'combined-slip-retained-lateral-force',motion,yawDeficit,responseSettled,settlingSource:saturationSettled?'supported-force-plateau':'normal-response',forceGrowth:Number.isFinite(forceGrowth)?forceGrowth:null,
     gates:{context:context?.actionAllowed!==false,forward:forward>3,handbrake:!handbrake,sameTurn,rearDominant,yawReversal,rearRotation,frontEvidence,yawCompatible,usable,candidate},chosenWheel:chosen?.wheel??null,
     ratio,ratioConfidence,axleRatios:ratioModels,wheelRatios,estimates,axisSelection,pedalEvidence,driveCounterfactuals:driveCounterfactual.length,brakeCounterfactuals:brakeCounterfactual.length,reason:!motion.active?motion.state:context?.actionAllowed===false?(context.reason==='ready'?'controls-unavailable':context.reason||'context-blocked'):!(forward>3)?'not-forward':handbrake?'handbrake':!sameTurn?'not-excess-in-turn':rearDominant?'rear-dominant':yawReversal?'yaw-reversal':rearRotation?'rear-rotation':!chosen?'stiffness-unavailable':!responseSettled?'response-building':candidate?'reduce-steering':indication?'steering-saturation':!yawCompatible?'yaw-without-front-evidence':'productive-or-insufficient-reduction'}};
  }
  snapshot(now){return {ratios:this.ratios.map(r=>({...r,time:now-r.time}))};}
  restore(data,now,elapsed){if(Array.isArray(data?.ratios))this.ratios=data.ratios.slice(-600).filter(v=>Number.isInteger(v.wheel)&&v.wheel>=0&&v.wheel<4&&Number.isFinite(v.value)&&Number.isFinite(v.time)&&v.time>=0&&v.time+elapsed<30000).map(v=>({...v,time:now-v.time-elapsed}));}
 }
 const api={Advisor,force,retainedAngle};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SteeringAdvisor=api;
})(typeof window!=='undefined'?window:globalThis);
