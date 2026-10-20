'use strict';
const assert=require('node:assert/strict'),{Estimator,marginFromElasticity}=require('../realtime-response');
const make=()=>({handbrake:0,game:{speedKmh:80,gas:.7,brake:0,statuses:{},wheels:Array.from({length:4},()=>({load:3000,fx:600,fy:500,ratio:.03,angle:-.03}))}});
const step=(m,s,t,unloaded=[false,false,false,false])=>m.update(s,t,unloaded,{delta:5},true);
let s=make(),m=new Estimator(),v=step(m,s,0);assert.equal(v.needle,0);assert.equal(v.easeSteering,false);
const neutral=make();neutral.game.wheels.forEach(w=>{w.angle=0;w.ratio=0;});assert.equal(step(m,neutral,25).needle,0);assert.equal(step(m,neutral,50).axles.front.reserve.value,1);
// Status and G invariance, including large auxiliary changes.
const x=make(),y=structuredClone(x);y.game.statuses={absActive:true,tcActive:true,escActive:true};y.game.accG=[9,-8,7];
assert.deepEqual(step(new Estimator(),x,0),step(new Estimator(),y,0));
// Old road / force history cannot affect current state after the strict 100ms horizon.
const warmed=new Estimator(),cold=new Estimator();for(let t=0;t<1000;t+=20){const p=make();p.game.wheels.forEach(w=>{w.ratio=.8;w.angle=.4;w.fx=8000;});step(warmed,p,t);}
for(let t=1000;t<=1140;t+=20){v=step(warmed,x,t);const c=step(cold,x,t);if(t>=1100)assert.deepEqual(v,c);}
assert(warmed.history.every(h=>h.every(p=>1140-p.time<=100)));
// A short linear response stays productive; a local plateau is visibly exhausted without ABS.
function ramp(plateau){const m=new Estimator();let v;for(let t=0;t<=100;t+=25){const p=make(),k=.03+t*.0005;p.game.wheels.forEach(w=>{w.angle=0;w.ratio=k;w.fy=0;w.fx=3000*(plateau?.65:k*12);});v=step(m,p,t);}return v;}
const linear=ramp(false),plateau=ramp(true);assert(plateau.axles.front.responseObserved);assert(plateau.wheels.every(w=>w.directions.longitudinal.estimate.value<.05&&w.directions.longitudinal.danger>.9));assert(plateau.wheels[0].remaining===linear.wheels[0].remaining,'fit cannot rewrite measured main state');assert(linear.axles.front.currentReserve.value>.7);assert(linear.axles.front.reserve.value<=linear.axles.front.currentReserve.value);
// Recovery, discontinuities, reversal: no stale slope reused.
s=make();s.game.wheels.forEach(w=>{w.angle=-.3;w.ratio=.4;});m=new Estimator();v=step(m,s,0);assert(v.steeringState.front>.8&&v.steeringState.rear>.8);
s.game.wheels.forEach(w=>{w.angle=.03;w.ratio=-.02;});v=step(m,s,25);assert.equal(v.needle,0);assert(v.axles.front.reserve.value>.9);
v=step(m,s,50,[true,false,false,false]);assert.equal(v.axles.front.support,.5);assert(Math.abs(v.axles.front.reserve.value-v.wheels[1].remaining/2)<1e-12);
v=step(m,s,75,[true,true,true,true]);assert.equal(v.axles.front.reserve.value,0);assert.equal(v.needle,0);
s=make();s.game.speedKmh=0;v=step(new Estimator(),s,0);assert.equal(v.axles.front.reserve.value,1);assert.equal(v.axles.front.reserve.low,1);
for(const driven of [[0,1],[2,3],[0,1,2,3]]){s=make();s.game.wheels.forEach((w,i)=>{w.angle=0;w.ratio=driven.includes(i)?.95:0;w.fx=driven.includes(i)?2000:0;});v=step(new Estimator(),s,0);assert(v.driveCue.severity>.8);s.game.gas=0;assert.equal(step(new Estimator(),s,0).driveCue,null);}
// Frame cadence, finite/bounded output and endpoint colour input safety.
for(const dt of [10,20,25,33,50,120]){m=new Estimator();for(let t=0;t<1000;t+=dt){s=make();s.game.wheels.forEach((w,i)=>{w.angle=Math.sin(t/90+i)*.4;w.ratio=Math.cos(t/120+i)*.8;});v=step(m,s,t);assert(Number.isFinite(v.needle));for(const a of Object.values(v.axles))assert(a.reserve.value>=0&&a.reserve.value<=1);}}
assert(marginFromElasticity(0)<1e-10);assert(marginFromElasticity(1)>.999);
console.log('PASS: 100ms history isolation; same-frame recovery/reversal; G and ABS/TC/ESC invariance; linear/plateau local response; rest/unload/single-wheel; FWD/RWD/AWD; zero-input exit; finite cadence boundaries.');

