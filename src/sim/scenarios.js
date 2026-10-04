/* ============================================================================
   Preset demonstration scenarios, presentation demo loop and the offline
   strategy benchmark. All of these drive the same Simulation object, so what
   you see in the classroom IS what the numbers describe.
   ==========================================================================*/
import { ZONES, SEATS, STRATEGIES, LOADS, FANS } from '../config.js';
import { seeded } from '../core/utils.js';

/* pick a spread of seats in a zone */
export function seatsIn(zone, n, { from = 0 } = {}) {
  const list = SEATS.filter((s) => s.zone === zone);
  const out = [];
  for (let i = 0; i < n && i + from < list.length; i++) out.push(list[i + from]);
  return out;
}

export function populateZone(sim, zone, n, opts = {}) {
  const { still = false, walkIn = false, act, personality, from = 0 } = opts;
  const seats = seatsIn(zone, n, { from });
  if (opts.clear !== false) sim.clearZone(zone, { vanish: true });
  const made = [];
  seats.forEach((seat, i) => {
    const o = sim.addOccupant({
      seat,
      zone,
      instant: !walkIn,
      fromX: walkIn ? 4.5 : undefined,
      fromZ: walkIn ? 1.55 : undefined,
      act: act != null ? act : walkIn ? 1 : still ? 0.02 : 0.55 - i * 0.05,
      personality: personality || (still ? 'calm' : i % 3 === 0 ? 'fidget' : 'calm'),
      baseline: still ? 0.015 : undefined,
    });
    if (o) made.push(o);
  });
  return made;
}

const S = (at, fn, extra = {}) => ({ at, fn, ...extra });

