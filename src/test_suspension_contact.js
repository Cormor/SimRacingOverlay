'use strict';
const assert=require('node:assert/strict'),{Contact}=require('../suspension-contact');
function wheel(defl,vel=0){return {shockDeflectionM:defl,shockVelocityMs:vel};}
function run(contact,rows,start=0,step=20){let out;rows.forEach((w,i)=>{out=contact.update(w,20,start+i*step);});return out;}
// A normal loaded suspension never signals contact loss.
{
 const c=new Contact();const out=run(c,Array.from({length:20},()=>[wheel(.07),wheel(.07),wheel(.05),wheel(.05)]));
 assert.deepEqual(out.airborne,[false,false,false,false]);
}
// A rear corner reaching its measured full extension with stopped velocity is unloaded.
{
 const c=new Contact();const frames=[];
 for(let i=0;i<10;i++)frames.push([wheel(.07),wheel(.07),wheel(.05),wheel(.05)]);
 for(let i=0;i<10;i++)frames.push([wheel(.07),wheel(.07),wheel(.01),wheel(.001,0)]);
 const out=run(c,frames);
 assert.equal(out.airborne[3],true,'rear right reaches full extension');
 assert.equal(out.airborne[2],false,'left rear still loaded');
 assert.equal(out.airborne[0],false,'front stays loaded');
}
// Extension must stop before contact loss is reported; compression clears it.
{
 const c=new Contact();run(c,Array.from({length:5},()=>[wheel(.07),wheel(.07),wheel(.05),wheel(.001,0)]));
 const stopped=run(c,Array.from({length:5},()=>[wheel(.07),wheel(.07),wheel(.05),wheel(.001,0)]),100);
 assert.equal(stopped.airborne[3],true);
 const compressed=run(c,Array.from({length:3},()=>[wheel(.07),wheel(.07),wheel(.05),wheel(.02,0)]),220);
 assert.equal(compressed.airborne[3],false,'rebound-free compression exits the state');
}
// Fast extension without settling does not fire until the hold time elapses.
{
 const c=new Contact();let out;
 for(let i=0;i<1;i++)out=c.update([wheel(.07),wheel(.07),wheel(.05),wheel(.001,-.2)],20,0);
 assert.equal(out.airborne[3],false,'moving extension is not a static full-extension claim');
}
// Low speed disables the detector, so a parked car cannot claim airborne wheels.
{
 const c=new Contact();const out=c.update([wheel(.07),wheel(.07),wheel(.05),wheel(.001,0)],0,0);
 assert.equal(out.airborne[3],false);
}
// Missing suspension fields leave the capability unavailable instead of faking zero.
{
 const c=new Contact();const out=c.update([{}, {}, {}, {}],20,0);
 assert.equal(out.available,false);
}
// The reference is per corner: a front corner whose minimum never approaches
// full extension cannot borrow the rear corner's reference.
{
 const c=new Contact();
 for(let i=0;i<30;i++)c.update([wheel(.047),wheel(.05),wheel(.003),wheel(.001)],20,i*20);
 const out=c.update([wheel(.047),wheel(.05),wheel(.003),wheel(.001)],20,620);
 assert.equal(out.airborne[0],false);
 assert.equal(out.airborne[2],true);
}
console.log('PASS: full-extension detection, velocity hold, hysteresis, low-speed disable, per-corner reference and missing fields.');
