'use strict';

// Regression for the observed periodic display scan/failed OBS ownership path.
// Deferred queries exercise selection and shutdown while native work is in flight.
const assert = require('node:assert/strict');
const {createDisplayController} = require('../desktop-display');
const settle = () => new Promise(resolve => setImmediate(resolve));
const display = (id, scaleFactor = 2) => ({id, scaleFactor,
  bounds: {x: id * 1920, y: 0, width: 1920, height: 1080}, rotation: 0});
const native = width => ({selected: {x: 0, y: 0, width, height: 2160,
  workX: 0, workY: 0, workWidth: width, workHeight: 2080}});

function harness() {
  const jobs = [], values = [], errors = [], retries = [];
  const controller = createDisplayController({root: '.',
    screen: {dipToScreenPoint: p => ({x: p.x * 2, y: p.y * 2})},
    onChange: value => values.push(value), onError: error => errors.push(error.message),
    read: center => {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const job = {center, resolve, reject, cancelled: false}; jobs.push(job);
      return {promise, cancel: () => { job.cancelled = true; }};
    },
    schedule: (callback, delay) => { const token = {callback, delay}; retries.push(token); return token; },
    unschedule: token => { token.cancelled = true; }
  });
  return {controller, jobs, values, errors, retries};
}

(async () => {
  const h = harness(), a = display(0), b = display(1);
  h.controller.request(a);
  for (let i = 0; i < 100; i++) h.controller.request({...a});
  assert.equal(h.jobs.length, 1, 'unchanged display does not spawn another process');
  h.controller.request(b);
  assert(h.jobs[0].cancelled);
  h.jobs[0].resolve(native(3840)); await settle();
  assert.equal(h.values.length, 0, 'old native result cannot overwrite selected screen');
  assert.equal(h.jobs.length, 2, 'latest screen is queried after old work settles');
  h.jobs[1].resolve(native(5120)); await settle();
  assert.equal(h.controller.get(b).width, 5120);
  assert.equal(h.controller.get(a), null);
  for (let i = 0; i < 100; i++) h.controller.request(b);
  assert.equal(h.jobs.length, 2, 'idle state uses cached native size');
  const changed = display(1, 1.5);
  assert.equal(h.controller.get(changed), null, 'DPI change invalidates the old dimensions');
  h.controller.request(changed);
  h.controller.dispose();
  h.jobs[2].resolve(native(2560)); await settle();
  assert.equal(h.values.length, 1, 'disposed owner does not publish late work');

  const f = harness(); f.controller.request(a);
  for (let i = 0; i < 4; i++) {
    f.jobs[i].reject(new Error('native query failed')); await settle();
    if (i < 3) f.retries[i].callback();
  }
  assert.deepEqual(f.retries.map(x => x.delay), [250, 1000, 3000]);
  assert.equal(f.jobs.length, 4, 'failed query has a bounded recovery sequence');
  f.controller.request(b);
  assert.equal(f.jobs.length, 5, 'a later real display change can recover');
  f.jobs[4].resolve(native(3840)); await settle();
  assert.equal(f.values.length, 1); f.controller.dispose();

  const r = harness(); r.controller.request(a); r.controller.request(b); r.controller.request(a);
  r.jobs[0].resolve(native(999)); await settle();
  assert.equal(r.values.length, 0, 'A → B → A still rejects the first generation');
  r.jobs[1].resolve(native(3840)); await settle();
  assert.equal(r.controller.get(a).width, 3840); r.controller.dispose();
  console.log('desktop display: idle, stale result, DPI, shutdown, failure recovery, A-B-A passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
