'use strict';
// Current-frame response display. No ABS/TC inputs, persistent peak, or driving commands.
(function(root){
 const finite=Number.isFinite,clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
 const WINDOW_MS=100,VERSION='directional-response-v8';
 // Display scales, NOT measured optimum slip or a universal friction coefficient.
 const K_SCALE=.16,A_SCALE=.14;
 function marginFromElasticity(e){
  // Conditional brush shape: local tangent/secant elasticity -> remaining force fraction.
  let lo=0,hi=1;e=clamp(e);
  for(let j=0;j<18;j++){const x=(lo+hi)/2,v=3*(1-x)**2/(3-3*x+x*x);if(v>e)lo=x;else hi=x;}
  return (1-(lo+hi)/2)**3;
 }
 // Directional gain is conditioned on stable cross-slip and load: not a full tyre law.
 function axisResponse(rows,axis){
  const observation=axis==='longitudinal'?'forceXObserved':'forceYObserved';
  if(rows.length<3||rows.at(-1).time-rows[0].time<40||rows.some(x=>!(x[observation]??x.forceObserved)))return null;
  const key=axis==='longitudinal'?'k':'a',cross=key==='k'?'a':'k',force=key==='k'?'qx':'qy',last=rows.at(-1);
  if(Math.min(...rows.map(x=>x.load))<Math.max(...rows.map(x=>x.load))*.88)return null;
  const x=rows.map(p=>Math.abs(p[key])),y=rows.map(p=>p[force]),c=rows.map(p=>Math.abs(p[cross]));
  const spread=Math.max(...x)-Math.min(...x),crossSpread=Math.max(...c)-Math.min(...c);
  if(spread<=.002||crossSpread>Math.max(.006,Math.abs(last[cross])*.15)||Math.abs(last[key])<.012||last[force]<.06)return null;
  // A sign reversal invalidates a magnitude regression even if the magnitudes happen to match.
  if(rows.some(p=>p[key]*last[key]<0))return null;
  const mx=x.reduce((a,b)=>a+b,0)/x.length,my=y.reduce((a,b)=>a+b,0)/y.length;
  let xx=0,xy=0;for(let i=0;i<x.length;i++){xx+=(x[i]-mx)**2;xy+=(x[i]-mx)*(y[i]-my);}
  if(xx<1e-8)return null;
  const slope=xy/xx,error=Math.sqrt(x.reduce((n,v,i)=>n+(y[i]-(my+slope*(v-mx)))**2,0)/x.length);
  if(error>Math.max(.025,last[force]*.08))return null;
  const elasticity=clamp(slope*Math.abs(last[key])/last[force],-2,2),span=last.time-rows[0].time;
  const weight=clamp((spread-.002)/.008)*clamp((span-40)/40);
  return {axis,elasticity,weight,slope,error,spanMs:span,spread,
   margin:marginFromElasticity(elasticity),overrun:elasticity<0?weight*(-elasticity)/(1-elasticity):0,
   state:elasticity<-.08?'declining':elasticity<.08?'plateau':'productive'};
 }
 class Estimator {
  constructor(){this.reset();}
  reset(){this.history=Array.from({length:4},()=>[]);this.steeringHistory=[];this.last=null;}
  pause(){this.reset();}
  snapshot(){return {version:VERSION};} // Dynamic observations never survive a restart or car change.
  restore(){this.reset();}
  update(s,now,unloaded,steering,loadKnown){
   if(this.last!==null&&(now<=this.last||now-this.last>100))this.reset();this.last=now;
   const g=s.game,speed=Math.abs(g.speedKmh||0)/3.6,rest=speed<.5;
   const loadAt=i=>Array.isArray(loadKnown)?!!loadKnown[i]:!!loadKnown;
   // Feed-forward is based on an observed change in actual road-wheel angle, not speed alone.
   const roadAngle=finite(steering?.wheel)?steering.wheel*Math.PI/180:null;
   this.steeringHistory=this.steeringHistory.filter(p=>now-p.time<=WINDOW_MS);
   if(roadAngle!==null)this.steeringHistory.push({time:now,angle:roadAngle});else this.steeringHistory=[];
   const sh=this.steeringHistory,st=sh.length>1?(now-sh[0].time)/1000:0;
   const steerRate=st>=.04?clamp((roadAngle-sh[0].angle)/st,-2,2):0;
   const coupling=finite(steering?.wheelbase)&&steering.wheelbase>1?clamp((speed*.1/steering.wheelbase)**2):0;
   const steeringLead=-steerRate*.1*coupling*.35;

   const wheels=g.wheels.map((w,i)=>{
    const contact=loadAt(i)&&finite(w.load)&&w.load>=40;
    const hasRatio=finite(w.ratio),hasAngle=finite(w.angle),physical=hasAngle||hasRatio,feedback=finite(w.slipFeedback)||finite(w.lockFeedback);
    const valid=(contact||!loadAt(i))&&(physical||feedback);
    if(!valid||unloaded[i]){this.history[i]=[];return {available:valid,unloaded:!!unloaded[i]||loadAt(i)&&w.load<40,remaining:0,confidence:0,pressure:0,trend:0,method:'unloaded-or-missing'};}
    const k=hasRatio?w.ratio:0,a=hasAngle?Math.tan(clamp(w.angle,-Math.PI/2+.001,Math.PI/2-.001)):0,u=Math.hypot(k,a),hasFx=contact&&finite(w.fx),hasFy=contact&&finite(w.fy),hasForce=hasFx&&hasFy,q=hasForce?Math.hypot(w.fx,w.fy)/w.load:0;
    const p={time:now,u,q,k,a,qx:hasFx?Math.abs(w.fx)/w.load:0,qy:hasFy?Math.abs(w.fy)/w.load:0,load:w.load,forceObserved:hasForce,forceXObserved:hasFx,forceYObserved:hasFy},old=this.history[i];
    // No interpolation across reversal or a contact/load discontinuity.
    if(old.length){const prev=old.at(-1);if(w.load/prev.load<.8||w.load/prev.load>1.25||k*prev.k<-.0001||a*prev.a<-.0001)old.length=0;}
    const rows=old.filter(x=>now-x.time<=WINDOW_MS);rows.push(p);this.history[i]=rows.slice(-16);
    let elasticity=null,slipRate=0,qRate=0,aRate=0,kRate=0,confidence=.12,localWeight=0;
    const span=now-rows[0].time;
    if(rows.length>=3&&span>=40){
     const mt=rows.reduce((s,x)=>s+x.time-now,0)/rows.length/1000,mu=rows.reduce((s,x)=>s+x.u,0)/rows.length,mq=rows.reduce((s,x)=>s+x.q,0)/rows.length;
     let tt=0,tu=0,tq=0,ta=0,tk=0,uu=0,uq=0;
     for(const x of rows){const dt=(x.time-now)/1000-mt,du=x.u-mu;tt+=dt*dt;ta+=dt*x.a;tk+=dt*x.k;tu+=dt*du;tq+=dt*(x.q-mq);uu+=du*du;uq+=du*(x.q-mq);}
     slipRate=tt>0?tu/tt:0;qRate=tt>0?tq/tt:0;aRate=tt>0?ta/tt:0;kRate=tt>0?tk/tt:0;
     const spread=Math.max(...rows.map(x=>x.u))-Math.min(...rows.map(x=>x.u));
     const stableLoad=Math.min(...rows.map(x=>x.load))>=Math.max(...rows.map(x=>x.load))*.88;
     const coherent=rows.every(x=>x.u<.006||u<.006||(x.k*k+x.a*a)/(x.u*u)>.96);
     // During recovery / changing combined-force direction do not claim a measured peak or slope.
     if(hasForce&&rows.every(x=>x.forceObserved&&finite(x.load)&&x.load>0)&&stableLoad&&coherent&&spread>.005&&slipRate>.02&&uu>1e-7&&u>.012&&q>.06){
      elasticity=clamp((uq/uu)*u/q,-1,2);localWeight=clamp((spread-.005)/.015)*clamp((span-40)/40);confidence=.12+localWeight*.58;
     }
    }
    const proxy=physical?Math.exp(-((k/K_SCALE)**2+(a/A_SCALE)**2)):1-clamp(Math.max(Math.abs(w.slipFeedback||0),w.lockFeedback||0));
    const local=elasticity===null?null:marginFromElasticity(elasticity);
    // The instantaneous proxy bounds an optimistic noisy local slope. Never reuse yesterday's peak.
    let remaining=rest?1:local===null?proxy:proxy+(Math.min(proxy,local)-proxy)*localWeight;
    const axisResponses=(hasFx||hasFy)&&hasRatio&&hasAngle?['longitudinal','lateral'].map(axis=>axisResponse(rows,axis)).filter(Boolean):[];
    // A lost longitudinal response must not be hidden by a lateral-force increase in the force norm.
    for(const response of axisResponses)if(!rest)remaining=Math.min(remaining,proxy+(Math.min(proxy,response.margin)-proxy)*response.weight);
    const overrun=rest?0:Math.max(0,...axisResponses.map(r=>r.overrun));

    const trend=rest?0:clamp((slipRate-Math.max(0,qRate)*u/Math.max(.1,q))*.25,-1,1);
    // Causal 100ms trend envelope; prediction never assumes an unobserved road or peak mu.
    const outward=(value,step)=>value*step>0?step:0;
    const measuredLead=outward(a,clamp(aRate*.1,-.12,.12));
    const commandedLead=i<2?outward(a,clamp(steeringLead,-.06,.06)):0;
    const aLead=Math.abs(commandedLead)>Math.abs(measuredLead)?commandedLead:measuredLead;
    const kLead=outward(k,clamp(kRate*.1,-.16,.16));
    const projectedProxy=physical?Math.exp(-(((k+kLead)/K_SCALE)**2+((a+aLead)/A_SCALE)**2)):proxy;
    // Bounded warning, never a 100%-to-zero collapse caused solely by a derivative.
    const projectedRemaining=rest?remaining:Math.min(remaining,Math.max(remaining*.65,remaining*projectedProxy/Math.max(1e-12,proxy)));
    const longitudinal=Math.abs(k)/K_SCALE,lateral=Math.abs(a)/A_SCALE,share=longitudinal+lateral;
    const lateralFuture=1-Math.exp(-(((a+aLead)/A_SCALE)**2)),lateralNow=1-Math.exp(-((a/A_SCALE)**2));

    return {available:true,unloaded:false,remaining,projectedRemaining,axisResponses,overrun,lateralNow,lateralFuture,aRate,kRate,steeringLead:commandedLead,confidence,pressure:1-remaining,trend,
     method:localWeight>.5?'short-local-response':'instant-slip-proxy',localWeight,elasticity,slipRate,qRate,spanMs:span,
     longitudinalPressure:(1-remaining)*(share?longitudinal/share:0),lateralPressure:(1-remaining)*(share?lateral/share:0),
     braking:hasRatio&&k<-.005,positiveDrive:hasRatio&&k>.005,angle:hasAngle?w.angle:null,load:contact?w.load:1,
     low:rest?1:local===null?0:clamp(remaining-.2),high:rest?1:local===null?1:clamp(remaining+.2)};
   });
   const axles={};
   for(let axle=0;axle<2;axle++){
    const ws=wheels.slice(axle*2,axle*2+2),live=ws.filter(w=>w.available&&!w.unloaded),support=live.length/2;
    // Each wheel contributes half: the surviving side determines a single-wheel axle at half scale.
    const currentValue=live.reduce((n,w)=>n+w.remaining,0)/2,value=live.reduce((n,w)=>n+w.projectedRemaining,0)/2,trend=live.length?live.reduce((n,w)=>n+w.trend,0)/live.length:0;
    axles[axle?'rear':'front']={available:ws.every((w,j)=>w.available||unloaded[axle*2+j]||loadAt(axle*2+j)&&g.wheels[axle*2+j].load<40),sides:ws.map(w=>({available:w.available,unloaded:w.unloaded,value:w.unloaded?0:w.projectedRemaining??0,current:w.unloaded?0:w.remaining,overrun:w.overrun||0})),overrun:live.reduce((n,w)=>n+(w.overrun||0),0)/2,currentReserve:{value:currentValue},forecastDrop:currentValue-value,reserve:{value,low:Math.min(value,live.reduce((n,w)=>n+w.low,0)/2),high:live.reduce((n,w)=>n+w.high,0)/2},rawReserve:{value},confidence:live.length?Math.min(...live.map(w=>w.confidence)):0,support,unloadedSides:ws.map(w=>w.unloaded),loadKnown:loadAt(axle*2)&&loadAt(axle*2+1),trend,
     responseObserved:live.some(w=>w.method==='short-local-response'),methods:live.map(w=>w.method),reason:!support?'unloaded':rest?'low-speed':support<1?'single-wheel':'realtime'};
   }
   const front=wheels.slice(0,2).filter(w=>w.available&&!w.unloaded),sum=front.reduce((n,w)=>n+w.load,0);
   const signed=sum?front.reduce((n,w)=>n-w.angle*w.load,0)/sum:0;
   const lateralPressure=front.length?front.reduce((n,w)=>n+w.lateralPressure,0)/front.length:0;
   const sideLevel=start=>{const ws=wheels.slice(start,start+2).filter(w=>w.available&&!w.unloaded);return ws.length?ws.reduce((n,w)=>n+Math.max(w.lateralNow,w.lateralFuture*.65),0)/ws.length:0;};
   const frontLevel=sideLevel(0),rearLevel=sideLevel(2);
   const frontTendency=clamp((frontLevel-.08)/.72),rearTendency=clamp((rearLevel-.08)/.72);
   // Semantic axis: front-dominant slide (push) LEFT, rear-dominant slide (rotate) RIGHT.
   // Simultaneous front/rear sliding illuminates BOTH half arcs, even with a balanced centre needle.
   const needle=rest?clamp((steering?.delta||0)/30,-1,1):clamp((rearTendency-frontTendency)*1.4,-1,1);
   const sensitivityGPerDegree=roadAngle!==null&&finite(steering?.wheelbase)&&steering.wheelbase>1?speed*speed/(steering.wheelbase*9.80665)*Math.PI/180/(Math.cos(roadAngle)**2):null;
   const steeringState={front:frontTendency,rear:rearTendency,sensitivityGPerDegree,sensitivity:sensitivityGPerDegree===null?0:clamp(sensitivityGPerDegree/2),both:Math.min(frontTendency,rearTendency)>.55,forecastMs:100,
    source:'current-lateral-slip-and-short-growth',headingSide:Math.sign(signed)};
   const active=speed>3;
   const driveWheels=wheels.filter(w=>w.available&&!w.unloaded&&w.positiveDrive),brakeWheels=wheels.filter((w,i)=>w.available&&!w.unloaded&&w.braking&&!(s.handbrake>1&&i>=2));
   const drivePressure=active&&g.gas>.04?Math.max(0,...driveWheels.map(w=>w.longitudinalPressure)):0;
   const brakePressure=active&&g.brake>.04?Math.max(0,...brakeWheels.map(w=>w.longitudinalPressure)):0;
   const pedal=(pressure,ws,input)=>{
    if(!active||!finite(input)||input<=.04||!ws.length)return null;
    const evidence=ws.map(w=>{
     const axis=w.axisResponses?.find(r=>r.axis==='longitudinal');
     // Actual loss of incremental longitudinal return, not the mere existence of tyre slip.
     const response=axis?axis.weight*clamp((.35-axis.elasticity)/1.35):0;
     // Conservative degraded-mode gross spin/near-lock indication. This is NOT an optimal-slip target.
     const index=wheels.indexOf(w),gross=clamp((Math.abs(g.wheels[index].ratio)-.55)/.45);
     const axle=wheels.slice(index<2?0:2,index<2?2:4).filter(x=>x.available&&!x.unloaded);
     const weight=clamp(w.load/Math.max(1,axle.reduce((n,x)=>n+x.load,0))/.3);
     return {wheel:index,strength:Math.max(response,gross)*weight,method:response>=gross?'observed-longitudinal-return':'gross-slip',elasticity:axis?.elasticity??null};
    });
    const severity=Math.max(0,...evidence.map(e=>e.strength));
    if(severity<=.01)return null;
    return {label:'',mode:'release-reference',severity,overrun:Math.max(0,...ws.map(w=>w.overrun||0)),source:VERSION,evidence};
   };

   return {version:VERSION,available:wheels.some(w=>w.available),reserve:axles.front.reserve,axles,wheels,needle,steeringState,steeringPressure:lateralPressure,
    // Compatibility flags describe display levels, not recommended actions.
    easeSteering:false,indication:active&&lateralPressure>.01,gripLow:active&&lateralPressure>.5,lift:false,brakeRelease:false,
    driveCue:pedal(drivePressure,driveWheels,g.gas),brakeCue:pedal(brakePressure,brakeWheels,g.brake),
    advisor:{method:VERSION,motion:{active,state:active?'moving':'low-speed'},reason:'continuous-response',windowMs:WINDOW_MS,steerRate,coupling,forecastMs:100},reason:!wheels.some(w=>w.available)?'force-data':rest?'low-speed':'realtime'};
  }
 }
 const api={Estimator,marginFromElasticity,axisResponse,WINDOW_MS,VERSION};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RealtimeResponse=api;
})(typeof window!=='undefined'?window:globalThis);
