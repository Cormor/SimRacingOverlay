'use strict';
// Bounded adaptive body kinematics with learned steering geometry and an
// observed-load display reference. Never fabricates per-wheel tyre forces.
(function(root){
 const finite=Number.isFinite,clip=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
 const smooth=x=>{x=clip(x);return x*x*(3-2*x);};
 function derivative(rows,key){
  if(rows.length<3||rows.at(-1).t-rows[0].t<40)return 0;
  const end=rows.at(-1).t,mt=rows.reduce((n,p)=>n+(p.t-end)/1000,0)/rows.length,my=rows.reduce((n,p)=>n+p[key],0)/rows.length;
  let tt=0,ty=0;for(const p of rows){const t=(p.t-end)/1000-mt;tt+=t*t;ty+=t*(p[key]-my);}return tt>1e-8?ty/tt:0;
 }
 function geometry(g){
  if(finite(g.roadWheelAngle)&&Math.abs(g.roadWheelAngle)<1.2&&finite(g.wheelbase)&&g.wheelbase>1&&g.wheelbase<6)return {angle:g.roadWheelAngle,wheelbase:g.wheelbase,source:'reported-road-wheel-geometry',confidence:1,uncertainty:.01};
  const p=g.vehicleGeometry;
  if(!finite(g.steeringWheelAngle)||!p||!finite(p.wheelbaseM)||p.wheelbaseM<1||p.wheelbaseM>6||!finite(p.steeringRatio)||p.steeringRatio<2||p.steeringRatio>60)return null;
  if(Math.abs(g.steeringWheelAngle/p.steeringRatio)>=1.2)return null;
  return {angle:g.steeringWheelAngle/p.steeringRatio,wheelbase:p.wheelbaseM,source:p.source||'reported-vehicle-geometry',confidence:finite(p.confidence)?clip(p.confidence):1,uncertainty:p.nominal?.08:.02};
 }
 class Observer {
  constructor(){this.reset();}
  reset(){this.resetTransient();this.aRef=14;this.aPeak=null;this.aySince=null;this.aRefAt=null;this.geoKey=null;this.k=null;}
  resetTransient(){this.rows=[];this.last=null;this.switches=[];this.lastResidualSign=0;this.lastSwitch=-Infinity;this.commandSign=0;this.turnStart=-Infinity;this.lastFront=null;this.frontAt=null;this.deficitSmooth=null;this.lastRear=null;this.rearAt=null;}
  missing(reason){return {available:false,frontRemaining:null,rearRemaining:null,understeer:0,oversteer:0,sway:0,confidence:0,reason,source:'neutral-vehicle-kinematics'};}
  update(g,now){
   const v=g.localVelocity,yaw=g.yawRate;
   if(!finite(now)||!g.available||g.paused===true||g.inMenu===true||!Array.isArray(v)||v.length!==3||!v.every(finite)||!finite(yaw)){
    this.resetTransient();return this.missing('missing-body-kinematics');
   }
   const speed=v[2];if(speed<5){this.resetTransient();return this.missing(speed<0?'reverse':'low-speed');}
   if(this.last&&(now<=this.last.t||now-this.last.t>250))this.resetTransient();
   const learnDt=this.last?Math.max(0,Math.min(100,now-this.last.t)):0;
   const beta=Math.atan2(v[0],speed),geo=geometry(g),steer=finite(g.steeringWheelAngle)?g.steeringWheelAngle:null;
   const p={t:now,v:speed,yaw,beta,curvature:yaw/speed,steer:steer??0};
   this.rows=this.rows.filter(p=>now-p.t<=120);this.rows.push(p);this.last=p;
   const span=now-this.rows[0].t,yawAccel=derivative(this.rows,'yaw'),curvatureRate=derivative(this.rows,'curvature'),betaRate=derivative(this.rows,'beta'),steerRate=derivative(this.rows,'steer');
   // The inertial velocity heading equals body heading + body sideslip.
   // Its rotation therefore follows r_path = r_body + beta_dot (right-positive).
   const pathYaw=yaw+betaRate,ratioK=this.k??35,neutralYaw=geo?speed/geo.wheelbase*Math.tan(geo.angle):finite(steer)?speed*steer/ratioK:null;
   const turnSign=Math.sign(neutralYaw||yaw),commanded=finite(neutralYaw)&&Math.abs(steer||0)>.00001;
   const commandSign=commanded?Math.sign(neutralYaw):0;if(commandSign!==this.commandSign){this.commandSign=commandSign;this.turnStart=now;}
   const aligned=commanded&&yaw*neutralYaw>=0;
   const observedTurn=Math.max(0,turnSign*yaw,turnSign*pathYaw);
   // During ordinary turn-in, currently measured positive curvature change is
   // evidence of ongoing realization, not a reason to wait for a plateau.
   // Longitudinal acceleration alone cannot supply curvature response.
   // Short bounded projection does not alter the raw yaw/slip measurements.
   const developing=Math.max(0,turnSign*curvatureRate)*speed*.1;
   const realized=commanded?clip((observedTurn+developing)/Math.abs(neutralYaw),0,2):null;
   const entering=now-this.turnStart<50&&Math.abs(yaw)<Math.abs(neutralYaw||0)*.3;
   const deficit=commanded&&span>=40&&!entering?Math.max(0,1-realized-(geo?.uncertainty||0)):0;
   // An absolute road-angle residual supplies the dimensional scale. A tiny
   // denominator must not turn a normal straight-line correction into full loss.
   const angleError=commanded&&geo?Math.max(0,Math.abs(geo.angle)-Math.atan(geo.wheelbase*(observedTurn+developing)/speed)):0;
   const errorWeight=geo?smooth(angleError/.035):1;
   // A large body-sideslip rate with the trajectory rotating against the
   // commanded direction is a rear/transient state, not evidence that the
   // front tyres have saturated. Judging front response there reports
   // "understeer" while the car is merely correcting or recovering.
   const pathReversed=commanded&&Math.abs(betaRate)>.1&&turnSign*pathYaw<-.01;
   // Normal tyre sideslip makes yaw lag the geometric neutral reference on
   // wide, low-curvature arcs, which is not front saturation. Judge front
   // response only when the trajectory curvature itself is meaningful; using
   // curvature (not yaw rate or speed) keeps this gate independent of
   // longitudinal acceleration and gear changes.
   const curvature=pathYaw/speed;
   // Runtime identification of ratio*wheelbase from steady cornering. iRacing's
   // car data is packed, so the program learns k=steer/curvature instead of
   // depending on a per-car table. A two-second time constant is independent
   // of packet rate; exp(-dt/tau) itself would almost replace k every frame.
   const kSample=Math.abs(steer||0)>.15&&Math.abs(curvature)>.003&&speed>8&&Math.abs(beta)<.12&&Math.abs(betaRate)<.4?Math.abs(steer)/Math.abs(curvature):null;
   if(!geo&&kSample!==null&&kSample>=15&&kSample<=80){if(this.k===null)this.k=kSample;else this.k+=(kSample-this.k)*(1-Math.exp(-learnDt/2000));}
   const loadGate=smooth((Math.abs(curvature)-.004)/.004);
   const underRaw=aligned&&span>=40&&!entering?smooth(Math.max(0,deficit-.06)/.42)*errorWeight*loadGate:0;
   // Steering margin from the current steering demand, not from a yaw-error
   // threshold. The geometric angle needed for the reference lateral load grows
   // with speed, so more steering at the same speed lowers the margin smoothly;
   // reaching that reference (or the measured lateral load) empties the rail.
   const ay=Math.abs(pathYaw)*speed;
   const id=g.vehicleIdentity;
   const geoKey=(id?String(id.carId)+':'+String(id.carPath):'')+'|'+(geo?String(geo.wheelbase)+':'+String(geo.source):'');
   if(this.geoKey!==geoKey){this.geoKey=geoKey;this.aRef=14;this.aPeak=null;this.aySince=null;this.aRefAt=null;this.k=null;}
   const refDt=this.aRefAt===null?16:Math.max(0,Math.min(100,now-this.aRefAt));
   const wheelNow=geo?Math.atan(geo.wheelbase*this.aRef/(speed*speed)):ratioK*this.aRef/(speed*speed);
   const steerNow=(geo?Math.abs(geo.angle):Math.abs(steer||0))/Math.max(wheelNow,1e-3);
   const vertical=Array.isArray(g.accG)&&finite(g.accG[1])?Math.abs(g.accG[1]-1):0;
   const active=ay>1.8&&speed>5&&vertical<.8&&(geo?steerNow>.75:steerNow>.6)&&Math.abs(beta)<.12&&Math.abs(betaRate)<.6;
   if(active){
    if(this.aySince===null)this.aySince=now;
    if(now-this.aySince>=120)this.aPeak=this.aPeak===null?ay:Math.max(this.aPeak*Math.exp(-refDt/15000),ay);
   }else this.aySince=null;
   const wet=Math.max(0,Math.min(1,(g.statuses?.trackWetness??0)/7));
   const wetFactor=1-.4*wet;
   const target=this.aPeak===null?14*wetFactor:clip(this.aPeak*1.02*wetFactor,8.0,18);
   // Reference changes slowly and is rate-limited, so the bar moves smoothly
   // when the estimated grip changes instead of stepping.
   this.aRef+=clip(target-this.aRef,-1.2*refDt/1000,1.2*refDt/1000);
   this.aRefAt=now;
   const aRef=this.aRef;
   const wheelMax=geo?Math.atan(geo.wheelbase*aRef/(speed*speed)):ratioK*aRef/(speed*speed);
   const steerUse=(geo?Math.abs(geo.angle):Math.abs(steer||0))/Math.max(wheelMax,1e-3);
   const ayUse=ay/aRef;
   const margin=clip(1-Math.max(ayUse,steerUse*.7)-underRaw*.5);
   const priorFront=finite(this.lastFront)?this.lastFront:1;
   let frontRemaining=span>=20?margin:null;
   if(frontRemaining!==null){
    // Falling stays prompt; recovery is slower so the bar does not flicker.
    if(finite(this.lastFront)&&this.frontAt!==null){
     const dt2=now-this.frontAt;
     if(dt2>0&&dt2<100)frontRemaining=this.lastFront+Math.max(-8*dt2/1000,Math.min(5*dt2/1000,frontRemaining-this.lastFront));
    }
    this.lastFront=frontRemaining;this.frontAt=now;
   }
   const understeer=underRaw;
   const outward=Math.max(0,-Math.sign(yaw)*beta),outwardGrowth=Math.max(0,-Math.sign(yaw)*betaRate);
   const yawExcess=commanded&&aligned?Math.max(0,Math.abs(yaw)/Math.abs(neutralYaw)-1):0;
   // Rear loss is recognized from heading rotating away from the velocity
   // trajectory while outward sideslip grows; countersteer is not required.
   const divergence=Math.abs(yaw)>.06?clip(Math.max(0,Math.sign(yaw)*(yaw-pathYaw))/Math.max(.12,Math.abs(yaw))):0;
   const growingRear=span>=60?smooth(outward/.035)*Math.max(smooth(outwardGrowth/.12),smooth(divergence/.65)):0;
   const sustainedRear=span>=60?smooth(outward/.09)*Math.max(smooth(yawExcess/.4),smooth(Math.max(0,outward-.035)/.06)):0;
   const oversteer=clip(Math.max(growingRear,sustainedRear));
   const residual=neutralYaw===null?0:yaw-neutralYaw;
   if(now-this.lastSwitch>1600)this.lastResidualSign=0;
   const residualSign=Math.abs(residual)>.12&&Math.abs(beta)>.018&&Math.abs(betaRate)>.025?Math.sign(residual):0;
   if(residualSign&&residualSign!==this.lastResidualSign&&now-this.lastSwitch>=140){if(this.lastResidualSign)this.switches.push(now);this.lastResidualSign=residualSign;this.lastSwitch=now;}
   this.switches=this.switches.filter(t=>now-t<=1600);
   const sway=geo&&this.switches.length>=3?smooth(Math.abs(beta)/.06)*clip(this.switches.length/4):0;
   const rearUse=Math.max(oversteer,sway,Math.abs(beta)/.3*.5);
   let rearRemaining=span>=60?clip(1-rearUse):null;
   if(rearRemaining!==null){
    if(finite(this.lastRear)&&this.rearAt!==null){const dtR=now-this.rearAt;if(dtR>0&&dtR<100)rearRemaining=this.lastRear+Math.max(-8*dtR/1000,Math.min(5*dtR/1000,rearRemaining-this.lastRear));}
    this.lastRear=rearRemaining;this.rearAt=now;
   }
   const slipL=geo?geo.wheelbase:2.6,slipA=slipL*.5,slipB=slipL*.5;
   const slipDelta=geo?geo.angle:finite(steer)?steer*slipL/ratioK:0;
   const slipVy=speed*Math.sin(beta),slipVx=Math.max(.1,speed*Math.cos(beta));
   const slipFront=speed>=5?clip((slipDelta-Math.atan2(slipVy+slipA*yaw,slipVx))*180/Math.PI,-45,45):null;
   const slipRear=speed>=5?clip((-Math.atan2(slipVy-slipB*yaw,slipVx))*180/Math.PI,-45,45):null;
   return {available:frontRemaining!==null||rearRemaining!==null,frontRemaining,rearRemaining,understeer,oversteer,sway,
    slipAngleFront:slipFront,slipAngleRear:slipRear,slipAngleSource:'bicycle-model-estimate',
    confidence:geo?.confidence||(this.k?.5:.35),reason:span<20?'kinematics-settling':geo?'current-neutral-yaw-balance':this.k?'learned-ratio-wheelbase':'learned-ratio-settling',source:'neutral-vehicle-kinematics',
    evidence:{beta,betaRate,yawRate:yaw,pathYawRate:pathYaw,yawAcceleration:yawAccel,curvatureRate,roadAngleError:angleError,angleErrorWeight:errorWeight,steer,steerRate,curvature:yaw/speed,neutralYawRate:neutralYaw,roadWheelAngle:geo?.angle??null,wheelbaseM:geo?.wheelbase??null,geometrySource:geo?.source??null,geometryUncertainty:geo?.uncertainty??null,realizedRatio:realized,steeringDeficit:deficit,rearDivergence:divergence,outwardSideslip:outward,speed,at:now,referenceLoad:aRef,peakLoad:this.aPeak,learnedRatioWheelbase:this.k}};
  }
 }
 const api={Observer,geometry};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ChassisResponse=api;
})(typeof window!=='undefined'?window:globalThis);
