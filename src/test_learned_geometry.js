'use strict';
const assert=require('node:assert/strict'),{Observer}=require('../chassis-response');
function game(t,steer,yaw,v=20,id=160,wet=0,beta=0){return {available:true,source:'fixture',carModel:'fixture',packet:t+1,sampleTime:t,speedKmh:v*3.6,gas:.4,brake:0,gear:3,localVelocity:[Math.tan(beta)*v,0,v],steeringWheelAngle:steer,yawRate:yaw,accG:[0,1,0],statuses:{trackWetness:wet},vehicleIdentity:{carId:id,carPath:'fixture'},vehicleGeometry:null,wheels:Array.from({length:4},()=>({angle:null,ratio:null,load:null,fx:null,fy:null}))};}
// A car without a geometry table learns ratio*wheelbase from steady cornering
// and still produces a live margin.
{
 const m=new Observer();let out;
 for(let t=0;t<=2000;t+=20)out=m.update(game(t,.4,.12),t);
 assert(m.k>55&&m.k<80,'learned ratio*wheelbase: '+m.k);
 assert(out.frontRemaining!==null&&out.frontRemaining>.5,'no-geometry margin is live: '+out.frontRemaining);
 assert.equal(out.reason,'learned-ratio-wheelbase');
}
// Changing the car resets the learned value.
{
 const m=new Observer();for(let t=0;t<=1000;t+=20)m.update(game(t,.4,.12),t);
 assert(m.k>0);
 m.update(game(1020,.4,.12,20,999),1020);
 assert.equal(m.k,null,'vehicle change clears the learned ratio');
}
// Rear margin recovers smoothly after a large yaw/sideslip excursion.
{
 const m=new Observer();let out;
 for(let t=0;t<=1200;t+=20)out=m.update(game(t,.3,.5,20,160,0,-.08),t);
 assert(out.rearRemaining<.4,'rear margin drops under oversteer: '+out.rearRemaining);
 for(let t=1220;t<=1600;t+=20)out=m.update(game(t,.1,.03),t);
 assert(out.rearRemaining>.7,'rear margin recovers: '+out.rearRemaining);
}
// Wet track lowers the reference without a step.
{
 const m=new Observer();let out,maxJump=0,prev=null;
 for(let t=0;t<=3000;t+=20){out=m.update(game(t,.4,.12,20,160,7),t);if(prev!==null&&Number.isFinite(out.frontRemaining))maxJump=Math.max(maxJump,Math.abs(out.frontRemaining-prev));if(Number.isFinite(out.frontRemaining))prev=out.frontRemaining;}
 assert(m.aRef<13,'wet track lowers the reference: '+m.aRef);
 assert(maxJump<.2,'wet reference changes stay continuous: '+maxJump);
}
console.log('PASS: runtime ratio*wheelbase learning, car reset, rear recovery and wet reference.');

// Equivalent elapsed time, different packet rates: geometry identification has
// a 2-second time constant rather than replacing ~99% of k on each sample.
{
 const values=[];
 for(const dt of [10,20,40]){const m=new Observer();for(let t=0;t<=4000;t+=dt)m.update(game(t,t<1000?.3:.45,.12),t);values.push(m.k);}
 assert(Math.max(...values)-Math.min(...values)<.15,JSON.stringify(values));
}
// Missing geometry still permits learning the reference from achieved load.
{
 const m=new Observer();for(let t=0;t<=6000;t+=20)m.update(game(t,1.4,.3),t);
 assert(m.aPeak!==null,'load reference is observable without a hard-coded geometry table');
 assert(m.aRef<12,'low-grip reference adapts on the no-geometry path');
}
