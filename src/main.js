/* ============================================================================
   EcoSwitch — entry point: renderer, world, camera rig, console, picking,
   audio, intro choreography and the frame loop.
   ==========================================================================*/
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { buildMaterials } from './world/materials.js';
import { buildClassroom } from './world/classroom.js';
import { buildFurniture } from './world/furniture.js';
import { buildFixtures } from './world/fixtures.js';
import { buildSensors, buildElectronics } from './world/hardware.js';
import { buildPeople } from './world/people.js';
import { buildEffects } from './world/effects.js';
import { buildSystemView } from './world/systemview.js';
import { buildLighting } from './world/lighting.js';
import { Simulation } from './sim/simulation.js';
import { applyScenario, startDemo, populateZone } from './sim/scenarios.js';
import { CameraRig } from './core/camera.js';
import { Picker } from './core/picking.js';
import { createUI, updateUI, attachUIHandlers, setRigMode } from './ui/panels.js';
import { clamp, lerp, damp, Ease, TAU } from './core/utils.js';
import { ZONES, ROOM, LIGHTS, FANS, SENSORS, LOADS, TIMING, TOTALS, STATE_COLORS, SCENARIOS, SEATS } from './config.js';

/* ------------------------------------------------------------------ safety
   If initialisation ever fails (blocked CDN font, missing extension, a driver
   that refuses post-processing) the boot curtain must still lift and say why,
   instead of leaving the viewer staring at a splash screen forever. */
function hardFail(where, err) {
  const b = document.getElementById('boot');
  if (b) b.classList.add('gone');
  const app = document.getElementById('app');
  if (app) app.classList.remove('cinema');
  if (document.getElementById('ui-root') && document.getElementById('ui-root').children.length) return;
  const n = document.createElement('div');
  n.id = 'fatal';
  n.style.cssText =
    'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:80;font:500 11.5px/1.6 "IBM Plex Mono",monospace;' +
    'color:#ffd9a2;background:rgba(30,20,13,.92);border:1px solid rgba(226,196,140,.34);border-radius:12px;padding:11px 16px;' +
    'box-shadow:0 18px 40px -18px rgba(0,0,0,.8);max-width:min(70vw,560px)';
  n.textContent = where + ' — ' + (err && err.message ? err.message : String(err || 'unknown')) + ' · reload to retry';
  (app || document.body).appendChild(n);
}
addEventListener('error', (e) => hardFail('EcoSwitch could not start', e.error || e.message));
setTimeout(() => {
  const b = document.getElementById('boot');
  if (b && !b.classList.contains('gone')) hardFail('EcoSwitch is slow to wake', 'still booting after 15 s');
}, 15000);

/* ------------------------------------------------------------------ audio */
class AudioKit {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.humGain = null;
    this.humOsc = [];
  }
  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    const master = this.ctx.createGain();
    master.gain.value = 0.5;
    master.connect(this.ctx.destination);
    this.master = master;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 240;
    g.connect(filt).connect(master);
    [58, 87, 116].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      const og = this.ctx.createGain();
      og.gain.value = [0.5, 0.28, 0.14][i];
      o.connect(og).connect(g);
      o.start();
      this.humOsc.push(o);
    });
    this.humGain = g;
    return this.ctx;
  }
  setEnabled(v) {
    this.on = v;
    if (v) {
      this.ensure();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    } else if (this.humGain) this.humGain.gain.value = 0;
  }
  hum(level) {
    if (!this.on || !this.humGain) return;
    this.humGain.gain.value = Math.min(0.05, level * 0.032);
    this.humOsc.forEach((o, i) => (o.frequency.value = [58, 87, 116][i] * (0.88 + level * 0.3)));
  }
  blip(freq = 880, dur = 0.07, type = 'square', vol = 0.12) {
    if (!this.on) return;
    const c = this.ensure();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(c.currentTime + dur + 0.02);
  }
  relay(up) {
    this.blip(up ? 320 : 250, 0.05, 'square', 0.1);
    setTimeout(() => this.blip(up ? 190 : 150, 0.045, 'triangle', 0.07), 34);
  }
  chirp(n = 2) {
    for (let i = 0; i < n; i++) setTimeout(() => this.blip(1620, 0.07, 'sine', 0.1), i * 120);
  }
  ui() {
    this.blip(1250, 0.02, 'triangle', 0.045);
  }
}

/* --------------------------------------------------------------- renderer */
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
} catch (err) {
  document.getElementById('boot').innerHTML =
    '<div class="boot-inner"><div class="boot-name">WEBGL UNAVAILABLE</div><div class="boot-sub">this simulation needs hardware 3D acceleration</div></div>';
  throw err;
}
const isCoarse = matchMedia('(pointer: coarse)').matches;
const smallScreen = Math.min(innerWidth, innerHeight) < 720;
const quality = {
  pixelRatio: isCoarse || smallScreen ? 1.15 : Math.min(devicePixelRatio || 1, 1.7),
  shadows: !smallScreen,
  bloom: !smallScreen,
  dust: true,
  tags: false,
  drift: true,
  autodim: false,
};
renderer.setPixelRatio(quality.pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = quality.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x0b0705, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc9b79c, 0.0058);
try {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();
} catch (e) {
  console.warn('environment probe unavailable — continuing without IBL', e);
}

buildMaterials(renderer);

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.05, 420);
camera.position.set(6.5, 2.3, 4.7);

const sim = new Simulation();
const rig = new CameraRig(camera, renderer.domElement, scene);
rig.onMode = (m) => {
  app._mode = m === 'fp' ? 'fp' : app._mode === 'fp' ? 'room' : app._mode;
  setRigMode(app, app._mode);
  document.body.classList.toggle('fps-ui', m === 'fp');
  if (m === 'fp') {
    app.hint.style.opacity = '1';
    app.hint.innerHTML =
      document.pointerLockElement
        ? '<kbd>W A S D</kbd> move · mouse looks · <kbd>Shift</kbd> hurry · <kbd>C</kbd> crouch · <kbd>Esc</kbd> releases the mouse'
        : '<kbd>W A S D</kbd> move · <kbd>drag</kbd> to look · <kbd>tap the floor</kbd> to walk there · <kbd>R</kbd> or the CLASSROOM button exits';
    clearTimeout(endIntro._t);
    endIntro._t = setTimeout(() => (app.hint.style.opacity = '0'), 9000);
  }
};
rig.orbit.enabled = false; // the intro owns the camera until it hands over

