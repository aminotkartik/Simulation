/* ============================================================================
   Operator console. Everything here is real UI driving real state — no mock
   numbers. Panels are DOM (crisp text, cheap) over the WebGL classroom.
   ==========================================================================*/
import { ZONES, LIGHTS, FANS, SENSORS, SCENARIOS, STRATEGIES, LOADS, TIMING, ROOM, STATE_COLORS, TOTALS, zoneOf } from '../config.js';
import { clamp, lerp, el, esc, fmtNum, seeded } from '../core/utils.js';
import { runBenchmark } from '../sim/scenarios.js';

const ICON = {
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.5 1 .5 1.6h6c0-.6 0-1.2.5-1.6A6 6 0 0 0 12 3Z"/></svg>',
  fan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="2.2"/><path d="M12 9.8c1.6-4.2 6.4-5 7.4-2.4.8 2.3-2.4 4-7.4 2.4ZM14.2 12c4.2-1.6 5-6.4 2.4-7.4-2.3-.8-4 2.4-2.4 7.4ZM12 14.2c-1.6 4.2-6.4 5-7.4 2.4-.8-2.3 2.4-4 7.4-2.4ZM9.8 12c-4.2 1.6-5 6.4-2.4 7.4 2.3.8 4-2.4 2.4-7.4Z"/></svg>',
  radar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 20a8 8 0 0 0-8-8M12 20a8 8 0 0 1 8-8M12 20V12"/><circle cx="12" cy="20" r="1.4" fill="currentColor" stroke="none"/><path d="M7 9.5A6.5 6.5 0 0 1 17 9.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 2.6 8.4 4.7v9.4L12 21.4 3.6 16.7V7.3Z"/><path d="M3.6 7.3 12 12l8.4-4.7M12 12v9.4"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10-6.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.6"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.4 2 5 13.4h5.2L9.2 22 19 9.9h-5.4z"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20V4M4 20h16M8 17V11M12 17V7M16 17v-4"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.3M12 18.9v2.3M21.2 12h-2.3M5.1 12H2.8M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6M18.5 18.5l-1.6-1.6M7.1 7.1 5.5 5.5"/></svg>',
  walk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="13" cy="4.2" r="1.8"/><path d="m9 21 2.4-5.4L9.6 13l.6-4-3 2-1.4 3M12.6 9l3 2.4.8 3.4M15.6 11.4 18 14M11.4 15.6 14 21"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 8.5h11v9h-11z"/><path d="m14.5 12 5-3v9l-5-3"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>',
  flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 3h4M11 3v6L5.6 18.4A2 2 0 0 0 7.3 21.5h9.4a2 2 0 0 0 1.7-3.1L13 9V3"/></svg>',
};

const $ = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

function bar(cls = '') {
  const b = $('div', 'bar ' + cls);
  b.appendChild($('i'));
  return b;
}

