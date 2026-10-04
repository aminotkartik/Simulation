/* ============================================================================
   Occupants — simplified but believable human figures, drawn with 11
   InstancedMeshes total (so 20+ people cost 11 draw calls) while still being
   individually animated: idle breathing, head turns, gestures, walking gait.
   Figures are the "motion source" the sensors read, so their animation feeds
   straight back into the sensing model.
   ==========================================================================*/
import * as THREE from 'three';
import { MAT, box, cyl, sph, cap, plane, mesh } from './materials.js';
import { SKIN, SHIRTS, OCCUPANT_NAMES, ROOM } from '../config.js';
import { clamp, lerp, damp, seeded, TAU, smoothstep } from '../core/utils.js';

const MAXP = 30;

const PARTS = [
  { key: 'head', geo: () => sph(0.1, 14), kind: 'skin', scale: [1, 1.1, 1] },
  { key: 'hair', geo: () => sph(0.108, 12), kind: 'hair' },
  { key: 'torso', geo: () => cap(0.155, 0.22), kind: 'shirt' },
  { key: 'hips', geo: () => box(0.28, 0.16, 0.3), kind: 'trouser' },
  { key: 'upper', geo: () => cap(0.05, 0.16), kind: 'shirt', pair: true },
  { key: 'fore', geo: () => cap(0.043, 0.15), kind: 'skin', pair: true },
  { key: 'hand', geo: () => sph(0.045, 8), kind: 'skin', pair: true },
  { key: 'thigh', geo: () => cap(0.073, 0.24), kind: 'trouser', pair: true },
  { key: 'shin', geo: () => cap(0.056, 0.26), kind: 'trouser', pair: true },
  { key: 'shoe', geo: () => box(0.2, 0.055, 0.1), kind: 'shoe', pair: true },
];