/* ------------------------------------------------------------ world build */
const room = buildClassroom();
scene.add(room.group);
const furniture = buildFurniture();
scene.add(furniture.group);
const fixtures = buildFixtures(scene);
scene.add(fixtures.group);
const sensorRig = buildSensors();
scene.add(sensorRig.group);
const elec = buildElectronics(sim);
scene.add(elec.group);
const people = buildPeople();
people.inst.torso.userData.pick = { kind: 'person', title: 'Occupant' };
scene.add(people.group);
const effects = buildEffects(sim);
scene.add(effects.group);
const lighting = buildLighting(scene, renderer);
const systemView = buildSystemView({ sim });
scene.add(systemView.group);

/* pickability: only objects that answer to the user keep raycasts; zone
   overlays are clickable so the floor itself can select a zone */
effects.zoneMeshes.forEach((z, i) => {
  z.mesh.userData.pick = { kind: 'zone', zone: i, title: ZONES[i].name };
});
const xrayMats = new Set();
scene.traverse((o) => {
  let p = o,
    has = false;
  while (p) {
    if (p.userData && p.userData.pick) {
      has = true;
      break;
    }
    p = p.parent;
  }
  if (!has && (o.isMesh || o.isPoints || o.isLine || o.isSprite)) o.raycast = () => {};
  const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
  mats.forEach((m) => {
    if (!m || m.isSpriteMaterial) return;
    if (m.userData && m.userData.xray === false) return;
    if (!m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial && !m.isMeshBasicMaterial) return;
    if (m.userData.__done) return;
    m.userData.__done = true;
    m.userData.__o = m.opacity;
    m.userData.__t = m.transparent;
    m.userData.__d = m.depthWrite;
    xrayMats.add(m);
  });
});
const pickRoots = [room.group, furniture.group, fixtures.group, sensorRig.group, elec.group, people.group, effects.group];

/* ------------------------------------------------------------- composer */
let composer = null,
  bloomPass = null;
try {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.33, 0.6, 0.86);
  bloomPass.enabled = quality.bloom;
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
} catch (e) {
  console.warn('post-processing unavailable, using direct rendering', e);
  composer = null;
  bloomPass = null;
}

const audio = new AudioKit();

/* ------------------------------------------------------------- env state */
const env = {
  clock: 0,
  daylight: 0.9,
  timeOfDay: 11.1,
  breeze: 0.35,
  doorOpen: 0,
  viz: 0,
  systemOn: false,
  demoOn: false,
  sound: false,
  selectedZone: null,
  pixelRatio: renderer.getPixelRatio(),
  fanAngle: 0,
  perf: false,
  nightBoost: 0,
  shadows: quality.shadows,
  chirp: 0,
  showTags: false,
  cameraPos: camera.position,
  dim: [1, 1, 1],
};

/* ------------------------------------------------------------------ UI */
const ctl = {};
const app = createUI(sim, rig, ctl);
document.getElementById('app').classList.add('cinema');
showConsoleNow(); // the console is interactive from frame one — the film only fades it back
if (document.hidden) setTimeout(() => endIntro(), 400); // opened in a background tab: skip the film

