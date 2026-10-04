/* ============================================================================
   Camera rig. One controller for inspection (OrbitControls), one for walking
   (pointer-lock first person with collision + head bob), plus choreographed
   transitions used by the intro, the zone buttons, the overview, the bench
   close-up, the follow shot and the system view.
   ==========================================================================*/
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { ROOM, ZONES, BENCH_KEYS, SEATS, BENCH } from '../config.js';
import { clamp, damp, lerp, Ease, TAU, smoothstep } from './utils.js';

const EYE = 1.62;

export class CameraRig {
  constructor(camera, dom, scene) {
    this.camera = camera;
    this.dom = dom;
    this.mode = 'room';
    this.transitioning = false;
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.075;
    this.orbit.minDistance = 0.9;
    this.orbit.maxDistance = 46;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.target.set(-0.4, 1.35, 0);
    this.orbit.zoomSpeed = 0.85;
    this.orbit.rotateSpeed = 0.62;
    this.orbit.panSpeed = 0.6;
    this.orbit.screenSpacePanning = true;

    this.fps = new PointerLockControls(camera, dom);
    this.fpsEnabled = false;
    this.vel = new THREE.Vector3();
    this.keys = {};
    this.headBob = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.pos = new THREE.Vector3(3.4, EYE, 2.4);
    this.bobT = 0;
    this.shake = 0;
    this.buildColliders();

    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    window.addEventListener('blur', () => (this.keys = {}));
    this.fps.addEventListener('unlock', () => {
      if (this.mode === 'fp') this.setMode('room');
    });
  }

  /* AABBs the walker cannot pass through */
  buildColliders() {
    const box = (x, z, hx, hz) => ({ x, z, hx, hz });
    this.colliders = [];
    BENCH_KEYS.forEach((b) => {
      this.colliders.push(box(b.x, b.z, BENCH.d / 2 + 0.14, BENCH.w / 2 + 0.06));
      this.colliders.push(box(b.x + 0.52, b.z, 0.3, BENCH.w / 2 + 0.06));
    });
    this.colliders.push(box(-3.95, 1.95, 0.95, 0.5)); // teacher desk
    this.colliders.push(box(-4.12, -2.35, 0.66, 0.36)); // prototype bench
    this.colliders.push(box(4.05, 2.55, 0.6, 0.34)); // almirah
    this.colliders.push(box(-1.3, ROOM.zMax - 0.3, 1.4, 0.3)); // store bench
    this.wallT = 0.28;
  }

  blocked(x, z) {
    const t = this.wallT;
    if (x < ROOM.xMin + t || x > ROOM.xMax - t || z < ROOM.zMin + t || z > ROOM.zMax - t) return true;
    for (const c of this.colliders) {
      if (Math.abs(x - c.x) < c.hx && Math.abs(z - c.z) < c.hz) return true;
    }
    return false;
  }

  setMode(mode, opts = {}) {
    if (mode === this.mode && !opts.force) return;
    this.mode = mode;
    const orbitOn = mode !== 'fp';
    this.orbit.enabled = orbitOn;
    if (mode === 'fp') {
      this.orbit.enabled = false;
      const p = this.camera.position.clone();
      this.pos.set(clamp(p.x, -4.4, 4.4), EYE, clamp(p.z, -2.9, 2.9));
      const d = new THREE.Vector3();
      this.camera.getWorldDirection(d);
      this.yaw = Math.atan2(d.x, d.z);
      this.pitch = 0;
      try {
        this.fps.lock();
      } catch (e) {}
    } else {
      if (this.fps.isLocked) this.fps.unlock();
      this.orbit.enabled = true;
    }
  }

  /* ---------- choreography ---------- */
  flyTo({ pos, target, dur = 1.5, ease = Ease.inOut, onDone, mode = 'room' }) {
    const from = this.camera.position.clone();
    const fromT = this.orbit.target.clone();
    this.transitioning = true;
    this.orbit.enabled = false;
    this._tw = { e: 0, dur, ease, from, fromT, to: new THREE.Vector3(...pos), toT: new THREE.Vector3(...target), onDone, mode };
    return this._tw;
  }

