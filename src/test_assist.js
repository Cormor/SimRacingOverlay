const assert=require('node:assert/strict');
const {Model,geometry}=require('../assist.js');
const r=Math.PI/180;
function fixture(wheel=17,motion=5){return {connected:true,handbrake:0,throttle:70,brake:70,game:{available:true,telemetryVersion:2,packet:1,source:'fixture',carModel:'test',sampleTime:1000,speedKmh:72,gas:0,brake:.7,statuses:{},velocity:[20*Math.sin(motion*r),0,20*Math.cos(motion*r)],localVelocity:[20*Math.sin(motion*r),0,20*Math.cos(motion*r)],angularVelocity:[0,-20*Math.cos(motion*r)/2.6*Math.tan(motion*r),0],wheels:[[-.8,0,1.3],[.8,0,1.3],[-.8,0,-1.3],[.8,0,-1.3]].map((p,i)=>({load:3000,contactPoint:p,contactNormal:[0,1,0],contactHeading:i<2?[Math.sin(wheel*r),0,Math.cos(wheel*r)]:[0,0,-1],angle:(i<2?6:2)*r,ratio:0,omega:60}))}};}
const near=(a,b,t=1e-6)=>assert(Math.abs(a-b)<t,`${a} != ${b}`);
let s=fixture(),g=geometry(s.game,[false,false,false,false]);near(g.wheel,17);
// Same geometry under world yaw and road banking must not change the readout.
function rotate(v){const y=.8,z=.2;let a=[Math.cos(y)*v[0]+Math.sin(y)*v[2],v[1],-Math.sin(y)*v[0]+Math.cos(y)*v[2]];return [Math.cos(z)*a[0]-Math.sin(z)*a[1],Math.sin(z)*a[0]+Math.cos(z)*a[1],a[2]];}
s.game.velocity=rotate(s.game.velocity);s.game.wheels.forEach(w=>{for(const key of ['contactPoint','contactHeading','contactNormal'])w[key]=rotate(w[key]);});g=geometry(s.game,[false,false,false,false]);near(g.wheel,17);
// ACR's world frame is mirrored relative to the usual cross(up,forward) convention.
// Mirroring the world must NOT reverse anatomical left/right.
s=fixture();const mirror=v=>[-v[0],v[1],v[2]];s.game.velocity=mirror(s.game.velocity);s.game.wheels.forEach(w=>{for(const key of ['contactPoint','contactHeading','contactNormal'])w[key]=mirror(w[key]);});g=geometry(s.game,[false,false,false,false]);near(g.wheel,17);