/* --------------------------------------------------------- ctl surface */
Object.assign(ctl, {
  vizOn: false,
  systemOn: false,
  demoOn: false,
  setMode(m) {
    sim.setMode(m);
    audio.ui();
    ctl.toast('Mode · ' + m.replace('_', ' '), 'ok');
  },
  view(mode, opts = {}) {
    if (mode === 'fp') {
      if (rig.mode === 'fp') {
        rig.setMode('room');
        app._mode = 'room';
        setRigMode(app, 'room');
        document.body.classList.remove('fps-ui');
        rig.view('room', { dur: 0.9 });
        return;
      }
      rig.setMode('fp');
      app._mode = 'fp';
      setRigMode(app, 'fp');
      document.body.classList.add('fps-ui');
      ctl.toast('Walk mode — W A S D to move, mouse to look, ESC to exit');
      return;
    }
    document.body.classList.remove('fps-ui');
    if (rig.mode === 'fp' && mode !== 'fp') rig.setMode('room');
    if (mode === 'zone') {
      env.selectedZone = opts.zone;
      rig.view('zone', opts);
      app._mode = 'room';
    } else {
      rig.view(mode, opts);
      app._mode = mode;
    }
    setRigMode(app, app._mode);
    if (mode === 'system') ctl.setSystem(true);
    else if (ctl.systemOn && mode !== 'system') ctl.setSystem(false);
    audio.ui();
  },
  toggleViz() {
    ctl.vizOn = !ctl.vizOn;
    effects.setViz(ctl.vizOn);
    app.vizBtn.classList.toggle('act', ctl.vizOn);
    ctl.toast(ctl.vizOn ? 'Sensor fields on — PIR wedges, radar cones, detection links' : 'Sensor fields off');
    audio.ui();
  },
  toggleSystem() {
    ctl.setSystem(!ctl.systemOn);
  },
  setSystem(v) {
    ctl.systemOn = v;
    env.systemOn = v;
    systemView.setOpen(v);
    app.sysBtn.classList.toggle('act', v);
    setXray(v ? 1 : 0, v ? 1 : 0.7);
    if (v) {
      effects.setViz(true);
      ctl.vizOn = true;
      app.vizBtn.classList.add('act');
      rig.view('system');
      app._mode = 'system';
    } else {
      effects.setViz(ctl.vizOn);
      if (app._mode === 'system') {
        rig.view('room');
        app._mode = 'room';
      }
    }
    setRigMode(app, app._mode || 'room');
    audio.ui();
  },
  runScenario(id) {
    ctl.demoOn = false;
    env.demoOn = false;
    app.demo.classList.remove('act');
    applyScenario(sim, id);
    hookScript();
    ctl.toast(SCENARIOS.find((s) => s.id === id).name, 'ok');
    if (id !== 8) ctl.view('overview', { dur: 1.1 });
  },
  toggleDemo() {
    if (ctl.demoOn) {
      ctl.demoOn = false;
      env.demoOn = false;
      sim.stopScript();
      ctl.toast('Demo mode stopped');
    } else {
      ctl.demoOn = true;
      env.demoOn = true;
      if (ctl.systemOn) ctl.setSystem(false);
      startDemo(sim);
      hookScript();
      ctl.view('room', { dur: 1.2 });
      ctl.toast('Demo mode running — no input needed', 'ok');
    }
    app.demo.classList.toggle('act', ctl.demoOn);
  },
  focusZone(i) {
    env.selectedZone = i;
    ctl.view('zone', { zone: i });
  },
  setManual(i, mode) {
    sim.setZoneManual(i, mode);
    audio.relay(mode === 'ON');
  },
  toggleZoneLights(i) {
    const z = sim.zones[i];
    const next = z.lightCmd === 'AUTO' ? 'ON' : z.lightCmd === 'ON' ? 'OFF' : 'AUTO';
    sim.setLoadCmd(i, 'lights', next);
    audio.relay(next === 'ON');
  },
  toggleZoneFans(i) {
    const z = sim.zones[i];
    const next = z.fanCmd === 'AUTO' ? 'ON' : z.fanCmd === 'ON' ? 'OFF' : 'AUTO';
    sim.setLoadCmd(i, 'fans', next);
    audio.relay(next === 'ON');
  },
  toggleZoneFault(i) {
    const anyOff = sim.sensors.some((x) => x.zone === i && !x.enabled);
    sim.sensors.filter((x) => x.zone === i).forEach((x) => sim.setSensorEnabled(x.id, anyOff));
  },
  toggleSensor(id) {
    const s = sim.sensors.find((x) => x.id === id);
    sim.setSensorEnabled(id, !s.enabled);
    audio.blip(s.enabled ? 760 : 210, 0.08, 'square', 0.1);
  },
  allSensorsOnline() {
    sim.sensors.forEach((s) => sim.setSensorEnabled(s.id, true));
    ctl.toast('All sensor modules online', 'ok');
  },
  addPerson(zone) {
    const o = sim.addOccupant({ zone, walkIn: true, act: 1, speed: 1.35 });
    if (!o) ctl.toast(ZONES[zone].name + ' is fully seated', 'warn');
  },
  clearZone(zone) {
    sim.clearZone(zone);
    sim.log(ZONES[zone].name + ' asked to vacate', 'sys', zone, ZONES[zone].tag);
  },
  resetEnergy() {
    sim.resetEnergy();
    app.samples.length = 0;
  },
  resetTime() {
    sim.time = 0;
    sim.resetEnergy();
  },
  setExposure(v) {
    renderer.toneMappingExposure = v;
  },
  setQuality(k, v) {
    quality[k] = v;
    if (k === 'shadows') {
      renderer.shadowMap.enabled = v;
      lighting.sun.castShadow = v;
      scene.traverse((o) => {
        if (o.isMesh && o.material && !Array.isArray(o.material)) o.material.needsUpdate = true;
      });
    }
    if (k === 'bloom' && bloomPass) bloomPass.enabled = v;
    if (k === 'dust') effects.setDust(v);
    if (k === 'tags') env.showTags = v;
  },
  toggleSound() {
    audio.setEnabled(!audio.on);
    env.sound = audio.on;
    app.soundBtn.classList.toggle('act', audio.on);
    if (audio.on) audio.blip(990, 0.06, 'sine', 0.1);
    ctl.toast(audio.on ? 'Audio cues on' : 'Audio muted');
  },
  toggleHelp(force) {
    const on = force == null ? !app.scrim.classList.contains('on') : force;
    app.scrim.classList.toggle('on', on);
    app.sheet.classList.toggle('on', on);
  },
  toast(msg, kind) {
    app.toast(msg, kind);
  },
  skipIntro() {
    endIntro();
  },
});

/* ------------------------------------------------------- info card */
let infoState = null;
const picker = new Picker(camera, renderer.domElement, pickRoots);
picker.onHover = (hit, pt) => {
  const h = app.hover;
  if (hit) {
    h.style.opacity = '1';
    h.style.transform = `translate(${clamp(pt.x + 16, 8, innerWidth - 240)}px, ${clamp(pt.y + 18, 8, innerHeight - 60)}px)`;
    const zc = hit.pick.zone != null ? STATE_COLORS[sim.zones[hit.pick.zone].state] : '#d8b26a';
    h.innerHTML = `<i style="background:${zc};box-shadow:0 0 10px ${zc}"></i><span>${hit.pick.title || ''}</span>`;
    renderer.domElement.style.cursor = 'pointer';
  } else {
    h.style.opacity = '0';
    renderer.domElement.style.cursor = rig.mode === 'fp' ? 'none' : 'grab';
  }
};
picker.onClick = (hit, e) => {
  if (rig.mode === 'fp') {
    // in walk mode a click on open floor walks you there; a click on a device inspects it
    if (!hit || hit.pick.kind === 'zone') {
      const cx = e && e.clientX != null ? e.clientX : innerWidth / 2;
      const cy = e && e.clientY != null ? e.clientY : innerHeight / 2;
      const g = rig.groundPoint(cx, cy);
      if (g && rig.walkTo(g.x, g.z)) {
        effects.ping(g.x, 0.03, g.z, 0.7, 0xffd9a2);
        audio.ui();
        return;
      }
    }
  }
  if (!hit) {
    hideInfo();
    return;
  }
  if (hit.pick.kind === 'zone') {
    env.selectedZone = hit.pick.zone;
  }
  showInfo(hit);
  audio.ui();
};