export function buildPeople() {
  const group = new THREE.Group();
  group.name = 'people';
  const mats = {
    skin: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.0, envMapIntensity: 0.5 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x1c1713, roughness: 0.55, envMapIntensity: 0.7 }),
    shirt: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, envMapIntensity: 0.45 }),
    trouser: new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.8, envMapIntensity: 0.4 }),
    shoe: new THREE.MeshStandardMaterial({ color: 0x25221f, roughness: 0.6 }),
  };
  Object.values(mats).forEach((m) => (m.userData.xray = false));

  const inst = {};
  const data = {};
  PARTS.forEach((p) => {
    const im = new THREE.InstancedMesh(p.geo(), mats[p.kind], MAXP * (p.pair ? 2 : 1));
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = true;
    im.receiveShadow = false;
    im.frustumCulled = false;
    im.count = 0;
    group.add(im);
    inst[p.key] = im;
    data[p.key] = { n: 0, pair: !!p.pair };
  });

  /* scratch */
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const Q2 = new THREE.Quaternion();
  const E = new THREE.Euler();
  const V = new THREE.Vector3();
  const S = new THREE.Vector3();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const COL = new THREE.Color();
  const SHOE = new THREE.Color(0x26221e);
  const R = seeded(2024);

  const look = new Map(); // per-occupant visual state
  function visFor(o) {
    let v = look.get(o.id);
    if (!v) {
      v = {
        x: o.x,
        z: o.z,
        ry: o.faceRY || 0,
        lean: 0.1,
        headT: 0,
        bob: 0,
        phase: R() * TAU,
        skin: new THREE.Color(SKIN[Math.floor(R() * SKIN.length)]),
        shirt: new THREE.Color(SHIRTS[Math.floor(R() * SHIRTS.length)]),
        hairStyle: R() > 0.55 ? 1 : 0,
        hairCol: new THREE.Color().setHSL(0.07 + R() * 0.06, 0.25 + R() * 0.2, 0.07 + R() * 0.06),
        trouser: new THREE.Color().setHSL(0.06 + R() * 0.1, 0.08, 0.16 + R() * 0.16),
        gait: 0,
        leanS: 0,
        hand: R(),
        height: 0.96 + R() * 0.12,
      };
      look.set(o.id, v);
    }
    return v;
  }

  function put(key, px, py, pz, rx, ry, rz, sx, sy, sz, color) {
    const im = inst[key];
    const i = data[key].n++;
    E.set(rx || 0, ry || 0, rz || 0);
    Q.setFromEuler(E);
    V.set(px, py, pz);
    S.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
    M.compose(V, Q, S);
    im.setMatrixAt(i, M);
    if (color) im.setColorAt(i, color);
  }

  function update(dt, sim, env) {
    for (const k in data) data[k].n = 0;
    const occs = sim.occupants.slice(0, MAXP);
    for (const o of occs) {
      const v = visFor(o);
      const seated = o.state === 'seated';
      // smooth follow of the simulated body
      v.x = lerp(v.x, o.x, 1 - Math.exp(-16 * dt));
      v.z = lerp(v.z, o.z, 1 - Math.exp(-16 * dt));
      const targetRY = o.faceRY || 0;
      let d = targetRY - v.ry;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      v.ry += d * (1 - Math.exp(-7 * dt));
      // gait / idle
      v.phase += dt * (seated ? 1.05 : 5.6 + o.speed * 1.4);
      const act = clamp(o.motion, 0, 1);
      v.gait = damp(v.gait, seated ? 0 : 1, 6, dt);
      v.leanS = damp(v.leanS, seated ? 0.2 + act * 0.12 : 0.03, 5, dt);
      const br = Math.sin(v.phase) * (seated ? 1 : 0.35);
      const swing = seated ? 0 : Math.sin(v.phase) * (0.34 + 0.28 * act);
      const swing2 = seated ? 0 : Math.sin(v.phase + Math.PI) * (0.34 + 0.28 * act);
      const bob = seated ? 0 : Math.abs(Math.sin(v.phase)) * 0.022;
      v.headT = damp(v.headT, (seated ? Math.sin(v.phase * 0.33) * 0.28 : Math.sin(v.phase * 0.5) * 0.5) * (0.4 + act), 3, dt);
      const gesture = o.spike;
      const hs = v.height * (seated ? 1 : 1);
      const cosR = Math.cos(v.ry),
        sinR = Math.sin(v.ry);
      const L = (lx, ly, lz) => {
        // local (forward = -x) → world
        const x = -lx * cosR + lz * sinR;
        const z = lx * sinR + lz * cosR;
        return [v.x + x, ly + bob, v.z + z];
      };
      const rot = (lx, ly, lz) => ({ x: lx, y: ly, z: lz });

      const skin = v.skin,
        shirt = v.shirt;
      if (seated) {
        const hipY = 0.47 * hs;
        const t = L(0.02, hipY, 0);
        put('hips', t[0], t[1], t[2], 0, v.ry, 0, 1, 1, 1, v.trouser);
        const to = L(-0.02, hipY + 0.26, 0);
        put('torso', to[0], to[1], to[2], 0, v.ry, v.leanS + 0.06, 1.02 + br * 0.012, 1, 0.86, v.shirt);
        const hd = L(-0.06, hipY + 0.52, 0);
        put('head', hd[0], hd[1], hd[2], v.headT * 0.25, v.ry + v.headT * 0.5, 0.12 + v.leanS * 0.4, 1, 1.06, 1, skin);
        const hr = L(-0.045, hipY + 0.555, 0);
        put('hair', hr[0], hr[1], hr[2], 0.1 + v.leanS * 0.4, v.ry + v.headT * 0.5, 0, v.hairStyle ? 1.02 : 1.1, v.hairStyle ? 0.78 : 1.16, 1.02, v.hairCol);
        for (const s of [-1, 1]) {
          const th = L(-0.2, hipY + 0.01, s * 0.095);
          put('thigh', th[0], th[1], th[2], 0, v.ry, Math.PI / 2 + 0.06, 1, 1, 1, v.trouser);
          const sh = L(-0.34, hipY - 0.24, s * 0.1);
          put('shin', sh[0], sh[1], sh[2], 0, v.ry, 0.06, 1, 1, 1, v.trouser);
          const so = L(-0.37, 0.055, s * 0.1);
          put('shoe', so[0], so[1], so[2], 0, v.ry, 0, 1, 1, 1, SHOE);
          const ua = L(-0.03, hipY + 0.34, s * 0.2);
          put('upper', ua[0], ua[1], ua[2], 0, v.ry + s * 0.1, 0.42 + s * 0.06 + gesture * 0.9, 1, 1, 1, v.shirt);
          const fa = L(-0.19, hipY + 0.34 - gesture * 0.18, s * 0.15);
          put('fore', fa[0], fa[1], fa[2], 0, v.ry + s * 0.35, Math.PI / 2 - 0.2 - gesture * 1.1, 1, 1, 1, skin);
          const ha = L(-0.3, hipY + 0.33 - gesture * 0.34, s * 0.1);
          put('hand', ha[0], ha[1], ha[2], 0, v.ry, 0, 1, 1, 1, skin);
        }
      } else {
        const hipY = 0.9 * hs;
        const t = L(0, hipY, 0);
        put('hips', t[0], t[1], t[2], 0, v.ry, 0, 1, 1, 1, v.trouser);
        const to = L(0, hipY + 0.27, 0);
        put('torso', to[0], to[1], to[2], 0, v.ry, 0.02 + br * 0.01, 1.02, 1 + br * 0.006, 0.86, v.shirt);
        const hd = L(0.005, hipY + 0.6, 0);
        put('head', hd[0], hd[1], hd[2], 0, v.ry + v.headT * 0.4, -0.03, 1, 1.05, 1, skin);
        const hr = L(0.02, hipY + 0.635, 0);
        put('hair', hr[0], hr[1], hr[2], 0, v.ry + v.headT * 0.4, 0, v.hairStyle ? 1.02 : 1.12, v.hairStyle ? 0.8 : 1.1, 1.04, v.hairCol);
        for (const s of [-1, 1]) {
          const sw = s === -1 ? swing : swing2;
          const th = L(-sw * 0.09, hipY - 0.19, s * 0.085);
          put('thigh', th[0], th[1], th[2], 0, v.ry, sw * 0.9, 1, 1, 1, v.trouser);
          const bend = Math.max(0, -sw) * 0.55;
          const sh = L(-sw * 0.18 - bend * 0.13, hipY - 0.47, s * 0.085);
          put('shin', sh[0], sh[1], sh[2], 0, v.ry, -sw * 0.55 + bend, 1, 1, 1, v.trouser);
          const so = L(-sw * 0.24 - bend * 0.2, 0.03, s * 0.09);
          put('shoe', so[0], so[1], so[2], 0, v.ry, -sw * 0.2, 1, 1, 1, SHOE);
          const ua = L(0.01, hipY + 0.33, s * 0.19);
          put('upper', ua[0], ua[1], ua[2], 0, v.ry, -sw * 0.55, 1, 1, 1, v.shirt);
          const fa = L(0.03 - sw * 0.1, hipY + 0.15, s * 0.2);
          put('fore', fa[0], fa[1], fa[2], 0, v.ry, -sw * 0.4 + 0.35, 1, 1, 1, skin);
          const ha = L(0.02 - sw * 0.14, hipY + 0.03, s * 0.2);
          put('hand', ha[0], ha[1], ha[2], 0, v.ry, 0, 1, 1, 1, skin);
        }
      }
    }
    for (const k in inst) {
      const im = inst[k];
      im.count = data[k].n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  function removeFor(id) {
    look.delete(id);
  }

  return { group, inst, update, removeFor, look };
}
