'use strict';

const path = require('node:path');
const {execFile} = require('node:child_process');

function displayKey(display) {
  return JSON.stringify([display.id, display.bounds, display.workArea,
    display.scaleFactor, display.rotation]);
}

function readNativeDisplay(root, center) {
  let child;
  const promise = new Promise((resolve, reject) => {
    child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'src', 'Sync-Display.ps1'),
      '-CenterX', String(center.x), '-CenterY', String(center.y)],
    {windowsHide: true, timeout: 5000, maxBuffer: 65536}, (error, stdout) => {
      if (error) { reject(error); return; }
      try { resolve(JSON.parse(stdout.trim().replace(/^\uFEFF/, ''))); }
      catch (error) { reject(error); }
    });
  });
  return {promise, cancel: () => child?.kill()};
}

// Electron owns display selection. This adapter only supplies native pixel sizes;
// OBS consumes the resulting layout through its own Lua integration.
function createDisplayController({screen, root, onChange, onError,
  read = center => readNativeDisplay(root, center),
  schedule = setTimeout, unschedule = clearTimeout}) {
  let closed = false, generation = 0, wanted = null, running = null, retry = null;
  let cached = null;
  const counters = {requests: 0, discarded: 0, failures: 0};

  function valid(result) {
    const p = result?.selected;
    return p && ['x', 'y', 'workX', 'workY'].every(k => Number.isFinite(p[k])) &&
      ['width', 'height', 'workWidth', 'workHeight'].every(k => Number.isFinite(p[k]) && p[k] > 0);
  }

  function launch() {
    if (closed || running || retry || !wanted || !wanted.force && cached?.key === wanted.key) return;
    const entry = {...wanted, generation};
    running = entry;
    counters.requests++;
    try { entry.job = read(entry.center); }
    catch (error) { entry.job = {promise: Promise.reject(error)}; }
    entry.job.promise.then(result => {
      if (closed || entry.generation !== generation) { counters.discarded++; return; }
      if (!valid(result)) throw new Error('Invalid physical display dimensions');
      cached = {key: entry.key, pixels: result.selected};
      wanted.force = false;
      onChange({...result, displayId: entry.id, metricsKey: entry.key, ...counters});
    }).catch(error => {
      if (closed || entry.generation !== generation) return;
      counters.failures++;
      onError(error);
      // Recovery belongs to this query, not a perpetual background scan.
      const delay = [250, 1000, 3000][wanted.attempt++];
      if (delay !== undefined) retry = schedule(() => { retry = null; launch(); }, delay);
    }).finally(() => {
      if (running === entry) running = null;
      if (!closed && entry.generation !== generation) launch();
    });
  }

  function request(display, refresh = false) {
    if (closed) return;
    const key = displayKey(display);
    if (!refresh && wanted?.key === key) return;
    generation++;
    if (retry) unschedule(retry);
    retry = null;
    const center = {x: Math.round(display.bounds.x + display.bounds.width / 2),
      y: Math.round(display.bounds.y + display.bounds.height / 2)};
    wanted = {key, id: display.id, attempt: 0, force: refresh, center: screen.dipToScreenPoint(center)};
    // Do not start a second process until the earlier callback has settled.
    // Its result cannot overwrite this generation, even if selection returns to A.
    running?.job.cancel?.();
    launch();
  }

  return {
    request,
    get: display => cached?.key === displayKey(display) ? cached.pixels : null,
    diagnostics: () => ({...counters, pending: !!running || !!retry}),
    dispose() {
      closed = true;
      generation++;
      if (retry) unschedule(retry);
      retry = null;
      running?.job.cancel?.();
    }
  };
}

module.exports = {createDisplayController, displayKey};
