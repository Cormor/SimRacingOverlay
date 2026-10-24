'use strict';
// Separate present slip state from conditional, <=100ms incremental response.
(function(root){
 const Chassis=typeof module!=='undefined'&&module.exports?require('./chassis-response'):root.ChassisResponse;
 const LegacyChassis=typeof module!=='undefined'&&module.exports?require('./legacy-chassis-response'):root.LegacyChassisResponse;
 const Context=typeof module!=='undefined'&&module.exports?require('./telemetry-context'):root.TelemetryContext;
 const finite=Number.isFinite,clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
 const smooth=v=>{v=clamp(v);return v*v*(3-2*v);};
 const WINDOW_MS=100,VERSION='lateral-state-v3',K_SCALE=.16,A_SCALE=.14;
 // Legacy export for older offline comparisons only. Never interpreted as measured capacity.
 function marginFromElasticity(e){let lo=0,hi=1;e=clamp(e);for(let j=0;j<18;j++){const x=(lo+hi)/2,v=3*(1-x)**2/(3-3*x+x*x);if(v>e)lo=x;else hi=x;}return (1-(lo+hi)/2)**3;}
 function rate(rows,key){if(rows.length<2)return 0;const end=rows.at(-1).time,span=end-rows[0].time;if(span<35)return 0;const mt=rows.reduce((n,p)=>n+(p.time-end)/1000,0)/rows.length,my=rows.reduce((n,p)=>n+p[key],0)/rows.length;let tt=0,ty=0;for(const p of rows){const t=(p.time-end)/1000-mt;tt+=t*t;ty+=t*(p[key]-my);}return tt>0?ty/tt:0;}
 function axisResponse(rows,axis){
  const longitudinal=axis==='longitudinal',key=longitudinal?'k':'a',cross=longitudinal?'a':'k',force=longitudinal?'qx':'qy',signed=longitudinal?'sx':'sy',observation=longitudinal?'forceXObserved':'forceYObserved';
  if(rows.length<3||rows.at(-1).time-rows[0].time<=0||rows.some(p=>!p[observation]||!finite(p.load)||p.load<=0||!finite(p[key])))return null;
  const last=rows.at(-1),x=rows.map(p=>Math.abs(p[key])),y=rows.map(p=>p[force]),spread=Math.max(...x)-Math.min(...x),loadRatio=Math.min(...rows.map(p=>p.load))/Math.max(...rows.map(p=>p.load));
  if(spread<1e-8||last[force]<=0||loadRatio<=0)return null;
  // A shrinking/reversing excursion is recovery, not a test of further demand.
  const growth=x.at(-1)-x[0];let retreat=0;for(let i=1;i<x.length;i++)retreat+=Math.max(0,x[i-1]-x[i]);
  if(growth<=0)return null;
  if(rows.some(p=>p[key]*last[key]<0||finite(p[signed])&&finite(last[signed])&&p[signed]*last[signed]<0))return null;
  const crossKnown=rows.every(p=>finite(p[cross]));
  let crossScore=.5;if(crossKnown){const c=rows.map(p=>Math.abs(p[cross])),variation=Math.max(...c)-Math.min(...c);crossScore=Math.exp(-((variation/Math.max(.006,Math.abs(last[cross])*.15))**2));}
  const mx=x.reduce((a,b)=>a+b,0)/x.length,my=y.reduce((a,b)=>a+b,0)/y.length;let xx=0,xy=0;
  for(let i=0;i<x.length;i++){xx+=(x[i]-mx)**2;xy+=(x[i]-mx)*(y[i]-my);}if(xx<1e-8)return null;
  const slope=xy/xx,error=Math.sqrt(x.reduce((n,v,i)=>n+(y[i]-(my+slope*(v-mx)))**2,0)/x.length),limit=Math.max(.025,last[force]*.08);
  if(error>=limit)return null; // Fit weight approaches zero continuously at this validity boundary.
  const elasticity=clamp(slope*Math.abs(last[key])/last[force],-2,2),span=last.time-rows[0].time;
  const amplitude=(last[key]**2)/(last[key]**2+.012**2),forceScore=last[force]**2/(last[force]**2+.06**2);
  const weight=smooth(spread/.01)*smooth(span/80)*smooth(growth/spread)*Math.exp(-4*(retreat/spread)**2)*Math.exp(-(((1-loadRatio)/.12)**2))*smooth(1-error/limit)*crossScore*amplitude*forceScore;
  return {axis,elasticity,weight,slope,error,spanMs:span,spread,growth,state:elasticity<-.08?'declining':elasticity<.08?'plateau':'productive',
   // Incremental gain ratio, NOT a brush-model estimate of remaining peak force.
   gain:clamp(elasticity),margin:clamp(elasticity),overrun:elasticity<0?weight*(-elasticity)/(1-elasticity):0};
 }
 class Estimator {
  constructor(){this.body=new Chassis.Observer();this.legacyBody=new LegacyChassis.Observer();this.bodyProfile=null;this.reset();}
  reset(){this.body?.resetTransient();this.legacyBody?.resetTransient();this.history=Array.from({length:4},()=>[]);this.steeringHistory=[];this.lateralResponse=Array(4).fill(null);this.last=null;}
  pause(){this.reset();this.body?.reset();this.legacyBody?.reset();this.bodyProfile=null;}snapshot(){return {version:VERSION};}restore(){this.reset();}
  update(s,now,unloaded,steering,loadKnown){
   if(this.last!==null&&(now<=this.last||now-this.last>WINDOW_MS))this.reset();this.last=now;
   const g=s.game,speed=Math.abs(g.speedKmh||0)/3.6,rest=speed===0,motion=smooth(speed/3),loadAt=i=>Array.isArray(loadKnown)?!!loadKnown[i]:!!loadKnown;
   // Versioned input contract supplied by an adapter, never inferred from a game name.
   // Existing streams retain the exact pre-DeepSeek observer; the adaptive
   // profile adds learned steering geometry without changing native tyre paths.
   const profile=g.capabilities?.kinematicsProfile==='adaptive-steering-v1'?'adaptive-steering-v1':'neutral-v15';
   if(profile!==this.bodyProfile){this.body.reset();this.legacyBody.reset();this.bodyProfile=profile;}
   const vehicle=(profile==='adaptive-steering-v1'?this.body:this.legacyBody).update(g,now);
   const roadAngle=finite(steering?.wheel)?steering.wheel*Math.PI/180:null;
   this.steeringHistory=this.steeringHistory.filter(p=>now-p.time<=WINDOW_MS);
   if(roadAngle!==null)this.steeringHistory.push({time:now,angle:roadAngle});else this.steeringHistory=[];
   const steerRate=rate(this.steeringHistory,'angle'),coupling=finite(steering?.wheelbase)&&steering.wheelbase>1?clamp((speed*.1/steering.wheelbase)**2):0,steeringLead=-clamp(steerRate,-2,2)*.1*coupling*.35;
   // Body sideslip is a shared observation, never a fabricated per-wheel angle.
   let bodyAngle=null;
   if(g.wheels.some(w=>!finite(w.angle))){
    const velocity=g.localVelocity;let right=null,forward=null;
    if(Array.isArray(velocity)&&velocity.length===3&&velocity.every(finite)){right=velocity[0];forward=velocity[2];}
    else if(Array.isArray(g.velocity)&&g.velocity.length===3&&g.velocity.every(finite)){
     const basis=Context?.roadBasis(g);
     if(basis){right=g.velocity.reduce((sum,v,i)=>sum+v*basis.right[i],0);forward=g.velocity.reduce((sum,v,i)=>sum+v*basis.forward[i],0);}
    }
    if(finite(right)&&finite(forward)&&Math.abs(forward)>=3)bodyAngle=Math.atan2(right,Math.abs(forward));
   }
   const wheels=g.wheels.map((w,i)=>{
    const contact=loadAt(i)&&finite(w.load)&&w.load>=40,hasRatio=finite(w.ratio),hasAngle=finite(w.angle),physical=hasRatio||hasAngle,feedback=finite(w.slipFeedback)||finite(w.lockFeedback),valid=physical||feedback;
    if((!valid&&bodyAngle===null)||unloaded[i]||loadAt(i)&&!contact){this.history[i]=[];return {available:valid,unloaded:!!unloaded[i]||loadAt(i)&&w.load<40,remaining:0,projectedRemaining:0,directions:{},axisResponses:[],overrun:0,confidence:0,pressure:0,trend:0,method:'unloaded-or-missing'};}
    const k=hasRatio?w.ratio:null,a=hasAngle?Math.tan(clamp(w.angle,-Math.PI/2+.001,Math.PI/2-.001)):null,hasFx=contact&&finite(w.fx),hasFy=contact&&finite(w.fy);
    const p={time:now,k,a,load:w.load,qx:hasFx?Math.abs(w.fx)/w.load:0,qy:hasFy?Math.abs(w.fy)/w.load:0,sx:hasFx?w.fx/w.load:null,sy:hasFy?w.fy/w.load:null,forceXObserved:hasFx,forceYObserved:hasFy};
    let rows=this.history[i];if(rows.length){const old=rows.at(-1);if(w.load/old.load<.8||w.load/old.load>1.25||(k||0)*(old.k||0)<-.0001||(a||0)*(old.a||0)<-.0001)rows=[];}
    rows=rows.filter(x=>now-x.time<=WINDOW_MS);rows.push(p);this.history[i]=rows.slice(-16);
    const kRate=hasRatio&&rows.every(p=>finite(p.k))?rate(rows,'k'):0,aRate=hasAngle&&rows.every(p=>finite(p.a))?rate(rows,'a'):0;
    const outward=(value,step)=>value*step>0?step:0,kLead=outward(k,clamp(kRate*.1,-.16,.16));
    const measuredLead=outward(a,clamp(aRate*.1,-.12,.12)),commandedLead=i<2?outward(a,clamp(steeringLead,-.06,.06)):0,aLead=Math.abs(commandedLead)>Math.abs(measuredLead)?commandedLead:measuredLead;
    const axisResponses=rest?[]:['longitudinal','lateral'].map(axis=>axisResponse(rows,axis)).filter(Boolean).map(r=>({...r,weight:r.weight*motion}));
    const generic=1-clamp(Math.max(Math.abs(w.slipFeedback||0),w.lockFeedback||0));
    const proxy=rest?1:physical?Math.exp(-(((k||0)/K_SCALE)**2+((a||0)/A_SCALE)**2)):generic;
    const projectedProxy=rest?1:physical?Math.exp(-((((k||0)+kLead)/K_SCALE)**2+(((a||0)+aLead)/A_SCALE)**2)):generic;
    // Main measurement never changes definition when a fit appears/disappears.
    const remaining=proxy,projectedRemaining=Math.min(proxy,Math.max(proxy*.65,projectedProxy));
    const directions={},bases={longitudinal:hasRatio?Math.exp(-((k/K_SCALE)**2)):null,lateral:hasAngle?Math.exp(-((a/A_SCALE)**2)):null};
    const futureBases={longitudinal:hasRatio?Math.exp(-(((k+kLead)/K_SCALE)**2)):null,lateral:hasAngle?Math.exp(-(((a+aLead)/A_SCALE)**2)):null};
    for(const axis of ['lateral','longitudinal']){
     const lateral=axis==='lateral',known=lateral?hasAngle:hasRatio,v=lateral?a:k;
     // A measured slip-state channel is directional, not a measured friction-circle occupancy.
     // In particular wheelspin/locking must not erase the independent lateral readout.
     const own=bases[axis],current=known?1-motion*(1-own):null;
     const projected=known?1-motion*(1-Math.min(own,Math.max(own*.65,futureBases[axis]))):null;
     const fit=axisResponses.find(r=>r.axis===axis),evidence=fit?.weight||0;
     const ownLoss=fit?fit.weight*(1-fit.gain):0;
     const point=known?clamp(projected*(1-ownLoss)):null;
     directions[axis]={available:known,current,isolatedCurrent:own,coupling:known?1:null,forecast:projected,
      estimate:{value:point,low:point,high:current,evidence,otherEvidence:0,responseGain:fit?.gain??null,kind:fit?'directional-incremental-response':'directional-slip-trend'},danger:known?1-point:0,
      phase:rest?'rest':!known?'missing':v*(lateral?aRate:kRate)<-.0002?'recovering':v*(lateral?aRate:kRate)>.0002?'growing':'steady',mode:lateral?'turning':k<0?'braking':k>0?'drive':'rolling'};
    }
    if(hasAngle){
     directions.lateral.source='wheel-slip-angle';
     const fit=axisResponses.find(r=>r.axis==='lateral');let observed=this.lateralResponse[i];
     if(fit&&fit.weight>.12){observed={gain:clamp(fit.gain),angle:w.angle,load:w.load,speed,weight:fit.weight};this.lateralResponse[i]=observed;}
     else if(observed&&(w.angle*observed.angle<=0||Math.abs(w.angle)<Math.abs(observed.angle)*.9||Math.abs(w.load-observed.load)>Math.max(100,observed.load*.15)||Math.abs(speed-observed.speed)>Math.max(1.5,observed.speed*.1))){observed=null;this.lateralResponse[i]=null;}
     if(observed){
      const d=directions.lateral;d.slipState=d.current;d.current=Math.min(d.current,observed.gain);d.danger=Math.max(d.danger,1-d.current);d.estimate={...d.estimate,value:d.current,evidence:observed.weight,kind:'observed-lateral-response'};
     }
    }
    else if(bodyAngle!==null){
     const slipState=1-motion*(1-Math.exp(-((Math.tan(bodyAngle)/A_SCALE)**2)));
     const response=i<2?vehicle.frontRemaining:vehicle.rearRemaining;
     // A small body angle alone cannot certify spare front/rear response.
     const current=Number.isFinite(response)?Math.min(slipState,response):slipState<.3?slipState:null;
     directions.lateral={available:true,current,slipState,forecast:current,danger:current===null?0:1-current,source:Number.isFinite(response)?'vehicle-steering-response':'body-sideslip',shared:true,estimate:{value:current,evidence:vehicle.confidence,kind:Number.isFinite(response)?'observed-vehicle-response':'uncalibrated-body-slip'}};
    }
    if(hasAngle){const response=i<2?vehicle.frontRemaining:vehicle.rearRemaining;const d=directions.lateral;
     if(Number.isFinite(response)&&vehicle.confidence>=.3){d.slipState??=d.current;d.current=Math.min(d.current,response);d.danger=Math.max(d.danger,1-d.current);d.estimate={...d.estimate,value:d.current,vehicleEvidence:vehicle.confidence};}
    }
    const overrun=Math.max(0,...axisResponses.map(r=>r.overrun)),lateralNow=hasAngle?1-Math.exp(-((a/A_SCALE)**2)):0,lateralFuture=hasAngle?1-Math.exp(-(((a+aLead)/A_SCALE)**2)):0;
    return {available:true,unloaded:false,remaining,projectedRemaining,directions,axisResponses,overrun,lateralNow,lateralFuture,aRate,kRate,steeringLead:commandedLead,confidence:Math.max(0,...axisResponses.map(r=>r.weight)),pressure:1-proxy,trend:0,
     method:axisResponses.length?'separate-current-and-response':'instant-slip-state',localWeight:0,elasticity:null,spanMs:now-rows[0].time,
     longitudinalPressure:hasRatio?1-Math.exp(-((k/K_SCALE)**2)):0,lateralPressure:lateralNow,braking:hasRatio&&k<0,positiveDrive:hasRatio&&k>0,angle:hasAngle?w.angle:null,load:contact?w.load:1,low:projectedRemaining,high:remaining};
   });
   const axles={};
   for(let axle=0;axle<2;axle++){
    const ws=wheels.slice(axle*2,axle*2+2),live=ws.filter(w=>w.available&&!w.unloaded),value=live.reduce((n,w)=>n+w.projectedRemaining,0)/2,current=live.reduce((n,w)=>n+w.remaining,0)/2;
    axles[axle?'rear':'front']={available:ws.every((w,j)=>w.available||unloaded[axle*2+j]||loadAt(axle*2+j)&&g.wheels[axle*2+j].load<40),sides:ws.map(w=>({available:w.available,unloaded:w.unloaded,value:w.projectedRemaining??0,current:w.remaining,overrun:w.overrun||0,directions:w.directions})),
     overrun:live.reduce((n,w)=>n+w.overrun,0)/2,currentReserve:{value:current},reserve:{value,low:value,high:current},rawReserve:{value},forecastDrop:current-value,support:live.length/2,unloadedSides:ws.map(w=>w.unloaded),loadKnown:loadAt(axle*2)&&loadAt(axle*2+1),responseObserved:live.some(w=>w.axisResponses.some(r=>r.weight>.01)),methods:live.map(w=>w.method),reason:!live.length?'unloaded':rest?'low-speed':live.length<2?'single-wheel':'realtime'};
   }
   const level=start=>{const ws=wheels.slice(start,start+2).filter(w=>w.available&&!w.unloaded&&finite(w.angle));return ws.length?ws.reduce((n,w)=>n+Math.max(w.lateralNow,w.lateralFuture*.65,w.directions.lateral.estimate?.kind==='observed-lateral-response'?1-w.directions.lateral.current:0),0)/ws.length:null;};
   const frontLevel=level(0),rearLevel=level(2),frontTendency=frontLevel===null?null:clamp((frontLevel-.08)/.72),rearTendency=rearLevel===null?null:clamp((rearLevel-.08)/.72),bothKnown=frontLevel!==null&&rearLevel!==null;
   const front=wheels.slice(0,2).filter(w=>w.available&&!w.unloaded&&finite(w.angle)),sum=front.reduce((n,w)=>n+w.load,0),signed=sum?front.reduce((n,w)=>n-w.angle*w.load,0)/sum:0;
   const needle=rest?clamp((steering?.delta||0)/30,-1,1):bothKnown?clamp((rearTendency-frontTendency)*1.4,-1,1):0,sensitivityGPerDegree=roadAngle!==null&&finite(steering?.wheelbase)&&steering.wheelbase>1?speed*speed/(steering.wheelbase*9.80665)*Math.PI/180/(Math.cos(roadAngle)**2):null;
   const active=motion>0;
   const pedal=(ws,input)=>{
    if(!finite(input)||input<=0||!ws.length||motion===0)return null;
    const activation=smooth(input/.1)*motion;
    const evidence=ws.map(w=>{
     const index=wheels.indexOf(w),axis=w.axisResponses.find(r=>r.axis==='longitudinal'),d=w.directions.longitudinal;
     const axle=wheels.slice(index<2?0:2,index<2?2:4).filter(x=>x.available&&!x.unloaded),weight=clamp(w.load/Math.max(1,axle.reduce((n,x)=>n+x.load,0))/.3);
     // Longitudinal risk is shown at the pedal border only; lateral risk is not a release command.
     return {wheel:index,strength:(d?.danger||0)*weight*activation,method:'continuous-combined-directional-risk',elasticity:axis?.elasticity??null};
    });
    const severity=Math.max(0,...evidence.map(e=>e.strength));return severity>0?{label:'',mode:'risk-trend',severity,overrun:Math.max(0,...ws.map(w=>w.overrun||0)),source:VERSION,evidence}:null;
   };
   const steeringState={front:frontTendency,rear:rearTendency,sensitivityGPerDegree,sensitivity:sensitivityGPerDegree===null?0:clamp(sensitivityGPerDegree/2),both:bothKnown&&Math.min(frontTendency,rearTendency)>.55,forecastMs:100,source:'current-lateral-slip-and-short-growth',headingSide:Math.sign(signed)};
   const driveWheels=wheels.filter(w=>w.available&&!w.unloaded&&w.positiveDrive),brakeWheels=wheels.filter((w,i)=>w.available&&!w.unloaded&&w.braking&&!(s.handbrake>1&&i>=2));
   return {vehicleResponse:vehicle,version:VERSION,available:wheels.some(w=>w.available),reserve:axles.front.reserve,axles,wheels,needle,steeringState,steeringPressure:front.length?front.reduce((n,w)=>n+w.lateralPressure,0)/front.length:0,easeSteering:false,indication:active&&frontTendency>0,gripLow:active&&frontTendency>.5,lift:false,brakeRelease:false,
    driveCue:pedal(driveWheels,g.gas),brakeCue:pedal(brakeWheels,g.brake),advisor:{method:VERSION,motion:{active,state:active?'moving':'low-speed'},reason:'separate-measurement-and-inference',windowMs:WINDOW_MS,steerRate,coupling,forecastMs:100},reason:rest?'low-speed':'realtime'};
  }
 }
 const api={Estimator,marginFromElasticity,axisResponse,WINDOW_MS,VERSION};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RealtimeResponse=api;
})(typeof window!=='undefined'?window:globalThis);
