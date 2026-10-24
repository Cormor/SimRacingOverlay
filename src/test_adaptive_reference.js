'use strict';
const assert=require('node:assert/strict'),{Observer}=require('../chassis-response');
function game(t,steer,yaw,v=20,id=160){return {available:true,source:'fixture',carModel:'fixture',packet:t+1,sampleTime:t,speedKmh:v*3.6,gas:.4,brake:0,gear:3,localVelocity:[0,0,v],steeringWheelAngle:steer,yawRate:yaw,accG:[0,1,0],vehicleIdentity:{carId:id,carPath:'fixture'},vehicleGeometry:{wheelbaseM:2.5,steeringRatio:20,source:'fixture'},wheels:Array.from({length:4},()=>({angle:null,ratio:null,load:null,fx:null,fy:null}))};}
// Low grip: sustained large steering with low achieved lateral load lowers the
// estimated reference and empties the margin.
{
 const m=new Observer();let out,last=null,maxJump=0;
 for(let t=0;t<=6000;t+=20){out=m.update(game(t,1.4,.3),t);if(last!==null&&Number.isFinite(out.frontRemaining))maxJump=Math.max(maxJump,Math.abs(out.frontRemaining-last));if(Number.isFinite(out.frontRemaining))last=out.frontRemaining;}
 assert(m.aRef<12,'low grip lowers the reference: '+m.aRef);
 assert(out.frontRemaining<.2,'low grip empties the margin: '+out.frontRemaining);
 assert(maxJump<.2,'reference updates keep the bar continuous: '+maxJump);
}
// High grip: the same steering with a high achieved lateral load raises the
// reference instead of pinning it at the default.
{
 const m=new Observer();let out;
 for(let t=0;t<=3000;t+=20)out=m.update(game(t,1.4,.7),t);
 assert(m.aRef>14.1,'high grip raises the reference: '+m.aRef);
}
// A single impact/kerb spike must not set the reference.
{
 const m=new Observer();
 for(let t=0;t<100;t+=20)m.update(game(t,1.4,.3),t);
 m.update(game(120,1.4,1.5),120);
 for(let t=140;t<=600;t+=20)m.update(game(t,1.4,.3),t);
 assert(m.aRef>13,'a sub-120ms spike does not raise the reference: '+m.aRef);
}
// A vehicle change resets the learned reference.
{
 const m=new Observer();
 for(let t=0;t<=5000;t+=20)m.update(game(t,1.4,.3),t);
 assert(m.aRef<12);
 m.update(game(5020,1.4,.3,20,999),5020);
 assert.equal(m.aRef,14,'vehicle change resets the reference');
}
console.log('PASS: adaptive grip reference lowers/raises slowly, ignores spikes, stays continuous, resets on vehicle change.');
