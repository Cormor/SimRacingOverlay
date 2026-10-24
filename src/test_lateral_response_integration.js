'use strict';
const path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),{Model}=require(path.join(root,'assist'));
let packet=0;
function state(t,steer=.3,yaw=.12,beta=.002){return {connected:true,angle:steer*180/Math.PI,brake:0,throttle:40,buttons:[],game:{available:true,source:'arbitrary-vehicle',capabilities:{kinematicsProfile:'adaptive-steering-v1'},carModel:'fixture',packet:++packet,sampleTime:t,speedKmh:72,gas:.4,brake:0,localVelocity:[Math.tan(beta)*20,0,20],steeringWheelAngle:steer,yawRate:yaw,vehicleGeometry:{wheelbaseM:2.5,steeringRatio:20,source:'synthetic-known-geometry'},wheels:Array.from({length:4},()=>({angle:null,ratio:null,load:null,fx:null,fy:null}))}};}
let m=new Model(),v;
v=m.update(state(0),0);assert.equal(v.grip.wheels[0].directions.lateral.current,null,'unsettled body-only input cannot show a green front reserve');
for(let t=20;t<=2400;t+=20)v=m.update(state(t),t);
assert(v.grip.wheels[0].directions.lateral.current>.7,'productive response with supplied geometry can be green');
for(let i=1;i<=80;i++){const s=.3+i*.012;v=m.update(state(2400+i*20,s,20*Math.min(s,.5)/50),2400+i*20);}
assert(v.grip.wheels[0].directions.lateral.current<.2,'main fill, not only an outline, exposes exhausted response');
assert.equal(v.handling.state,'understeer');assert(Math.abs(v.grip.vehicleResponse.evidence.beta)<.01,'early warning does not wait for large sideslip');
assert(v.grip.wheels.every(w=>w.angle===null),'body observer never writes invented native wheel slip angles');
for(let i=1;i<=25;i++)v=m.update(state(4000+i*20,.3,.12),4000+i*20);
assert(v.grip.wheels[0].directions.lateral.current>.7&&!v.handling.state,'normal response recovery clears the warning');
// Same-body dynamics, different actual failure: excess yaw, growing outward beta, countersteer.
m=new Model();for(let t=0;t<=2400;t+=20)v=m.update(state(t),t);
for(let i=1;i<=35;i++)v=m.update(state(2400+i*20,i<20?.3:-.15,.12+i*.012,-.002-i*.0013),2400+i*20);
assert.equal(v.handling.state,'oversteer');assert(v.grip.wheels[2].directions.lateral.current<.6);
// Native tyre force plateau at a small angle must change the MAIN horizontal fill too.
m=new Model();
for(let t=0;t<=100;t+=20){const s=state(t);delete s.game.yawRate;delete s.game.steeringWheelAngle;s.game.wheels.forEach((w,i)=>Object.assign(w,{angle:i<2?.03+t*.0003:.03,ratio:0,load:3000,fx:0,fy:i<2?2000:1500}));v=m.update(s,t);}
assert(v.grip.wheels[0].directions.lateral.current<.2&&v.grip.wheels[2].directions.lateral.current>.8,'front plateau does not erase independent rear response');
assert.equal(v.handling.state,'understeer');
for(let t=120;t<=500;t+=20){const s=state(t);delete s.game.yawRate;delete s.game.steeringWheelAngle;s.game.wheels.forEach((w,i)=>Object.assign(w,{angle:i<2?.06:.03,ratio:0,load:3000,fx:0,fy:i<2?2000:1500}));v=m.update(s,t);}
assert(v.grip.wheels[0].directions.lateral.current<.2,'holding the same saturated force/slip state cannot turn green just because the fit window stops growing');
console.log('PASS: early main-bar response exhaustion, honest unknown geometry, understeer/oversteer classification, recovery, native plateau hold, independent rear state and no synthetic wheel angles.');
