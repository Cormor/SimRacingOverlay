'use strict';
const assert=require('node:assert/strict'),{Estimator,axisResponse}=require('../realtime-response'),{Model}=require('../assist');
function state(){return {connected:true,handbrake:0,game:{available:true,source:'fixture',carModel:'fixture',packet:1,sampleTime:1000,speedKmh:100,gas:.8,brake:0,capabilities:{loads:true},localVelocity:[0,0,28],roadWheelAngle:0,wheels:Array.from({length:4},()=>({ratio:.04,angle:0,load:3000,fx:1800,fy:0}))}};}
function ramp(recovering,cut=false){const m=new Estimator(),s=state();let v;for(let t=0;t<=100;t+=20){const k=recovering?.09-t*.0005:.04+t*.0005;s.game.wheels.forEach(w=>{w.ratio=k;w.fx=cut&&t>=60?-1800:1800;});v=m.update(s,t,[false,false,false,false],{},true);}return v;}
const growing=ramp(false),recovery=ramp(true),forceReversal=ramp(false,true);
assert(growing.wheels.every(w=>w.directions.longitudinal.estimate.evidence>.9&&w.directions.longitudinal.danger>.9));
assert(recovery.wheels.every(w=>!w.axisResponses.length&&w.directions.longitudinal.phase==='recovering'));
assert(recovery.driveCue?.mode==='risk-trend'&&recovery.driveCue.severity<.1,'recovery exposes small residual risk, not a release command');
assert(forceReversal.wheels.every(w=>!w.axisResponses.length),'force sign crossing is a transient, not a magnitude slope');
// Same measured input, different force curve: same main state, distinct secondary response.
{const a=new Estimator(),b=new Estimator();let va,vb;for(let t=0;t<=100;t+=20){const s=state(),r=state();s.game.wheels.forEach(w=>w.ratio=.04+t*.0005);r.game.wheels.forEach(w=>{w.ratio=.04+t*.0005;w.fx=w.ratio*3000*12;});va=a.update(s,t,[false,false,false,false],{},true);vb=b.update(r,t,[false,false,false,false],{},true);}
 assert.equal(va.wheels[0].remaining,vb.wheels[0].remaining);assert.equal(va.wheels[0].directions.longitudinal.current,vb.wheels[0].directions.longitudinal.current);
 assert(va.wheels[0].directions.longitudinal.estimate.value<.05&&vb.wheels[0].directions.longitudinal.estimate.value>va.wheels[0].directions.longitudinal.estimate.value+.3);
 const s=state();s.game.wheels.forEach(w=>w.ratio=.09);const v=a.update(s,201,[false,false,false,false],{},true);assert.equal(v.wheels[0].directions.longitudinal.estimate.evidence,0,'no fit survives >100ms');}
// Transport jitter cannot alter physics derivatives with identical producer stamps.
{const a=new Model(),b=new Model();for(let i=0;i<7;i++){const s=state();s.game.packet=i+1;s.game.sampleTime=1000+i*20;s.game.wheels.forEach(w=>{w.ratio=.03+i*.007;w.fx=1800;});const va=a.update(s,i*20),vb=b.update(s,[0,31,35,71,82,116,123][i]);assert.deepEqual(va.grip,vb.grip);}}
// Orthogonal data and all wheel positions remain independently useful.
{const m=new Estimator(),s=state();delete s.game.localVelocity;delete s.game.velocity;s.game.wheels[0].ratio=null;s.game.wheels[0].angle=.1;s.game.wheels[1].angle=null;const v=m.update(s,0,[false,false,false,false],{},true);assert(v.wheels[0].directions.lateral.available&&!v.wheels[0].directions.longitudinal.available);assert(v.wheels[1].directions.longitudinal.available&&!v.wheels[1].directions.lateral.available);}
// Actual danger is same-frame; no smooth/shift gate hides genuine spin or an unloaded wheel.
for(const driven of [[0,1],[2,3],[0,1,2,3]]){const m=new Estimator(),s=state();m.update(s,0,[false,false,false,false],{},true);s.game.gear=5;s.game.wheels.forEach((w,i)=>{w.ratio=driven.includes(i)?.95:0;w.angle=0;});let v=m.update(s,20,[false,false,false,false],{},true);for(const i of driven)assert(v.wheels[i].directions.longitudinal.danger>.99);assert(v.driveCue.severity>.8);s.game.gas=0;v=m.update(s,40,[false,false,false,false],{},true);assert.equal(v.driveCue,null);}
console.log('PASS: separate measured/inferred quantities; growth/recovery/force-sign discrimination; producer-clock invariance; no stale fit; independent axes; immediate real danger; FWD/RWD/AWD and zero-input exit.');
