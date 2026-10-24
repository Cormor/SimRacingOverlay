'use strict';
const assert=require('node:assert/strict'),{Observer}=require('../chassis-response');
const geo={wheelbaseM:2.5,steeringRatio:20,source:'fixture'};
function game(t,steer,yaw,v=20,beta=.002,geometry=geo){return {available:true,speedKmh:v*3.6,localVelocity:[Math.tan(beta)*v,0,v],steeringWheelAngle:steer,yawRate:yaw,vehicleGeometry:geometry,wheels:Array.from({length:4},()=>({angle:null,ratio:null,load:null,fx:null,fy:null}))};}
// Straight line: both estimated angles are zero.
{
 const m=new Observer();let out;
 for(let t=0;t<=200;t+=20)out=m.update(game(t,0,0),t);
 assert(Math.abs(out.slipAngleFront)<.2&&Math.abs(out.slipAngleRear)<.2,JSON.stringify(out));
 assert.equal(out.slipAngleSource,'bicycle-model-estimate');
}
// Steady corner: front and rear estimates have the expected signs and magnitude.
{
 const m=new Observer();let out;
 for(let t=0;t<=400;t+=20)out=m.update(game(t,.3,.2,20,.02),t);
 assert(out.slipAngleFront<0,'front slip angle is negative in this right-hand convention: '+out.slipAngleFront);
 assert(out.slipAngleRear<0,'rear slip angle follows the same convention: '+out.slipAngleRear);
 assert(Math.abs(out.slipAngleFront)<15&&Math.abs(out.slipAngleRear)<15);
}
// Low speed leaves the indicators unknown rather than showing zero.
{
 const m=new Observer();const out=m.update(game(0,.3,.1,3),0);
 assert(!Number.isFinite(out.slipAngleFront));
 assert(!Number.isFinite(out.slipAngleRear));
}
// Without a geometry table the learned ratio still produces estimates.
{
 const m=new Observer();let out;
 for(let t=0;t<=2000;t+=20)out=m.update(game(t,.4,.12,20,.01,null),t);
 assert(Number.isFinite(out.slipAngleFront)&&Number.isFinite(out.slipAngleRear),JSON.stringify(out));
}
console.log('PASS: estimated front/rear slip angles, sign, low-speed unknown, no-geometry learning.');
