'use strict';
// Read-only, session-local brush-model estimation. No control or device outputs.
(function(root){
 const Steering=typeof module!=='undefined'&&module.exports?require('./steering-advisor.js'):root.SteeringAdvisor;
 const Reserve=typeof module!=='undefined'&&module.exports?require('./reserve.js').Reserve:root.GripReserve.Reserve;
 const Context=typeof module!=='undefined'&&module.exports?require('./telemetry-context'):root.TelemetryContext;
 const Response=typeof module!=='undefined'&&module.exports?require('./tyre-response'):root.TyreResponse;
 const RAD=180/Math.PI,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function brush(tangent,c,mu){const x=clamp(c*tangent/(3*mu),0,1);return mu*x*(3-3*x+x*x);}
 const quantile=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p*(s.length-1)))];};
 class Tire {
  constructor(axis='lateral'){this.axis=axis;this.clear();}
  clear(){this.samples=[];this.previous=null;this.lastSample=-Infinity;this.lastFit=-Infinity;this.fit=null;this.reference=null;this.lastReference=-Infinity;this.mismatchSince=null;this.turn=0;this.turnSince=0;this.event=0;this.eventDirection=0;this.eventStart=0;this.eventTime=-Infinity;this.condition=null;this.localCache=null;this.localStamp=-Infinity;}
  invalidate(now){
   // A recent stiffness reference may be useful later, but is not trusted until re-observed.
   if(this.reference)this.reference={...this.reference,trust:.25};
   this.samples=[];this.fit=null;this.mismatchSince=null;this.lastFit=now;this.localCache=null;this.localStamp=-Infinity;
  }
  local(w,now){
   if(!w||!['angle','ratio','load','fy'].every(k=>Number.isFinite(w[k]))||w.load<200)return null;
   if(now-this.localStamp>=120){this.localStamp=now;this.localCache=Response.mapResponse(this.samples,w,now);this.localInput={...w};}
   const c=this.localCache;
   if(!c||!this.localInput)return null;
   const prev=this.localInput;
   if(Math.abs(w.angle-prev.angle)>.01||Math.abs(w.ratio-prev.ratio)>.015||Math.abs(w.load-prev.load)>prev.load*.1||Math.abs(w.fy/w.load-prev.fy/prev.load)>.08)return null;
   return c;
  }
  update(w,now,eligible,learn=eligible,allowFit=true){
   if(this.axis==='longitudinal'&&w&&(!Number.isFinite(w.angle)||!Number.isFinite(w.ratio)))return {available:false,reason:'force-data'};
   if(this.axis==='longitudinal'&&w)w={...w,angle:Math.atan(w.ratio),ratio:Math.tan(w.angle),fy:w.fx,fx:w.fy,mz:0};
   const valid=w&&['load','angle','fx','fy','ratio'].every(k=>Number.isFinite(w[k]))&&w.load>200&&w.load<40000&&Math.abs(w.angle)<1.05;
   if(!valid){this.previous=null;return {available:false,reason:'force-data'};}
   const currentCondition=Context.condition(w);
   if(this.condition&&!Context.compatible(this.condition,currentCondition))this.invalidate(now);
   this.condition=Context.anchor(this.condition,currentCondition);
   const alpha=Math.abs(w.angle),tangent=Math.tan(alpha),q=Math.abs(w.fy)/w.load,fx=Math.abs(w.fx)/w.load,demand=Math.hypot(q,fx),turn=Math.sign(w.angle);
   if(!Number.isFinite(demand)||demand>6){this.previous=null;return {available:false,reason:'force-range'};}
   if(turn!==this.turn&&alpha>.006){this.turn=turn;this.turnSince=now;}
   const previous=this.previous,dt=previous?now-previous.time:0;
   // Reject load shocks and rapid transients. Moderate combined slip is fitted using the measured cross-axis force.
   const settled=previous&&dt>0&&dt<250&&Math.abs(w.load-previous.load)/Math.max(w.load,previous.load)<.10&&Math.abs(alpha-previous.alpha)/(dt/1000)<.9&&now-this.turnSince>=180;
   const pure=Math.abs(w.ratio)<.10&&fx<Math.max(.06,q*.30);
   this.samples=this.samples.filter(s=>now-s.time<45000&&Context.compatible(s.condition||currentCondition,currentCondition));
   if(learn&&settled&&Math.abs(w.ratio)<.18&&fx<3&&alpha>.006&&alpha<.52&&q>.035&&now-this.lastSample>=80){
    const direction=previous?Math.sign(alpha-previous.alpha):0;
    if(direction&&direction!==this.eventDirection&&Math.abs(alpha-this.eventStart)>.012&&now-this.eventTime>600){this.event++;this.eventDirection=direction;this.eventStart=alpha;this.eventTime=now;}
    this.samples.push({time:now,t:tangent,q,cross:fx,k:w.ratio,event:this.event,condition:currentCondition,load:w.load,trail:Number.isFinite(w.mz)?Math.abs(w.mz)/Math.max(100,Math.abs(w.fy)):null});this.lastSample=now;
    if(this.samples.length>360)this.samples.shift();
   }
   if(learn&&allowFit&&now-this.lastFit>=600){this.lastFit=now;const next=this.solve(w.load,now);if(next)this.fit=next;}
   this.previous={time:now,alpha,load:w.load};
   const response=this.response(w,now,eligible);
   const fit=this.fit;
   if(!eligible||!fit||now-fit.time>180000||w.load/fit.load<.55||w.load/fit.load>1.80)return response||{available:false,reason:eligible?'learning':'condition',sampleCount:this.samples.length};
   const expected=brush(tangent,fit.c,Math.sqrt(Math.max(.0025,fit.mu*fit.mu-fx*fx))),error=Math.abs(q-expected);
   // A new surface or tyre state must not inherit a strong but incompatible old fit.
   // Only assess mismatch in the same near-pure, settled regime used for learning.
   if(settled&&pure&&alpha>.025&&error>Math.max(.18,fit.mu*.22)){
    if(this.mismatchSince===null)this.mismatchSince=now;
    if(now-this.mismatchSince>=320){this.invalidate(now);return {available:false,reason:'capacity-change'};}
   }else this.mismatchSince=null;
   const agedConfidence=fit.confidence*Math.exp(-Math.max(0,now-fit.time-30000)/100000);
   const confidence=this.mismatchSince===null?agedConfidence:Math.min(.25,agedConfidence);
   if(response?.available&&this.mismatchSince===null&&confidence<.58)return response;
   const remaining=clamp(1-demand/fit.mu,0,1),low=clamp(1-demand/fit.muLow,0,1),high=clamp(1-demand/fit.muHigh,0,1);
   // Approximate friction-circle reduction is only an ESTIMATE, not an exact combined-slip tyre law.
   const lateralCapacity=Math.sqrt(Math.max(0,fit.mu*fit.mu-fx*fx));
   const alpha95=Math.atan(3*lateralCapacity/fit.c*(1-Math.cbrt(.05)));
   const slopeRatio=Math.pow(Math.max(0,1-fit.c*tangent/(3*Math.max(.05,lateralCapacity))),2);
   const excess=Math.max(0,alpha-Math.max(alpha95,fit.alpha95High));
   const trail=Number.isFinite(w.mz)?Math.abs(w.mz)/Math.max(100,Math.abs(w.fy)):null;
   const trailDrop=Number.isFinite(trail)&&fit.trailReference>.005&&trail<fit.trailReference*.55&&alpha>alpha95*.8;
   const saturation=fit.c*tangent/(3*Math.max(.05,lateralCapacity)),pressure=clamp((saturation-(1-Math.cbrt(.05)))/Math.cbrt(.05),0,1);
   const angleValid=alpha>Math.max(.003,alpha95*.15);
   return {available:confidence>=.22,reason:confidence>=.22?'estimated':'learning',confidence,remaining,low,high,
    capacity:fit.mu*w.load,demand:demand*w.load,mu:fit.mu,muLow:fit.muLow,muHigh:fit.muHigh,
    alpha95:alpha95*RAD,slopeRatio,excess:excess*RAD,trailDrop,pressure,
    // Do not diagnose over-steering from a force circle alone, or from a tiny noisy alpha.
    limited:confidence>=.58&&angleValid&&slopeRatio<.13&&demand/fit.muHigh>.82,
    over:confidence>=.62&&pure&&angleValid&&excess>Math.max(.001,alpha95*.05)&&slopeRatio<.13,
    samples:fit.count,fitError:fit.error,axis:this.axis};
  }
  response(w,now,eligible){
   if(!eligible)return null;
   const pool=this.samples.filter(s=>now-s.time<45000&&s.load/w.load>.55&&s.load/w.load<1.8);
   const regress=rows=>{
    if(rows.length<10)return null;
    const mx=rows.reduce((a,p)=>a+p.t,0)/rows.length,my=rows.reduce((a,p)=>a+p.q,0)/rows.length;
    let xx=0,xy=0,yy=0;for(const p of rows){xx+=(p.t-mx)**2;xy+=(p.t-mx)*(p.q-my);yy+=(p.q-my)**2;}
    if(xx<1e-5)return null;
    const c=xy/xx,b=my-c*mx,r2=yy>1e-6?xy*xy/(xx*yy):0;
    return {c,b,r2,span:Math.max(...rows.map(p=>p.t))-Math.min(...rows.map(p=>p.t))};
   };
   if(now-this.lastReference>350){
    this.lastReference=now;
    const rows=pool.filter(s=>s.t<.065&&s.q>.06&&s.q<.75&&(s.cross||0)<Math.max(.07,s.q*.3));
    const f=regress(rows);
    if(f&&f.c>3&&f.c<180&&Math.abs(f.b)<.18&&f.r2>.85&&f.span>.008){
     const c=f.c*1.10;
     // A lower small-slip reference must not immediately erase established non-linear degradation.
     if(!this.reference||(this.reference.trust??1)<.5||now-this.reference.time>90000||c>this.reference.c*.96)this.reference={c:Math.max(c,this.reference&&(this.reference.trust??1)>=.5&&now-this.reference.time<90000?this.reference.c*.995:0),b:f.b,time:now,count:rows.length,trust:1};
    }
   }
   const ref=this.reference;
   if(!ref||now-ref.time>180000||(ref.trust??1)<.5)return null;
   const rawT=Math.tan(Math.abs(w.angle)),t=Math.max(.003,rawT),q=Math.max(0,Math.abs(w.fy)/w.load-ref.b),cross=Math.abs(w.fx)/w.load;
   // A small-slip reference identifies stiffness, not an arbitrary missing peak.
   // Combined demand cannot be inverted as a pure-axis Fiala capacity.
   if(rawT<.006||cross>Math.max(.06,q*.30))return null;
   const ratio=clamp(q/(ref.c*t),.33334,1);
   if(ratio>.90)return null; // Near-linear inverse is ill-conditioned; keep the broad force envelope.
   const x=clamp((3-Math.sqrt(Math.max(0,12*ratio-3)))/2,0,1);
   const inferredMu=x>.035?ref.c*t/(3*x):4.5,mu=clamp(inferredMu,.22,4.5);
   if(inferredMu<Math.hypot(Math.abs(w.fy)/w.load,cross)*.92||inferredMu<=.22||inferredMu>=4.5)return null;
   const confidence=Math.min(rawT<.003?.40:.70,clamp(ref.count/45,0,.70))*(ratio>.75?.72:1)*Math.exp(-Math.max(0,now-ref.time-30000)/120000);
   const reserve=clamp(1-Math.hypot(q,cross)/mu,0,1),muLow=rawT<.003?.05:mu*.75,muHigh=rawT<.003?4.5:mu*1.30;
   const recent=pool.filter(s=>now-s.time<1700&&(s.cross||0)<Math.max(.07,s.q*.3)),local=regress(recent);
   const weakGain=local&&local.span>.008&&local.c/ref.c<.25;
   const alpha95=Math.atan(3*mu/ref.c*(1-Math.cbrt(.05)));
   const pure=Math.abs(w.ratio)<.10&&cross<Math.max(.06,q*.30),limited=confidence>=.58&&ratio<.50&&Math.abs(w.angle)>Math.max(.003,alpha95*.15);
   // An established non-linear response can support steady-state advice without waiting for a fresh steering sweep.
   const over=limited&&pure&&(weakGain||ratio<.48);
   const pressure=clamp((x-(1-Math.cbrt(.05)))/Math.cbrt(.05),0,1);
   return {available:confidence>=.20,reason:'response-estimate',confidence,mu,muLow,muHigh,
    remaining:reserve,low:clamp(1-Math.hypot(q,cross)/muLow,0,1),high:clamp(1-Math.hypot(q,cross)/muHigh,0,1),
    limited,over,pressure,alpha95:alpha95*RAD,excess:Math.max(0,Math.abs(w.angle)-alpha95)*RAD,
    slopeRatio:(1-x)**2,capacity:mu*w.load,demand:Math.hypot(q,cross)*w.load,trailDrop:false,axis:this.axis,
    samples:ref.count,method:'normalized-response',responseRatio:ratio};
  }
  solve(load,now){
   const pool=this.samples;
   const data=pool.filter(s=>now-s.time<45000&&s.load/load>.55&&s.load/load<1.8).sort((a,b)=>a.time-b.time).map(s=>({...s,weight:Math.exp(-(now-s.time)/24000)*Math.exp(-Math.pow(Math.log(s.load/load)/.40,2))}));
   if(data.length<22||data.at(-1).time-data[0].time<1600)return null;
   // Downsample to bound grid-search cost. Values are retained in the raw session window.
   const stride=Math.max(1,Math.ceil(data.length/100)),points=data.filter((_,i)=>i%stride===0);
   const spread=quantile(points.map(p=>Math.atan(p.t)),.9)-quantile(points.map(p=>Math.atan(p.t)),.1);
   if(spread<.024)return null;
   const bins=new Set(points.map(p=>Math.floor(Math.atan(p.t)*RAD/1.5)));
   if(bins.size<3)return null;
   const sumWeight=points.reduce((s,p)=>s+p.weight,0),profiles=[];
   // Profile likelihood-style interval is conditional on this simple model, not a statistical guarantee.
   for(let m=0;m<45;m++){
    const mu=.22*Math.pow(4.5/.22,m/44),caps=points.map(p=>Math.sqrt(Math.max(.0025,mu*mu-(p.cross||0)**2)));let best=null;
    for(let k=0;k<33;k++){
     const c=4*Math.pow(180/4,k/32);let loss=0;
     for(let index=0;index<points.length;index++){const p=points[index],cross=p.cross||0,cap=caps[index],e=Math.abs(brush(p.t,c,cap)-p.q);loss+=p.weight*((e<=.08?e*e:.16*e-.0064)+Math.pow(Math.max(0,cross-mu),2));}
     loss/=sumWeight;if(!best||loss<best.loss)best={mu,c,loss};
    }
    profiles.push(best);
   }
   const best=profiles.reduce((a,b)=>a.loss<b.loss?a:b),near=profiles.filter(p=>p.loss<=best.loss*1.65+.0007);
   // Retain a model-error floor even with noiseless synthetic samples: a brush tyre is only an approximation.
   const muLow=Math.min(...near.map(p=>p.mu))*.88,muHigh=Math.max(...near.map(p=>p.mu))*1.12,width=(muHigh-muLow)/best.mu;
   const maxT=quantile(points.map(p=>p.t),.9),coverage=clamp(best.c*maxT/(3*best.mu)/.65,0,1);
   const quality=clamp(1-Math.sqrt(best.loss)/.15,0,1),identifiability=clamp(1-width/1.25,0,1),support=Math.min(clamp(data.length/65,0,1),new Set(data.map(p=>p.event)).size/3);
   // A fitted grid boundary or only straight/low-demand data does not establish peak capacity.
   const boundary=best.mu===profiles[0].mu||best.mu===profiles.at(-1).mu||best.c<=4.001||best.c>=179.99;
   const confidence=boundary?0:Math.min(quality,identifiability,coverage,support);
   const cLow=Math.min(...near.map(p=>p.c)),cHigh=Math.max(...near.map(p=>p.c));
   // Stiffness can be identified within a well-excited sweep; peak capacity requires repeated events.
   // Effective sample size accounts for age/load weights; precision scales with sqrt(N), not raw frame count.
   const effectiveN=sumWeight*sumWeight/points.reduce((n,p)=>n+p.weight*p.weight,0);
   const stiffnessSupport=clamp(Math.sqrt(effectiveN/65),0,1);
   const stiffnessConfidence=best.c<=4.001||best.c>=179.99?0:Math.min(quality,stiffnessSupport,clamp(1-(cHigh-cLow)/best.c,0,1));
   const alpha95High=Math.max(...near.map(p=>Math.atan(3*p.mu/p.c*(1-Math.cbrt(.05)))))*1.10;
   const lowerT=quantile(points.map(p=>p.t),.4),trailPoints=points.filter(p=>p.t<=lowerT&&p.trail>.001);
   return {...best,muLow,muHigh,cLow,cHigh,stiffnessConfidence,alpha95High,trailReference:trailPoints.length>=6?quantile(trailPoints.map(p=>p.trail),.5):0,
    confidence,load,time:now,count:data.length,error:Math.sqrt(best.loss)};
  }
 }
 class Estimator {
  constructor(){this.reset();}
  reset(){this.reserveModel=new Reserve();this.advisor=new Steering.Advisor();this.context=new Context.Context();this.fitCursor=0;this.fitStamp=-Infinity;this.tires=Array.from({length:4},()=>new Tire());this.longTires=Array.from({length:4},()=>new Tire('longitudinal'));this.states={};this.advance=null;this.axleFilters={};this.priors=[.9,.9,.9,.9];}
  pause(){this.advisor.pause();this.context.reset();this.states={};this.advance=null;for(const t of [...this.tires,...this.longTires]){t.previous=null;t.mismatchSince=null;}}
  snapshot(now){return {version:2,savedAt:Date.now(),priors:this.priors,reserve:this.reserveModel.snapshot(),steering:this.advisor.snapshot(now),tires:[...this.tires,...this.longTires].map(t=>({
   fit:t.fit?{...t.fit,time:now-t.fit.time}:null,reference:t.reference?{...t.reference,time:now-t.reference.time}:null,samples:t.samples.map(s=>({...s,time:now-s.time}))}))};}
  restore(data,now){
   const elapsed=Date.now()-data?.savedAt;
   if(data?.version!==2||!Array.isArray(data.tires)||data.tires.length!==8||!Number.isFinite(elapsed)||elapsed<0||elapsed>180000)return;
   if(Array.isArray(data.priors)&&data.priors.length===4&&data.priors.every(v=>Number.isFinite(v)&&v>=.2&&v<=5))this.priors=data.priors;
   [...this.tires,...this.longTires].forEach((t,i)=>{
    const src=data.tires[i],f=src?.fit;
    if(f&&['mu','muLow','muHigh','c','confidence','load','time','alpha95High','trailReference'].every(k=>Number.isFinite(f[k]))&&f.mu>.1&&f.mu<5&&f.c>0&&f.load>200&&f.time>=0&&f.time+elapsed<180000)t.fit={...f,time:now-f.time-elapsed,confidence:clamp(f.confidence*.90,0,1)};
    const ref=src?.reference;if(ref&&['c','b','time','count'].every(k=>Number.isFinite(ref[k]))&&ref.c>3&&ref.c<200&&ref.time>=0&&ref.time+elapsed<180000)t.reference={...ref,time:now-ref.time-elapsed};
    if(Array.isArray(src?.samples))t.samples=src.samples.slice(-360).filter(s=>['t','q','load','time'].every(k=>Number.isFinite(s[k]))&&s.time>=0&&s.time+elapsed<45000&&s.load>200&&s.q>=0&&s.q<6).map(s=>({...s,cross:Number.isFinite(s.cross)?s.cross:0,time:now-s.time-elapsed}));
   });
   this.pause();this.reserveModel.restore(data.reserve);this.advisor.restore(data.steering,now,elapsed);
  }
  held(key,condition,now,on=180,off=240){
   const s=this.states[key]||(this.states[key]={value:false,since:now,candidate:false});
   if(condition!==s.candidate){s.candidate=condition;s.since=now;}
   if(now-s.since>=(condition?on:off))s.value=condition;
   return s.value;
  }
  update(s,now,unloaded,steering,loadKnown){
   s=Context.sanitize(s);if(!s.game.available&&s.game.available!==undefined)return {available:false,reason:'invalid-telemetry',axles:{}};
   const context=this.context.update(s.game,now);context.actionAllowed=context.actionAllowed&&Number.isFinite(s.handbrake)&&s.handbrake>=0&&s.handbrake<=100;this.currentContext=context;
   // At most ONE grid fit per update; eight channels are staggered across >= 600 ms.
   let fitIndex=-1;if(now-this.fitStamp>=75){this.fitStamp=now;fitIndex=this.fitCursor;this.fitCursor=(this.fitCursor+1)%8;}
   unloaded=unloaded.map((v,i)=>v||(loadKnown&&s.game.wheels[i].load<40));
   const g=s.game,forward=Array.isArray(g.localVelocity)?g.localVelocity[2]:g.speedKmh/3.6;
   const moving=Number.isFinite(forward)&&Math.abs(forward)>3&&loadKnown,forwardDriving=forward>3&&loadKnown;
   const handbrake=s.handbrake>1,usable=moving;
   const motion=this.advisor.observe(g,now);
   const learn=forwardDriving&&motion.active&&context.learningAllowed;
   const lateral=g.wheels.map((w,i)=>this.tires[i].update(w,now,usable&&!unloaded[i],learn&&!unloaded[i]&&!(handbrake&&i>=2),fitIndex===i));
   const longitudinal=g.wheels.map((w,i)=>this.longTires[i].update(w,now,usable&&!unloaded[i],learn&&!unloaded[i]&&!(handbrake&&i>=2),fitIndex===i+4));
   const wheels=g.wheels.map((w,i)=>{
    // Use a measured local peak only when both sides/plateau are observed at near-pure slip.
    for(const [value,tire,input] of [[lateral[i],this.tires[i],w],[longitudinal[i],this.longTires[i],{...w,angle:Math.atan(w.ratio),ratio:Math.tan(w.angle),fy:w.fx}]]){
     const local=learn&&!unloaded[i]&&['angle','ratio','fx','fy'].every(k=>Number.isFinite(w[k]))?tire.local(input,now):null;
     if(local?.capacityKnown&&local.confidence>=.6&&local.peak>.1){
      value.mu=local.peak;value.muLow=local.peak*.82;value.muHigh=local.peak*1.22;value.confidence=Math.min(.8,local.confidence);value.available=true;value.localResponse=local;
      value.remaining=local.pastPeak?0:clamp(1-Math.abs(input.fy)/input.load/local.peak,0,1);
      value.slopeRatio=Math.max(0,local.slope)/Math.max(4,tire.reference?.c||tire.fit?.c||30);
      value.limited=value.remaining<.12&&value.slopeRatio<.13;value.over=local.pastPeak;
     }
    }
    const lat=lateral[i],lon=longitudinal[i];let hasLat=lat.available,hasLon=lon.available;
    const measured=['load','fx','fy'].every(k=>Number.isFinite(w[k]))&&w.load>200;
    const observed=measured?Math.hypot(w.fx,w.fy)/w.load:0;
    if(context.states[i]?.changed)this.priors[i]=.9;
    if(measured&&!unloaded[i]&&context.learningAllowed&&observed<5)this.priors[i]=Math.max(this.priors[i],observed*1.15);
    // A purported peak below force already produced by that same axis is inconsistent,
    // not evidence that the tyre has somehow used 500% of its grip.
    if(hasLat&&measured&&Math.abs(w.fy)/w.load>lat.mu*1.12)hasLat=false;
    if(hasLon&&measured&&Math.abs(w.fx)/w.load>lon.mu*1.12)hasLon=false;
    if(!hasLat&&!hasLon){
     if(!['load','fx','fy','ratio','angle'].every(k=>Number.isFinite(w[k]))||w.load<=0)return {available:false,reason:'force-data'};
     const demand=Math.hypot(w.fx,w.fy)/w.load;
     if(!unloaded[i]&&demand<5)this.priors[i]=Math.max(this.priors[i],demand*1.15);
     const mu=this.priors[i],slipFactor=Math.exp(-Math.max(0,Math.abs(w.ratio)-.08)*3.5),margin=cap=>clamp(1-demand/cap,0,1)*slipFactor;
     // Explicit broad prior: this keeps a usable display before identification, but can NEVER trigger steering advice.
     return {available:true,reason:'prior-estimate',confidence:.12,remaining:margin(mu),low:margin(mu*.4),high:margin(mu*2.2),muX:mu,muY:mu,muXLow:mu*.4,muYLow:mu*.4,muXHigh:mu*2.2,muYHigh:mu*2.2,
      limited:false,over:false,excess:0,alpha95:0,trailDrop:false,lateralKnown:false,longitudinalKnown:false,driveLimited:false,method:'broad-prior'};
    }
    const mx=hasLon?lon.mu:this.priors[i],my=hasLat?lat.mu:this.priors[i];
    const mxLow=hasLon?lon.muLow:mx*.4,mxHigh=hasLon?lon.muHigh:mx*2.2;
    const myLow=hasLat?lat.muLow:my*.4,myHigh=hasLat?lat.muHigh:my*2.2;
    const x=Math.abs(w.fx)/w.load,y=Math.abs(w.fy)/w.load;
    const remaining=(ux,uy)=>clamp(1-Math.hypot(x/ux,y/uy),0,1);
    const confidence=hasLat&&hasLon?Math.min(lat.confidence,lon.confidence):Math.min(.35,(hasLat?lat.confidence:lon.confidence)*.88);
    return {...lat,available:true,confidence,remaining:remaining(mx,my),low:remaining(mxLow,myLow),high:remaining(mxHigh,myHigh),
     longitudinalLocalResponse:lon.localResponse??null,longitudinalKnown:hasLon,lateralKnown:hasLat,muX:mx,muY:my,muXLow:mxLow,muXHigh:mxHigh,muYLow:myLow,muYHigh:myHigh,axis:hasLat&&hasLon?'combined':hasLat?'lateral-with-longitudinal-prior':'longitudinal-with-lateral-prior',
     limited:hasLat&&lat.limited,over:hasLat&&lat.over,pressure:hasLat?lat.pressure??0:0,alpha95:lat.alpha95??0,excess:lat.excess??0,
     driveLimited:hasLon&&lon.confidence>=.58&&lon.slopeRatio<.13&&lon.remaining<.12&&w.ratio>.015};
   });
   const axles=this.reserveModel.update(s,now,unloaded,loadKnown,wheels);
   const advice=this.advisor.update(s,now,unloaded,steering,this.tires,this.longTires,context);
   const driveDemand=usable&&forwardDriving&&!handbrake&&wheels.some((w,i)=>!unloaded[i]&&w.driveLimited&&g.wheels[i].fx>0&&Math.abs(g.wheels[i].fx)>Math.abs(g.wheels[i].fy))&&g.gas>.18&&g.brake<.1;
   const driveInput=Number.isFinite(g.gas)&&g.gas>.04&&Number.isFinite(g.brake)&&g.brake<.1;
   const brakeInput=Number.isFinite(g.brake)&&g.brake>.08&&Number.isFinite(g.gas)&&g.gas<.1;
   const lift=usable&&context.actionAllowed&&!handbrake&&driveInput&&this.held('liftDrive',driveDemand||advice.lift,now,180,180);
   const brakeRelease=usable&&context.actionAllowed&&!handbrake&&brakeInput&&this.held('releaseBrake',advice.brakeRelease,now,120,120);
   if(!usable||handbrake||!context.actionAllowed||!driveInput)delete this.states.liftDrive;
   if(!usable||handbrake||!context.actionAllowed||!brakeInput)delete this.states.releaseBrake;
   const forceReady=wheels.every((w,i)=>['fx','fy','load','angle','ratio'].every(k=>Number.isFinite(g.wheels[i][k])));
   return {...advice,context,available:forceReady&&usable&&axles.front.available&&axles.front.support>0,reserve:axles.front.reserve??null,axles,wheels,lift,brakeRelease,
    liftSeverity:Math.max(.15,...wheels.filter(w=>w.driveLimited).map(w=>1-w.remaining),advice.lift?.5:0),
    reason:!forceReady?'force-data':!moving?'low-speed':handbrake?'handbrake':unloaded[0]||unloaded[1]?'unloaded':'estimated'};
  }
 }
 const api={Estimator,Tire,brush};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TyreGrip=api;
})(typeof window!=='undefined'?window:globalThis);