function describe(p, hit) {
  const zi = p.zone;
  const z = zi != null && sim.zones[zi] ? sim.zones[zi] : null;
  const rows = [];
  const add = (k, v, cls = '') => rows.push([k, v, cls]);
  let actions = [];
  let sub = '';
  let role = '';
  let title = p.title || 'Component';

  if (p.kind === 'zone' && z) {
    title = `${z.name} · ${z.label}`;
    sub = 'open occupancy zone · no physical divider';
    add('state', z.manual !== 'AUTO' ? 'MANUAL ' + z.manual : z.state, z.state === 'OCCUPIED' ? 'on' : z.state === 'GRACE' ? 'warn' : 'off');
    add('why', z.state === 'OCCUPIED' ? `${z.src.join(' + ')} presence` : z.state === 'GRACE' ? `${z.countdown.toFixed(1)} s to shutdown` : 'both sensors clear', z.state === 'GRACE' ? 'warn' : '');
    add('bodies', `${z.occupants} seated / detected ${z.detected}`);
    add('circuit', `${z.lightCount} LED (${z.lightW} W) + ${z.fanCount} fan (${z.fanW} W)`);
    add('energy', (z.kwh * 1000).toFixed(1) + ' Wh this session');
    add('illiance', z.lux + ' lx');
    role = 'A zone is a lighting/fan circuit plus the sensors assigned to it. Three zones run three independent state machines, so an empty Zone 2 can never switch off its neighbours.';
    actions = [
      { label: '+ student', fn: () => ctl.addPerson(zi) },
      { label: 'clear zone', fn: () => ctl.clearZone(zi) },
      { label: z.manual === 'ON' ? 'auto' : 'force on', fn: () => sim.setZoneManual(zi, z.manual === 'ON' ? 'AUTO' : 'ON') },
    ];
  } else if (p.kind === 'light') {
    const L = LIGHTS.find((x) => x.id === p.id);
    title = `LED panel · ${ZONES[zi].tag}${L.z > 0 ? '-B' : '-A'}`;
    sub = 'recessed 1200 × 300 · 22 W · 4000 K';
    add('state', z.lightLevel > 0.85 ? 'ON' : z.lightLevel > 0.05 ? 'ramping' : 'OFF', z.lightLevel > 0.5 ? 'on' : 'off');
    add('circuit cmd', z.lightCmd === 'AUTO' ? 'automatic' : 'forced ' + z.lightCmd, z.lightCmd === 'AUTO' ? '' : 'warn');
    add('switched by', `MOSFET Q${zi + 1} · gate 3.3 V`);
    add('zone', `${z.manual !== 'AUTO' ? 'MANUAL' : z.state} · ${z.occupants} bodies`);
    role = 'Two of these make one zone circuit. They are driven through a low-side MOSFET, never straight from a GPIO, and fade rather than snap so occupants see the change coming.';
    actions = [{ label: z.lightCmd === 'AUTO' ? 'force ON' : z.lightCmd === 'ON' ? 'force OFF' : 'to AUTO', fn: () => sim.setLoadCmd(zi, 'lights', z.lightCmd === 'AUTO' ? 'ON' : z.lightCmd === 'ON' ? 'OFF' : 'AUTO') }];
  } else if (p.kind === 'fan') {
    const F = FANS.find((x) => x.id === p.id);
    const rec = fixtures.fans[F.id];
    title = `Ceiling fan · ${ZONES[zi].tag}`;
    sub = '1200 mm sweep · 3 blades · 72 W';
    const rpm = Math.round((rec.rpm || 0) * 60);
    add('state', rpm > 4 ? 'RUNNING' : 'stopped', rpm > 4 ? 'on' : 'off');
    add('speed', rpm + ' rpm');
    add('start-up', 'soft, ≈ 2.5 s');
    add('circuit cmd', z.fanCmd === 'AUTO' ? 'automatic' : 'forced ' + z.fanCmd);
    add('flyback', '1N4007 at the motor');
    role = 'Represented on the bench by a 5 V DC motor with a propeller. Its blades are also the classic enemy of a ceiling radar — see the fan-reflection scenario.';
    actions = [{ label: z.fanCmd === 'AUTO' ? 'force ON' : 'to AUTO', fn: () => sim.setLoadCmd(zi, 'fans', z.fanCmd === 'AUTO' ? 'ON' : 'AUTO') }];
  } else if (p.kind === 'pir' || p.kind === 'mmwave') {
    const s = sim.sensors.find((x) => x.id === p.id);
    title = (p.kind === 'pir' ? 'PIR motion sensor' : '24 GHz mmWave radar') + ` · ${ZONES[zi].tag}`;
    sub = p.kind === 'pir' ? 'pyroelectric dome · motion only' : 'FMCW module · presence + micro-motion';
    add('status', s.enabled ? (s.presence ? 'TRIGGERED' : 'ready') : 'OFFLINE / FAULT', s.enabled ? (s.presence ? 'on' : '') : 'bad');
    add('mount', s.mount === 'ceiling' ? `ceiling · ${s.y.toFixed(2)} m` : `wall · ${s.y.toFixed(2)} m`);
    add('field', `${s.beam}° × ${s.range.toFixed(1)} m`);
    add('bodies in field', `${s.targets}${s.stillTargets ? ' · still' : ''}`);
    if (p.kind === 'mmwave') {
      add('range gate', sim.rangeGate.toFixed(2) + ' m');
      add('sensitivity', sim.sensitivity.toFixed(2));
      add('false reports', s.falsePos || 0, (s.falsePos || 0) > 2 ? 'warn' : '');
      role = 'Sees presence, not motion: breathing and small posture shifts keep a still occupant detected. The trade-off is that reflections from fan blades, curtains or an over-sensitive threshold can invent occupancy.';
    } else {
      add('hold time', sim.pirHold.toFixed(1) + ' s');
      add('gain', sim.pirGain.toFixed(2));
      role = 'Triggers only on a *changing* infrared signal. A motionless reader slowly disappears from its view — the exact failure that makes PIR-only controls turn lights off in an occupied room.';
    }
    actions = [
      { label: s.enabled ? 'simulate fault' : 'restore', fn: () => sim.setSensorEnabled(s.id, !s.enabled) },
      { label: 'focus zone', fn: () => ctl.view('zone', { zone: zi, tight: true }) },
    ];
  } else if (p.kind === 'esp32') {
    title = 'ESP32-S3 DevKitC-1';
    sub = 'controller · 3.3 V logic only';
    add('mode', sim.mode.replace('_', ' '));
    add('inputs', '3 × PIR + 3 × mmWave');
    add('outputs', 'Q1..Q3 → MOSFET gates');
    add('zones on', sim.zones.filter((x) => x.lightLevel > 0.5).length + ' / 3');
    add('grace', sim.zones.some((x) => x.state === 'GRACE') ? Math.max(...sim.zones.map((x) => x.countdown)).toFixed(1) + ' s' : 'idle');
    add('display', 'I²C OLED 0x3C live');
    role = 'Runs three independent OCCUPIED → GRACE → VACANT machines, de-glitches the sensor inputs, drives the OLED and the buzzer, and honours the manual overrides. It only ever steers gates.';
    actions = [{ label: 'view signal chain', fn: () => ctl.setSystem(true) }];
  } else if (p.kind === 'oled') {
    title = '0.96" OLED · SSD1306';
    sub = '128 × 64 px · the room\'s status surface';
    sim.zones.forEach((x) =>
      add(x.tag, x.manual !== 'AUTO' ? 'MANUAL' : x.state === 'OCCUPIED' ? 'ON' : x.state === 'GRACE' ? Math.max(0, sim.offAfter - x.t).toFixed(0) + ' s' : 'OFF', x.lightLevel > 0.5 ? 'on' : 'off')
    );
    add('mode', sim.mode.replace('_', ' '));
    add('load', Math.round(sim.zones.reduce((a, x) => a + x.lightW * x.lightLevel + x.fanW * x.fanLevel, 0)) + ' W');
    role = 'Physically tiny on purpose — this is the same panel the prototype carries, refreshed a few times a second like the real thing.';
  } else if (p.kind === 'mosfet') {
    title = 'Low-side MOSFET switch board';
    sub = '4 × IRFZ44N · 10 k gate pulldown';
    sim.zones.forEach((x, i) => {
      const on = x.lightLevel > 0.05 || x.fanLevel > 0.05;
      add(`Z${i + 1} gate`, on ? '3.3 V → conducting' : '0 V → off', on ? 'on' : 'off');
      add(`Z${i + 1} load`, Math.round(x.lightW * x.lightLevel + x.fanW * x.fanLevel) + ' W');
    });
    add('load supply', '5 V DC bench (demo only)');
    add('protection', '1N4007 across each motor');
    role = 'GPIO → gate resistor → MOSFET. The motor current loop is supply → motor → drain → source → 0 V; the microcontroller never carries it. The 10 k pulldown holds the load OFF while the GPIO is floating at boot.';
  } else if (p.kind === 'motor') {
    const m = elec.motors[p.id];
    const zi2 = Math.min(2, p.id);
    title = `5 V DC motor · ${ZONES[zi2].tag} load`;
    sub = 'fan / lamp stand-in for the demonstration';
    add('state', m.rpm > 0.6 ? 'SPINNING' : 'stopped', m.rpm > 0.6 ? 'on' : 'off');
    add('speed', (m.rpm * 9.55).toFixed(0) + ' rpm');
    add('flyback diode', '1N4007 fitted');
    add('switched by', `Q${zi2 + 1}`);
    role = 'Deliberately low voltage: the behaviour of the switching chain is visible on a desk without anyone touching 230 V.';
  } else if (p.kind === 'switch' || p.kind === 'override') {
    title = `Manual override · ${ZONES[zi].tag}`;
    sub = 'three-position: AUTO · FORCE ON · FORCE OFF';
    add('position', z.manual, z.manual === 'AUTO' ? '' : 'warn');
    add('sensors say', `${z.pirSeen ? 'PIR ' : ''}${z.mmSeen ? 'mmWave ' : ''}${z.pirSeen || z.mmSeen ? 'presence' : 'clear'}`);
    add('zone state', z.state, z.state === 'OCCUPIED' ? 'on' : 'off');
    role = 'Override always wins over the sensors — for cleaning, an exam, or a failed detector. Releasing it hands control straight back to the state machine.';
    actions = [
      { label: 'force ON', fn: () => sim.setZoneManual(zi, 'ON') },
      { label: 'force OFF', fn: () => sim.setZoneManual(zi, 'OFF') },
      { label: 'AUTO', fn: () => sim.setZoneManual(zi, 'AUTO') },
    ];
  } else if (p.kind === 'mcb') {
    title = p.title;
    sub = 'distribution board DB-04 · one MCB per zone circuit';
    add('rating', '6 A');
    add('zone', z ? z.state : 'control rail');
    add('load', z ? Math.round(z.lightW * z.lightLevel + z.fanW * z.fanLevel) + ' W' : '5 V bench rail');
    role = 'In a real room these are contactors on the lighting and fan circuits, coil-driven by the controller. Here they mark which circuit each MOSFET belongs to.';
    if (z) actions = [{ label: z.manual === 'OFF' ? 'close circuit' : 'trip (force off)', fn: () => sim.setZoneManual(zi, z.manual === 'OFF' ? 'AUTO' : 'OFF') }];
  } else if (p.kind === 'buzzer') {
    title = 'Piezo buzzer';
    sub = 'active · 5 V · event annunciator';
    add('chirps', 'vacancy warning · fault · override');
    add('last event', sim.events.length ? sim.events[sim.events.length - 1].label : '—');
    role = 'Tells the person in the room that a shutdown is coming, before the lights actually go — the part most PIR-only systems leave out.';
  } else if (p.kind === 'person') {
    const o = sim.occupants[hit && hit.instanceId != null ? hit.instanceId : 0];
    if (!o) return null;
    title = o.name || 'Occupant';
    sub = `${o.state === 'seated' ? 'seated at desk' : o.state === 'walking' ? 'walking' : 'standing'} · ${ZONES[o.zone].name}`;
    add('motion', (o.motion * 100).toFixed(0) + '%', o.motion > 0.13 ? 'on' : 'warn');
    add('micro-motion', o.micro > 0.012 ? 'breathing visible to radar' : 'still', o.micro > 0.012 ? 'on' : '');
    add('PIR sees', sim.zones[o.zone].pirSeen ? 'yes' : 'no', sim.zones[o.zone].pirSeen ? 'on' : 'bad');
    add('radar sees', sim.zones[o.zone].mmSeen ? 'yes' : 'no', sim.zones[o.zone].mmSeen ? 'on' : 'bad');
    add('zone state', sim.zones[o.zone].state);
    role = 'This body is the whole test: stillness defeats PIR, the radar holds it, and the hybrid rule keeps the lights on.';
    actions = [
      {
        label: 'freeze',
        fn: () => {
          o.baseline = 0.012;
          o.act = 0.04;
          o.spike = 0;
          o.spikeTimer = 999;
        },
      },
      { label: 'walk out', fn: () => sim.removeOccupant(o.id) },
    ];
  } else return null;
  return { title, sub, rows, role, actions };
}

