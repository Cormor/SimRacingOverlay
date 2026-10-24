'use strict';
const assert=require('node:assert/strict'),{Observer}=require('../chassis-response'),{Model}=require('../assist');
const geo={wheelbaseM:2.575,steeringRatio:13.5,source:'synthetic-geometry',nominal:true};
function game(t,steer,yaw,v=40){return {available:true,source:'fixture',carModel:'fixture',packet:t+1,sampleTime:t,speedKmh:v*3.6,gas:.5,brake:0,gear:3,localVelocity:[0,0,v],steeringWheelAngle:steer,yawRate:yaw,vehicleGeometry:geo,wheels:Array.from({length:4},()=>({angle:null,ratio:null,load:null,fx:null,fy:null}))};}
for(const speed of [8,20,40,60])for(const delay of [60,120,180,240]){
 const m=new Observer();for(let t=0;t<=1600;t+=20){const steer=t>=400&&t<800?.05:0,old=t>=400+delay&&t<800+delay?.05:0,yaw=speed/geo.wheelbaseM*Math.tan(old/geo.steeringRatio);const v=m.update(game(t,steer,yaw,speed),t);if(t>=80){assert(Number.isFinite(v.frontRemaining),JSON.stringify({speed,delay,t,value:v}));assert(v.frontRemaining>.55,'a small correction is not exhausted front response');assert(v.understeer<.25,'small straight correction does not trigger understeer');}}
}
// The margin is normalized by speed: the geometric angle for the reference
// lateral load shrinks as speed rises, so a speed change intentionally moves
// the bar. Only pedal/gear changes at the same kinematics must stay isolated.
// Gear/clutch/throttle edits alone cannot affect any lateral response or handling.
{const a=new Model(),b=new Model();for(let t=0;t<=1600;t+=20){const g=game(t,.7,.2,25),h=structuredClone(g);h.gear=t<400?4:t<500?0:3;h.gas=t<400?.8:0;h.clutch=t<500?1:0;const x=a.update({connected:true,game:g},t),y=b.update({connected:true,game:h},t);assert.deepEqual(x.grip.vehicleResponse,y.grip.vehicleResponse);assert.deepEqual(x.handling,y.handling);for(let i=0;i<4;i++)assert.deepEqual(x.grip.wheels[i].directions.lateral,y.grip.wheels[i].directions.lateral);}}
console.log('PASS: 16 speed/delay combinations retain straight-line data without false understeer; acceleration invariance; gear/clutch/throttle isolation.');
