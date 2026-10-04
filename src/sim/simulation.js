/* ============================================================================
   EcoSwitch simulation core.
   Pure logic (no rendering imports) so the state machines can be unit-tested
   in node. Occupant positions live here; the 3D world follows this model.

   Sensing model (simplified but honest):
     • PIR      — pyroelectric motion only. Needs a *change* in IR flux. Still
                  bodies fall out of detection after a short hold window.
     • mmWave   — 24 GHz FMCW presence radar. Keeps still bodies via micro
                  motion (breathing), but can be fooled by moving clutter
                  (fan blades, curtains) and by oversensitivity / noise.
     • Hybrid   — OCCUPIED while (PIR OR mmWave); both clear → GRACE → VACANT.
   Nothing here claims real RF physics or real metering; it is a logical model.
   ==========================================================================*/

import { ZONES, SENSORS, LIGHTS, FANS, LOADS, TIMING, SENSE, SEATS, zoneOf, OCCUPANT_NAMES, SENSE as S } from '../config.js';
import { clamp, lerp, damp, rand, seeded } from '../core/utils.js';

let uid = 1;
const nextId = () => uid++;

export const MODES = ['HYBRID', 'PIR_ONLY', 'MMWAVE_ONLY', 'ALWAYS_ON'];

/* ---------------- coverage test ----------------
   `zoneMask` mirrors a real installation: the detection area is drawn in
   software (per zone) so neighbouring rooms / rows do not cross-trigger. */
export function inCoverage(sensor, px, pz, opts = {}) {
  if (opts.zoneMask != null && opts.occZone != null && opts.occZone !== opts.zoneMask) return false;
  const dx = px - sensor.x;
  const dz = pz - sensor.z;
  const horiz = Math.hypot(dx, dz);
  const range = sensor.range * (opts.rangeScale ?? 1);
  if (horiz > range) return false;
  if (sensor.mount === 'ceiling') {
    // downward cone from ceiling: half-angle measured from straight-down
    const dy = sensor.y - (opts.headY ?? 1.15);
    const ang = Math.atan2(horiz, Math.max(0.3, dy)) * (180 / Math.PI);
    return ang <= sensor.beam / 2;
  }
  const facing = sensor.yaw * (Math.PI / 180);
  // yaw 0 => looks towards +z, 180 => -z, 90 => +x, 270 => -x
  const vx = Math.sin(facing),
    vz = Math.cos(facing);
  if (horiz < 1e-4) return true;
  const dot = (dx * vx + dz * vz) / horiz;
  return Math.acos(clamp(dot, -1, 1)) * (180 / Math.PI) <= sensor.beam / 2;
}

/* ---------------- occupant ---------------- */
export class Occupant {
  constructor(opts = {}) {
    this.id = nextId();
    this.name = opts.name || OCCUPANT_NAMES[this.id % OCCUPANT_NAMES.length];
    this.seat = opts.seat ?? null;
    this.x = opts.x ?? 0;
    this.z = opts.z ?? 0;
    this.yaw = opts.yaw ?? Math.PI; // facing -x (whiteboard)
    this.state = opts.state || 'seated'; // walking | seated | standing | gone
    this.personality = opts.personality || 'calm'; // calm | fidget | active
    this.baseline = opts.baseline ?? (this.personality === 'calm' ? 0.018 : this.personality === 'fidget' ? 0.15 : 0.06);
    this.act = opts.act ?? 1.0; // current voluntary activity level (decays to baseline)
    this.spike = 0;
    this.spikeTimer = rand(4, 16);
    this.motion = 1;
    this.micro = 0.02;
    this.breath = rand(0, 6.28);
    this.path = opts.path || null;
    this.pathI = 0;
    this.speed = opts.speed ?? 1.28;
    this.targetSeat = null;
    this.seatId = null;
    this.ghost = false; // decorative (not sensed) occupant
    this.done = false;
    this.age = 0;
    this.zone = zoneOf(this.x);
  }

  /* path helper: lane-snapped walking route */
  static routeTo(fromX, fromZ, toX, toZ) {
    const lane = Math.abs(toZ) > 2.2 ? (toZ > 0 ? 2.62 : -2.62) : 0.0;
    const pts = [];
    const nearDoor = (x) => Math.abs(x - 4.6) < 0.2;
    if (Math.abs(fromZ - lane) > 0.22 && !nearDoor(fromX)) pts.push([fromX, lane]);
    pts.push([toX + (toX > fromX ? -0.02 : 0.02), lane]);
    pts.push([toX, toZ]);
    return pts;
  }