function showInfo(hit) {
  infoState = { hit, world: hit.point.clone() };
  renderInfo(true);
  app.info.classList.add('on');
  positionInfo();
}
function hideInfo() {
  infoState = null;
  app.info.classList.remove('on');
}
function positionInfo() {
  if (!infoState) return;
  const v = infoState.world.clone().project(camera);
  const x = (v.x * 0.5 + 0.5) * innerWidth;
  const y = (-v.y * 0.5 + 0.5) * innerHeight;
  const box = app.info;
  box.style.left = clamp(x, 146, innerWidth - 146) + 'px';
  box.style.top = clamp(y - 16, 72, Math.max(80, innerHeight - 320)) + 'px';
  box.style.display = v.z > 1 ? 'none' : 'block';
}
let infoAcc = 0;
function renderInfo(force) {
  if (!infoState) return;
  const d = describe(infoState.hit.pick, infoState.hit);
  if (!d) {
    hideInfo();
    return;
  }
  const box = app.info;
  box.querySelector('.ti').textContent = d.title;
  box.querySelector('.sub').textContent = d.sub;
  const dl = box.querySelector('dl');
  const key = d.rows.map((r) => r[0] + r[1]).join('|');
  if (force || dl.dataset.k !== key) {
    dl.dataset.k = key;
    dl.innerHTML = d.rows.map((r) => `<dt>${r[0]}</dt><dd class="${r[2]}">${r[1]}</dd>`).join('');
    const act = box.querySelector('.act');
    act.innerHTML = '';
    (d.actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.className = 'mini';
      b.textContent = a.label;
      b.onclick = (e) => {
        e.stopPropagation();
        a.fn();
        audio.ui();
        renderInfo(true);
      };
      act.appendChild(b);
    });
  }
  box.querySelector('.role').textContent = d.role;
}