// Heading vectors may point backwards in the actual API; orient towards the front axle.
s=fixture(-18,-4);s.game.wheels.slice(0,2).forEach(w=>w.contactHeading=w.contactHeading.map(v=>-v));near(geometry(s.game).wheel,-18);
s.game.velocity=[0,0,0];s.game.localVelocity=[0,0,0];s.game.angularVelocity=[0,0,0];g=geometry(s.game);near(g.wheel,-18);near(g.wheel,-18);
s.game.velocity=[0,0,-20];s.game.localVelocity=[0,0,-20];s.game.angularVelocity=[0,20/2.6*Math.tan(-4*r),0];near(geometry(s.game).forward,-20);
s=fixture();s.game.wheels[0].contactPoint=[0,0,0];s.game.wheels[1].contactPoint=[0,0,0];assert.equal(geometry(s.game,[false,false,false,false]),null);
let model=new Model();s=fixture();let view=model.update(s,0);near(view.lateral.front,6);near(view.lateral.rear,2);
function step(t,edit=()=>{}){edit(s);s.game.packet++;s.game.sampleTime=1000+t;return model.update(s,t);}
s.game.wheels[0].load=0;assert(!step(20).unloaded[0]);assert(step(85).unloaded[0]);assert.equal(view.steering!==null,true);near(step(100).steering.delta,-6);
s.game.wheels[0].load=3000;assert(step(120).unloaded[0]);assert(!step(165).unloaded[0]);assert(step(180).steering);
assert.equal(model.update(s,700).fresh,false);assert.equal(model.update({connected:false},720).fresh,false);
// An unimplemented all-zero load field must not become four airborne wheels.
model=new Model();s=fixture();s.game.wheels.forEach(w=>w.load=0);view=model.update(s,0);assert(!view.loadKnown);assert(!view.unloaded.some(Boolean));assert(view.steering,'unknown load support must not suppress independently valid slip angles');
// A real jump after supported loads makes all four indicators empty; then landing recovers.
model=new Model();s=fixture();model.update(s,0);s.game.wheels.forEach(w=>w.load=0);step(20);assert(step(90).unloaded.every(Boolean));assert.equal(step(110).drive,null);
s.game.wheels.forEach(w=>w.load=3000);step(130);assert(!step(180).unloaded.some(Boolean));
// 0.8g measured deceleration, not pedal percentage or raw acceleration including gravity.
model=new Model();s=fixture();for(let t=0;t<=600;t+=20){s.game.speedKmh=(30-.8*9.80665*t/1000)*3.6;view=step(t);}near(view.decel,.8,1e-6);
s.game.brake=0;assert.equal(step(620).decel,null);
// Auxiliary status is not an input to continuous pedal response. Current physical force is required.
model=new Model();s=fixture();s.game.wheels.forEach(w=>{w.fx=-2000;w.fy=100;w.ratio=-.2;});
view=step(0);const before=JSON.stringify(view.grip);s.game.statuses={absActive:true,tcActive:true};view=step(200);
assert(view.brake.mode==='risk-trend'&&view.brake.severity>.5,'current slip is exposed continuously, not a release command');assert.equal(view.grip.easeSteering,false);
s.game.wheels[0].ratio=-.9;view=step(220);assert(view.brake.severity>.7);
// The visual state recovers immediately, without a release latch or a historical peak.
s.game.wheels.forEach(w=>{w.ratio=-.01;w.angle=.001;});view=step(240);assert(view.brake.severity<.02);
s.game.brake=0;assert.equal(step(260).brake,null);
// A driven rear axle participates; zero gas removes its cue on the very next packet.
model=new Model();s=fixture();s.game.gas=.7;s.game.brake=0;s.game.wheels.forEach((w,i)=>{w.fx=i>=2?2200:0;w.fy=0;w.ratio=i>=2?.95:0;});
view=step(0);assert.equal(view.drive.mode,'risk-trend');assert(view.drive.severity>.8);s.game.gas=0;assert.equal(step(20).drive,null);
// Turning itself is NOT a slip: arbitrary wheel/yaw angles, zero tyre slip -> white neutral.
s=fixture(25,17);s.game.wheels.forEach(w=>w.angle=0);model=new Model();view=model.update(s,0);near(view.steering.delta,0);assert(view.steering.neutral);assert.equal(view.steering.source,'native-front-contact-slip-angle');
// Changing native yaw does not contaminate a contact-slip measurement.
s.game.angularVelocity=[0,3,0];view=step(20);near(view.steering.delta,0);
// A stopped car uses the explicit static reference and still reacts to the front wheels.
s=fixture(22,0);s.game.localVelocity=[0,0,0];s.game.velocity=[0,0,0];model=new Model();view=model.update(s,0);near(view.steering.delta,22);assert.equal(view.steering.mode,'static');assert.equal(view.steering.trend,null);
// Normal or large native slip is not proof of grip saturation; never issue a push cue from angle alone.
model=new Model();s=fixture(17,5);s.game.wheels.forEach((w,i)=>w.angle=(i<2?-8:-2)*r);step(0);view=step(160);assert.equal(view.steering.trend,null);assert.equal(view.steering.gripAssessment,'estimated');near(view.steering.delta,8);
s.game.wheels.forEach((w,i)=>w.angle=(i<2?2:11)*r);for(let t=200;t<=600;t+=20)view=step(t);assert.equal(view.steering.trend,null);
s.game.wheels[0].load=0;step(620);view=step(700);assert(view.steering);assert.equal(view.steering.trend,null);assert(view.steering.unloaded);
// Dynamic contact slip remains valid even if the optional chassis contact geometry is unavailable.
model=new Model();s=fixture();s.game.wheels.forEach(w=>w.contactPoint=[0,0,0]);view=model.update(s,0);near(view.steering.delta,-6);assert.equal(view.steering.wheel,null);
// Neutral has hysteresis; it is a display deadband, not a fabricated sensor reading.
model=new Model();s=fixture();s.game.wheels.forEach(w=>w.angle=.002);view=model.update(s,0);assert(view.steering.neutral);assert.notEqual(view.steering.delta,0);
console.log('PASS: native contact-angle steering; pure rolling neutral despite turning; yaw independence; stationary reference; mirrored geometry; no uncalibrated grip-limit claims; unloading/recovery; missing geometry; pause/disconnect; measured deceleration; ABS/handbrake distinction; throttle recovery.');