  update(dt, sim) {
    this.age += dt;
    // seated bodies are attributed to the zone of their desk (a body leans over
    // the aisle; the desk — and therefore the load — decides the zone)
    this.zone = this.seat && this.state === 'seated' ? this.seat.zone : zoneOf(this.x);
    // ---- movement ----
    if (this.state === 'walking' && this.path) {
      const tgt = this.path[this.pathI];
      const dx = tgt[0] - this.x;
      const dz = tgt[1] - this.z;
      const d = Math.hypot(dx, dz);
      const v = this.speed * dt;
      if (d <= v) {
        this.x = tgt[0];
        this.z = tgt[1];
        this.pathI++;
        if (this.pathI >= this.path.length) {
          this.path = null;
          this.state = this.targetSeat != null ? 'seated' : 'standing';
          if (this.state === 'seated') {
            this.act = 0.95;
            this.faceRY = 0;
          }
        }
      } else {
        this.x += (dx / d) * v;
        this.z += (dz / d) * v;
        this.faceRY = Math.atan2(dz, -dx); // figure's local forward is -x
      }
      this.motion = 0.86 + 0.14 * Math.sin(this.age * 7.2);
      this.micro = 0.12;
      return;
    }

    // ---- voluntary activity decay & random gestures ----
    this.act = damp(this.act, this.baseline, this.state === 'seated' ? 0.42 : 0.9, dt);
    this.spikeTimer -= dt;
    if (this.spikeTimer <= 0) {
      if (this.state === 'seated') {
        this.spike = rand(0.35, 0.85);
        this.spikeTimer = rand(6, 18);
      } else {
        this.spikeTimer = rand(2, 5);
        this.spike = 0.25;
      }
    }
    this.spike = damp(this.spike, 0, 1.6, dt);

    const still = this.state === 'seated';
    this.motion = clamp(Math.max(this.act, this.spike) * (still ? 1 : 0.75) + (still ? 0 : 0.3), 0, 1);
    // micro-motion: breathing + small posture shifts (radar sees this)
    this.breath += dt * (still ? 1.05 : 1.7);
    this.micro = (still ? 0.024 + 0.014 * Math.sin(this.breath) : 0.14 + 0.05 * Math.sin(this.breath)) + this.spike * 0.2;
  }

  get seatedX() {
    return this.x;
  }
}

/* ---------------- zone ---------------- */
export class Zone {
  constructor(def) {
    Object.assign(this, def);
    const L = LOADS.perZone[def.id];
    this.lightW = L.lightW;
    this.fanW = L.fanW;
    this.lightCount = L.lightCount;
    this.fanCount = L.fanCount;
    this.totalW = L.totalW;
    this.state = 'VACANT';
    this.prevState = null;
    this.t = 0;
    this.warnFired = false;
    this.manual = 'AUTO'; // AUTO | ON | OFF
    this.lightLevel = 0;
    this.fanLevel = 0;
    this.fanRpm = 0;
    this.presence = false;
    this.pirSeen = false;
    this.mmSeen = false;
    this.occupants = 0;
    this.detected = 0;
    this.ghostTicks = 0; // loads off while occupied
    this.kwh = 0;
    this.onSec = 0;
    this.switchEvents = 0;
    this.degraded = false;
    this.fault = false;
    this.lux = 0;
    this.countdown = 0;
    this.onT = 0;
    this.lightCmd = 'AUTO'; // per-circuit manual: AUTO | ON | OFF
    this.fanCmd = 'AUTO';
    this.stillHold = false;
    this.src = [];
  }
}

