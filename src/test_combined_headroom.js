'use strict';
const assert=require('node:assert/strict'),{Estimator}=require('../realtime-response'),L=require('../layout');
function sample(k=0,a=0,input=.6){return {handbrake:0,game:{speedKmh:100,gas:input,brake:input,wheels:Array.from({length:4},()=>({ratio:k,angle:a,load:3000,fx:k*20000,fy:a*20000}))}};}
function once(k,a,input){return new Estimator().update(sample(k,a,input),0,[false,false,false,false],{},true);}
// Longitudinal slip does not masquerade as measured lateral occupancy, or vice versa.
for(const sign of [-1,1])for(const mag of [0,.02,.05,.1,.2,.4,.8]){assert.equal(once(sign*mag,0).wheels[0].directions.lateral.current,1);assert.equal(once(0,sign*mag).wheels[0].directions.longitudinal.current,1);}
assert(once(0,.5).wheels[0].directions.lateral.current<.01);
// No 55% gate; both the tyre border and pedal expose the same continuously graded risk.
for(const sign of [-1,1]){const severity=k=>(sign>0?once(sign*k,0).driveCue:once(sign*k,0).brakeCue)?.severity||0;
 assert(severity(.2)>.5&&severity(.4)>.9);assert(Math.abs(severity(.5501)-severity(.5499))<.001);
 let previous=0;for(let i=0;i<=100;i++){const v=severity(i/200);assert(v>=previous-1e-12);previous=v;}
 for(const input of [.00001,.001,.039,.04,.041,.1]){const v=once(sign*.2,0,input),cue=sign>0?v.driveCue:v.brakeCue;assert(cue.severity>0&&cue.mode==='risk-trend');}
 assert.equal(sign>0?once(sign*.2,0,0).driveCue:once(sign*.2,0,0).brakeCue,null);
}
// A longitudinal plateau remains visible at the pedal; it cannot erase a known lateral state.
{const m=new Estimator();let v;for(let t=0;t<=100;t+=20){const s=sample(.04+t*.0005,0);s.game.wheels.forEach(w=>w.fx=2100);v=m.update(s,t,[false,false,false,false],{},true);}assert(v.wheels.every(w=>w.directions.lateral.estimate.value===1&&w.directions.longitudinal.estimate.value<.1));assert(v.driveCue.severity>.8);}
// Default/reset size contract, without overriding an explicitly saved user size.
const clean=L.clean(null);for(const key of ['frontResponse','rearResponse']){assert.equal(clean.controls[key].sx,2);assert.equal(clean.controls[key].sy,2);assert.equal(L.defaultScale(key),2);}assert.equal(clean.controls.wheel.sx,1);assert.equal(L.clean({controls:{frontResponse:{sx:1.7,sy:1.6}}}).controls.frontResponse.sx,1.7);
// Wheel/axis availability and unload still take priority over estimates.
{const s=sample(.2,.1);s.game.wheels[0].load=0;const v=new Estimator().update(s,0,[true,false,false,false],{},true);assert(v.wheels[0].unloaded);assert.equal(v.wheels[0].remaining,0);assert(v.wheels[1].directions.lateral.available);}
console.log('PASS: independent measured lateral state; longitudinal plateau retained at pedal; continuous slip/input risk; 2x defaults and saved settings; unload.');
