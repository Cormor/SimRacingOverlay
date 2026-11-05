'use strict';
const assert=require('node:assert/strict');
const {Clock}=require('../telemetry-clock');
const clock=new Clock();
assert.equal(clock.locate({epoch:'A',publishedMs:5000},100),null,'a foreign clock has no implicit offset');
assert(clock.observe('A',10000,100,104));
const first=clock.locate({epoch:'A',publishedMs:10010},120);
assert.equal(first.at,109);assert.equal(first.ageMs,11);
// The same increasing sample sequence can arrive after a long browser task.
// A freshly delivered message must not restart its 100 ms hardware lifetime.
const queued=clock.locate({epoch:'A',publishedMs:10020},230);
assert.equal(queued.ageMs,111);assert(queued.ageMs+3>=100);
assert.equal(clock.locate({epoch:'A',publishedMs:11000},230),null,'future publication cannot be clamped to fresh');
const generation=clock.generation;
assert(clock.observe('A',10040,140,144));
assert.equal(clock.generation,generation);assert.equal(clock.locate({epoch:'A',publishedMs:10020},230).at,119,'routine recalibration cannot move earlier samples');
assert(!clock.observe('A',10050,150,250),'long calibration queue does not yield a trustworthy short-age bound');
assert.equal(clock.generation,generation);
assert.equal(clock.locate({epoch:'A',publishedMs:70000},60144),null,'stale clock observation cannot certify freshness');
assert(clock.observe('B',20000,1000,1004));
assert.equal(clock.locate({epoch:'A',publishedMs:10050},1010),null);
assert(!clock.observe('A',10060,1010,1014),'a late old-process HTTP response cannot restore its clock');
assert(clock.observe('B',21000,3000,3004));assert.equal(clock.generation,generation+2,'disjoint clock intervals begin a new calculation context');
console.log('PASS: interval clock mapping, queued/future/stale frames, stable projection, process replacement and clock discontinuity.');