/* ---------------- simulation ---------------- */
export class Simulation {
  constructor() {
    this.zones = ZONES.map((z) => new Zone(z));
    this.sensors = SENSORS.map((s) => ({
      ...s,
      enabled: true,
      presence: false,
      hold: 0,
      targets: 0,
      health: 1,
      lastTrigger: -99,
      falsePos: 0,
      phase: rand(0, 6.28),
      flicker: 0,
    }));
    this.occupants = [];
    this.mode = 'HYBRID';
    this.time = 0; // simulated seconds
    this.realTime = 0;
    this.timeScale = TIMING.timeScale;
    this.warnAfter = TIMING.warnAfter;
    this.offAfter = TIMING.offAfter;
    this.pirHold = TIMING.pirHold;
    this.sensitivity = 0.75; // mmWave sensitivity 0..1
    this.pirGain = 0.85;
    this.rangeScale = 1;
    this.confirmOn = 0.55; // load-on de-glitch window (sim seconds)
    this.clutter = 0.55; // how much moving fan blades fool the radar
    this.rangeGate = 0.7; // radar distance gate (m): reflectors closer than this dominate
    this.noise = 0.18; // radar noise / ghost triggers
    this.breeze = 0.35; // curtains
    this.daylight = 0.85; // 0..1 sun strength
    this.timeOfDay = 11.2; // hours
    this.energy = { kwh: 0, baseKwh: 0, cost: 0, saved: 0, savedPct: 0, peakW: 0, sec: 0 };
    this.stats = {
      occupiedEvents: 0,
      falseVacancy: 0,
      falseOccupancy: 0,
      graceEntries: 0,
      shutdowns: 0,
      overrides: 0,
      faults: 0,
      comfortIncidents: 0,
    };
    this.events = [];
    this.listeners = {};
    this.seatTaken = new Set();
    this.rng = seeded(12345);
    this.paused = false;
    this.status = 'STANDBY';
    this.scenario = null;
    this.script = null;
    this.scriptT = 0;
    this.scriptLoop = false;
    this.fanSpin = FANS.map(() => 0);
    /* live "what would the other strategy have used" shadows — same occupancy
       signals, same timers, so the comparison is apples to apples */
    this.shadow = {};
    ['ALWAYS_ON', 'PIR_ONLY', 'MMWAVE_ONLY', 'HYBRID'].forEach((m) => {
      this.shadow[m] = { kwh: 0, onSec: 0, comfort: 0, zones: ZONES.map(() => ({ on: false, t: 0, lvl: 0, flvl: 0 })) };
    });
    this.onEvent = null;
  }