// A recovered force channel cannot fit a slope through earlier missing-force samples.
s=make();m=new Estimator();for(let t=0;t<=100;t+=25){s.game.wheels.forEach(w=>{w.ratio=.03+t*.0005;w.fx=t<100?null:2000;w.fy=t<100?null:0;});v=step(m,s,t);}assert(!v.axles.front.responseObserved);
console.log('PASS: missing force history cannot masquerade as observed local response.');
// Explicit semantic endpoints, not an ambiguous road-left/road-right recommendation.
s=make();s.game.wheels.forEach((w,i)=>{w.ratio=0;w.angle=i<2?-.2:0;});v=step(new Estimator(),s,0);assert(v.needle<-.5);assert(v.steeringState.front>.5&&v.steeringState.rear===0);
s.game.wheels.forEach((w,i)=>w.angle=i>=2?.2:0);v=step(new Estimator(),s,0);assert(v.needle>.5);
s.game.wheels.forEach(w=>w.angle=.3);v=step(new Estimator(),s,0);assert(v.steeringState.both);assert.equal(v.needle,0);
// Speed alone never consumes margin. Measured road-wheel change is an early, bounded warning.
function steerTransient(speed,change){const m=new Estimator(),s=make();s.game.speedKmh=speed;s.game.wheels.forEach(w=>{w.ratio=0;w.angle=-.01;w.fy=800;w.fx=0;});let v;for(let t=0;t<=100;t+=25)v=m.update(s,t,[false,false,false,false],{delta:.5,wheel:change?t*.05:0,wheelbase:2.6},true);return v;}
const slowStraight=steerTransient(40,false),fastStraight=steerTransient(200,false);
assert.deepEqual(slowStraight.axles.front.reserve,fastStraight.axles.front.reserve);
assert(fastStraight.steeringState.sensitivity>slowStraight.steeringState.sensitivity);
const slowInput=steerTransient(40,true),fastInput=steerTransient(200,true);
assert(fastInput.axles.front.reserve.value<slowInput.axles.front.reserve.value);
assert(fastInput.axles.front.forecastDrop>0);assert(fastInput.axles.rear.forecastDrop===0,'road-wheel feed-forward is front-only');
assert(fastInput.axles.front.reserve.value>=fastInput.axles.front.currentReserve.value*.65-1e-10);
// Growing rear slip lowers rear outlook; recovering slip cannot be extrapolated through zero.
m=new Estimator();s=make();for(let t=0;t<=100;t+=25){s.game.wheels.forEach((w,i)=>{w.ratio=0;w.angle=i>=2?.02+t*.0005:0;w.fx=0;w.fy=w.angle*30000;});v=step(m,s,t);}assert(v.axles.rear.forecastDrop>0);assert.equal(v.axles.front.forecastDrop,0);
s.game.wheels.forEach(w=>{w.angle=0;w.ratio=0;});v=step(m,s,125);assert.equal(v.axles.rear.reserve.value,1);
console.log('PASS: push/rotate/both-slide semantic axis; speed-alone invariance; high-speed observed steering lead; bounded forecast, front-only feed-forward; rear slip lead and zero-crossing recovery.');
// A longitudinal force plateau cannot be hidden by rising lateral force in the combined norm.
function directional(mode){const m=new Estimator(),s=make();s.game.gas=0;s.game.brake=.8;let v;for(let t=0;t<=100;t+=25){s.game.wheels.forEach(w=>{w.ratio=-(.04+t*.0005);w.angle=.025;w.fx=-3000*(mode==='declining'?.9-t*.003:.7);w.fy=3000*(.1+t*.004);});v=step(m,s,t);}return v;}
let directionalPlateau=directional('plateau');
assert(directionalPlateau.wheels.every(w=>w.axisResponses.some(r=>r.axis==='longitudinal'&&r.state==='plateau')));
assert(directionalPlateau.wheels.every(w=>w.directions.longitudinal.estimate.value<.05));
const declining=directional('declining');assert(declining.axles.front.overrun>.1);assert(declining.brakeCue.overrun>.1);assert(declining.wheels.every(w=>w.directions.longitudinal.estimate.value<.05));
assert(declining.axles.front.sides.every(s=>s.overrun>0));
// A single frame / constant slip cannot establish a missing peak; no fabricated overrun.
s=make();m=new Estimator();for(let t=0;t<=100;t+=25)v=step(m,s,t);assert.equal(v.axles.front.overrun,0);
console.log('PASS: directional braking plateau despite combined force growth; independently measured declining-response overrun; no negative margin invented from steady data.');

// Normal slip with increasing useful force must not request lift/brake release.
for(const braking of [false,true]){m=new Estimator();s=make();s.game.gas=braking?0:.7;s.game.brake=braking?.7:0;for(let t=0;t<=100;t+=25){const k=.025+t*.0002;s.game.wheels.forEach(w=>{w.angle=.001;w.ratio=braking?-k:k;w.fx=(braking?-1:1)*k*15*w.load;w.fy=0;});v=step(m,s,t);}assert((braking?v.brakeCue:v.driveCue).mode==='risk-trend'&&(braking?v.brakeCue:v.driveCue).severity<.3);}
// Rear handbrake-induced slip does not become a foot-brake release request.
s=make();s.handbrake=100;s.game.gas=0;s.game.brake=.8;s.game.wheels.forEach((w,i)=>{w.ratio=i>=2?-.95:0;w.fx=i>=2?-2000:0;w.angle=0;w.fy=0;});assert.equal(step(new Estimator(),s,0).brakeCue,null);
console.log('PASS: productive slip never implies release; observed plateau/decline and gross-slip fallback; handbrake rear exclusion.');
