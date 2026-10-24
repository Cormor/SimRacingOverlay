const assert=require('node:assert/strict'),{wrap}=require('../paint-context');
let alpha=.35,writes=0,factor=1,seen=[];
const native={get globalAlpha(){return alpha;},set globalAlpha(v){writes++;alpha=v;},fill(){assert.equal(this,native);seen.push(this.globalAlpha);},fillText(){throw Error('fixture draw failure');}};
const paint=wrap(native,()=>factor);
for(let i=0;i<200;i++)paint.fill();assert(seen.every(v=>v===.35));assert.equal(writes,0,'opaque component preserves caller alpha without redundant native writes');
factor=.4;paint.fill();assert.equal(seen.at(-1),.35*.4);assert.equal(alpha,.35);assert.equal(writes,2);
assert.throws(()=>paint.fillText('test',0,0),/fixture draw failure/);assert.equal(alpha,.35,'translucent draw failure restores caller alpha');
factor=0;paint.fill();assert.equal(seen.at(-1),0);assert.equal(alpha,.35,'invisible component remains correctly scoped');
console.log('PASS: opaque draw avoids alpha writes; caller/translucent/invisible alpha and failure restoration preserved.');