  /* ---------------- events ---------------- */
  log(msg, kind = 'sys', zone = null, tag = null) {
    const e = { id: nextId(), t: this.time, msg, kind, zone, tag, label: this.clockLabel() };
    this.events.push(e);
    if (this.events.length > 260) this.events.splice(0, 120);
    if (this.onEvent) this.onEvent(e);
    this.emit('event', e);
    return e;
  }
  clockLabel() {
    const s = Math.floor(this.time) % 60;
    const m = Math.floor(this.time / 60) % 60;
    const h = 8 + Math.floor(this.time / 3600);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  on(ev, fn) {
    (this.listeners[ev] ||= []).push(fn);
    return this;
  }
  emit(ev, data) {
    (this.listeners[ev] || []).forEach((f) => f(data));
  }

  /* ---------------- occupant API ---------------- */
  freeSeat(zone, prefer = 0) {
    const list = SEATS.filter((s) => s.zone === zone && !this.seatTaken.has(s.id));
    if (!list.length) return null;
    list.sort((a, b) => Math.abs(a.x - prefer) - Math.abs(b.x - prefer));
    return list[Math.min(list.length - 1, Math.floor(this.rng() * Math.min(4, list.length)))];
  }

  seatOccupant(occ, seat) {
    if (occ.seatId != null) this.seatTaken.delete(occ.seatId);
    occ.seatId = seat.id;
    occ.seat = seat;
    this.seatTaken.add(seat.id);
    occ.targetSeat = seat.id;
    const px = seat.x + 0.44;
    occ.path = Occupant.routeTo(occ.x, occ.z, px, seat.z);
    occ.state = 'walking';
  }

  addOccupant(opts = {}) {
    const zone = opts.zone ?? 0;
    const occ = new Occupant(opts);
    if (opts.instant && opts.seat) {
      occ.x = opts.seat.x + 0.44;
      occ.z = opts.seat.z;
      occ.seatId = opts.seat.id;
      occ.seat = opts.seat;
      occ.state = 'seated';
      occ.act = opts.act ?? occ.baseline;
      this.seatTaken.add(opts.seat.id);
    } else if (opts.seat || (opts.seat == null && opts.seatFromPool !== false)) {
      const seat = opts.seat || this.freeSeat(zone, opts.preferX);
      if (!seat) return null;
      occ.x = opts.fromX ?? 4.5;
      occ.z = opts.fromZ ?? 1.55;
      occ.state = 'walking';
      this.seatOccupant(occ, seat);
    } else {
      occ.state = opts.state || 'standing';
    }
    occ.zone = zoneOf(occ.x);
    this.occupants.push(occ);
    return occ;
  }

  removeOccupant(id, { vanish = false } = {}) {
    const i = this.occupants.findIndex((o) => o.id === id);
    if (i < 0) return;
    const o = this.occupants[i];
    if (vanish) {
      if (o.seatId != null) this.seatTaken.delete(o.seatId);
      this.occupants.splice(i, 1);
      return;
    }
    // walk to the door then disappear
    if (o.state !== 'walking') {
      o.state = 'walking';
      o.act = 1;
      o.targetSeat = null;
      o.path = [
        [o.x, Math.abs(o.z) > 2.2 ? (o.z > 0 ? 2.62 : -2.62) : 0],
        [4.15, o.z > 0 ? 2.62 : 0.0],
        [4.75, 1.55],
      ];
      o.pathI = 0;
      o.leaving = true;
    }
  }

  clearZone(zone, { vanish = false } = {}) {
    this.occupants.filter((o) => o.zone === zone).forEach((o) => this.removeOccupant(o.id, { vanish }));
  }
  clearAll({ vanish = true } = {}) {
    [...this.occupants].forEach((o) => this.removeOccupant(o.id, { vanish }));
  }

  /* ---------------- sensor physics ---------------- */
  updateSensors(dt) {
    for (const s of this.sensors) {
      let hit = false;
      let hits = 0;
      let stillHit = false;
      if (s.enabled) {
        for (const o of this.occupants) {
          if (o.state === 'gone' || o.ghost) continue;
          if (!inCoverage(s, o.x, o.z, { rangeScale: this.rangeScale, headY: o.state === 'seated' ? 1.16 : 1.42, zoneMask: s.zone, occZone: o.zone })) continue;
          hits++;
          if (s.kind === 'pir') {
            if (o.motion > SENSE.pirMotionThreshold / (0.6 + this.pirGain * 0.6)) hit = true;
          } else {
            const gross = o.motion > SENSE.mmMotionThreshold;
            const micro = o.micro > SENSE.mmMicroThreshold / (0.4 + this.sensitivity);
            if (gross || micro) {
              hit = true;
              if (o.motion < SENSE.pirMotionThreshold) stillHit = true;
            }
          }
        }
      }
      s.targets = hits;
      s.stillTargets = stillHit ? 1 : 0;

      if (s.kind === 'pir') {
        if (hit) {
          s.hold = this.pirHold;
          s.lastTrigger = this.time;
        }
        s.hold -= dt;
        s.presence = s.enabled && s.hold > 0;
      } else {
        // radar: fast enough to be treated as level-based, with a short hold
        if (hit) s.hold = SENSE.mmHold;
        else s.hold -= dt;
        s.hold = Math.max(0, s.hold);
        let clutterHit = false;
        let clutterHold = 0.4; // short by default: the on-filter de-glitches a single blip
        if (s.enabled) {
          // spinning fan blades inside the radar footprint create micro-Doppler
          for (const f of FANS) {
            if (f.zone !== s.zone) continue;
            const spin = this.fanSpin[f.id] || 0;
            if (spin < 0.3) continue;
            if (!inCoverage(s, f.x, f.z, { rangeScale: this.rangeScale })) continue;
            // a well-installed module gates its range so the blade disc under it
            // is ignored; widen the gate and the blades come back as clutter
            const d = Math.hypot(f.x - s.x, f.z - s.z);
            if (d > this.rangeGate) continue;
            const strength = spin * this.clutter * this.sensitivity;
            const osc = Math.sin(this.time * 7.3 + f.id * 1.9 + s.phase) * 0.5 + 0.5;
            if (osc > 1 - strength * 0.6) {
              clutterHit = true;
              clutterHold = Math.max(clutterHold, 0.9 + this.sensitivity * 1.3);
            }
          }
          // ghost triggers: receiver noise, reflections off a moving curtain,
          // leakage through the wall from activity in the neighbouring zone
          if (!clutterHit && !hit) {
            const wind = 0.5 + this.breeze;
            const p = this.noise * 0.1 * dt * (0.4 + this.sensitivity) * wind;
            if (this.rng() < p) clutterHit = true;
          }
        }
        if (clutterHit) {
          if (!s.presence) {
            s.falsePos += 1;
            if (!hit) this.stats.falseOccupancy++;
            if (this.time - (s.lastFPLog ?? -99) > 5.5) {
              s.lastFPLog = this.time;
              this.log(`mmWave ${ZONES[s.zone].tag} reported presence with no moving body`, 'warn', s.zone, 'RADAR');
            }
          }
          s.hold = Math.max(s.hold, clutterHold);
        }
        s.presence = s.enabled && (s.hold > 0 || hit);
        s.clutterNow = clutterHit && !hit;
      }
      s.health = s.enabled ? clamp(s.health + dt * 0.4, 0, 1) : clamp(s.health - dt * 0.8, 0, 1);
    }
  }

  zonePresence(zoneId) {
    const z = this.zones[zoneId];
    const pir = this.sensors.find((s) => s.kind === 'pir' && s.zone === zoneId);
    const mm = this.sensors.find((s) => s.kind === 'mmwave' && s.zone === zoneId);
    const pOK = pir.enabled,
      mOK = mm.enabled;
    z.degraded = !pOK || !mOK;
    z.fault = !pOK && !mOK;
    let presence = false;
    let src = [];
    if (this.mode === 'ALWAYS_ON') presence = true;
    else if (this.mode === 'PIR_ONLY') {
      presence = pOK ? pir.presence : false;
      if (presence) src = ['PIR'];
    } else if (this.mode === 'MMWAVE_ONLY') {
      presence = mOK ? mm.presence : false;
      if (presence) src = ['MMW'];
    } else {
      const a = pOK && pir.presence;
      const b = mOK && mm.presence;
      presence = a || b;
      if (a) src.push('PIR');
      if (b) src.push('MMW');
      if (!a && !b && z.fault) {
        // both sensors dead → fail safe: treat as vacant, alarm
        presence = false;
      }
    }
    const wasPir = z.pirSeen,
      wasMm = z.mmSeen;
    z.pirSeen = pOK && pir.presence;
    z.mmSeen = mOK && mm.presence;
    // sensor-level event lines (rate limited so the log stays readable)
    if (z.pirSeen && !wasPir && this.time - (z._pirLogT || -99) > 6) {
      z._pirLogT = this.time;
      this.log(`PIR motion detected — ${z.name} (${pir.targets} ${pir.targets === 1 ? 'body' : 'bodies'} in wedge)`, 'sys', z.id, 'PIR');
    }
    if (z.mmSeen && !wasMm && this.time - (z._mmLogT || -99) > 6) {
      z._mmLogT = this.time;
      this.log(`mmWave presence detected — ${z.name}${mm.stillTargets ? ' (still occupant held)' : ''}`, 'sys', z.id, 'MMW');
    }
    z.src = src;
    // if a sensor has failed in PIR/MWAVE solo mode we must keep the lights on
    if ((this.mode === 'PIR_ONLY' && !pOK) || (this.mode === 'MMWAVE_ONLY' && !mOK)) {
      if (z.state === 'OCCUPIED') presence = true; // last-known-good, fail-safe hold
    }
    return presence;
  }

  /* ---------------- zone state machines ---------------- */
  updateZones(dt) {
    this.energy.nowW = 0;
    this.energy.baseKwh += (LOADS.allOnW * dt) / 3.6e6; // "every load, all day" reference
    for (const z of this.zones) {
      let presence = this.zonePresence(z.id);
      if (z.manual === 'ON') presence = true;
      if (z.manual === 'OFF') presence = false;
      z.presence = presence;

      const prevState = z.state;
      // short de-glitch filter (0.45 s) so a single radar blip cannot latch a
      // zone on; once occupied the response is immediate.
      if (presence) z.onT = (z.onT || 0) + dt;
      else z.onT = 0;
      const confirmed = z.state !== 'VACANT' ? presence : presence && z.onT >= this.confirmOn;
      if (confirmed) {
        if (z.state !== 'OCCUPIED') {
          if (z.state === 'GRACE') this.log(`${z.name} — occupancy restored, timer reset`, 'ok', z.id, z.tag);
          else this.log(`${z.name} occupied (${z.src.join(' + ') || 'forced'})`, 'ok', z.id, z.tag);
          z.state = 'OCCUPIED';
          z.t = 0;
          z.warnFired = false;
          z.switchEvents++;
          this.stats.occupiedEvents++;
        }
      } else {
        if (z.state === 'OCCUPIED') {
          z.state = 'GRACE';
          z.t = 0;
          z.warnFired = false;
          this.stats.graceEntries++;
          this.log(`${z.name} entering grace period (${this.offAfter}s)`, 'warn', z.id, z.tag);
        } else if (z.state === 'GRACE') {
          z.t += dt;
          if (!z.warnFired && z.t >= this.warnAfter) {
            z.warnFired = true;
            const still = z.occupants > 0;
            this.log(
              still
                ? `${z.name} vacancy warning — ${z.occupants} occupant(s) still present`
                : `${z.name} vacancy warning — no movement`,
              'warn',
              z.id,
              z.tag
            );
          }
          if (z.t >= this.offAfter) {
            z.state = 'VACANT';
            z.t = 0;
            z.switchEvents++;
            this.stats.shutdowns++;
            this.log(`${z.name} VACANT — control relays released`, 'dim', z.id, z.tag);
            if (z.occupants > 0) {
              z.ghostTicks++;
              this.stats.comfortIncidents++;
              this.stats.falseVacancy++;
              this.log(`${z.name} shut off while occupied — PIR blind spot`, 'bad', z.id, z.tag);
            }
          }
        }
      }
      if (prevState !== z.state) z.prevState = prevState;

      // ---- loads (state machine, then per-circuit manual switches) ----
      const loadsOn = z.state === 'OCCUPIED' || z.state === 'GRACE' || z.manual === 'ON';
      const lt = z.lightCmd === 'AUTO' ? loadsOn : z.lightCmd === 'ON';
      const ft = z.fanCmd === 'AUTO' ? loadsOn : z.fanCmd === 'ON';
      z.loadAuto = loadsOn;
      const target = lt || ft ? 1 : 0;
      z.lightLevel = damp(z.lightLevel, lt ? 1 : 0, 1 / TIMING.ramp, dt);
      if (Math.abs(z.lightLevel - (lt ? 1 : 0)) < 0.004) z.lightLevel = lt ? 1 : 0;
      if (z._lt !== undefined && z._lt !== lt)
        this.log(`${z.name} lights ${lt ? 'ON' : 'OFF'}`, lt ? 'sys' : 'dim', z.id, z.tag);
      z._lt = lt;
      z.fanLevel = damp(z.fanLevel, ft ? 1 : 0, 0.95, dt); // motor inertia
      if (z._ft !== undefined && z._ft !== ft)
        this.log(`${z.name} fan ${ft ? 'ON' : 'OFF'}`, ft ? 'sys' : 'dim', z.id, z.tag);
      z._ft = ft;
      z.fanRpm = damp(z.fanRpm, target * (60 * 1.65), 0.62, dt); // ~100 rpm visual
      z.onSec += (loadsOn ? dt : 0);
      z.countdown = z.state === 'GRACE' ? Math.max(0, this.offAfter - z.t) : 0;
      z.lux = Math.round(lerp(46, z.lightW * 3.4 + 110, z.lightLevel) + this.daylight * 120 * (0.4 + 0.6 * Math.sin(this.timeOfDay / 24 * Math.PI)));

      // ---- energy (simulated, from configured loads × operating time) ----
      const w = z.lightW * z.lightLevel + z.fanW * z.fanLevel;
      const kwh = (w * dt) / 3.6e6; // W·s → kWh  (simulated, from configured loads)
      z.kwh += kwh;
      this.energy.kwh += kwh;
      this.energy.nowW = (this.energy.nowW || 0) + w;
      this.energy.peakW = Math.max(this.energy.peakW, w);
    }
    // fan spin map for the radar clutter model + props
    FANS.forEach((f) => {
      const z = this.zones[f.zone];
      this.fanSpin[f.id] = z.fanLevel;
    });
    for (const z of this.zones) {
      const mm = this.sensors.find((x) => x.kind === 'mmwave' && x.zone === z.id);
      z.stillHold = !!(mm && mm.presence && mm.stillTargets && !z.pirSeen);
    }
    this.energy.cost = this.energy.kwh * LOADS.tariff;
    this.energy.saved = Math.max(0, this.energy.baseKwh - this.energy.kwh);
    this.energy.savedPct = this.energy.baseKwh > 1e-6 ? this.energy.saved / this.energy.baseKwh : 0;

    // system status
    const anyFault = this.sensors.some((s) => !s.enabled);
    const anyManual = this.zones.some((z) => z.manual !== 'AUTO');
    const hard = this.zones.some((z) => z.fault);
    this.status = hard ? 'FAULT' : anyFault ? 'DEGRADED' : anyManual ? 'MANUAL OVERRIDE' : this.mode === 'ALWAYS_ON' ? 'BASELINE (ALWAYS ON)' : 'NOMINAL';
  }

  /* ---------------- scripts (scenarios / demo mode) ---------------- */
  play(script, { loop = false, label = null } = {}) {
    this.script = script.map((s) => ({ ...s, done: false }));
    this.scriptT = 0;
    this.scriptLoop = loop;
    this.scenario = label;
    this.emit('script', { label, loop });
    return this;
  }
  stopScript() {
    this.script = null;
    this.scenario = null;
    this.emit('script', { label: null, loop: false });
  }
  updateScript(dt) {
    if (!this.script) return;
    this.scriptT += dt;
    let allDone = true;
    for (const st of this.script) {
      if (st.at > this.scriptT) allDone = false;
      if (!st.done && st.at <= this.scriptT) {
        st.done = true;
        try {
          st.fn(this);
        } catch (e) {
          console.warn('script step failed', e);
        }
      }
    }
    if (allDone) {
      const last = this.script[this.script.length - 1];
      if (this.scriptLoop) {
        const total = (last.at || 0) + (this.scriptHold || 6);
        if (this.scriptT > total) {
          this.script.forEach((s) => (s.done = false));
          this.scriptT = 0;
          if (this.onResetForLoop) this.onResetForLoop();
        }
      } else {
        this.script = null;
        this.emit('script', { label: this.scenario, loop: false, finished: true });
      }
    }
  }

  updateShadows(dt) {
    for (const m in this.shadow) {
      const sh = this.shadow[m];
      if (m === this.mode) {
        // the running strategy IS the real one — reuse the authoritative numbers
        sh.kwh = this.energy.kwh;
        sh.onSec = this.zones.reduce((a, z) => a + z.onSec, 0);
        sh.comfort = this.stats.comfortIncidents;
        continue;
      }
      for (let zi = 0; zi < this.zones.length; zi++) {
        const st = sh.zones[zi];
        const z = this.zones[zi];
        let presence;
        if (m === 'ALWAYS_ON') presence = true;
        else if (m === 'PIR_ONLY') presence = z.pirSeen;
        else if (m === 'MMWAVE_ONLY') presence = z.mmSeen;
        else presence = z.pirSeen || z.mmSeen;
        if (m !== 'ALWAYS_ON' && z.manual === 'ON') presence = true;
        if (z.manual === 'OFF') presence = false;
        if (z.fault && m !== 'ALWAYS_ON') presence = false;
        if (presence) {
          st.on = true;
          st.t = 0;
        } else if (st.on) {
          st.t += dt;
          if (st.t >= this.offAfter) {
            st.on = false;
            st.t = 0;
            if (z.occupants > 0) sh.comfort++;
          }
        }
        const tgt = st.on ? 1 : 0;
        st.lvl = damp(st.lvl, tgt, 1 / TIMING.ramp, dt);
        st.flvl = damp(st.flvl || 0, tgt, 0.95, dt); // fan inertia, same as the real one
        sh.kwh += ((z.lightW * st.lvl + z.fanW * st.flvl) * dt) / 3.6e6;
        sh.onSec += (tgt ? dt : 0);
      }
    }
    const base = Math.max(1e-9, this.shadow.ALWAYS_ON.kwh);
    for (const m in this.shadow) {
      const sh = this.shadow[m];
      sh.savedPct = Math.max(0, 1 - sh.kwh / base);
      sh.kwhPct = sh.kwh / base;
    }
  }

  /* ---------------- main step ---------------- */
  step(dtReal) {
    if (this.paused) return;
    this.realTime += dtReal;
    const dt = Math.min(0.05, dtReal) * this.timeScale;
    this.time += dt;

    // occupants
    for (let i = this.occupants.length - 1; i >= 0; i--) {
      const o = this.occupants[i];
      o.update(dt, this);
      if (o.leaving && o.path === null && o.x > 4.6 && Math.abs(o.z - 1.55) < 0.4) {
        if (o.seatId != null) this.seatTaken.delete(o.seatId);
        this.occupants.splice(i, 1);
      } else if (o.leaving && !o.path) {
        if (o.seatId != null) this.seatTaken.delete(o.seatId);
        this.occupants.splice(i, 1);
      }
    }
    // per-zone occupancy counts
    for (const z of this.zones) {
      z.occupants = 0;
      z.detected = 0;
    }
    for (const o of this.occupants) {
      if (o.ghost) continue;
      const z = this.zones[zoneOf(o.x)];
      if (z) z.occupants++;
    }

    this.updateSensors(dt);
    for (const z of this.zones) {
      const pir = this.sensors.find((s) => s.kind === 'pir' && s.zone === z.id);
      const mm = this.sensors.find((s) => s.kind === 'mmwave' && s.zone === z.id);
      z.detected = Math.max(pir.targets, mm.targets);
    }
    this.updateZones(dt);
    this.updateShadows(dt);
    this.updateScript(dt);
  }

  /* ---------------- controls API ---------------- */
  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    this.log(`Operating mode → ${m.replace('_', '- ')}`, 'sys', null, 'MODE');
    this.emit('mode', m);
  }
  setZoneManual(zoneId, mode) {
    const z = this.zones[zoneId];
    if (z.manual === mode) return;
    z.manual = mode;
    this.stats.overrides++;
    this.log(
      mode === 'AUTO'
        ? `${z.name} manual override released → automatic`
        : `Manual override activated — ${z.name} forced ${mode === 'ON' ? 'ON' : 'OFF'}`,
      'manual',
      zoneId,
      z.tag
    );
    this.emit('manual', { zoneId, mode });
  }
  setLoadCmd(zoneId, kind, cmd) {
    const z = this.zones[zoneId];
    const key = kind === 'lights' ? 'lightCmd' : 'fanCmd';
    if (z[key] === cmd) return;
    z[key] = cmd;
    this.log(
      `${z.name} ${kind} circuit → ${cmd === 'AUTO' ? 'automatic' : 'forced ' + cmd}`,
      cmd === 'AUTO' ? 'ok' : 'manual',
      zoneId,
      z.tag
    );
  }
  setSensorEnabled(id, on0) {
    const s = this.sensors.find((x) => x.id === id);
    if (!s || s.enabled === on0) return;
    s.enabled = on0;
    s.presence = false;
    s.hold = 0;
    const zn = ZONES[s.zone].name;
    if (!on0) {
      this.stats.faults++;
      this.log(`Sensor fault detected — ${s.kind === 'pir' ? 'PIR' : 'mmWave'} ${s.id.toUpperCase()} offline (${zn})`, 'bad', s.zone, 'FAULT');
    } else {
      this.log(`${s.kind === 'pir' ? 'PIR' : 'mmWave'} ${s.id.toUpperCase()} back online — ${zn} restored to hybrid`, 'ok', s.zone, 'FAULT');
    }
    this.emit('sensor', s);
  }
  setTiming({ warn, off, timeScale } = {}) {
    if (warn != null) {
      this.warnAfter = clamp(warn, 2, 600);
      this.offAfter = Math.max(this.warnAfter + 1, this.offAfter);
    }
    if (off != null) {
      this.offAfter = clamp(off, this.warnAfter + 1, 900);
      this.warnAfter = Math.min(this.warnAfter, this.offAfter - 1);
    }
    if (timeScale != null) this.timeScale = clamp(timeScale, 0.25, 8);
  }
  resetEnergy() {
    this.energy = { kwh: 0, baseKwh: 0, cost: 0, saved: 0, savedPct: 0, peakW: 0, sec: 0 };
    this.zones.forEach((z) => {
      z.kwh = 0;
      z.onSec = 0;
      z.switchEvents = 0;
    });
    this.log('Energy counters reset — accumulating from now', 'sys', null, 'METER');
  }
  resetAll() {
    this.clearAll({ vanish: true });
    this.zones.forEach((z) => {
      z.manual = 'AUTO';
      z.state = 'VACANT';
      z.t = 0;
      z.warnFired = false;
      z.ghostTicks = 0;
    });
    this.sensors.forEach((s) => {
      s.enabled = true;
      s.presence = false;
      s.hold = 0;
      s.health = 1;
    });
    this.stopScript();
  }
}

/* Convenience: describe the "why" of the last zone change for UI cards. */
export function zoneReason(z, sim) {
  if (z.fault) return 'both sensors offline — fail-safe vacant';
  if (z.manual === 'ON') return 'manual override locked ON';
  if (z.manual === 'OFF') return 'manual override locked OFF';
  if (z.degraded) return `running on ${z.pirSeen ? 'PIR' : z.mmSeen ? 'mmWave' : 'remaining sensor'}`;
  if (z.state === 'OCCUPIED') return `${z.src.join(' + ') || '—'} presence${z.stillHold ? ' (micro-motion)' : ''}`;
  if (z.state === 'GRACE') return `both sensors clear · ${z.countdown.toFixed(1)}s to shutdown`;
  return 'no presence detected';
}