/* --------------------------------------------------------- x-ray fading */
let xrayNow = 0,
  xrayTarget = 0,
  xrayK = 0;
function setXray(v, speed = 1) {
  xrayTarget = v;
  xraySpeedCache = speed;
}
let xraySpeedCache = 1;
function updateXray(dt) {
  xrayNow = damp(xrayNow, xrayTarget, 3.6 * xraySpeedCache, dt);
  const k = (xrayNow = clamp(xrayNow));
  if (Math.abs(k - xrayK) < 0.0015) return;
  xrayK = k;
  const e = k * k * (3 - 2 * k);
  xrayMats.forEach((m) => {
    if (e < 0.005) {
      m.opacity = m.userData.__o;
      m.transparent = m.userData.__t;
      m.depthWrite = m.userData.__d;
      return;
    }
    m.transparent = true;
    m.depthWrite = e > 0.55 ? false : m.userData.__d;
    m.opacity = lerp(m.userData.__o ?? 1, (m.userData.__o ?? 1) * 0.09, e);
  });
  room.ceilingGroup.visible = e < 0.7;
  room.group.children.forEach((c) => {
    if (c === room.exterior) c.visible = true;
  });
}

/* ------------------------------------------------------------- intro */
const introKeys = [
  { t: 0, p: [11.4, 1.58, 1.66], q: [5.4, 1.62, 1.55] },
  { t: 1.8, p: [7.15, 1.56, 1.6], q: [1.3, 1.55, 1.15] },
  { t: 3.2, p: [4.05, 1.66, 1.2], q: [-2.4, 1.5, -0.5] },
  { t: 4.6, p: [1.2, 2.0, 2.05], q: [-3.4, 1.4, -0.6] },
  { t: 6.1, p: [5.0, 2.3, 4.0], q: [-1.3, 1.35, -0.1] },
  { t: 7.5, p: [6.5, 2.3, 4.7], q: [-1.35, 1.28, -0.1] },
];
function introAt(k) {
  let i = 0;
  while (i < introKeys.length - 2 && k > introKeys[i + 1].t) i++;
  const a = introKeys[i],
    b = introKeys[i + 1];
  const u = clamp((k - a.t) / (b.t - a.t));
  const e = Ease.inOut(u);
  return { p: [0, 1, 2].map((j) => lerp(a.p[j], b.p[j], e)), q: [0, 1, 2].map((j) => lerp(a.q[j], b.q[j], e)) };
}
const intro = app.intro;
let introActive = true,
  introT = -0.6;
const introStart = performance.now();
const introEvents = [
  { t: 2.2, done: false, fn: () => applyScenario(sim, 8) },
  { t: 3.5, done: false, fn: () => effects.setViz(true) },
  { t: 5.0, done: false, fn: () => effects.setViz(false) },
  { t: 5.1, done: false, fn: () => app.skipBtn.parentElement.classList.add('on') },
];
function showConsoleNow() {
  ['top', 'left', 'right', 'dock'].forEach((k) => app[k] && app[k].classList.add('on'));
}
function showConsole() {
  showConsoleNow();
}
function endIntro() {
  if (!introActive) return;
  introActive = false;
  rig.orbit.enabled = true;
  intro.classList.add('hide');
  setTimeout(() => (intro.style.display = 'none'), 1050);
  document.getElementById('app').classList.remove('cinema');
  showConsole();
  if (!rig.mode || rig.mode === 'room') rig.view('room', { dur: 1.15 });
  app.hint.style.opacity = '1';
  clearTimeout(endIntro._t);
  endIntro._t = setTimeout(() => (app.hint.style.opacity = '0'), 11000);
  app.toast('Click any device in the room to inspect it · press WALK to step inside', 'ok');
  app.runDay && app.runDay();
}
/* The cinematic must never be able to hold the interface hostage: a wall clock
   plus three independent exits means input is always handed back. */