  /* named views */
  view(mode, opts = {}) {
    switch (mode) {
      case 'overview':
        return this.flyTo({ pos: [0.15, 13.4, 0.65], target: [0, 0.4, 0], dur: opts.dur || 1.5 });
      case 'room':
        return this.flyTo({ pos: [5.9, 2.34, 4.55], target: [-1.35, 1.28, -0.1], dur: opts.dur || 1.5 });
      case 'doorway':
        return this.flyTo({ pos: [7.4, 1.62, 1.5], target: [-2.2, 1.5, -0.2], dur: opts.dur || 1.4 });
      case 'bench':
        return this.flyTo({ pos: [-3.05, 1.32, -1.42], target: [-4.06, 0.8, -2.33], dur: opts.dur || 1.4 });
      case 'system':
        return this.flyTo({ pos: [1.4, 3.1, -11.4], target: [0.05, 1.62, -6.1], dur: opts.dur || 1.6 });
      case 'zone': {
        const z = ZONES[opts.zone | 0] || ZONES[0];
        const tight = opts.tight ? 2.4 : 3.5;
        return this.flyTo({
          pos: [z.cx + 2.05 * (z.id === 2 ? -1 : 1), z.id === 1 ? 2.5 : 2.25, tight],
          target: [z.cx, 1.15, -0.15],
          dur: opts.dur || 1.3,
        });
      }
      case 'panel':
        return this.flyTo({ pos: [2.6, 1.9, 3.05], target: [4.7, 1.35, 0.9], dur: 1.3 });
      default:
        return this.flyTo({ pos: [5.9, 2.34, 4.55], target: [-1.35, 1.28, -0.1], dur: 1.4 });
    }
  }

  follow(occ, dt) {
    if (!occ) return;
    const tx = occ.x,
      tz = occ.z;
    this.orbit.target.lerp(new THREE.Vector3(tx, 1.2, tz), 1 - Math.exp(-3.2 * dt));
    const want = new THREE.Vector3(tx + 2.15, 1.95, tz + 2.35);
    if (!this.transitioning) this.camera.position.lerp(want, 1 - Math.exp(-1.3 * dt));
  }

  update(dt, env = {}) {
    if (this._tw) {
      const w = this._tw;
      w.e += dt;
      const k = clamp(w.e / w.dur);
      const e = w.ease(k);
      this.camera.position.lerpVectors(w.from, w.to, e);
      this.orbit.target.lerpVectors(w.fromT, w.toT, e);
      this.camera.lookAt(this.orbit.target);
      if (k >= 1) {
        this._tw = null;
        this.transitioning = false;
        this.mode = w.mode || this.mode;
        if (this.mode !== 'fp') this.orbit.enabled = true;
        if (w.onDone) w.onDone();
      }
      return;
    }
    if (this.mode === 'fp') {
      // mouse look is handled by PointerLockControls; emulate yaw/pitch safely
      const sp = (this.keys.ShiftLeft || this.keys.ShiftRight ? 2.55 : 1.32) * (env.walkScale || 1);
      const f = new THREE.Vector3();
      this.camera.getWorldDirection(f);
      f.y = 0;
      f.normalize();
      const r = new THREE.Vector3(-f.z, 0, f.x);
      const move = new THREE.Vector3();
      if (this.keys.KeyW || this.keys.ArrowUp) move.add(f);
      if (this.keys.KeyS || this.keys.ArrowDown) move.sub(f);
      if (this.keys.KeyD || this.keys.ArrowRight) move.add(r);
      if (this.keys.KeyA || this.keys.ArrowLeft) move.sub(r);
      const moving = move.lengthSq() > 0.0001;
      if (moving) {
        move.normalize().multiplyScalar(sp * dt);
        const nx = this.pos.x + move.x,
          nz = this.pos.z + move.z;
        if (!this.blocked(nx, this.pos.z)) this.pos.x = nx;
        if (!this.blocked(this.pos.x, nz)) this.pos.z = nz;
        this.bobT += dt * (sp > 2 ? 12 : 8.4);
      } else this.bobT = damp(this.bobT, Math.round(this.bobT / TAU) * TAU, 3, dt);
      const crouch = this.keys.KeyC ? -0.42 : 0;
      this.headBob = Math.sin(this.bobT) * 0.018 + Math.sin(this.bobT * 2) * 0.006;
      this.camera.position.set(this.pos.x, EYE + this.headBob + crouch, this.pos.z);
      this.pos.x = clamp(this.pos.x, ROOM.xMin + 0.2, ROOM.xMax + 2.0);
      this.pos.z = clamp(this.pos.z, ROOM.zMin + 0.2, ROOM.zMax + 0.2);
      this.camera.position.y = EYE + this.headBob + crouch;
      return;
    }
    // orbit / inspect: mild framing limits so the room never gets lost
    this.orbit.update();
    const t = this.orbit.target;
    t.x = clamp(t.x, -6.4, 6.4);
    t.y = clamp(t.y, 0.1, 3.6);
    t.z = clamp(t.z, -5.6, 5.6);
    if (env.snapFloor) this.camera.position.y = Math.max(0.28, this.camera.position.y);
    const p = this.camera.position;
    p.y = Math.max(0.24, p.y);
    if (this.mode === 'overview') {
      p.x = damp(p.x, 0.15, 2.2, dt);
      p.z = damp(p.z, 0.65, 2.2, dt);
      p.y = damp(p.y, 13.4, 2.2, dt);
      this.orbit.minPolarAngle = 0;
    } else {
      this.orbit.minPolarAngle = 0;
    }
  }

  get position() {
    return this.camera.position;
  }
}