/* -------------------------------------------------------------------------- */
export function scenarioScript(sim, id) {
  const steps = [];
  const reset = () => {
    sim.clearAll({ vanish: true });
    sim.zones.forEach((z) => {
      z.manual = 'AUTO';
    });
    sim.sensors.forEach((s) => (s.enabled = true));
  };

  switch (id) {
    /* ---------------- 1 — empty classroom ---------------- */
    case 1:
      return {
        label: 'SCENARIO 1 · EMPTY CLASSROOM',
        setup: () => {
          sim.setMode('HYBRID');
          reset();
          sim.log('Scenario loaded — room empty, all zones unoccupied', 'sys', null, 'SCN');
        },
        steps: [
          S(0, () => {}, { cam: { mode: 'overview' } }),
          S(4, () => sim.log('No presence in any zone — all controlled loads commanded OFF', 'dim', null, 'SCN')),
          S(10, () => {
            const o = sim.addOccupant({ zone: 2, walkIn: true, act: 1, speed: 1.5 });
            if (o) sim.log('A student walks in from the corridor (control for the empty-state demo)', 'sys', 2, 'SCN');
          }),
          S(20, () => {}, { cam: { mode: 'room' } }),
        ],
        hold: 22,
      };

    /* ---------------- 2 — one zone occupied ---------------- */
    case 2:
      return {
        label: 'SCENARIO 2 · ONE ZONE OCCUPIED',
        setup: () => {
          sim.setMode('HYBRID');
          reset();
          populateZone(sim, 0, 5, { act: 0.5 });
          sim.log('Scenario loaded — Zone 1 occupied, Zones 2 & 3 empty', 'sys', 0, 'SCN');
        },
        steps: [
          S(0, () => {}, { cam: { mode: 'zone', zone: 0 } }),
          S(6, () => sim.log('Only Zone 1 loads are energised — 24 of 36 seats dark', 'ok', 0, 'SCN'), {}),
          S(12, () => {}, { cam: { mode: 'overview' } }),
          S(16, () => populateZone(sim, 1, 4, { act: 0.45 }), { cam: { mode: 'zone', zone: 1 } }),
          S(18, () => sim.log('Zone 2 joins — zones stay independent', 'ok', 1, 'SCN')),
        ],
        hold: 20,
      };

    /* ---------------- 3 — stationary student ---------------- */
    case 3:
      return {
        label: 'SCENARIO 3 · STATIONARY STUDENT (PIR BLIND SPOT)',
        setup: () => {
          sim.setMode('PIR_ONLY');
          reset();
          populateZone(sim, 1, 1, { still: true, act: 1 });
          sim.log('Scenario loaded — one student reading quietly in Zone 2 · PIR-ONLY mode', 'sys', 1, 'SCN');
        },
        steps: [
          S(0, () => {}, { cam: { mode: 'zone', zone: 1, tight: true } }),
          S(3, () => sim.log('PIR triggered by chair movement on arrival', 'ok', 1, 'PIR')),
          S(9, () => {
            sim.occupants.forEach((o) => {
              o.baseline = 0.012;
              o.act = 0.05;
              o.spike = 0;
              o.spikeTimer = 999;
            });
            sim.log('Student becomes motionless while reading — IR flux stabilises', 'warn', 1, 'PIR');
          }),
          S(12, () => sim.log('PIR dropout: no changing signal → sensor reports clear', 'bad', 1, 'PIR')),
          S(14, () => sim.log('Watch the grace countdown — this is where PIR-only systems fail', 'warn', 1, 'PIR')),
          S(24, () => sim.log('Lights still ON — grace window running (occupant is present but invisible)', 'warn', 1, 'GRACE')),
          S(32, () => sim.log('Zone 2 VACANT with a student still seated — false vacancy', 'bad', 1, 'PIR'), { flash: 'bad' }),
          S(36, () => {
            sim.setMode('MMWAVE_ONLY');
            sim.log('Switching to mmWave — radar sees breathing micro-motion', 'sys', 1, 'MODE');
          }),
          S(39, () => sim.log('mmWave presence restored — zone returns to OCCUPIED instantly', 'ok', 1, 'MMW'), { flash: 'ok' }),
          S(48, () => sim.setMode('HYBRID'), { cam: { mode: 'overview' } }),
          S(50, () => sim.log('HYBRID keeps the zone ON for the rest of the session', 'ok', 1, 'MODE')),
        ],
        hold: 14,
      };

    /* ---------------- 4 — student leaves ---------------- */
    case 4:
      return {
        label: 'SCENARIO 4 · STUDENT LEAVES',
        setup: () => {
          sim.setMode('HYBRID');
          reset();
          populateZone(sim, 2, 4, { act: 0.5 });
          sim.log('Scenario loaded — Zone 3 busy; occupants will leave one by one', 'sys', 2, 'SCN');
        },
        steps: [
          S(0, () => {}, { cam: { mode: 'zone', zone: 2 } }),
          S(5, () => {
            const list = sim.occupants.filter((o) => o.zone === 2);
            if (list[0]) sim.removeOccupant(list[0].id);
            sim.log('Student leaves Zone 3', 'sys', 2, 'SCN');
          }),
          S(9, () => {
            const list = sim.occupants.filter((o) => o.zone === 2);
            if (list[1]) sim.removeOccupant(list[1].id);
          }),
          S(13, () => {
            sim.occupants.filter((o) => o.zone === 2).forEach((o) => sim.removeOccupant(o.id));
            sim.log('Last occupant leaves Zone 3 — both sensors clearing', 'warn', 2, 'SCN');
          }),
          S(16, () => sim.log('Grace started — countdown to shutdown visible on the OLED', 'warn', 2, 'TIMER')),
          S(24, () => sim.log('Vacancy warning: "check and switch off" buzzer chirp', 'warn', 2, 'TIMER')),
          S(31, () => sim.log('Zone 3 loads released automatically', 'dim', 2, 'SCN'), { flash: 'dim' }),
          S(36, () => {}, { cam: { mode: 'overview' } }),
        ],
        hold: 12,
      };

    /* ---------------- 5 — fan reflection / radar clutter ---------------- */
    case 5:
      return {
        label: 'SCENARIO 5 · FAN REFLECTION (RADAR CLUTTER)',
        setup: () => {
          sim.setMode('MMWAVE_ONLY');
          reset();
          sim.sensitivity = 0.92;
          sim.clutter = 1.0;
          sim.noise = 0.1;
          sim.rangeGate = 1.8;
          sim.setZoneManual(1, 'ON');
          sim.log('Scenario loaded — empty room, Zone 2 fan left running by override · mmWave-ONLY', 'sys', 1, 'SCN');
        },
        steps: [
          S(0, () => {}, { cam: { mode: 'zone', zone: 1, tight: true } }),
          S(4, () => sim.log('Rotating blades reflect the 24 GHz signal back to the module', 'warn', 1, 'MMW')),
          S(9, () => sim.log('Zone 2 reads OCCUPIED with 0 occupants — false positive', 'bad', 1, 'MMW'), { flash: 'bad' }),
          S(16, () => sim.log('Lesson: mount radars away from moving blades and tune sensitivity', 'sys', 1, 'CAL')),
          S(19, () => {
            sim.sensitivity = 0.34;
            sim.clutter = 0.25;
            sim.rangeGate = 0.5;
            sim.log('Sensitivity re-calibrated 0.92 → 0.34 · clutter rejected', 'ok', 1, 'CAL');
          }),
          S(24, () => sim.log('Radar now reports clear → grace period starts even with the fan running', 'ok', 1, 'MMW')),
          S(33, () => {
            sim.setZoneManual(1, 'AUTO');
            sim.log('Override released — Zone 2 shuts down', 'dim', 1, 'SCN');
          }, { flash: 'dim' }),
          S(38, () => {
            sim.sensitivity = 0.75;
            sim.clutter = 0.55;
            sim.rangeGate = 0.75;
          }),
        ],
        hold: 8,
      };

    /* ---------------- 6 — manual override ---------------- */
    case 6:
      return {
        label: 'SCENARIO 6 · MANUAL OVERRIDE',
        setup: () => {
          sim.setMode('HYBRID');
          reset();
          sim.log('Scenario loaded — an empty zone is forced ON for cleaning / revision', 'sys', 0, 'SCN');
        },
        steps: [
          S(0, () => {}, { cam: { mode: 'panel' } }),
          S(3, () => sim.setZoneManual(2, 'ON'), {}),
          S(4, () => sim.log('Override switch on the prototype bench pressed by the lab attendant', 'manual', 2, 'OVR')),
          S(10, () => {}, { cam: { mode: 'zone', zone: 2 } }),
          S(14, () => sim.setZoneManual(0, 'OFF'), {}),
          S(15, () => {
            populateZone(sim, 0, 4, { act: 0.6, walkIn: false });
            sim.log('Zone 1 forced OFF — sensors keep reporting, loads stay locked OFF', 'manual', 0, 'OVR');
          }),
          S(24, () => {
            sim.setZoneManual(0, 'AUTO');
            sim.setZoneManual(2, 'AUTO');
            sim.log('Both overrides released → full automatic control resumes', 'ok', null, 'OVR');
          }, { cam: { mode: 'overview' } }),
        ],
        hold: 10,
      };

    /* ---------------- 7 — sensor failure ---------------- */
    case 7:
      return {
        label: 'SCENARIO 7 · SENSOR FAILURE (DEGRADED)',
        setup: () => {
          sim.setMode('HYBRID');
          reset();
          populateZone(sim, 0, 5, { act: 0.5 });
          populateZone(sim, 2, 4, { act: 0.4 });
          sim.log('Scenario loaded — two zones occupied, one sensor will drop offline', 'sys', 0, 'SCN');
        },
        steps: [
          S(0, () => {}, { cam: { mode: 'zone', zone: 0 } }),
          S(6, () => {
            sim.setSensorEnabled('mm0', false);
            sim.log('mmWave module in Zone 1 lost I²C handshake → module offline', 'bad', 0, 'FAULT');
          }, { flash: 'bad' }),
          S(8, () => sim.log('System status DEGRADED — Zone 1 continues on PIR only', 'warn', 0, 'FAULT')),
          S(15, () => {
            sim.occupants.filter((o) => o.zone === 0).forEach((o) => {
              o.baseline = 0.013;
              o.act = 0.05;
            });
            sim.log('Zone 1 occupants become still — PIR alone cannot hold them', 'warn', 0, 'FAULT');
          }),
          S(22, () => sim.log('Zone 1 entering grace on PIR drop-out · degraded behaviour is expected', 'warn', 0, 'FAULT')),
          S(30, () => sim.log('Degraded rule: loads held ON during grace even with a failed sensor', 'sys', 0, 'SAFETY')),
          S(34, () => {
            sim.setSensorEnabled('mm0', true);
            sim.log('mmWave module restored — hybrid sensing re-armed', 'ok', 0, 'FAULT');
          }, { cam: { mode: 'overview' } }),
          S(38, () => sim.log('Zone 1 back to OCCUPIED — nominal status', 'ok', 0, 'SCN')),
        ],
        hold: 10,
      };

    /* ---------------- 8 — three-zone mixed (default showcase) ---------- */
    case 8:
    default:
      return {
        label: 'SCENARIO 8 · THREE-ZONE MIXED OCCUPANCY',
        setup: () => {
          sim.setMode('HYBRID');
          reset();
          populateZone(sim, 0, 6, { act: 0.42, from: 0 });
          populateZone(sim, 2, 7, { act: 0.32, from: 0 });
          sim.log('Scenario loaded — Zone 1 occupied · Zone 2 vacant · Zone 3 occupied', 'sys', null, 'SCN');
          sim.log('Zone 2 stays dark on purpose — daylight + no presence', 'dim', 1, 'SCN');
        },
        steps: [
          S(0, () => {}, { cam: { mode: 'overview' } }),
          S(6, () => {}, { cam: { mode: 'room' } }),
          S(9, () => sim.log('Middle zone: nothing to heat, nothing to light — that is the saving', 'ok', 1, 'SCN')),
        ],
        hold: 26,
      };
  }
}

