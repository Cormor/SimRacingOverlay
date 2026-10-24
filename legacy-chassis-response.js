'use strict';
// Current-state kinematics and neutral bicycle geometry. No learned grip peak,
// driver-history baseline, countersteer prerequisite, or fabricated tyre forces.
(function(root){
 const finite=Number.isFinite,clip=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
 const smooth=x=>{x=clip(x);return x*x*(3-2*x);};
 function derivative(rows,key){
  if(rows.length<3||rows.at(-1).t-rows[0].t<45)return 0;
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
  reset(){this.resetTransient();}
  resetTransient(){this.rows=[];this.last=null;this.switches=[];this.lastResidualSign=0;this.lastSwitch=-Infinity;this.commandSign=0;this.turnStart=-Infinity;}
  missing(reason){return {available:false,frontRemaining:null,rearRemaining:null,understeer:0,oversteer:0,sway:0,confidence:0,reason,source:'neutral-vehicle-kinematics'};}
  update(g,now){
   const v=g.localVelocity,yaw=g.yawRate;
   if(!finite(now)||!g.available||g.paused===true||g.inMenu===true||!Array.isArray(v)||v.length!==3||!v.every(finite)||!finite(yaw)){
    this.resetTransient();return this.missing('missing-body-kinematics');
   }
   const speed=v[2];if(speed<5){this.resetTransient();return this.missing(speed<0?'reverse':'low-speed');}
   if(this.last&&(now<=this.last.t||now-this.last.t>250))this.resetTransient();
   const beta=Math.atan2(v[0],speed),geo=geometry(g),steer=finite(g.steeringWheelAngle)?g.steeringWheelAngle:null;
   const p={t:now,v:speed,yaw,beta,curvature:yaw/speed,steer:steer??0};
   this.rows=this.rows.filter(p=>now-p.t<=120);this.rows.push(p);this.last=p;
   const span=now-this.rows[0].t,yawAccel=derivative(this.rows,'yaw'),curvatureRate=derivative(this.rows,'curvature'),betaRate=derivative(this.rows,'beta'),steerRate=derivative(this.rows,'steer');
   // The inertial velocity heading equals body heading + body sideslip.
   // Its rotation therefore follows r_path = r_body + beta_dot (right-positive).
   const pathYaw=yaw+betaRate,neutralYaw=geo?speed/geo.wheelbase*Math.tan(geo.angle):null;
   const turnSign=Math.sign(neutralYaw||yaw),commanded=finite(neutralYaw)&&Math.abs(geo.angle)>.00001;
   const commandSign=commanded?Math.sign(neutralYaw):0;if(commandSign!==this.commandSign){this.commandSign=commandSign;this.turnStart=now;}
   const aligned=commanded&&yaw*neutralYaw>=0;
   const observedTurn=Math.max(0,turnSign*yaw,turnSign*pathYaw);
   // During ordinary turn-in, currently measured positive curvature change is
   // evidence of ongoing realization, not a reason to wait for a plateau.
   // Longitudinal acceleration alone cannot supply curvature response.
   // Short bounded projection does not alter the raw yaw/slip measurements.
   const developing=Math.max(0,turnSign*curvatureRate)*speed*.1;
   const realized=commanded?clip((observedTurn+developing)/Math.abs(neutralYaw),0,2):null;
   const entering=now-this.turnStart<100&&Math.abs(yaw)<Math.abs(neutralYaw||0)*.3;
   const deficit=commanded&&span>=60&&!entering?Math.max(0,1-realized-(geo?.uncertainty||0)):0;
   // An absolute road-angle residual supplies the dimensional scale. A tiny
   // denominator must not turn a normal straight-line correction into full loss.
   const angleError=commanded?Math.max(0,Math.abs(geo.angle)-Math.atan(geo.wheelbase*(observedTurn+developing)/speed)):0;
   const errorWeight=smooth(angleError/.035);
   const frontRemaining=geo&&span>=60?clip(1-deficit*errorWeight*2):null;
   const understeer=aligned&&span>=60&&!entering?smooth(Math.max(0,deficit-.06)/.42)*errorWeight:0;
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
   const rearRemaining=span>=60?(geo?1-Math.max(oversteer,sway):oversteer>.15?1-oversteer:null):null;
   return {available:frontRemaining!==null||rearRemaining!==null,frontRemaining,rearRemaining,understeer,oversteer,sway,
    confidence:geo?.confidence||(oversteer>.15?.6:0),reason:span<60?'kinematics-settling':geo?'current-neutral-yaw-balance':'missing-steering-geometry',source:'neutral-vehicle-kinematics',
    evidence:{beta,betaRate,yawRate:yaw,pathYawRate:pathYaw,yawAcceleration:yawAccel,curvatureRate,roadAngleError:angleError,angleErrorWeight:errorWeight,steer,steerRate,curvature:yaw/speed,neutralYawRate:neutralYaw,roadWheelAngle:geo?.angle??null,wheelbaseM:geo?.wheelbase??null,geometrySource:geo?.source??null,geometryUncertainty:geo?.uncertainty??null,realizedRatio:realized,steeringDeficit:deficit,rearDivergence:divergence,outwardSideslip:outward,speed,at:now}};
  }
 }
 const api={Observer,geometry};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LegacyChassisResponse=api;
})(typeof window!=='undefined'?window:globalThis);