setTimeout(endIntro, 12000);
addEventListener('visibilitychange', () => {
  if (!document.hidden && introActive && performance.now() - introStart > 3200) endIntro();
});
renderer.domElement.addEventListener('pointerdown', () => {
  if (introActive && performance.now() - introStart > 900) endIntro();
});
addEventListener('wheel', () => introActive && endIntro(), { passive: true });
function stepIntro(dt) {
  introT = (performance.now() - introStart) / 1000 - 0.6;
  const k = Math.max(0, introT);
  const s = introAt(Math.min(k, introKeys[introKeys.length - 1].t));
  camera.position.set(s.p[0], s.p[1], s.p[2]);
  rig.orbit.target.set(s.q[0], s.q[1], s.q[2]);
  camera.lookAt(rig.orbit.target);
  intro.querySelectorAll('.l3 span').forEach((n, i) => n.classList.toggle('on', k > 0.8 + i * 0.5));
  introEvents.forEach((e) => {
    if (!e.done && k >= e.t) {
      e.done = true;
      e.fn();
    }
  });
  if (k > 7.7) endIntro();
}

/* -------------------------------------------------- sim → audio / visuals */
attachUIHandlers(app, sim, ctl);
const _prevOnEvent = sim.onEvent;
sim.onEvent = (e) => {
  _prevOnEvent && _prevOnEvent(e);
  if (e.kind === 'ok') {
    audio.relay(true);
    if (e.zone != null) effects.ping(ZONES[e.zone].cx, 1.45, 0, 2.4, 0x9fe0b0);
  } else if (e.kind === 'bad') {
    audio.chirp(3);
    env.chirp = 1;
    if (e.zone != null) effects.ping(ZONES[e.zone].cx, 1.45, 0, 2.8, 0xff8f7f);
  } else if (e.kind === 'warn') {
    audio.chirp(1);
    env.chirp = 0.8;
  } else if (e.kind === 'dim') {
    audio.relay(false);
    if (e.zone != null) effects.ping(ZONES[e.zone].cx, 1.4, 0, 2.0, 0x86a88f);
  } else if (e.kind === 'manual') {
    audio.relay(true);
    if (e.zone != null) effects.ping(ZONES[e.zone].cx, 1.5, 0, 2.4, 0xff9c68);
  }
};

/* ------------------------------------------------------------- keyboard */
const MODES = ['HYBRID', 'PIR_ONLY', 'MMWAVE_ONLY', 'ALWAYS_ON'];
const keymap = {
  Digit1: () => ctl.focusZone(0),
  Digit2: () => ctl.focusZone(1),
  Digit3: () => ctl.focusZone(2),
  KeyV: () => ctl.toggleViz(),
  KeyO: () => ctl.view('overview'),
  KeyR: () => ctl.view('room'),
  KeyB: () => ctl.view('bench'),
  KeyY: () => ctl.toggleSystem(),
  KeyH: () => ctl.toggleHelp(),
  KeyE: () => ctl.setMode(MODES[(MODES.indexOf(sim.mode) + 1) % 4]),
  KeyF: () => sim.setZoneManual(env.selectedZone != null ? env.selectedZone : 0, sim.zones[0].manual === 'ON' ? 'AUTO' : 'ON'),
  KeyP: () => {
    sim.paused = !sim.paused;
    ctl.toast(sim.paused ? 'Simulation paused' : 'Simulation resumed');
  },
  KeyG: () => {
    sim.setTiming({ warn: 10, off: 15 });
    ctl.toast('Timing: 10 s warning · 15 s shutdown');
  },
  KeyM: () => ctl.toggleSound(),
  Space: () => ctl.toggleDemo(),
  Escape: () => {
    if (app.scrim.classList.contains('on')) ctl.toggleHelp(false);
    else if (infoState) hideInfo();
    else if (ctl.systemOn) ctl.setSystem(false);
  },
};
addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (introActive && !keymap[e.code]) {
    endIntro();
    if (['Space', 'Enter'].includes(e.code)) e.preventDefault();
    return;
  }
  const f = keymap[e.code];
  if (!f) return;
  if (e.code === 'Space' || e.code === 'KeyF') e.preventDefault();
  f();
});

/* Losing the pointer lock must NOT eject the user from walk mode — in embedded
   or sandboxed frames the lock is often refused outright, so drag-look is the
   primary path and the lock is only ever an enhancement. */
document.addEventListener('pointerlockchange', () => {
  renderer.domElement.style.cursor = rig.mode === 'fp' ? (document.pointerLockElement ? 'none' : 'grab') : 'grab';
});

renderer.domElement.addEventListener('dblclick', (e) => {
  const hit = picker.pick(e.clientX, e.clientY);
  if (hit && hit.pick.kind === 'zone') ctl.focusZone(hit.pick.zone);
});

/* ------------------------------------------------------------- resize */
function onResize() {
  const w = innerWidth,
    h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (composer) {
    composer.setSize(w, h);
    composer.setPixelRatio(renderer.getPixelRatio());
  }
}
addEventListener('resize', onResize);

/* ------------------------------------------- script → camera + flash */
let boundScript = null;
function applyCamView(c) {
  if (introActive || !c || !c.mode) return;
  if (c.mode === 'fp') return;
  if (c.mode === 'zone') ctl.view('zone', { zone: c.zone, tight: !!c.tight, dur: c.dur || 1.5 });
  else ctl.view(c.mode, { dur: c.dur || 1.5 });
}
function hookScript() {
  const sc = sim.script;
  if (!sc || sc === boundScript) return;
  boundScript = sc;
  sc.forEach((st) => {
    if (!st.cam && !st.flash) return;
    const orig = st.fn;
    const cam = st.cam,
      fl = st.flash;
    st.fn = (s) => {
      try {
        orig(s);
      } finally {
        if (fl) {
          app.flash(fl);
          if (fl === 'ok' || fl === 'bad') env.chirp = fl === 'bad' ? 1 : 0.6;
        }
        if (cam) applyCamView(cam);
      }
    };
  });
}

/* ------------------------------------------------------------- loop */
const clock = new THREE.Clock();
let acc = 0,
  uiAcc = 0,
  frames = 0,
  fpsT = 0,
  fps = 60,
  booted = false,
  hidden = false,
  dimHold = [0, 0, 0];
