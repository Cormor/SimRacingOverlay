const assert=require('node:assert/strict'),fs=require('node:fs'),{Model}=require('../assist');
function state(){return {connected:true,game:{available:true,packet:1,source:'unknown',sampleTime:1000,speedKmh:72,localVelocity:[2,0,20],wheels:Array.from({length:4},()=>({angle:null,ratio:null,load:null}))}};}
function directions(view){return view.grip.wheels.map(w=>w.directions.lateral);}
let s=state(),m=new Model(),v=m.update(s,0);
assert(directions(v).every(d=>d.available&&d.shared&&d.slipState>0&&d.slipState<1&&d.current===null));
assert.equal(v.drive,null);assert.equal(v.brake,null);assert.equal(v.steering,null,'body observation never fabricates road-wheel orientation');
assert(s.game.wheels.every(w=>w.angle===null),'body fallback does not rewrite wheel evidence');
assert(!new Model().update(null,0).fresh,'absent transport state stays unavailable');
s=state();delete s.game.localVelocity;s.game.velocity=[2,0,20];s.game.roadBasis={forward:[0,0,1],right:[1,0,0]};
assert(directions(new Model().update(s,0)).every(d=>d.available&&d.shared),'world velocity plus measured body basis independently supports shared sideslip');
delete s.game.roadBasis;assert(!new Model().update(s,0).grip.wheels.some(w=>w.directions?.lateral?.available),'unframed world velocity is not treated as local velocity');
for(const x of [0,-2,2]){s=state();s.game.localVelocity[0]=x;v=new Model().update(s,0);assert(directions(v).every(d=>d.available));if(x===0)assert.equal(directions(v)[0].slipState,1);}
s=state();s.game.wheels[0].angle=.2;v=new Model().update(s,0);assert(!directions(v)[0].shared&&directions(v)[1].shared,'wheel observation overrides shared fallback independently');
s=state();s.game.localVelocity=[NaN,0,20];assert(!new Model().update(s,0).grip.wheels.some(w=>w.directions?.lateral?.available));
s=state();s.game.localVelocity=[0,0,0];s.game.speedKmh=0;assert(!new Model().update(s,0).grip.wheels.some(w=>w.directions?.lateral?.available),'no zero-speed body angle');
s=state();s.game.localVelocity[2]=-20;assert(directions(new Model().update(s,0)).every(d=>d.available),'reverse body movement remains bounded');
s=state();m=new Model();m.update(s,0);assert(!m.update(s,401).fresh);s.game.packet++;assert(m.update(s,420).fresh);s.game.paused=true;assert(!m.update(s,430).fresh);s.game.paused=false;s.game.packet++;assert(m.update(s,450).fresh);
s=state();s.game.capabilities={loads:true};s.game.wheels[0].load=0;v=new Model().update(s,0);assert(!v.grip.wheels[0].directions?.lateral?.available,'supported zero load outranks body fallback');
if(process.argv[2]){s=JSON.parse(fs.readFileSync(process.argv[2]));v=new Model().update(s,0);assert(directions(v).every(d=>d.available&&d.shared));assert(v.fresh);}
console.log('PASS: shared body sideslip, native wheel priority, zero/sign/reverse/missing values, rest, unload, stale/pause/recovery; optional IRSDK decoder-to-model fixture.');

// Shared body observations never enter the per-axle handling comparison, even
// when mixed with a real angle on another wheel or axle.
s=state();s.game.wheels.slice(2).forEach(w=>w.angle=.3);v=new Model().update(s,0);
assert(directions(v).slice(0,2).every(d=>d.shared));assert.equal(v.grip.steeringState.front,null);assert.equal(v.handling.state,null,'a missing front axle cannot imply oversteer');
s=state();s.game.wheels[0].angle=.3;s.game.wheels[2].angle=0;s.game.wheels[3].angle=0;
const mixed=new Model().update(s,0);s.game.wheels[1].angle=.3;const complete=new Model().update(s,0);
assert.equal(mixed.grip.steeringState.front,complete.grip.steeringState.front,'shared body fallback cannot dilute a measured wheel into a fabricated zero-angle wheel');
assert.equal(mixed.handling.state,'understeer');
console.log('PASS: body fallback and missing angles stay outside native axle handling comparisons.');
