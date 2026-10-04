/* ============================================================================
   Camera rig. One controller for inspection (OrbitControls), one for walking
   (pointer-lock first person with collision + head bob), plus choreographed
   transitions used by the intro, the zone buttons, the overview, the bench
   close-up, the follow shot and the system view.
   ==========================================================================*/
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ROOM, ZONES, BENCH_KEYS, SEATS, BENCH, DOOR } from '../config.js';
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

    /* first-person look is driven here (drag, touch-drag or pointer lock when a
       browser grants it) so walking works inside embedded views and on tablets */
    this.fpsEnabled = false;
    this.locked = false;
    this._look = { on: false, id: -1, x: 0, y: 0, moved: 0 };
    this.dest = null;
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ray = new THREE.Raycaster();
    this._tmp = new THREE.Vector3();
    camera.rotation.order = 'YXZ';
    this.bindLook();
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
  }

  bindLook() {
    const dom = this.dom;
    const isFP = () => this.mode === 'fp';
    dom.addEventListener('pointerdown', (e) => {
      if (!isFP() || this.transitioning) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this._look.on = true;
      this._look.id = e.pointerId;
      this._look.x = e.clientX;
      this._look.y = e.clientY;
      this._look.moved = 0;
      this.dest = null; // taking manual control cancels an auto-walk
      try {
        dom.setPointerCapture(e.pointerId);
      } catch (err) {}
    });
    dom.addEventListener('pointermove', (e) => {
      if (!isFP()) return;
      let dx = 0,
        dy = 0;
      if (this.locked) {
        dx = e.movementX || 0;
        dy = e.movementY || 0;
      } else if (this._look.on && e.pointerId === this._look.id) {
        dx = e.clientX - this._look.x;
        dy = e.clientY - this._look.y;
        this._look.x = e.clientX;
        this._look.y = e.clientY;
        this._look.moved += Math.abs(dx) + Math.abs(dy);
      } else return;
      const k = 0.0026;
      this.yaw -= dx * k;
      this.pitch = clamp(this.pitch - dy * k, -1.05, 0.95);
    });
    const up = (e) => {
      if (this._look.id === e.pointerId) this._look.on = false;
    };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('contextmenu', (e) => {
      if (isFP()) e.preventDefault();
    });
    this.dom.ownerDocument.addEventListener('pointerlockchange', () => {
      this.locked = this.dom.ownerDocument.pointerLockElement === this.dom;
      if (!this.locked && this.mode !== 'fp') this.dom.style.cursor = '';
    });
  }

  get lookDragged() {
    return this._look.moved > 8;
  }

  /* where a screen point meets the floor, for click-to-walk */
  groundPoint(cx, cy, maxDist = 9) {
    this.camera.updateMatrixWorld();
    const r = this.dom.getBoundingClientRect();
    this._ray.setFromCamera(
      new THREE.Vector2(((cx - r.left) / Math.max(1, r.width)) * 2 - 1, -((cy - r.top) / Math.max(1, r.height)) * 2 + 1),
      this.camera
    );
    const p = this._ray.ray.intersectPlane(this._plane, this._tmp);
    if (!p) return null;
    const d = p.distanceTo(this.camera.position);
    if (!Number.isFinite(d) || d > maxDist) {
      const t = Math.max(0.5, maxDist / Math.max(1e-3, d));
      p.x = this.camera.position.x + (p.x - this.camera.position.x) * t;
      p.z = this.camera.position.z + (p.z - this.camera.position.z) * t;
    }
    return { x: clamp(p.x, ROOM.xMin + 0.42, ROOM.xMax - 0.3), z: clamp(p.z, ROOM.zMin + 0.4, ROOM.zMax - 0.4) };
  }

  walkTo(x, z) {
    if (this.mode !== 'fp') return false;
    const free = this.freeNear(x, z);
    if (!free) return false;
    this.dest = { x: free.x, z: free.z };
    return true;
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
    this.doorZ = DOOR.z != null ? DOOR.z : 1.55;
  }

  /* standing in the doorway is legal; the rest of the walls are not */
  outsideLegal(x, z) {
    return x > ROOM.xMax - this.wallT && x < ROOM.xMax + 0.62 && Math.abs(z - this.doorZ) < 0.66;
  }

  blocked(x, z) {
    const t = this.wallT;
    const legalOut = this.outsideLegal(x, z);
    if (!legalOut && (x < ROOM.xMin + t || x > ROOM.xMax - t || z < ROOM.zMin + t || z > ROOM.zMax - t)) return true;
    if (legalOut && x < ROOM.xMax - t) return false;
    for (const c of this.colliders) {
      if (Math.abs(x - c.x) < c.hx && Math.abs(z - c.z) < c.hz) return true;
    }
    return false;
  }

  /* how deep a point sits inside furniture — lets a wedged walker slide out */
  pen(x, z) {
    let p = 0;
    for (const c of this.colliders) {
      const dx = c.hx - Math.abs(x - c.x);
      const dz = c.hz - Math.abs(z - c.z);
      if (dx > 0 && dz > 0) p = Math.max(p, Math.min(dx, dz));
    }
    return p;
  }

  freeNear(x, z, maxR = 1.9) {
    if (!this.blocked(x, z)) return { x, z };
    for (let r = 0.16; r <= maxR; r += 0.14) {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU + r * 0.7;
        const tx = clamp(x + Math.cos(a) * r, ROOM.xMin + 0.4, ROOM.xMax + 0.5);
        const tz = clamp(z + Math.sin(a) * r, ROOM.zMin + 0.4, ROOM.zMax - 0.4);
        if (!this.blocked(tx, tz)) return { x: tx, z: tz };
      }
    }
    return null;
  }

  setMode(mode, opts = {}) {
    if (mode === this.mode && !opts.force) {
      if (mode === 'fp') this.requestLock();
      return;
    }
    this.mode = mode;
    if (mode === 'fp') {
      this.orbit.enabled = false;
      this._tw = null;
      this.transitioning = false;
      const p = this.camera.position;
      const inside = p.x > ROOM.xMin && p.x < ROOM.xMax && p.z > ROOM.zMin && p.z < ROOM.zMax;
      const spot = inside ? this.freeNear(p.x, p.z) : null;
      if (spot) {
        this.pos.set(spot.x, EYE, spot.z);
        const d = new THREE.Vector3();
        this.camera.getWorldDirection(d);
        this.yaw = Math.atan2(-d.x, -d.z);
        this.pitch = clamp(Math.asin(clamp(d.y, -1, 1)), -0.6, 0.6);
      } else {
        // parked outside the room (or buried in geometry): stand in the main aisle
        const cands = [[ROOM.xMax - 0.9, 0], [2.55, 0], [0.2, 0], [-2.3, 0], [1.2, -2.55], [ROOM.xMax - 0.9, this.doorZ]];
        const c0 = cands.find((c) => !this.blocked(c[0], c[1])) || [0.2, 0];
        this.pos.set(c0[0], EYE, c0[1]);
        this.yaw = Math.PI / 2; // camera forward is -Z, so +π/2 looks down the aisle into the room
        this.pitch = -0.05;
      }
      this.applyFP();
      this.requestLock();
      this.dom.style.cursor = this.locked ? 'none' : 'grab';
    } else {
      this.dest = null;
      try {
        if (this.locked) this.dom.ownerDocument.exitPointerLock();
      } catch (e) {}
      // hand the orbit controller a sensible pivot straight ahead
      const d = new THREE.Vector3();
      this.camera.getWorldDirection(d);
      this.orbit.target.copy(this.camera.position).addScaledVector(d, 3.4);
      this.orbit.target.y = clamp(this.orbit.target.y, 0.3, 2.6);
      this.orbit.enabled = true;
      this.orbit.update();
      this.dom.style.cursor = 'grab';
    }
    if (this.onMode) this.onMode(mode);
  }

  requestLock() {
    try {
      const p = this.dom.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {});
    } catch (e) {
      try {
        this.dom.requestPointerLock();
      } catch (e2) {}
    }
  }

  applyFP() {
    this.camera.position.set(this.pos.x, this.pos.y + this.headBob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  /* ---------- choreography ---------- */
  flyTo({ pos, target, dur = 1.5, ease = Ease.inOut, onDone, mode = 'room' }) {
    const from = this.camera.position.clone();
    const fromT = this.orbit.target.clone();
    this.transitioning = true;
    this.orbit.enabled = false;
    this._tw = { e: 0, age: 0, dur, ease, from, fromT, to: new THREE.Vector3(...pos), toT: new THREE.Vector3(...target), onDone, mode };
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
      this._tw.age = (this._tw.age || 0) + dt;
      if (this._tw.age > 9) this._tw.dur = this._tw.e; // a stalled flight must still land
      this._tw.age = (this._tw.age || 0) + dt;
      if (this._tw.age > 9) this._tw.dur = this._tw.e; // stuck? land it now
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
      const run = this.keys.ShiftLeft || this.keys.ShiftRight;
      let sp = (run ? 2.5 : 1.3) * (env.walkScale || 1);
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(-f.z, 0, f.x);
      const move = new THREE.Vector3();
      let auto = 0;
      if (this.dest) {
        const dx = this.dest.x - this.pos.x,
          dz = this.dest.z - this.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.26) this.dest = null;
        else {
          move.addScaledVector(new THREE.Vector3(dx / dist, 0, dz / dist), 1);
          const want = Math.atan2(dx, dz);
          let err = want - this.yaw;
          while (err > Math.PI) err -= TAU;
          while (err < -Math.PI) err += TAU;
          this.yaw += clamp(err, -2.6 * dt, 2.6 * dt);
          this.pitch = damp(this.pitch, -0.02, 2, dt);
          auto = 1;
        }
      }
      if (this.keys.KeyW || this.keys.ArrowUp) move.add(f);
      if (this.keys.KeyS || this.keys.ArrowDown) move.sub(f);
      if (this.keys.KeyD || this.keys.ArrowRight) move.add(r);
      if (this.keys.KeyA || this.keys.ArrowLeft) move.sub(r);
      if (move.lengthSq() > 0.0001) this.dest = null;
      const moving = move.lengthSq() > 0.0001;
      if (moving) {
        move.normalize().multiplyScalar(sp * (auto ? 0.85 : 1) * dt);
        const nx = this.pos.x + move.x,
          nz = this.pos.z + move.z;
        if (this.blocked(this.pos.x, this.pos.z)) {
          // wedged inside furniture: slide toward freedom instead of sticking
          const here = this.pen(this.pos.x, this.pos.z);
          if (this.pen(nx, this.pos.z) < here) this.pos.x = nx;
          if (this.pen(this.pos.x, nz) < here) this.pos.z = nz;
          const free = this.freeNear(this.pos.x, this.pos.z, 0.9);
          if (free) {
            this.pos.x = free.x;
            this.pos.z = free.z;
          }
        } else {
          if (!this.blocked(nx, this.pos.z)) this.pos.x = nx;
          if (!this.blocked(this.pos.x, nz)) this.pos.z = nz;
        }
        this.bobT += dt * (run ? 12 : 8.4);
      } else this.bobT = damp(this.bobT, Math.round(this.bobT / TAU) * TAU, 3, dt);
      const crouch = this.keys.KeyC ? -0.42 : 0;
      this.headBob = Math.sin(this.bobT) * 0.018 + Math.sin(this.bobT * 2) * 0.006;
      this.pos.x = clamp(this.pos.x, ROOM.xMin + 0.22, ROOM.xMax + 0.58);
      this.pos.z = clamp(this.pos.z, ROOM.zMin + 0.22, ROOM.zMax + 2.2);
      this.pos.y = EYE + crouch;
      this.applyFP();
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
