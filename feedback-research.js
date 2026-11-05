/* Isolated research prototype. Thresholds require per-source driving validation. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeedbackResearch = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // All numerical experiment assumptions live here; none expresses remaining grip.
  const C = Object.freeze({ windows: [80, 120, 180, 240], maxPoints: 64,
    minPoints: 3, minSpan: 60, minSpread: .008, minQ: .05,
    maxLoadRatio: 1.12, speedAbs: 1.5, speedFraction: .10,
    crossAbs: .012, crossFraction: .15, crossForceAbs: .06, crossForceFraction: .15,
    gap: 300, softTTL: 120, hardTTL: 240, minSpeed: 3,
    refreshExcitation: .0015, slopeClass: .12, maxElasticityInterval: .5,
    confidenceMultiplier: 2.8, eventDwell: 60,
    minAxleLoadFraction: .25, plateauAttention: .35, clutchChange: .03,
    steerRateMin: .002, pedalRateMin: -.02, demandRateMin: .004,
    stateAngleScale: .14, stateRatioScale: .3 });
  const num = x => typeof x === 'number' && Number.isFinite(x);
  const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
  const sign = x => x > 0 ? 1 : x < 0 ? -1 : 0;
  const range = (a, k) => Math.max(...a.map(p => p[k])) - Math.min(...a.map(p => p[k]));
  const unknownDisplay = reason => ({ value: null, kind: 'unknown', attention: 0, dashed: false, reason });
  const channel = () => ({ points: [], fit: null, fitX: null, reason: 'insufficient-history' });
  const wheelMemory = () => ({ lateral: channel(), longitudinal: channel() });
  // Complete physical force coverage is separate from per-wheel slip eligibility.
  function forceTotal(g, previous, indices, axis, expected = null) {
    if (!indices.length || !indices.every(i => num(g.wheels?.[i]?.[axis]) && num(previous?.[i]))) return null;
    const values = indices.map(i => g.wheels[i][axis]);
    const prior = indices.map(i => previous[i]);
    const direction = expected ?? sign(values.find(v => v !== 0) ?? prior.find(v => v !== 0) ?? 0);
    if (!direction || [...values, ...prior].some(v => v * direction < 0)) return null;
    return { now: values.reduce((a, v) => a + direction * v, 0), prior: prior.reduce((a, v) => a + direction * v, 0) };
  }
  function compatible(a, b) {
    if (a.slipSign !== b.slipSign || a.forceSign !== b.forceSign) return 'sign-reversal';
    if (Math.max(a.load, b.load) / Math.min(a.load, b.load) > C.maxLoadRatio) return 'load-change';
    if (Math.abs(a.speed - b.speed) > Math.max(C.speedAbs, C.speedFraction * Math.abs(b.speed))) return 'speed-change';
    if (Math.abs(a.cross - b.cross) > Math.max(C.crossAbs, C.crossFraction * b.cross)) return 'cross-slip-change';
    if (Math.abs(a.crossForce - b.crossForce) > Math.max(C.crossForceAbs, C.crossForceFraction * b.crossForce)) return 'cross-force-change';
    return null;
  }
  function windowCompatible(points) {
    const last = points[points.length - 1];
    if (Math.max(...points.map(p => p.load)) / Math.min(...points.map(p => p.load)) > C.maxLoadRatio) return false;
    return points.every(p => !compatible(p, last));
  }
  function fitLocal(points, now) {
    const last = points[points.length - 1];
    if (!last) return null;
    for (const width of C.windows) {
      const ps = points.filter(p => last.t - p.t <= width);
      if (ps.length < C.minPoints || last.t - ps[0].t < C.minSpan || range(ps, 'x') <= C.minSpread || !windowCompatible(ps) || last.q <= C.minQ) continue;
      const spread=range(ps,'x'),growth=last.x-ps[0].x;
      const retreat=ps.slice(1).reduce((sum,p,i)=>sum+Math.max(0,ps[i].x-p.x),0);
      if(growth<=spread*.5||retreat>spread*.25)continue;
      const span = last.t - ps[0].t;
      const weights = ps.map(p => .6 + .4 * (p.t - ps[0].t) / span);
      const sw = weights.reduce((a, b) => a + b, 0);
      const mx = ps.reduce((a, p, i) => a + p.x * weights[i], 0) / sw;
      const my = ps.reduce((a, p, i) => a + p.q * weights[i], 0) / sw;
      const sxx = ps.reduce((a, p, i) => a + weights[i] * (p.x - mx) ** 2, 0);
      if (sxx < 1e-10) continue;
      const slope = ps.reduce((a, p, i) => a + weights[i] * (p.x - mx) * (p.q - my), 0) / sxx;
      const intercept = my - slope * mx;
      const rss = ps.reduce((a, p, i) => a + weights[i] * (p.q - intercept - slope * p.x) ** 2, 0);
      const stderr = Math.sqrt(Math.max(0, rss / (ps.length - 2) / sxx));
      const half = C.confidenceMultiplier * stderr;
      const scale = last.x / last.q;
      const lo = (slope - half) * scale, hi = (slope + half) * scale;
      // Exact plateaus have zero residual and pass. A noisy weak fit cannot hide behind R2.
      if (!num(lo) || hi - lo > C.maxElasticityInterval) continue;
      let state;
      if (lo > C.slopeClass) state = 'productive';
      else if (hi < -C.slopeClass) state = 'declining';
      else if (lo >= -C.slopeClass && hi <= C.slopeClass) state = 'plateau';
      else continue;
      const elasticity = slope * scale;
      const quality = clamp(.55 + .2 * Math.min(1, (ps.length - 3) / 4) + .15 * Math.min(1, range(ps, 'x') / .04) + .1 * (1 - (hi - lo) / C.maxElasticityInterval));
      return { gain: clamp(elasticity), elasticity, slope, slopeLow: slope - half,
        slopeHigh: slope + half, quality, state, observedAt: now, ageMs: 0,
        spanMs: span, samples: ps.length, source: 'native-local-force', uncertaintyKind:'residual-sensitivity-band-not-calibrated-probability' };
    }
    return null;
  }
  function visibleFit(ch, now) {
    if (!ch.fit) return null;
    const age = Math.max(0, now - ch.fit.observedAt);
    if (age >= C.hardTTL) { ch.fit = null; ch.reason = 'force-evidence-expired'; return null; }
    const decay = age <= C.softTTL ? 1 : (C.hardTTL - age) / (C.hardTTL - C.softTTL);
    return Object.assign({}, ch.fit, { ageMs: age, baseQuality: ch.fit.quality, quality: ch.fit.quality * decay });
  }
  function feed(ch, point, now, fresh, invalid) {
    if (invalid) { ch.points = []; ch.fit = null; ch.fitX = null; ch.reason = invalid; return null; }
    if (fresh) {
      const previous = ch.points[ch.points.length - 1];
      const incompatibility = previous && (compatible(previous, point) || (ch.points[0] && compatible(ch.points[0], point)));
      if (incompatibility) { ch.points = []; ch.fit = null; ch.fitX = null; ch.reason = incompatibility; }
      if(!incompatibility&&previous&&point.x<previous.x-C.refreshExcitation*.5){ch.points=[];ch.fit=null;ch.fitX=null;ch.reason='demand-recovery';}
      ch.points.push(point);
      ch.points = ch.points.filter(p => point.t - p.t <= C.hardTTL).slice(-C.maxPoints);
      if (ch.fitX === null || Math.abs(point.x - ch.fitX) >= C.refreshExcitation) {
        const fit = fitLocal(ch.points, now);
        if (fit) { ch.fit = fit; ch.fitX = point.x; ch.reason = 'native-local-force'; }
      }
    }
    return visibleFit(ch, now);
  }

  function ageView(view, now) {
    if (!view || !num(now)) return view;
    const age = Math.max(0, now - (view.diagnostics?.observedAt ?? view.diagnostics?.receiveTime ?? now));
    const stale = age >= C.hardTTL;
    const fit = f => {
      if (!f) return null;
      const elapsed = Math.max(0, now - f.observedAt);
      if (stale || elapsed >= C.hardTTL) return null;
      const base = f.baseQuality ?? f.quality;
      return { ...f, ageMs: elapsed, baseQuality: base, quality: base * (elapsed <= C.softTTL ? 1 : (C.hardTTL - elapsed) / (C.hardTTL - C.softTTL)) };
    };
    const wheels = view.wheels.map(w => {
      const lateral = fit(w.forceResponse.lateral), longitudinal = fit(w.forceResponse.longitudinal);
      let display = w.display ? { ...w.display } : null;
      if (display && (stale || display.kind === 'force-response' && !lateral)) display = unknownDisplay(stale ? 'source-stalled' : 'force-evidence-expired');
      if (display && (age > C.softTTL || display.reason?.startsWith('increasing-steer-with-raw-force') && (!lateral || lateral.ageMs > C.softTTL || lateral.quality < .55))) display.attention = 0;
      return { ...w, forceResponse: { lateral, longitudinal }, vehicleResponse: stale ? null : w.vehicleResponse,
        quality: { ...w.quality, ageMs: lateral?.ageMs ?? null, ...(stale ? { reason: 'source-stalled' } : {}) }, display };
    });
    const cue = c => {
      if (!c) return c;
      const required = c.wheels || [];
      const known = required.length && required.every(i => wheels[i]?.forceResponse.longitudinal);
      if (stale || c.mode === 'attention' && (age > C.softTTL || required.some(i => !wheels[i]?.forceResponse.longitudinal || wheels[i].forceResponse.longitudinal.ageMs > C.softTTL || wheels[i].forceResponse.longitudinal.quality < .55)) || ['attention','force-response'].includes(c.mode) && !known)
        return { ...c, mode: 'unknown', state: 'unknown', severity: 0, attention: 0, evidence: 0, reason: stale ? 'source-stalled' : 'force-evidence-expired' };
      return { ...c, ...(known ? { evidence: Math.min(...required.map(i => wheels[i].forceResponse.longitudinal.quality)) } : {}) };
    };
    return { ...view, wheels, driveCue: cue(view.driveCue), brakeCue: cue(view.brakeCue), diagnostics: { ...view.diagnostics, fresh: age === 0 && view.diagnostics.fresh, displayTime: now, displayAgeMs: age } };
  }
  class Observer {
    constructor(options = {}) {
      for (const k of ['steering', 'pedals']) if (options[k] != null && !['state', 'response', 'event'].includes(options[k])) throw new TypeError('Invalid ' + k + ' strategy');
      this.options = { steering: options.steering ?? null, pedals: options.pedals ?? null };
      this.reset();
    }
    reset() {
      this.mem = Array.from({ length: 4 }, wheelMemory);
      this.identity = null; this.lastTime = null; this.lastSampleTime = null; this.lastFreshAt = null;
      this.seen = new Set(); this.prev = null;
      this.dwell = { steer: [null, null, null, null], drive: null, brake: null };
      this.dwellReady = { steer: [0, 0, 0, 0], drive: 0, brake: 0 };
    }
    _dwell(key, condition, now, index, advance = true) {
      const a = index === undefined ? this.dwell : this.dwell[key];
      const k = index === undefined ? key : index;
      const ready = index === undefined ? this.dwellReady : this.dwellReady[key];
      if (!condition) { a[k] = null; ready[k] = 0; return 0; }
      if (!advance) return ready[k];
      if (a[k] === null) a[k] = now;
      ready[k] = now - a[k] >= C.eventDwell ? 1 : 0;
      return ready[k];
    }
    update(input, timeMs, unloaded = [], steering = null, loadKnown = false, vehicleResponse = null, receiveTimeMs = timeMs) {
      const g = input && input.game || {};
      // Producer time owns fits/derivatives; monotonic reception time owns TTL/dwell.
      const physicalNow = num(timeMs) ? timeMs : 0;
      const now = num(receiveTimeMs) ? receiveTimeMs : physicalNow;
      let resetReason = null;
      const identity = JSON.stringify([g.source ?? null, g.carModel ?? null, g.vehicleIdentity ?? null, g.streamEpoch ?? null]);
      const available = g.available === true && g.paused !== true && g.isPaused !== true && g.menu !== true && g.inMenu !== true && g.statuses?.paused !== true && g.statuses?.inMenu !== true;
      if (!available) resetReason = 'unavailable-or-paused';
      else if (this.identity !== null && this.identity !== identity) resetReason = 'source-or-vehicle-change';
      else if (this.lastTime !== null && (now < this.lastTime || now - this.lastTime > C.gap)) resetReason = 'time-discontinuity';
      const sampleT = num(g.sampleTime) ? g.sampleTime : physicalNow;
      const packetKey = g.packet == null ? null : JSON.stringify([identity, g.packet]);
      let duplicate = packetKey !== null && this.seen.has(packetKey);
      if (!resetReason && !duplicate && this.lastSampleTime !== null && sampleT < this.lastSampleTime) resetReason = 'sample-time-reversal';
      if (resetReason) this.reset();
      this.identity = identity;
      this.lastTime = now;
      duplicate = packetKey !== null && this.seen.has(packetKey);
      const sampleIdentityKnown = g.source != null && (g.carModel != null || g.vehicleIdentity != null) && (g.packet != null || num(g.sampleTime));
      const fresh = available && sampleIdentityKnown && !duplicate && (this.lastSampleTime === null || sampleT > this.lastSampleTime);
      // A producer clock may freeze while packet numbers continue. Do not reset
      // its watermark: that would make the same frozen sample fresh again.
      if (this.lastFreshAt !== null && now - this.lastFreshAt >= C.hardTTL) {
        for (const memory of this.mem) for (const ch of Object.values(memory)) {
          ch.points = []; ch.fit = null; ch.fitX = null; ch.reason = 'force-evidence-expired';
        }
        this.prev = null;
        this.dwell = { steer: [null, null, null, null], drive: null, brake: null };
        this.dwellReady = { steer: [0, 0, 0, 0], drive: 0, brake: 0 };
      }
      if (fresh) {
        this.lastFreshAt = now;
        this.lastSampleTime = sampleT;
        if (packetKey !== null) { this.seen.add(packetKey); if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value); }
      }
      const velocity = g.localVelocity;
      const forward = Array.isArray(velocity) ? velocity[2] : velocity && (velocity.zforward ?? velocity.z);
      const right = Array.isArray(velocity) ? velocity[0] : velocity && (velocity.xright ?? velocity.x);
      const speed = num(g.speedKmh) ? Math.abs(g.speedKmh) / 3.6 : num(forward) && num(right) ? Math.hypot(forward, right) : null;
      const reverse = num(forward) ? forward < -.2 : num(g.speedKmh) && g.speedKmh < 0 || num(g.gear) && g.gear < 0;
      const steerAngle = num(g.roadWheelAngle) ? g.roadWheelAngle : num(steering?.wheel) ? steering.wheel * Math.PI / 180 : num(g.steeringWheelAngle) ? g.steeringWheelAngle : null;
      const dt = this.prev && fresh ? (sampleT - this.prev.t) / 1000 : 0;
      const heldSample = !fresh && this.prev && now - this.prev.observedAt <= C.softTTL;
      const steeringIncreasing = available && num(steerAngle) && num(this.prev?.steer) && (fresh && dt > 0 && sign(steerAngle) === sign(this.prev.steer) && Math.abs(steerAngle) > Math.abs(this.prev.steer) + C.steerRateMin * dt || heldSample && steerAngle === this.prev.steer && this.prev.steeringIncreasing);
      const pedal = { drive: num(g.gas) ? clamp(g.gas) : null, brake: num(g.brake) ? clamp(g.brake) : null };
      const wheels = Array.from({ length: 4 }, (_, i) => {
        const w = g.wheels?.[i] || {};
        const known = Array.isArray(loadKnown) ? loadKnown[i] === true : loadKnown === true;
        const contact = available && unloaded[i] !== true && unloaded[i] !== 1 && w.contact !== false && w.grounded !== false && known && num(w.load) && w.load > 0;
        const nativeAngle = num(w.angle) ? w.angle : null;
        const ratio = num(w.ratio) ? w.ratio : null;
        const bodyAngle = num(right) && num(forward) && Math.abs(forward) >= C.minSpeed ? Math.atan2(right, Math.abs(forward)) : null;
        const slipState = !available ? null : nativeAngle !== null ? { value: Math.exp(-((Math.tan(nativeAngle) / C.stateAngleScale) ** 2)), angle: nativeAngle, ratio, source: 'native-slip-angle', shared: false }
          : bodyAngle !== null ? { value: Math.exp(-((Math.tan(bodyAngle) / C.stateAngleScale) ** 2)), angle: bodyAngle, ratio, source: 'shared-body-slip', shared: true } : null;
        const baseInvalid = !available ? 'unavailable-or-paused' : !sampleIdentityKnown ? 'sample-identity-unavailable' : !contact ? 'contact-or-load-unknown' : speed === null || speed < C.minSpeed ? 'low-or-unknown-speed' : null;
        const invalidLat = baseInvalid || (nativeAngle === null || ratio === null || !num(w.fy) || !num(w.fx) ? 'missing-lateral-fields' : Math.abs(w.fy) / w.load <= C.minQ ? 'force-response-below-information-floor' : null);
        const invalidLong = baseInvalid || (ratio === null || nativeAngle === null || !num(w.fx) || !num(w.fy) ? 'missing-longitudinal-fields' : Math.abs(w.fx) / w.load <= C.minQ ? 'force-response-below-information-floor' : null);
        const point = axis => ({ t: sampleT, x: axis === 'lateral' ? Math.abs(Math.tan(nativeAngle)) : Math.abs(ratio),
          q: Math.abs(axis === 'lateral' ? w.fy : w.fx) / w.load,
          cross: axis === 'lateral' ? Math.abs(ratio) : Math.abs(Math.tan(nativeAngle)),
          crossForce: Math.abs(axis === 'lateral' ? w.fx : w.fy) / w.load,
          load: w.load, speed, slipSign: sign(axis === 'lateral' ? nativeAngle : ratio), forceSign: sign(axis === 'lateral' ? w.fy : w.fx) });
        const lateral = feed(this.mem[i].lateral, invalidLat ? null : point('lateral'), now, fresh, invalidLat);
        const longitudinal = feed(this.mem[i].longitudinal, invalidLong ? null : point('longitudinal'), now, fresh, invalidLong);
        const forceResponse = { lateral, longitudinal };
        const axleRemaining = vehicleResponse && (i < 2 ? vehicleResponse.frontRemaining : vehicleResponse.rearRemaining);
        const body = available && num(axleRemaining) && num(vehicleResponse?.confidence) && vehicleResponse.confidence > 0 ? { value: clamp(axleRemaining), confidence: clamp(vehicleResponse.confidence), source: 'body-response', dashed: true } : null;
        let display = null;
        if (this.options.steering !== null) {
          const mode = this.options.steering;
          if (mode === 'response') display = lateral ? { value: lateral.gain, kind: 'force-response', attention: 0, dashed: false, reason: 'local-force-elasticity-not-capacity' } : unknownDisplay(this.mem[i].lateral.reason);
          else display = slipState ? { value: slipState.value, kind: 'slip-state', attention: 0, dashed: slipState.shared, reason: slipState.source + '-not-capacity' } : unknownDisplay('slip-state-unavailable');
          if (mode === 'event') {
            const axleStart = i < 2 ? 0 : 2;
            const axle = [axleStart, axleStart + 1].map(j => g.wheels?.[j]?.load);
            const axleKnown = axle.every((load, j) => num(load) && load > 0 && (Array.isArray(loadKnown) ? loadKnown[axleStart + j] === true : loadKnown === true));
            const loadedEnough = axleKnown && w.load / (axle[0] + axle[1]) >= C.minAxleLoadFraction;
            const rawLateral = forceTotal(g, this.prev?.forcesFy, [axleStart, axleStart + 1], 'fy');
            const rawLateralState = fresh && dt > 0 && rawLateral ? rawLateral.now < rawLateral.prior - 1 ? 'declining' : rawLateral.now <= rawLateral.prior + 1 ? 'plateau' : 'productive'
              : heldSample ? this.prev.steerForceState?.[i] : null;
            const nativeCondition = rawLateralState && rawLateralState !== 'productive' && steeringIncreasing && contact && loadedEnough && !reverse && speed >= C.minSpeed && lateral && lateral.ageMs <= C.softTTL && lateral.quality >= .55 && (lateral.state === 'plateau' || lateral.state === 'declining');
            // Body kinematics do not require unavailable wheel loads. This is a
            // front response observation, separate from native tyre saturation.
            const bodyCondition = i<2 && nativeAngle === null && unloaded[i]!==true && steeringIncreasing && !reverse && speed >= C.minSpeed && vehicleResponse?.available===true && vehicleResponse?.understeer > .35 && vehicleResponse?.confidence >= .65 && num(vehicleResponse?.evidence?.steerRate) && Math.abs(vehicleResponse.evidence.steerRate) > C.steerRateMin;
            display.attention = this._dwell('steer', Boolean(nativeCondition || bodyCondition), now, i, fresh);
            if (display.attention && nativeCondition && (lateral.state === 'plateau' || rawLateralState === 'plateau')) display.attention = C.plateauAttention;
            if (display.attention) display.reason = nativeCondition ? 'increasing-steer-with-raw-force-' + (display.attention === C.plateauAttention ? 'plateau' : 'declining') : 'body-response-increasing-steer-understeer';
          } else this._dwell('steer', false, now, i);
        }
        return { slipState, forceResponse, vehicleResponse: body, unloaded:unloaded[i]===true||w.contact===false||w.grounded===false, quality: { source: slipState?.source ?? 'unknown', reason: lateral ? 'native-local-force' : this.mem[i].lateral.reason, ageMs: lateral?.ageMs ?? null,
          availableSources: [slipState?.source, lateral && 'native-local-force-lateral', longitudinal && 'native-local-force-longitudinal', body && 'body-response'].filter(Boolean),
          lateralReason: this.mem[i].lateral.reason, longitudinalReason: this.mem[i].longitudinal.reason }, display };
      });
      const driveCue = this._pedalCue('drive', g, input?.handbrake, wheels, pedal, speed, reverse, fresh, dt, sampleT, now);
      const brakeCue = this._pedalCue('brake', g, input?.handbrake, wheels, pedal, speed, reverse, fresh, dt, sampleT, now);
      if (fresh) this.prev = { t: sampleT, observedAt: now, steeringIncreasing: Boolean(steeringIncreasing),
        steerForceState: Array.from({ length: 4 }, (_, i) => {
          const start = i < 2 ? 0 : 2, total = forceTotal(g, this.prev?.forcesFy, [start, start + 1], 'fy');
          return dt > 0 && total ? total.now < total.prior - 1 ? 'declining' : total.now <= total.prior + 1 ? 'plateau' : 'productive' : null;
        }),
        forcesFy: Array.from({ length: 4 }, (_, i) => num(g.wheels?.[i]?.fy) ? g.wheels[i].fy : null),
        longGrowing: Array.from({ length: 4 }, (_, i) => dt > 0 && num(g.wheels?.[i]?.ratio) && num(this.prev?.ratios[i]) && Math.abs(g.wheels[i].ratio) > Math.abs(this.prev.ratios[i]) + C.demandRateMin * dt),
        pedalHolding: { drive: dt > 0 && num(this.prev?.drive) && num(pedal.drive) && pedal.drive >= this.prev.drive + C.pedalRateMin * dt, brake: dt > 0 && num(this.prev?.brake) && num(pedal.brake) && pedal.brake >= this.prev.brake + C.pedalRateMin * dt }, steer: steerAngle, drive: pedal.drive, brake: pedal.brake, gear: g.gear ?? null, clutch: num(g.clutch) ? g.clutch : null, forcesFx:Array.from({length:4},(_,i)=>num(g.wheels?.[i]?.fx)?g.wheels[i].fx:null), ratios: Array.from({ length: 4 }, (_, i) => num(g.wheels?.[i]?.ratio) ? g.wheels[i].ratio : null) };
      return { wheels, driveCue, brakeCue, diagnostics: { fresh, duplicate, resetReason, sampleTime: sampleT, receiveTime: now, observedAt: this.lastFreshAt, enabled: Object.assign({}, this.options), sampleIdentityKnown, thresholdsExperimental: true } };
    }
    _pedalCue(key, g, handbrake, wheels, pedal, speed, reverse, fresh, dt, sampleT, now) {
      const mode = this.options.pedals;
      const input = pedal[key];
      if (mode === null || input === null || input <= 0) { this._dwell(key, false, now); return null; }
      const caps = g.capabilities || {}, statuses = g.statuses || {};
      const drivenKnown = Array.isArray(caps.drivenWheels) && caps.drivenWheels.length > 0 &&
        caps.drivenWheels.every(i => Number.isInteger(i) && i >= 0 && i < 4) && new Set(caps.drivenWheels).size === caps.drivenWheels.length;
      const driven = drivenKnown ? caps.drivenWheels : [];
      const forceIndices = key === 'drive' ? driven : [0, 1, 2, 3];
      const expected = key === 'drive' ? 1 : -1;
      const indices = (key === 'drive' && driven.length ? driven : [0, 1, 2, 3]).filter(i=>!wheels[i].unloaded&&num(g.wheels?.[i]?.ratio)&&g.wheels[i].ratio*expected>=0&&!(key==='brake'&&i>=2&&num(handbrake)&&handbrake>0));
      const base = { mode: 'unknown', state: 'unknown', severity: 0, evidence: 0, reason: 'longitudinal-evidence-unavailable', wheels: [], directionVerified: false, input };
      if (mode === 'state') {
        if (g.available !== true || g.paused === true || g.isPaused === true || g.menu === true || g.inMenu === true || g.statuses?.paused === true || g.statuses?.inMenu === true) return Object.assign(base, { reason: 'unavailable-or-paused' });
        const valid = indices.filter(i => num(g.wheels?.[i]?.ratio));
        if (!valid.length) return Object.assign(base, { reason: 'native-slip-ratio-unavailable' });
        return Object.assign(base, { mode: 'slip-state', state: 'slip', severity: clamp(Math.max(...valid.map(i => Math.abs(g.wheels[i].ratio))) / C.stateRatioScale), evidence: 1, reason: 'neutral-slip-magnitude-not-release', wheels: valid });
      }
      const fits = indices.filter(i => wheels[i].forceResponse.longitudinal);
      if (!fits.length) { this._dwell(key, false, now); return base; }
      const rank = { declining: 0, plateau: 1, productive: 2 };
      fits.sort((a, b) => rank[wheels[a].forceResponse.longitudinal.state] - rank[wheels[b].forceResponse.longitudinal.state]);
      const first = wheels[fits[0]].forceResponse.longitudinal;
      const matching = fits.filter(i => wheels[i].forceResponse.longitudinal.state === first.state);
      const directionContract = caps.longitudinalForceConvention === 'wheel-forward-positive' && (key !== 'drive' || drivenKnown);
      const directionVerified = directionContract && matching.every(i => sign(g.wheels[i].ratio) === expected && sign(g.wheels[i].fx) === expected);
      const evidence = Math.min(...matching.map(i => wheels[i].forceResponse.longitudinal.quality));
      const response = Object.assign(base, { mode: 'force-response', state: first.state, severity: first.state === 'declining' ? .8 : first.state === 'plateau' ? .4 : 0,
        evidence, reason: directionVerified ? 'local-force-response-not-capacity' : 'local-force-response-directionUnverified', wheels: matching, directionVerified });
      if (mode === 'response') return response;
      const present = key === 'drive' ? caps.tcPresent : caps.absPresent;
      const active = key === 'drive' ? statuses.tcActive : statuses.absActive;
      const assistVerified = caps.assistStatusSemantics === 'dynamic-v1' && !(present===false&&active===true) && (present === false || active === false);
      let block = !directionContract ? 'direction-contract-unavailable' : !directionVerified ? 'force-or-slip-direction-unverified' : !assistVerified ? 'dynamic-assist-status-unverified' :
        speed === null || speed < C.minSpeed || reverse ? 'low-speed-or-reverse' : caps.clutchConvention !== 'disengagement-fraction' ? 'clutch-convention-unverified' :
        !num(g.clutch) || g.clutch > .05 ? 'clutch-unknown-or-active' :
        !num(this.prev?.clutch) || Math.abs(g.clutch - this.prev.clutch) > C.clutchChange ? 'clutch-changing' :
        !this.prev || g.gear == null || this.prev.gear == null || g.gear !== this.prev.gear ? 'gear-unknown-or-changing' :
        !(handbrake === false || num(handbrake) && handbrake <= .01) ? 'handbrake-unknown-or-active' : null;
      const eligible = matching.filter(i => {
        const f = wheels[i].forceResponse.longitudinal;
        const axle=[i<2?0:2,i<2?1:3].map(j=>g.wheels?.[j]?.load);
        const loadedEnough=axle.every(v=>num(v)&&v>0)&&g.wheels[i].load/(axle[0]+axle[1])>=C.minAxleLoadFraction;
        const movement = fresh && dt > 0 && num(this.prev?.ratios[i]) && Math.abs(g.wheels[i].ratio) > Math.abs(this.prev.ratios[i]) + C.demandRateMin * dt && num(this.prev?.[key]) && input >= this.prev[key] + C.pedalRateMin * dt ||
          !fresh && this.prev && now - this.prev.observedAt <= C.softTTL && this.prev.longGrowing[i] && this.prev.pedalHolding[key] && g.wheels[i].ratio === this.prev.ratios[i] && input === this.prev[key];
        return loadedEnough && f.state === 'declining' && f.slopeHigh < 0 && f.ageMs <= C.softTTL && f.quality >= .55 && movement &&
          !(i >= 2 && !(handbrake === false || num(handbrake) && handbrake <= .01));
      });
      // Missing slip excludes event qualification, never its known physical force.
      const totalKnown = forceIndices.length > 0 && forceIndices.every(i => num(g.wheels?.[i]?.fx) && num(this.prev?.forcesFx?.[i]));
      const total = forceTotal(g, this.prev?.forcesFx, forceIndices, 'fx', expected);
      const relevantDirection = forceIndices.every(i => !num(g.wheels?.[i]?.ratio) || g.wheels[i].ratio * expected >= 0);
      if (!block && !totalKnown) block = 'total-force-unknown';
      if (!block && (!total || !relevantDirection)) block = 'force-or-slip-direction-unverified';
      const totalDeclining = fresh && dt > 0 && total && total.now < total.prior - 1;
      const heldDeclining = !fresh && this.prev && now - this.prev.observedAt <= C.softTTL && this.dwellReady[key] > 0;
      response.directionVerified = directionVerified && Boolean(total && relevantDirection);
      response.totalForce = { wheels: forceIndices.slice(), known: totalKnown, directionVerified: Boolean(total && relevantDirection), current: total?.now ?? null, prior: total?.prior ?? null };
      const condition = !block && eligible.length > 0 && first.state === 'declining' && (totalDeclining||heldDeclining);
      const attention = this._dwell(key, Boolean(condition), now, undefined, fresh);
      if (attention) return Object.assign(response, { mode: 'attention', severity: .8, wheels: eligible, reason: 'growing-slip-with-declining-force', attention: 1 });
      // An observation is deliberately non-commanding: event mode has no fallback danger frame.
      return Object.assign(response, { mode: 'unknown', severity: 0, attention: 0,
        reason: block || (eligible.length && fresh && !totalDeclining ? 'total-useful-force-not-declining' : first.state === 'plateau' ? 'plateau-is-not-release' : first.state === 'productive' ? 'productive-force-response' : eligible.length ? 'declining-event-dwell' : 'declining-observation-only') });
    }
  }
  return { Observer, ageView };
});