document.addEventListener('visibilitychange', () => (hidden = document.hidden));

let loopErrors = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (hidden) return;
  try {
    frameBody(dt);
  } catch (e) {
    loopErrors++;
    if (loopErrors === 1 || loopErrors % 120 === 0) console.error('EcoSwitch frame error', e);
    if (loopErrors === 3 && bloomPass) {
      // post-processing is the usual suspect — fall back to direct rendering
      quality.bloom = false;
      composer = null;
    }
    if (loopErrors > 40 && introActive) endIntro();
    return;
  }
}
function frameBody(dt) {
  env.clock += dt;
  frames++;
  fpsT += dt;
  if (fpsT > 0.8) {
    fps = frames / fpsT;
    frames = 0;
    fpsT = 0;
    env.perf = fps < 36;
    if (fps < 26 && quality.pixelRatio > 1 && !env.adapted) {
      env.adapted = true;
      quality.pixelRatio = 1;
      renderer.setPixelRatio(1);
      if (composer) composer.setPixelRatio(1);
      if (bloomPass) bloomPass.enabled = false;
      quality.dust && effects.setDust(false);
    }
    if (app.enRefs && app.enRefs.fpsText) app.enRefs.fpsText.textContent = Math.round(fps) + ' fps';
  }

  if (introActive) stepIntro(dt);
  else rig.update(dt, env);

  hookScript();
  sim.step(dt);
  if (ctl.demoOn && !sim.script && introT > 9) {
    ctl.demoOn = false;
    env.demoOn = false;
    app.demo.classList.remove('act');
  }

  /* environment */
  const tod = sim.timeOfDay + sim.time * 0.0011;
  env.timeOfDay = tod;
  const dayCurve = clamp(Math.sin(clamp((tod - 6.2) / 12.8, 0, 1) * Math.PI), 0, 1);
  env.daylight = clamp(sim.daylight * (0.16 + 0.84 * dayCurve), 0, 1.4);
  env.breeze = sim.breeze;
  env.nightBoost = 1 - dayCurve;
  env.shadows = quality.shadows;
  env.cameraPos = camera.position;
  env.pixelRatio = renderer.getPixelRatio();
  env.fanAngle = env.clock * 3.2;

  /* auto-dim when a zone is occupied but dead still (real occupancy dimming) */
  sim.zones.forEach((z, i) => {
    const quiet = z.state === 'OCCUPIED' && sim.occupants.filter((o) => o.zone === i).every((o) => o.motion < 0.06);
    dimHold[i] = clamp(dimHold[i] + (quiet && quality.autodim ? dt : -dt * 3), 0, 26);
    env.dim[i] = quality.autodim && dimHold[i] > 12 ? lerp(1, 0.55, clamp((dimHold[i] - 12) / 8)) : 1;
  });

  /* the door answers to arrivals and departures */
  let near = 0;
  for (const o of sim.occupants) {
    if (o.state !== 'walking') continue;
    const d = Math.hypot(o.x - (ROOM.xMax - 0.25), o.z - 1.55);
    near = Math.max(near, clamp(1 - d / 1.7));
  }
  if (rig.mode === 'fp') {
    // the door answers to you as well
    const dc = Math.hypot(camera.position.x - (ROOM.xMax - 0.25), camera.position.z - 1.55);
    near = Math.max(near, clamp(1 - dc / 1.9));
  }
  env.doorOpen = damp(env.doorOpen, near, 5, dt);

  updateXray(dt);
  room.update(dt, env);
  fixtures.update(dt, sim, env);
  sensorRig.update(dt, sim);
  elec.update(dt, sim, env);
  people.update(dt, sim, env);
  effects.update(dt, sim, env);
  lighting.update(dt, sim, env);
  const sysOpen = systemView.update(dt, sim, env);
  if (sysOpen > 0.02) room.ceilingGroup.visible = sysOpen < 0.72;

  /* ambient life: occasional shuffles, only when no script drives the room */
  if (quality.drift && !sim.script) {
    acc += dt;
    if (acc > 2.4) {
      acc = 0;
      const list = sim.occupants.filter((o) => o.state === 'seated');
      if (list.length && Math.random() < 0.5) {
        const o = list[Math.floor(Math.random() * list.length)];
        o.act = Math.max(o.act, 0.5);
        o.spike = Math.max(o.spike, 0.65);
      }
    }
  }

  audio.hum(sim.zones.reduce((a, z) => a + z.fanLevel, 0) / 3);
  env.chirp = damp(env.chirp, 0, 3, dt);

  picker.tick(dt, rig.mode);
  infoAcc += dt;
  if (infoAcc > 0.13 && infoState) {
    infoAcc = 0;
    renderInfo(false);
    positionInfo();
  }

  uiAcc += dt;
  if (uiAcc > 0.05) {
    updateUI(app, sim, env, uiAcc);
    uiAcc = 0;
  }

  if (composer && quality.bloom && bloomPass && bloomPass.enabled) composer.render();
  else renderer.render(scene, camera);

  if (!booted) {
    booted = true;
    const b = document.getElementById('boot');
    if (b) {
      b.classList.add('gone');
      setTimeout(() => b.remove(), 1200);
    }
  }
}

/* fps telemetry chip in the status strip */
const fpsEl = document.createElement('span');
fpsEl.className = 'ts';
fpsEl.textContent = '60 fps';
document.querySelector('.clock').appendChild(fpsEl);
app.enRefs.fpsText = fpsEl;

sim.log('EcoSwitch controller boot · 3 zones · 6 sensor modules · 12 MCB-protected circuits', 'sys', null, 'BOOT');
sim.log('rule → PIR OR mmWave = OCCUPIED · both clear = GRACE · timeout = VACANT', 'sys', null, 'RULE');
if (isCoarse) sim.log('Touch device detected — use the dock buttons to move around', 'sys', null, 'BOOT');

/* Scripting + harness hook: lets an embedding page (and our headless test
   harness) drive the simulation without touching the DOM. */
window.ecoSwitch = { sim, ctl, rig, app, picker, renderer, scene, camera, effects, fixtures, elec, sensorRig, systemView, lighting, room, people, audio };

frame();