export function applyScenario(sim, id, { loop = false } = {}) {
  const sc = scenarioScript(sim, id);
  sc.setup && sc.setup();
  sim.scriptHold = sc.hold || 8;
  sim.onResetForLoop = () => {
    sim.clearAll({ vanish: true });
    sim.zones.forEach((z) => (z.manual = 'AUTO'));
  };
  sim.play(sc.steps, { loop, label: sc.label });
  sim.log(`▶ ${sc.label}`, 'sys', null, 'SCN');
  return sc;
}

/* --------------------------------------------------------------------------
   DEMO MODE — presentation loop. One continuous, self-explanatory story:
   a person enters Zone 1 → detected → loads ON → leaves → grace → warning →
   shutdown, while Zone 2 (still occupied) is untouched; then Zone 2 wakes up.
   ------------------------------------------------------------------------*/
export function demoScript(sim) {
  const steps = [];
  const t = (at, fn, extra = {}) => steps.push({ at, fn, ...extra });
  t(0, () => {
    sim.clearAll({ vanish: true });
    sim.zones.forEach((z) => (z.manual = 'AUTO'));
    sim.sensors.forEach((s) => (s.enabled = true));
    sim.setMode('HYBRID');
    populateZone(sim, 1, 3, { act: 0.4 });
    sim.log('DEMO · Zone 2 has a small study group; Zone 1 & 3 are dark', 'sys', 1, 'DEMO');
  }, { cam: { mode: 'overview', dur: 2.2 } });

  t(4, () => {
    const o = sim.addOccupant({ zone: 0, walkIn: true, act: 1, speed: 1.35 });
    sim.log('DEMO · a student enters through the back door', 'sys', null, 'DEMO');
    sim._demoStudent = o && o.id;
  }, { cam: { mode: 'follow' } });

  t(9, () => sim.log('DEMO · PIR catches motion in the Zone 1 wedge', 'ok', 0, 'PIR'), { flash: 'ok' });
  t(11, () => {
    sim.log('DEMO · Zone 1 → OCCUPIED: 2 LED panels ON, ceiling fan starting', 'ok', 0, 'LOAD');
  }, { cam: { mode: 'zone', zone: 0 } });
  t(17, () => {
    populateZone(sim, 0, 5, { act: 0.5, walkIn: false, from: 0 });
    sim.log('DEMO · more students take Zone 1 seats', 'ok', 0, 'DEMO');
  });
  t(23, () => sim.log('DEMO · Zone 2 unaffected — independent state machine', 'dim', 1, 'DEMO'));
  t(27, () => {
    sim.occupants.filter((o) => o.zone === 0).forEach((o) => {
      o.baseline = 0.02;
      o.act = 0.12;
    });
    sim.log('DEMO · the zone goes quiet: hybrid holds it ON via micro-motion', 'warn', 0, 'MMW');
  });
  t(35, () => {
    sim.occupants.filter((o) => o.zone === 0).forEach((o) => sim.removeOccupant(o.id));
    sim.log('DEMO · students leave Zone 1', 'sys', 0, 'DEMO');
  }, { cam: { mode: 'door' } });
  t(40, () => sim.log('DEMO · both sensors clear → grace timer started', 'warn', 0, 'TIMER'));
  t(48, () => sim.log('DEMO · vacancy warning at 10 s — buzzer chirp, orange zone marker', 'warn', 0, 'TIMER'), { flash: 'warn' });
  t(54, () => sim.log('DEMO · 15 s elapsed → Zone 1 lights OFF, fan OFF', 'dim', 0, 'LOAD'), { flash: 'dim' });
  t(57, () => sim.log('DEMO · Zone 2 still lit and spinning — no cross-talk between zones', 'ok', 1, 'DEMO'));
  t(61, () => {
    const o = sim.addOccupant({ zone: 2, walkIn: true, act: 1, speed: 1.4 });
    sim.log('DEMO · another student walks into the dark back zone', 'sys', 2, 'DEMO');
  }, { cam: { mode: 'follow' } });
  t(66, () => sim.log('DEMO · Zone 3 → OCCUPIED instantly, loads energised', 'ok', 2, 'LOAD'), { flash: 'ok' });
  t(70, () => {
    sim.log('DEMO · now watch the meter: saved energy keeps climbing', 'ok', null, 'METER');
  }, { cam: { mode: 'overview', dur: 2.4 } });
  t(76, () => {
    sim.occupants.filter((o) => o.zone === 1).forEach((o) => sim.removeOccupant(o.id));
    sim.log('DEMO · Zone 2 empties → its own grace timer runs', 'warn', 1, 'TIMER');
  });
  t(84, () => sim.log('DEMO · Zone 2 shuts down · Zone 3 keeps running for the last student', 'dim', 1, 'LOAD'));
  t(90, () => {
    sim.log('DEMO · loop restarts', 'sys', null, 'DEMO');
  });
  return steps;
}