export function createUI(sim, rig, ctl) {
  const root = document.getElementById('ui-root');
  root.innerHTML = '';

  /* ------------------------------------------------------------- topbar */
  const top = $('div', 'topbar');
  const brand = $('div', 'brand');
  brand.innerHTML = `<span class="mark"><svg viewBox="0 0 64 64" width="30" height="30"><path d="M32 6 L54 16 v17 c0 12.4-8.6 20.4-22 24.6C18.6 53.4 10 45.4 10 33V16z" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M35 19 L23 37h7.6l-2.2 11.6L40 30h-8z" fill="currentColor"/></svg></span>
    <span><b>ECOSWITCH</b><small>zone energy manager · room 204</small></span>`;
  top.appendChild(brand);

  const modeSeg = $('div', 'seg');
  const modeBtns = {};
  STRATEGIES.forEach((s) => {
    const b = $('button', null, s.name);
    b.title = s.desc;
    b.onclick = () => ctl.setMode(s.id);
    modeSeg.appendChild(b);
    modeBtns[s.id] = b;
  });
  top.appendChild(modeSeg);

  const clock = $('div', 'clock');
  clock.innerHTML = `<span class="day" id="ui-day">DAY 1</span><span id="ui-clock">08:00:00</span><span class="ts" id="ui-ts">×1.0</span>`;
  top.appendChild(clock);
  top.appendChild($('div', 'spacer'));

  const statusPill = $('div', 'pill');
  statusPill.dataset.s = 'STANDBY';
  statusPill.innerHTML = `<i></i><span id="ui-status">standby</span>`;
  top.appendChild(statusPill);

  const tb = (icon, title, fn) => {
    const b = $('button', 'iconbtn', ICON[icon] || title);
    b.title = title;
    b.onclick = fn;
    top.appendChild(b);
    return b;
  };
  const vizBtn = tb('eye', 'Sensor fields  (V)', () => ctl.toggleViz());
  const sysBtn = tb('cube', 'System view  (Y)', () => ctl.toggleSystem());
  const ovBtn = tb('grid', 'Plan overview  (O)', () => ctl.view('overview'));
  const homeBtn = tb('cam', 'Classroom overview  (R)', () => ctl.view('room'));
  const demoBtn = tb('play', 'Demo mode  (Space)', () => ctl.toggleDemo());
  const soundBtn = tb('bolt', 'Audio cues', () => ctl.toggleSound());
  const helpBtn = tb('help', 'Help  (H)', () => ctl.toggleHelp());

  /* -------------------------------------------------------- zone column */
  const left = $('div', 'panel left');
  const zcards = ZONES.map((z, i) => {
    const c = $('div', 'card zone');
    c.dataset.state = 'VACANT';
    c.innerHTML = `<div class="glow"></div>
      <div class="head"><span class="zid">${z.name}</span><span class="zlab">${z.label}</span><span class="state">VACANT</span></div>
      <div class="rows"></div>
      <div class="loads"></div>
      <div class="grace"><svg class="ring" viewBox="0 0 30 30"><circle class="bg" cx="15" cy="15" r="12"/><circle class="fg" cx="15" cy="15" r="12" stroke-dasharray="75.4" stroke-dashoffset="75.4"/></svg><span class="txt">grace <b>0.0s</b></span></div>
      <div class="zbtns"></div>`;
    const rows = c.querySelector('.rows');
    const mk = (k, cls) => {
      const r = $('div', 'srow');
      r.appendChild($('span', 'k', k));
      const b = bar(cls);
      r.appendChild(b);
      const v = $('span', 'v', '—');
      r.appendChild(v);
      rows.appendChild(r);
      return { bar: b.querySelector('i'), val: v, row: r };
    };
    const occ = mk('bodies');
    const pir = mk('PIR');
    const mm = mk('mmWave', 'calm');
    const lux = mk('light', '');
    const loads = c.querySelector('.loads');
    const loadBtn = (icon, label, sub, fn) => {
      const b = $('div', 'load');
      b.innerHTML = `<span class="ic">${ICON[icon]}</span><span class="tx">${label}<b>${sub}</b></span>`;
      b.onclick = (e) => {
        e.stopPropagation();
        fn();
      };
      b.title = 'Click to toggle manual override for this load';
      loads.appendChild(b);
      return b;
    };
    const lightChip = loadBtn('light', 'LIGHTS', `${LOADS.perZone[i].lightCount} × 22 W`, () => ctl.toggleZoneLights(i));
    const fanChip = loadBtn('fan', 'FANS', `${LOADS.perZone[i].fanCount} × 72 W`, () => ctl.toggleZoneFans(i));
    fanChip.querySelector('.ic').classList.add('fanwrap');
    const blades = fanChip.querySelector('svg');
    const grace = c.querySelector('.grace');
    const ring = c.querySelector('.ring .fg');
    const gtxt = c.querySelector('.grace .txt b');
    const btns = c.querySelector('.zbtns');
    const mb = (label, fn, cls = '') => {
      const b = $('button', 'mini ' + cls, label);
      b.onclick = (e) => {
        e.stopPropagation();
        fn();
      };
      btns.appendChild(b);
      return b;
    };
    const bForceOn = mb('force on', () => ctl.setManual(i, sim.zones[i].manual === 'ON' ? 'AUTO' : 'ON'));
    const bForceOff = mb('force off', () => ctl.setManual(i, sim.zones[i].manual === 'OFF' ? 'AUTO' : 'OFF'));
    const bFault = mb('sensor fault', () => ctl.toggleZoneFault(i), 'danger');
    c.onclick = () => ctl.focusZone(i);
    return { z, c, state: c.querySelector('.state'), occ, pir, mm, lux, lightChip, fanChip, blades, grace, ring, gtxt, bForceOn, bForceOff, bFault, i };
  });
  const sysCard = $('div', 'card');
  sysCard.innerHTML = `<h4>SENSOR HEALTH <span class="r" id="ui-health">nominal</span></h4><div class="sh"></div>`;
  const sh = sysCard.querySelector('.sh');
  const healthRows = {};
  SENSORS.forEach((s) => {
    const r = $('div', 'srow');
    r.innerHTML = `<span class="k">${s.kind === 'pir' ? 'PIR' : 'mmW'} ${ZONES[s.zone].tag}</span>`;
    const b = bar('calm');
    r.appendChild(b);
    const v = $('span', 'v', '100%');
    r.appendChild(v);
    r.style.cursor = 'pointer';
    r.onclick = () => ctl.toggleSensor(s.id);
    r.title = 'Toggle this sensor online / offline';
    sh.appendChild(r);
    healthRows[s.id] = { bar: b.querySelector('i'), val: v, row: r };
  });
  left.appendChild(sysCard);
  zcards.forEach((c) => left.appendChild(c.c));

  /* ------------------------------------------------------- right column */
  const right = $('div', 'panel right');
  const tabs = $('div', 'tabs');
  const panes = {};
  const tabBtns = {};
  [
    ['energy', 'chart', 'ENERGY'],
    ['log', 'list', 'LOG'],
    ['run', 'flask', 'SCENARIOS'],
    ['cmp', 'bolt', 'COMPARE'],
    ['set', 'gear', 'SETUP'],
  ].forEach(([id, icon, label]) => {
    const b = $('button', null, `${ICON[icon]}<span style="margin-left:5px">${label}</span>`);
    b.style.flexDirection = 'column';
    b.style.gap = '3px';
    b.onclick = () => setTab(id);
    tabs.appendChild(b);
    tabBtns[id] = b;
    const p = $('div', 'tabpane');
    p.dataset.tab = id;
    panes[id] = p;
  });
  function setTab(id) {
    for (const k in tabBtns) tabBtns[k].classList.toggle('act', k === id);
    for (const k in panes) panes[k].classList.toggle('on', k === id);
  }
  const rightBody = $('div', 'scrolly');
  Object.values(panes).forEach((p) => rightBody.appendChild(p));
  right.appendChild(tabs);
  right.appendChild(rightBody);

  /* ---- energy pane ---- */
  const enCard = $('div', 'card');
  enCard.innerHTML = `<h4>LIVE ENERGY SIMULATION <span class="r" id="ui-strat">HYBRID</span></h4>
    <div class="kpi">
      <div><span>active load</span><b id="ui-load">0<em>W</em></b></div>
      <div><span>active zones</span><b id="ui-az">0<em>/3</em></b></div>
      <div><span>energy used</span><b id="ui-kwh">0.000<em>Wh</em></b></div>
      <div class="good"><span>energy saved</span><b id="ui-saved">0.0<em>%</em></b></div>
    </div>
    <canvas class="spark" width="620" height="124"></canvas>
    <div class="zbars"></div>
    <div class="kpi" style="margin-top:10px">
      <div><span>occupancy events</span><b id="ui-c1">0</b></div>
      <div><span>load switches</span><b id="ui-c2">0</b></div>
      <div><span>grace → shutdown</span><b id="ui-c3">0</b></div>
      <div><span>comfort incidents</span><b id="ui-c4">0</b></div>
    </div>`;
  const zb = enCard.querySelector('.zbars');
  const zrows = ZONES.map((z, i) => {
    const r = $('div', 'zbar');
    r.innerHTML = `<span class="t">${z.tag}</span><span class="b"><i class="l"></i><i class="f"></i></span><span class="w">0 W</span>`;
    zb.appendChild(r);
    return { l: r.querySelector('.l'), f: r.querySelector('.f'), w: r.querySelector('.w') };
  });
  const spark = enCard.querySelector('.spark');
  const sctx = spark.getContext('2d');
  const enMeta = $('div', 'card');
  enMeta.innerHTML = `<h4>SESSION TOTALS <span class="r" id="ui-simhrs">0.0 h</span></h4>
    <div class="kpi">
      <div><span>cost avoided</span><b id="ui-cost">₹0.00</b></div>
      <div><span>CO₂ avoided</span><b id="ui-co2">0<em>g</em></b></div>
      <div><span>switches</span><b id="ui-sw">0</b></div>
      <div><span>peak load</span><b id="ui-peak">0<em>W</em></b></div>
    </div>`;
  panes.energy.append(enCard, enMeta, (() => {
    const c = $('div', 'card');
    c.innerHTML = `<h4>METER NOTES</h4><p style="font-size:10px;line-height:1.65;color:rgba(240,226,200,.62);margin:0">
      Energy is <b style="color:#ffd9a2">computed</b> from configured lamp / fan ratings × measured on-time in this simulation.
      No electrical measurement is being performed. The reference case is every load in all three zones running continuously.</p>
      <div class="zbtns" style="display:flex;gap:6px;margin-top:10px"><button class="mini" id="ui-resetE">reset counters</button><button class="mini" id="ui-resetT">reset time</button></div>`;
    c.querySelector('#ui-resetE').onclick = () => ctl.resetEnergy();
    c.querySelector('#ui-resetT').onclick = () => ctl.resetTime();
    return c;
  })());

  /* ---- log pane ---- */
  const logCard = $('div', 'card');
  logCard.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0';
  logCard.innerHTML = `<h4>EVENT LOG <span class="r"><span id="ui-evcount">0</span> entries</span></h4><div class="log"></div>
    <div style="display:flex;gap:6px;margin-top:9px"><button class="mini" id="ui-pause">pause</button><button class="mini" id="ui-clear">clear</button></div>`;
  const logBox = logCard.querySelector('.log');
  panes.log.appendChild(logCard);

  /* ---- scenario pane ---- */
  const scnHead = $('div', 'card');
  scnHead.innerHTML = `<h4>DEMONSTRATION LIBRARY</h4>`;
  const demo = $('button', 'cta', `${ICON.play}<span>DEMO MODE — full EcoSwitch cycle</span>`);
  demo.onclick = () => ctl.toggleDemo();
  scnHead.appendChild(demo);
  const scnList = $('div', 'card scn');
  const scnBtns = {};
  SCENARIOS.forEach((s) => {
    const b = $('button');
    b.innerHTML = `<span class="n">${String(s.id).padStart(2, '0')} · ${s.name}</span><span class="k">${s.short}</span><span class="d">${s.desc}</span>`;
    b.onclick = () => ctl.runScenario(s.id);
    scnList.appendChild(b);
    scnBtns[s.id] = b;
  });
  panes.run.append(scnHead, scnList);

  /* ---- compare pane ---- */
  const cmpLive = $('div', 'card');
  cmpLive.innerHTML = `<h4>LIVE RACE — SAME OCCUPANCY, 4 STRATEGIES <span class="r" id="ui-race-h">since reset</span></h4><div class="cmp" id="cmp-live"></div>
    <p class="note" style="margin:9px 0 0;font-size:9.5px;line-height:1.5;color:rgba(233,214,180,.55)">Three shadow controllers replay the identical sensor signals with their own logic, so the bars are directly comparable to what the room is doing.</p>`;
  const liveRows = {};
  const cmpLiveBox = cmpLive.querySelector('#cmp-live');
  STRATEGIES.forEach((s) => {
    const r = $('div', 'r');
    r.innerHTML = `<span class="nm">${s.name}</span><span class="bb"><i style="background:linear-gradient(90deg,#7d5a2a,#e6a341)"></i><em>—</em></span><span class="pc">—</span>`;
    cmpLiveBox.appendChild(r);
    liveRows[s.id] = { bar: r.querySelector('i'), em: r.querySelector('em'), pc: r.querySelector('.pc'), row: r };
  });
  const cmpRun = $('div', 'card');
  cmpRun.innerHTML = `<h4>SCHEDULE STUDY — ONE SCHOOL DAY <span class="r" id="cmp-hours">—</span></h4>
    <div class="cmp" id="cmp-day"></div>
    <div style="display:flex;gap:6px;margin-top:11px">
      <button class="mini" id="cmp-go" style="flex:2">run day simulation</button>
      <button class="mini" id="cmp-apply" style="flex:1">apply best</button>
    </div>
    <p class="note" id="cmp-note" style="margin-top:9px">Models 8 teaching periods across the three zones with motion, stillness and vacancy gaps.</p>`;
  const dayBox = cmpRun.querySelector('#cmp-day');
  const dayRows = {};
  STRATEGIES.forEach((s) => {
    const r = $('div', 'r');
    r.innerHTML = `<span class="nm">${s.name}</span><span class="bb"><i></i><em>—</em></span><span class="pc">—</span>`;
    dayBox.appendChild(r);
    dayRows[s.id] = { bar: r.querySelector('i'), em: r.querySelector('em'), pc: r.querySelector('.pc'), row: r };
  });
  cmpRun.querySelector('#cmp-go').onclick = () => runDay();
  cmpRun.querySelector('#cmp-apply').onclick = () => ctl.setMode('HYBRID');
  function runDay() {
    const res = runBenchmark({ sensitivity: sim.sensitivity, offAfter: sim.offAfter, warnAfter: sim.warnAfter, periods: +cmpPeriods.value });
    const max = Math.max(...res.map((r) => r.kwh), 1e-6);
    res.forEach((r) => {
      const d = dayRows[r.id];
      d.bar.style.width = (r.kwh / max) * 100 + '%';
      d.bar.style.background = r.id === 'HYBRID' ? 'linear-gradient(90deg,#4d7f57,#8ec7a0)' : r.id === 'ALWAYS_ON' ? 'linear-gradient(90deg,#5a5148,#8b8275)' : r.id === 'PIR_ONLY' ? 'linear-gradient(90deg,#8a3a26,#d9552f)' : 'linear-gradient(90deg,#8a5f22,#e6a341)';
      d.em.textContent = `${r.kwh.toFixed(2)} kWh`;
      d.pc.textContent = r.id === 'ALWAYS_ON' ? 'baseline' : `−${(r.savedPct * 100).toFixed(0)}%`;
      d.pc.style.color = r.id === 'HYBRID' ? '#b8e6c4' : r.id === 'PIR_ONLY' ? '#ffb0a2' : '';
      d.row.classList.toggle('win', r.id === 'HYBRID');
    });
    cmpRun.querySelector('#cmp-hours').textContent = (res.hours || 0).toFixed(1) + ' h compressed';
    cmpRun.querySelector('#cmp-note').innerHTML =
      `Comfort complaints (lights off while someone is still seated): <b>PIR ${res[1].comfort}</b> · mmWave ${res[2].comfort} · hybrid ${res[3].comfort}. ` +
      `Radar-only also carries <b>${Math.round(res[2].falseOnSec)} s</b> of fan-clutter false ON at sensitivity ${sim.sensitivity.toFixed(2)}.` +
      `<br>Baseline ${res.baseKwh.toFixed(2)} kWh → EcoSwitch ${res[3].kwh.toFixed(2)} kWh (<b>₹${(res.baseKwh - res[3].kwh).toFixed(2) * 0 + ((res.baseKwh - res[3].kwh) * LOADS.tariff).toFixed(2)}</b> avoided per day).`;
    if (ctl.toast) ctl.toast('Day study complete — hybrid saves ' + Math.round(res[3].savedPct * 100) + '% vs always-on', 'ok');
  }
  const cmpPeriods = $('input');
  cmpPeriods.type = 'range';
  cmpPeriods.min = 2;
  cmpPeriods.max = 12;
  cmpPeriods.value = 8;
  cmpPeriods.step = 1;
  cmpPeriods.oninput = () => runDay();
  const prCtl = $('div', 'ctl');
  prCtl.innerHTML = `<label>periods in schedule<b>${cmpPeriods.value}</b></label>`;
  prCtl.appendChild(cmpPeriods);
  cmpRun.appendChild(prCtl);
  cmpPeriods.addEventListener('input', () => (prCtl.querySelector('b').textContent = cmpPeriods.value));
  panes.cmp.append(cmpLive, cmpRun);

  /* ---- settings pane ---- */
  const setTiming = $('div', 'card');
  setTiming.innerHTML = `<h4>TIMING — ACCELERATED FOR DEMONSTRATION</h4>`;
  const mkCtl = (parent, label, min, max, step, val, fmt, onInput) => {
    const c = $('div', 'ctl');
    const l = $('label', null, `${label}<b>${fmt(val)}</b>`);
    const i = $('input');
    i.type = 'range';
    i.min = min;
    i.max = max;
    i.step = step;
    i.value = val;
    i.oninput = () => {
      l.querySelector('b').textContent = fmt(+i.value);
      onInput(+i.value);
    };
    c.appendChild(l);
    c.appendChild(i);
    parent.appendChild(c);
    return i;
  };
  const warn = mkCtl(setTiming, 'inactivity warning', 4, 60, 1, sim.warnAfter, (v) => v + ' s', (v) => sim.setTiming({ warn: v }));
  const off = mkCtl(setTiming, 'shutdown delay', 6, 120, 1, sim.offAfter, (v) => v + ' s', (v) => sim.setTiming({ off: v }));
  const ts = mkCtl(setTiming, 'simulated time scale', 0.5, 6, 0.1, sim.timeScale, (v) => '×' + v.toFixed(1), (v) => sim.setTiming({ timeScale: v }));
  const quick = $('div', 'toggles');
  [['FAST 5/8', 5, 8], ['DEFAULT 10/15', 10, 15], ['CLASS 30/60', 30, 60]].forEach(([n, w, o]) => {
    const b = $('button', 'mini', n);
    b.onclick = () => {
      sim.setTiming({ warn: w, off: o });
      warn.value = w;
      off.value = o;
      warn.oninput();
      off.oninput();
    };
    quick.appendChild(b);
  });
  setTiming.appendChild(quick);

  const setSense = $('div', 'card');
  setSense.innerHTML = `<h4>SENSOR TUNING</h4>`;
  const sens = mkCtl(setSense, 'mmWave sensitivity', 0.05, 1, 0.01, sim.sensitivity, (v) => v.toFixed(2), (v) => (sim.sensitivity = v));
  mkCtl(setSense, 'radar range gate', 0.3, 2.4, 0.05, sim.rangeGate, (v) => v.toFixed(2) + ' m', (v) => (sim.rangeGate = v));
  mkCtl(setSense, 'fan clutter coupling', 0, 1, 0.01, sim.clutter, (v) => v.toFixed(2), (v) => (sim.clutter = v));
  mkCtl(setSense, 'radar noise', 0, 1, 0.01, sim.noise, (v) => v.toFixed(2), (v) => (sim.noise = v));
  mkCtl(setSense, 'PIR gain', 0.3, 1.6, 0.01, sim.pirGain, (v) => v.toFixed(2), (v) => (sim.pirGain = v));
  mkCtl(setSense, 'PIR hold', 0.4, 6, 0.1, sim.pirHold, (v) => v.toFixed(1) + ' s', (v) => (sim.pirHold = v));
  mkCtl(setSense, 'on-filter (de-glitch)', 0, 3, 0.05, sim.confirmOn, (v) => v.toFixed(2) + ' s', (v) => (sim.confirmOn = v));
  const faultAll = $('div', 'toggles');
  const fb1 = $('button', 'mini', 'all sensors online');
  fb1.onclick = () => ctl.allSensorsOnline();
  const fb2 = $('button', 'mini', 'kill all mmWave');
  fb2.onclick = () => SENSORS.filter((s) => s.kind === 'mmwave').forEach((s) => sim.setSensorEnabled(s.id, false));
  faultAll.append(fb1, fb2);
  setSense.appendChild(faultAll);

  const setEnv = $('div', 'card');
  setEnv.innerHTML = `<h4>ENVIRONMENT & RENDERING</h4>`;
  mkCtl(setEnv, 'time of day', 6.5, 19, 0.1, sim.timeOfDay, (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`, (v) => (sim.timeOfDay = v));
  mkCtl(setEnv, 'daylight strength', 0, 1.4, 0.01, sim.daylight, (v) => (v * 100).toFixed(0) + '%', (v) => (sim.daylight = v));
  mkCtl(setEnv, 'breeze (curtains)', 0, 1, 0.01, sim.breeze, (v) => (v * 100).toFixed(0) + '%', (v) => (sim.breeze = v));
  mkCtl(setEnv, 'exposure', 0.5, 1.8, 0.01, 1.02, (v) => v.toFixed(2), (v) => ctl.setExposure(v));
  const tgBox = $('div', 'toggles');
  const mkTg = (label, val, fn) => {
    const b = $('button', 'tg' + (val ? ' on' : ''), `<i></i>${label}`);
    b.onclick = () => {
      b.classList.toggle('on');
      fn(b.classList.contains('on'));
    };
    tgBox.appendChild(b);
    return b;
  };
  mkTg('shadows', true, (v) => ctl.setQuality('shadows', v));
  mkTg('bloom', true, (v) => ctl.setQuality('bloom', v));
  mkTg('dust motes', true, (v) => ctl.setQuality('dust', v));
  mkTg('zone tags', false, (v) => ctl.setQuality('tags', v));
  mkTg('auto-dim idle', false, (v) => ctl.setQuality('autodim', v));
  mkTg('people drift', true, (v) => ctl.setQuality('drift', v));
  setEnv.appendChild(tgBox);
  panes.set.append(setTiming, setSense, setEnv);

  rightBody.appendChild($('div'));
  setTab('energy');

  /* --------------------------------------------------------- bottom dock */
  const dock = $('div', 'dock');
  const g1 = $('div', 'grp');
  const camBtns = {};
  [
    ['room', 'cam', 'CLASSROOM'],
    ['fp', 'walk', 'WALK'],
    ['overview', 'grid', 'PLAN'],
    ['bench', 'flask', 'BENCH'],
  ].forEach(([m, ic, label]) => {
    const b = $('button', null, `${ICON[ic]}<span>${label}</span>`);
    b.onclick = () => ctl.view(m);
    g1.appendChild(b);
    camBtns[m] = b;
  });
  const g2 = $('div', 'grp');
  const leg = $('div', 'legend');
  leg.innerHTML = Object.entries({ OCCUPIED: STATE_COLORS.OCCUPIED, GRACE: STATE_COLORS.GRACE, VACANT: STATE_COLORS.VACANT, MANUAL: STATE_COLORS.MANUAL, FAULT: STATE_COLORS.FAULT })
    .map(([k, v]) => `<span><i style="background:${v};box-shadow:0 0 9px ${v}"></i>${k}</span>`)
    .join('');
  const hint = $('div', 'hint', `<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> zones · <kbd>V</kbd> fields · <kbd>O</kbd> plan · <kbd>Y</kbd> system · <kbd>Space</kbd> demo · <kbd>H</kbd> help`);

  /* ------------------------------------------------------- hover tooltip */
  const hover = $('div', 'pill');
  hover.style.cssText = 'position:absolute;left:0;top:0;opacity:0;transition:opacity .18s;pointer-events:none;white-space:nowrap;z-index:25;font-size:9.5px';
  hover.innerHTML = `<i></i><span></span>`;

  /* ------------------------------------------------------- info card */
  const info = $('div', 'infocard');
  info.innerHTML = `<div class="card"><button class="x">×</button><div class="t"><i></i><span class="ti">—</span></div><div class="sub">—</div><dl></dl><p class="role"></p><div class="act"></div></div>`;
  info.querySelector('.x').onclick = () => hideInfo();

  /* ------------------------------------------------------- toasts */
  const toasts = $('div', 'toasts');
  function toast(msg, kind = '') {
    const t = $('div', 'toast ' + kind, `<i></i><span>${esc(msg)}</span>`);
    toasts.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 420);
    }, kind === 'bad' ? 4200 : 2900);
    while (toasts.children.length > 3) toasts.firstChild.remove();
  }

  /* --------------------------------------------------------- intro card */
  const intro = $('div', 'intro');
  intro.innerHTML = `<div class="veil"></div><div class="wrap">
      <h1>ECO<b>SWITCH</b></h1>
      <p>intelligent zone-based classroom energy management</p>
      <div class="l3"><span>PIR + 24 GHz mmWave</span><span>3 independent zones</span><span>ESP32-S3 · MOSFET · 5 V demo loads</span></div>
      <div class="skip"><button class="cta" style="width:auto;padding:10px 22px">${ICON.play}<span>ENTER THE ROOM</span></button></div>
    </div>`;
  const skipBtn = intro.querySelector('button');
  skipBtn.onclick = () => ctl.skipIntro();

  /* ------------------------------------------------------------- help */
  const scrim = $('div', 'scrim');
  const sheet = $('div', 'sheet');
  sheet.innerHTML = `<div class="card">
    <h2>HOW TO <b>DRIVE</b> THE SIMULATION</h2>
    <p class="lede">EcoSwitch splits one real classroom into three open occupancy zones. Each zone owns two LED panels and one or two ceiling fans, and each zone runs its own state machine: presence is immediate ON, both sensors clear starts a grace period, and only when the timer expires do the loads drop. Move through the room, click anything, and watch the middle zone stay dark while its neighbours are lit.</p>
    <div class="keys">
      <div><kbd>drag</kbd> orbit · <kbd>scroll</kbd> zoom</div>
      <div><kbd>W A S D</kbd> walk · <kbd>drag</kbd> look · <kbd>tap floor</kbd> to walk there</div>
      <div><kbd>Shift</kbd> hurry</div>
      <div><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> focus zone</div>
      <div><kbd>V</kbd> sensor fields</div>
      <div><kbd>O</kbd> plan overview</div>
      <div><kbd>Y</kbd> system view</div>
      <div><kbd>B</kbd> prototype bench</div>
      <div><kbd>Space</kbd> demo mode</div>
      <div><kbd>E</kbd> cycle sensing mode</div>
      <div><kbd>F</kbd> force zone 1 ON</div>
      <div><kbd>R</kbd> back to classroom</div>
      <div><kbd>G</kbd> grace timing preset</div>
      <div><kbd>H</kbd> this panel</div>
    </div>
    <p class="foot">Simulated behaviour, not measured data: the sensing model, load ratings and energy figures are logical approximations of a PIR + 24 GHz mmWave hybrid controller driving low-side MOSFET switches and 5 V DC demo motors. The prototype never connects a load to an ESP32 GPIO.</p>
    <div style="text-align:right;margin-top:14px"><button class="cta" style="width:auto;padding:9px 18px" id="help-close">CLOSE</button></div></div>`;
  sheet.querySelector('#help-close').onclick = () => ctl.toggleHelp(false);
  scrim.onclick = () => ctl.toggleHelp(false);

  const reticle = $('div', 'reticle');
  const flash = $('div', 'flash');
  root.append(top, left, right, dock, info, toasts, intro, hint, hover, scrim, sheet, reticle, flash);
  function screenFlash(kind = 'ok') {
    flash.dataset.k = kind;
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
  }
  g2.appendChild(leg);
  dock.append(g1, g2);

  /* ----------------------------------------------------------- wiring */
  const api = {
    top, left, right, dock, info, toast, intro, skipBtn, demo, scnBtns, zcards, camBtns, modeBtns,
    vizBtn, sysBtn, ovBtn, helpBtn, soundBtn, statusPill, hint, hover, sheet, scrim, tabs, setTab,
    liveRows, logBox, spark, sctx, enRefs: {
      load: enCard.querySelector('#ui-load'),
      az: enCard.querySelector('#ui-az'),
      kwh: enCard.querySelector('#ui-kwh'),
      saved: enCard.querySelector('#ui-saved'),
      strat: enCard.querySelector('#ui-strat'),
      simhrs: enMeta.querySelector('#ui-simhrs'),
      cost: enMeta.querySelector('#ui-cost'),
      co2: enMeta.querySelector('#ui-co2'),
      sw: enMeta.querySelector('#ui-sw'),
      peak: enMeta.querySelector('#ui-peak'),
      c1: enCard.querySelector('#ui-c1'),
      c2: enCard.querySelector('#ui-c2'),
      c3: enCard.querySelector('#ui-c3'),
      c4: enCard.querySelector('#ui-c4'),
      evcount: logCard.querySelector('#ui-evcount'),
      clock: clock.querySelector('#ui-clock'),
      ts: clock.querySelector('#ui-ts'),
      status: clock.querySelector('#ui-status'),
      day: clock.querySelector('#ui-day'),
      health: sysCard.querySelector('#ui-health'),
    },
    zrows, healthRows, logPaused: false, samples: [], sampleAcc: 0,
    reticle,
    flash: screenFlash,
    setLogPaused(v) {
      api.logPaused = v;
      logCard.querySelector('#ui-pause').textContent = v ? 'resume' : 'pause';
      logCard.querySelector('#ui-pause').classList.toggle('act', v);
    },
  };
  logCard.querySelector('#ui-pause').onclick = () => api.setLogPaused(!api.logPaused);
  logCard.querySelector('#ui-clear').onclick = () => {
    logBox.innerHTML = '';
    sim.events.length = 0;
    api.enRefs.evcount.textContent = '0';
  };
  api.runDay = runDay;
  try {
    runDay();
  } catch (e) {
    console.warn('day study warm-up failed', e);
  }
  return api;
}

/* ---------------------------------------------------------- render pass */
export function attachUIHandlers(app, sim, ctl) {
  /* event log */
  sim.onEvent = (e) => {
    if (app.logPaused) return;
    const n = document.createElement('div');
    n.className = 'ev';
    n.dataset.k = e.kind;
    n.innerHTML = `<time>${e.label.slice(0, 8)}</time><i></i><p>${e.tag ? `<b>${e.tag}</b> · ` : ''}${esc(e.msg)}</p>`;
    app.logBox.prepend(n);
    while (app.logBox.children.length > 90) app.logBox.lastChild.remove();
    app.enRefs.evcount.textContent = sim.events.length;
  };
}

export function updateUI(app, sim, env, dt) {
  const R = app.enRefs;
  R.clock.textContent = sim.clockLabel();
  R.day.textContent = 'DAY ' + (1 + Math.floor(sim.time / 3600));
  R.ts.textContent = '×' + sim.timeScale.toFixed(1);
  R.status.textContent = sim.status.toLowerCase();
  app.statusPill.dataset.s = sim.status === 'MANUAL OVERRIDE' ? 'MANUAL OVERRIDE' : sim.status.startsWith('BASELINE') ? 'STANDBY' : sim.status;
  for (const s of STRATEGIES) app.modeBtns[s.id].classList.toggle('act', sim.mode === s.id);
  R.strat.textContent = sim.mode.replace('_', ' ');

  // zone cards
  app.zcards.forEach((c) => {
    const z = sim.zones[c.i];
    const shown = z.fault ? 'FAULT' : z.manual !== 'AUTO' ? 'MANUAL' : z.state;
    if (c.c.dataset.state !== shown) {
      c.c.dataset.state = shown;
      c.state.textContent = shown === 'MANUAL' ? (z.manual === 'ON' ? 'MANUAL ON' : 'MANUAL OFF') : shown;
    }
    const loadPct = clamp((z.lightW * z.lightLevel + z.fanW * z.fanLevel) / (z.totalW || 1)) * 100;
    c.occ.bar.style.width = clamp(z.occupants / 8) * 100 + '%';
    c.occ.val.textContent = `${z.occupants}/${8}`;
    const pirSensor = sim.sensors.find((s) => s.id === 'pir' + c.i);
    const mmSensor = sim.sensors.find((s) => s.id === 'mm' + c.i);
    c.pir.bar.style.width = (z.pirSeen ? 100 : z.occupants ? 14 : 0) + '%';
    c.pir.val.textContent = pirSensor.enabled ? (z.pirSeen ? 'MOTION' : 'clear') : 'FAULT';
    c.pir.row.children[1].className = 'bar' + (pirSensor.enabled ? (z.pirSeen ? '' : ' idle') : ' fault');
    c.mm.bar.style.width = (z.mmSeen ? 100 : 0) + '%';
    c.mm.val.textContent = mmSensor.enabled ? (z.mmSeen ? 'PRESENT' : 'clear') : 'FAULT';
    c.mm.row.children[1].className = 'bar' + (mmSensor.enabled ? ' calm' : ' fault');
    c.lux.bar.style.width = clamp(z.lux / 620) * 100 + '%';
    c.lux.val.textContent = z.lux + ' lx';
    const onL = z.lightLevel > 0.3;
    c.lightChip.classList.toggle('on', onL);
    c.lightChip.querySelector('b').textContent = onL ? `${Math.round(z.lightW * z.lightLevel)} W` : 'OFF';
    const onF = z.fanLevel > 0.3;
    c.fanChip.classList.toggle('on', onF);
    c.fanChip.querySelector('b').textContent = onF ? `${Math.round(z.fanW * z.fanLevel)} W` : 'OFF';
    c.blades.style.transform = `rotate(${onF ? (env.fanAngle || 0).toFixed(2) : 0}rad)`;
    c.blades.style.opacity = onF ? 1 : 0.55;
    const showG = z.state === 'GRACE';
    c.grace.classList.toggle('show', showG);
    if (showG) {
      const k = clamp(1 - z.countdown / Math.max(0.001, sim.offAfter));
      c.ring.style.strokeDashoffset = 75.4 * (1 - k);
      c.gtxt.textContent = z.countdown.toFixed(1) + 's';
      c.ring.style.stroke = z.countdown < sim.offAfter - sim.warnAfter ? '#e07b39' : '#ffd9a2';
    }
    c.bForceOn.classList.toggle('act', z.manual === 'ON');
    c.bForceOff.classList.toggle('act', z.manual === 'OFF');
    c.bFault.classList.toggle('act', !pirSensor.enabled || !mmSensor.enabled);
    c.c.classList.toggle('sel', env.selectedZone === c.i);
  });

  // sensor health
  let healthy = 0;
  sim.sensors.forEach((s) => {
    const h = app.healthRows[s.id];
    const on = s.enabled;
    healthy += on ? 1 : 0;
    h.bar.style.width = (on ? (s.presence ? 100 : 62) : 8) + '%';
    h.val.textContent = on ? (s.presence ? 'TRIG' : 'ready') : 'OFFLINE';
    h.row.children[1].className = 'bar ' + (!on ? 'fault' : s.presence ? '' : 'calm');
  });
  R.health.textContent = healthy === sim.sensors.length ? `${healthy}/${sim.sensors.length} nominal` : `${healthy}/${sim.sensors.length} · degraded`;
  R.health.style.color = healthy === sim.sensors.length ? '#b8e6c4' : '#ffb884';

  // energy
  const nowW = sim.zones.reduce((a, z) => a + z.lightW * z.lightLevel + z.fanW * z.fanLevel, 0);
  R.load.innerHTML = `${Math.round(nowW)}<em>W</em>`;
  const az = sim.zones.filter((z) => z.lightLevel > 0.3 || z.fanLevel > 0.3).length;
  R.az.innerHTML = `${az}<em>/3</em>`;
  R.kwh.innerHTML = `${(sim.energy.kwh * 1000).toFixed(1)}<em>Wh</em>`;
  R.saved.innerHTML = `${(sim.energy.savedPct * 100).toFixed(1)}<em>%</em>`;
  R.simhrs.textContent = (sim.time / 3600).toFixed(2) + ' h simulated';
  R.cost.textContent = '₹' + (sim.energy.saved * LOADS.tariff).toFixed(3);
  R.co2.innerHTML = `${(sim.energy.saved * LOADS.gridCO2 * 1000).toFixed(1)}<em>g</em>`;
  R.sw.textContent = sim.zones.reduce((a, z) => a + z.switchEvents, 0);
  R.peak.innerHTML = `${Math.round(Math.max(sim.energy.peakW, nowW))}<em>W</em>`;
  R.c1.textContent = sim.stats.occupiedEvents;
  R.c2.textContent = sim.zones.reduce((a, z) => a + z.switchEvents, 0);
  R.c3.textContent = sim.stats.shutdowns;
  R.c4.textContent = sim.stats.comfortIncidents;
  R.c4.style.color = sim.stats.comfortIncidents ? '#ffb884' : '#b8e6c4';
  sim.zones.forEach((z, i) => {
    const row = app.zrows[i];
    const maxW = Math.max(...LOADS.perZone.map((p) => p.totalW));
    row.l.style.width = (z.lightW * z.lightLevel / maxW) * 100 + '%';
    row.f.style.width = (z.fanW * z.fanLevel / maxW) * 100 + '%';
    row.w.textContent = Math.round(z.lightW * z.lightLevel + z.fanW * z.fanLevel) + ' W';
  });

  // sparkline
  app.sampleAcc += dt;
  if (app.sampleAcc > 0.12) {
    app.sampleAcc = 0;
    app.samples.push(nowW);
    if (app.samples.length > 155) app.samples.shift();
    drawSpark(app, sim);
  }

  // live strategy race
  const base = Math.max(1e-9, sim.shadow.ALWAYS_ON.kwh);
  STRATEGIES.forEach((s) => {
    const d = app.liveRows[s.id];
    const v = sim.shadow[s.id].kwh / base;
    d.bar.style.width = clamp(v) * 100 + '%';
    d.em.textContent = (sim.shadow[s.id].kwh * 1000).toFixed(1) + ' Wh';
    d.pc.textContent = s.id === 'ALWAYS_ON' ? 'baseline' : '−' + ((1 - v) * 100).toFixed(0) + '%';
    d.row.classList.toggle('win', s.id === sim.mode);
    d.bar.style.background =
      s.id === sim.mode ? 'linear-gradient(90deg,#4d7f57,#a8e0b4)' : s.id === 'ALWAYS_ON' ? 'linear-gradient(90deg,#5a5148,#8b8275)' : 'linear-gradient(90deg,#7d5a2a,#e6a341)';
  });

  // dock / camera state
  for (const k in app.camBtns) app.camBtns[k].classList.toggle('act', rigMode(app) === k);
  app.reticle.classList.toggle('on', rigMode(app) === 'fp');
  app.vizBtn.classList.toggle('act', !!env.viz);
  app.sysBtn.classList.toggle('act', !!env.systemOn);
  app.demo.classList.toggle('act', !!env.demoOn);
  app.demoBtn && app.demoBtn.classList.toggle('act', !!env.demoOn);
  app.soundBtn.classList.toggle('act', !!env.sound);
  app.ovBtn.classList.toggle('act', rigMode(app) === 'overview');
  Object.entries(app.scnBtns).forEach(([id, b]) => b.classList.toggle('act', sim.scenario && sim.scenario.startsWith('SCENARIO ' + id)));
}
function rigMode(app) {
  return app._mode || 'room';
}
export function setRigMode(app, m) {
  app._mode = m;
}

function drawSpark(app, sim) {
  const c = app.spark, x = app.sctx;
  const W = c.width, H = c.height;
  x.clearRect(0, 0, W, H);
  const maxW = LOADS.allOnW * 1.05;
  // grid
  x.strokeStyle = 'rgba(226,196,140,0.10)';
  x.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    x.beginPath();
    x.moveTo(0, (H / 4) * i);
    x.lineTo(W, (H / 4) * i);
    x.stroke();
  }
  // baseline (all on)
  x.strokeStyle = 'rgba(200,190,172,0.34)';
  x.setLineDash([4, 5]);
  x.beginPath();
  x.moveTo(0, H - (LOADS.allOnW / maxW) * H);
  x.lineTo(W, H - (LOADS.allOnW / maxW) * H);
  x.stroke();
  x.setLineDash([]);
  if (app.samples.length > 1) {
    const n = app.samples.length;
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(240,200,118,0.55)');
    g.addColorStop(1, 'rgba(240,200,118,0.03)');
    x.beginPath();
    app.samples.forEach((v, i) => {
      const px = (i / 154) * W,
        py = H - (v / maxW) * (H - 4) - 2;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    });
    x.strokeStyle = '#f0c876';
    x.lineWidth = 2;
    x.stroke();
    x.lineTo(((n - 1) / 154) * W, H);
    x.lineTo(0, H);
    x.closePath();
    x.fillStyle = g;
    x.fill();
  }
  x.fillStyle = 'rgba(233,214,180,0.4)';
  x.font = '500 15px "IBM Plex Mono", monospace';
  x.fillText('W · dashed line = every load ON', 8, 16);
}