export function startDemo(sim) {
  sim.scriptHold = 4;
  sim.onResetForLoop = () => {
    sim.clearAll({ vanish: true });
    sim.zones.forEach((z) => (z.manual = 'AUTO'));
  };
  populateZone(sim, 1, 3, { act: 0.4 });
  sim.log('▶ DEMO MODE — hands-free presentation loop', 'sys', null, 'DEMO');
  sim.play(demoScript(sim), { loop: true, label: 'DEMO MODE' });
}

/* --------------------------------------------------------------------------
   Offline strategy benchmark. Deterministic arithmetic on a synthetic but
   realistic class schedule — used by the comparison panel. NOT a claim about
   real measured energy.
   ------------------------------------------------------------------------*/
export function runBenchmark({ periods = 8, activeSec = 240, stillSec = 600, gapSec = 660, offAfter = 15, warnAfter = 10, sensitivity = 0.75, power = null } = {}) {
  const per = power || LOADS.perZone.map((p) => p.totalW);
  const rand01 = seeded(4242);
  const out = STRATEGIES.map((st) => ({
    id: st.id,
    name: st.name,
    kwh: 0,
    onSec: 0,
    comfort: 0,
    falseOnSec: 0,
    zoneRows: per.map(() => ({ onSec: 0, kwh: 0, comfort: 0 })),
  }));
  const idx = { ALWAYS_ON: 0, PIR_ONLY: 1, MMWAVE_ONLY: 2, HYBRID: 3 };
  const totalSec = periods * (activeSec + stillSec + gapSec);

  for (let p = 0; p < periods; p++) {
    for (let z = 0; z < per.length; z++) {
      const jitter = 0.85 + rand01() * 0.3;
      const A = activeSec * jitter;
      const St = stillSec * jitter;
      const G = gapSec * jitter;
      const on = (row, sec) => {
        row.onSec += sec;
        row.kwh += (per[z] * sec) / 3600;
      };
      // ALWAYS ON — runs the whole period
      out[idx.ALWAYS_ON].zoneRows[z] && on(out[idx.ALWAYS_ON].zoneRows[z], A + St + G);
      // PIR ONLY — on during motion, then offDelay; stays off through stillness
      const pirOn = Math.min(A + offAfter, A + St);
      on(out[idx.PIR_ONLY].zoneRows[z], pirOn);
      if (A + offAfter < A + St) {
        out[idx.PIR_ONLY].comfort++;
        out[idx.PIR_ONLY].zoneRows[z].comfort++;
      }
      // MMWAVE ONLY — holds through stillness; clutter adds tail time when a fan
      // is left running or the radar is oversensitive
      const clutter = Math.max(0, (sensitivity - 0.55) * 2.2) * G * (0.35 + rand01() * 0.5);
      on(out[idx.MMWAVE_ONLY].zoneRows[z], A + St + offAfter + clutter);
      out[idx.MMWAVE_ONLY].falseOnSec += clutter;
      // HYBRID — union of both, releases offAfter after the last body leaves
      on(out[idx.HYBRID].zoneRows[z], A + St + offAfter);
    }
  }
  out.forEach((r) => {
    r.kwh = r.zoneRows.reduce((a, x) => a + x.kwh, 0);
    r.onSec = r.zoneRows.reduce((a, x) => a + x.onSec, 0);
    r.comfort = r.zoneRows.reduce((a, x) => a + x.comfort, 0);
    r.kwhPerHour = r.kwh / Math.max(1e-6, totalSec / 3600);
    r.falseOnSec = r.falseOnSec || 0;
  });
  const baseKwh = out[idx.ALWAYS_ON].kwh;
  out.forEach((r) => {
    r.cost = r.kwh * LOADS.tariff;
    r.savedPct = baseKwh > 0 ? Math.max(0, 1 - r.kwh / baseKwh) : 0;
  });
  out.baseKwh = baseKwh;
  out.totalSec = totalSec;
  out.hours = totalSec / 3600;
  return out;
}
