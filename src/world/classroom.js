/* ============================================================================
   The classroom shell: floor, walls with real window/door openings, ceiling,
   skirting, glazing, curtains, whiteboard, corridor, exterior context.
   Openings are real holes, so the sun genuinely throws window rectangles of
   light across the floor and furniture.
   ==========================================================================*/
import * as THREE from 'three';
import { ROOM, WINDOWS, DOOR, ZONES } from '../config.js';
import { MAT, box, cyl, sph, plane, mesh, cap } from './materials.js';
import { TEX } from '../core/textures.js';
import { makeTextPlate } from '../core/labels.js';
import { clamp, lerp, DEG, TAU, seeded, smoothstep } from '../core/utils.js';

const X0 = -4.8,
  X1 = 4.8,
  Z0 = -3.3,
  Z1 = 3.3,
  H = 3.2,
  T = 0.18;

const slab = (w, h, d, mat, x, y, z, cast = true, rec = true) => mesh(box(w, h, d), mat, x, y, z, cast, rec);

export function sunDirection(timeOfDay, out = new THREE.Vector3()) {
  const p = clamp((timeOfDay - 7.4) / 10.2, 0, 1);
  const elev = (0.11 + Math.sin(p * Math.PI) * 0.82) * 1.0;
  const az = lerp(-62, 62, p) * DEG;
  return out.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)).normalize();
}

export function buildClassroom() {
  const group = new THREE.Group();
  const ceilingGroup = new THREE.Group();
  group.name = 'classroom';

  /* ---------------------------------------------------------------- floor */
  const floor = mesh(plane(ROOM.length, ROOM.width), MAT.floor, 0, 0.001, 0, false, true);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);
  // threshold strip at the door + a faint scuff ring near the board
  const scuff = mesh(new THREE.CircleGeometry(1.25, 28), new THREE.MeshBasicMaterial({ color: 0x8d7357, transparent: true, opacity: 0.055, depthWrite: false }), -3.4, 0.004, 0.2, false, false);
  scuff.rotation.x = -Math.PI / 2;
  group.add(scuff);

  /* ------------------------------------------------------------ ceiling */
  const ceil = mesh(plane(ROOM.length, ROOM.width), MAT.ceiling, 0, H - 0.002, 0, false, true);
  ceil.rotation.x = Math.PI / 2;
  ceilingGroup.add(ceil);
  // two RCC cross beams (real 6.6 m span classrooms have them)
  for (const bx of [-2.05, 2.05]) {
    const b = slab(T * 1.25, 0.26, ROOM.width + 0.02, MAT.concrete, bx, H - 0.13, 0, true, true);
    ceilingGroup.add(b);
  }
  // surface conduit runs feeding the sensors & the prototype bench
  const conduit = new THREE.Group();
  const condMat = MAT.plastic(0xdedcd4, 0.55);
  const runs = [
    [
      [-4.7, H - 0.06, 2.9],
      [-2.5, H - 0.06, 2.9],
      [-2.5, H - 0.06, 0],
    ],
    [
      [-4.7, H - 0.06, 2.9],
      [0.17, H - 0.06, 2.9],
      [0.17, H - 0.06, 0],
    ],
    [
      [-4.7, H - 0.06, 2.9],
      [2.9, H - 0.06, 2.9],
      [2.9, H - 0.06, 0],
    ],
    [
      [-4.7, H - 0.06, 2.9],
      [-4.7, H - 0.06, -3.0],
    ],
  ];
  runs.forEach((path) => {
    for (let i = 0; i < path.length - 1; i++) {
      const a = new THREE.Vector3(...path[i]),
        b = new THREE.Vector3(...path[i + 1]);
      const len = a.distanceTo(b);
      const m = slab(len, 0.035, 0.055, condMat, 0, 0, 0, false, false);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.lookAt(b);
      m.rotateY(Math.PI / 2);
      m.scale.set(1, 1, 1);
      ceilingGroup.add(m);
    }
  });
  ceilingGroup.add(conduit);
  // smoke detector + a sprinkler-ish ceiling rose for texture of a real room
  const det = new THREE.Group();
  det.add(mesh(cyl(0.075, 0.075, 0.035, 18), MAT.white, 0, 0, 0, false, false));
  det.add(mesh(cyl(0.02, 0.02, 0.012, 10), MAT.black, 0, -0.02, 0, false, false));
  det.position.set(-1.0, H - 0.02, -2.4);
  ceilingGroup.add(det);
  group.add(ceilingGroup);

  /* -------------------------------------------------------------- walls */
  const walls = new THREE.Group();
  group.add(walls);
  const W = (w, h, d, x, y, z, mat = MAT.wall) => {
    const m = slab(w, h, d, mat, x, y, z, true, true);
    walls.add(m);
    return m;
  };
  // front (whiteboard) wall & right wall: solid
  W(T, H, ROOM.width + 2 * T, X0 - T / 2, H / 2, 0);
  W(ROOM.length + 2 * T, H, T, 0, H / 2, Z1 + T / 2);
  // back wall with the doorway
  const dA = DOOR.x - DOOR.w / 2,
    dB = DOOR.x + DOOR.w / 2;
  const zLo = Z0 - T,
    zHi = Z1 + T;
  W(T, H, dA - zLo, X1 + T / 2, H / 2, (zLo + dA) / 2);
  W(T, H, zHi - dB, X1 + T / 2, H / 2, (dB + zHi) / 2);
  W(T, H - DOOR.h, DOOR.w, X1 + T / 2, DOOR.h + (H - DOOR.h) / 2, DOOR.x);
  // window wall (z-) built from piers, sill and header so the glass is a hole
  const wSpan = [WINDOWS[0].x - WINDOWS[0].w / 2, WINDOWS[WINDOWS.length - 1].x + WINDOWS[WINDOWS.length - 1].w / 2];
  const y0 = WINDOWS[0].y0,
    y1 = WINDOWS[0].y1;
  W(wSpan[1] - wSpan[0], y0, T, (wSpan[0] + wSpan[1]) / 2, y0 / 2, Z0 - T / 2); // under sill
  W(wSpan[1] - wSpan[0], H - y1, T, (wSpan[0] + wSpan[1]) / 2, y1 + (H - y1) / 2, Z0 - T / 2); // header
  let cursor = X0 - T;
  const pierEdges = [];
  WINDOWS.forEach((wd) => pierEdges.push([wd.x - wd.w / 2, wd.x + wd.w / 2]));
  pierEdges.push([wSpan[1], X1 + T]);
  let prev = X0 - T;
  for (const [a] of pierEdges) {
    if (a - prev > 0.001) W(a - prev, H, T, (prev + a) / 2, H / 2, Z0 - T / 2);
    prev = a + (WINDOWS.find((w2) => Math.abs(w2.x - w2.w / 2 - a) < 0.001)?.w || 0);
  }
  W(X1 + T - prev, H, T, (prev + X1 + T) / 2, H / 2, Z0 - T / 2);

  /* ---------------------------------------------------------- skirting */
  const sk = MAT.skirting;
  const SK = ROOM.skirtingH;
  group.add(slab(0.02, SK, ROOM.width, sk, X0 + 0.01, SK / 2, 0, false, true));
  group.add(slab(0.02, SK, ROOM.width, sk, X1 - 0.01, SK / 2, 0, false, true));
  group.add(slab(ROOM.length, SK, 0.02, sk, 0, SK / 2, Z1 - 0.01, false, true));
  const skWin = [];
  WINDOWS.forEach((wd) => skWin.push([wd.x - wd.w / 2 - 0.06, wd.x + wd.w / 2 + 0.06]));
  let lastZ = X0;
  skWin.forEach(([a, b]) => {
    if (a - lastZ > 0.01) group.add(slab(a - lastZ, SK, 0.02, sk, (lastZ + a) / 2, SK / 2, Z0 + 0.01, false, true));
    lastZ = b;
  });
  if (X1 - lastZ > 0.01) group.add(slab(X1 - lastZ, SK, 0.02, sk, (lastZ + X1) / 2, SK / 2, Z0 + 0.01, false, true));

  /* ------------------------------------------------- windows: frames, glass, grills, curtains */
  const curtains = [];
  const windowObjs = [];
  WINDOWS.forEach((wd, wi) => {
    const wg = new THREE.Group();
    wg.position.set(wd.x, (wd.y0 + wd.y1) / 2, Z0 - T / 2);
    const fw = wd.w,
      fh = wd.y1 - wd.y0;
    const Al = MAT.aluminium;
    // outer frame
    wg.add(slab(fw, 0.06, 0.1, Al, 0, fh / 2 - 0.03, 0, false, false));
    wg.add(slab(fw, 0.06, 0.1, Al, 0, -fh / 2 + 0.03, 0, false, false));
    wg.add(slab(0.055, fh, 0.1, Al, -fw / 2 + 0.028, 0, 0, false, false));
    wg.add(slab(0.055, fh, 0.1, Al, fw / 2 - 0.028, 0, 0, false, false));
    // two sliding shutters, each with a mid rail + glass
    for (const s of [-1, 1]) {
      const sx = (s * fw) / 4;
      const sw = fw / 2 - 0.04;
      const sh = new THREE.Group();
      sh.position.set(sx, 0, s * 0.03);
      sh.add(slab(sw, 0.05, 0.05, Al, 0, fh / 2 - 0.13, 0, false, false));
      sh.add(slab(sw, 0.05, 0.05, Al, 0, -fh / 2 + 0.13, 0, false, false));
      sh.add(slab(0.045, fh - 0.2, 0.05, Al, -sw / 2 + 0.02, 0, 0, false, false));
      sh.add(slab(0.045, fh - 0.2, 0.05, Al, sw / 2 - 0.02, 0, 0, false, false));
      sh.add(slab(0.035, fh - 0.26, 0.045, Al, 0, 0, 0, false, false)); // centre mullion
      const glass = mesh(plane(sw - 0.05, fh - 0.26), MAT.glass, 0, 0, 0, false, false);
      sh.add(glass);
      wg.add(sh);
    }
    // external grill bars
    for (let i = 0; i < 5; i++) {
      const bx = -fw / 2 + 0.16 + (i * (fw - 0.32)) / 4;
      wg.add(mesh(cyl(0.014, 0.014, fh + 0.06, 8), MAT.metalDark, bx, 0, -0.115, false, false));
    }
    wg.add(slab(fw + 0.1, 0.02, 0.02, MAT.metalDark, 0, fh / 2 + 0.02, -0.115, false, false));
    wg.add(slab(fw + 0.1, 0.02, 0.02, MAT.metalDark, 0, -fh / 2 - 0.02, -0.115, false, false));
    // internal stone sill
    group.add(slab(fw + 0.16, 0.035, 0.26, MAT.concrete, wd.x, wd.y0 - 0.02, Z0 + 0.05, true, true));
    // curtain rod + two tied-back panels
    const rodY = wd.y1 + 0.2;
    group.add(mesh(cyl(0.014, 0.014, fw + 0.44, 10), MAT.metalDark, wd.x, rodY, Z0 + 0.13, false, false).rotateZ(Math.PI / 2));
    for (const s of [-1, 1]) {
      const cw = fw * 0.42,
        chh = wd.y1 - wd.y0 + 0.55;
      const geo = new THREE.PlaneGeometry(cw, chh, 14, 8);
      const base = geo.attributes.position.array.slice(0);
      const cm = new THREE.Mesh(geo, MAT.curtain);
      cm.material = MAT.curtain;
      cm.castShadow = true;
      cm.receiveShadow = true;
      cm.position.set(wd.x + s * (fw / 2 - cw / 2 + 0.03), wd.y1 + 0.28 - chh / 2, Z0 + 0.1);
      cm.rotation.y = s * 0.06;
      curtains.push({ mesh: cm, base, phase: wi * 1.3 + s, side: s, x0: wd.x + s * (fw / 2 - cw / 2 + 0.03) });
      group.add(cm);
      // tie-back band
      const band = mesh(cyl(0.028, 0.028, cw * 1.02, 8), MAT.fabric, cm.position.x, wd.y0 + 0.16, Z0 + 0.1, false, false);
      band.rotation.z = Math.PI / 2;
      group.add(band);
    }
    windowObjs.push(wg);
    group.add(wg);
  });

  /* ----------------------------------------------------------- the door */
  const doorPivot = new THREE.Group();
  doorPivot.position.set(X1, 0, DOOR.x - DOOR.w / 2);
  const shutter = new THREE.Group();
  const dw = DOOR.w,
    dh = DOOR.h;
  const doorMat = MAT.plastic(0x7d6a55, 0.42);
  const panel = slab(0.045, dh - 0.06, dw - 0.05, doorMat, 0, dh / 2, dw / 2, true, true);
  shutter.add(panel);
  // recessed panels & a vision glass strip
  for (const py of [dh * 0.3, dh * 0.72]) {
    shutter.add(slab(0.012, 0.5, 0.5, MAT.woodDark, -0.028, py, dw / 2, false, false));
    shutter.add(slab(0.012, 0.5, 0.5, MAT.woodDark, 0.028, py, dw / 2, false, false));
  }
  shutter.add(slab(0.05, 0.34, 0.14, MAT.metal, 0, dh - 0.25, dw / 2 - 0.09, false, false)); // closer
  // lever handle both sides
  for (const s of [-1, 1]) {
    const hg = new THREE.Group();
    hg.position.set(s * 0.035, 1.02, dw - 0.13);
    hg.add(mesh(cyl(0.02, 0.02, 0.05, 10), MAT.aluminium, 0, 0, 0, false, false).rotateZ(Math.PI / 2));
    const lever = mesh(cyl(0.012, 0.012, 0.12, 8), MAT.aluminium, 0, 0, 0, false, false);
    lever.rotation.x = Math.PI / 2;
    lever.position.set(s * 0.05, -0.005, -0.05);
    hg.add(lever);
    shutter.add(hg);
  }
  // hinges
  for (const hy of [0.32, 1.02, 1.74]) shutter.add(slab(0.05, 0.09, 0.03, MAT.metalDark, 0.02, hy, 0.045, false, false));
  doorPivot.add(shutter);
  group.add(doorPivot);
  // frame + ventilator louvers
  const frMat = MAT.concrete;
  group.add(slab(T + 0.04, dh + 0.06, 0.07, frMat, X1 + T / 2, (dh + 0.06) / 2, DOOR.x - DOOR.w / 2 - 0.035, false, true));
  group.add(slab(T + 0.04, dh + 0.06, 0.07, frMat, X1 + T / 2, (dh + 0.06) / 2, DOOR.x + DOOR.w / 2 + 0.035, false, true));
  group.add(slab(0.04, 0.06, dw + 0.14, MAT.metalDark, X1 - 0.005, dh + 0.03, DOOR.x, false, false));
  const vent = new THREE.Group();
  vent.position.set(X1 - 0.02, 2.62, DOOR.x);
  for (let i = 0; i < 6; i++) {
    const lv = slab(0.06, 0.055, dw - 0.06, MAT.aluminium, 0, -0.22 + i * 0.088, 0, false, false);
    lv.rotation.z = 0.5;
    vent.add(lv);
  }
  group.add(vent);
  // room number plate beside the door (inside)
  const plate = makeTextPlate({ w: 512, h: 150, bg: 'rgba(238,229,208,0.96)', border: 'rgba(90,70,50,0.35)', color: '#3a2c1f', font: '600 40px Sora, sans-serif' });
  plate.draw(['ROOM 204 · SEM VI', { 0: 'ELECTRICAL ENGG. BLOCK C', 1: {} }].map((s) => (typeof s === 'string' ? s : s[0])), {});
  plate.ctx.fillStyle = '#8c4a22';
  plate.ctx.font = '400 30px "IBM Plex Mono", monospace';
  plate.ctx.fillText('ELECTRICAL ENGG. BLOCK C', 24, 92);
  plate.tex.needsUpdate = true;
  const plateMesh = new THREE.Mesh(plane(0.62, 0.18), new THREE.MeshStandardMaterial({ map: plate.tex, roughness: 0.5, metalness: 0.05 }));
  plateMesh.position.set(X1 - 0.012, 2.36, DOOR.x + 0.72);
  plateMesh.rotation.y = -Math.PI / 2;
  group.add(plateMesh);

  /* --------------------------------------------------- whiteboard wall */
  const boardGroup = new THREE.Group();
  const bw = 3.72,
    bh = 1.3;
  const boardY = 1.62;
  const board = mesh(plane(bw, bh), MAT.whiteboard, X0 + 0.03, boardY, -0.15, false, true);
  board.rotation.y = Math.PI / 2;
  boardGroup.add(board);
  boardGroup.add(slab(0.05, bh + 0.09, 0.05, MAT.boardFrame, X0 + 0.02, boardY, -0.15 - bw / 2 - 0.02, false, false));
  boardGroup.add(slab(0.05, bh + 0.09, 0.05, MAT.boardFrame, X0 + 0.02, boardY, -0.15 + bw / 2 + 0.02, false, false));
  boardGroup.add(slab(0.05, 0.05, bw + 0.14, MAT.boardFrame, X0 + 0.02, boardY + bh / 2 + 0.02, -0.15, false, false));
  boardGroup.add(slab(0.06, 0.05, bw + 0.14, MAT.boardFrame, X0 + 0.02, boardY - bh / 2 - 0.02, -0.15, false, false));
  boardGroup.add(slab(0.09, 0.045, bw - 0.3, MAT.aluminium, X0 + 0.06, boardY - bh / 2 - 0.075, -0.15, false, false)); // marker tray
  for (let i = 0; i < 4; i++) {
    const mk = mesh(cyl(0.011, 0.011, 0.11, 8), MAT.plastic([0xb3402f, 0x2f4bb3, 0x2c7a44, 0x2b2b2b][i], 0.4), X0 + 0.075, boardY - bh / 2 - 0.05, -0.15 - 0.55 + i * 0.14, false, false);
    mk.rotation.x = Math.PI / 2;
    boardGroup.add(mk);
  }
  boardGroup.add(slab(0.03, 0.05, 0.13, MAT.plastic(0x3a5a70, 0.6), X0 + 0.075, boardY - bh / 2 - 0.048, -0.15 + 0.62, false, false)); // duster
  // smartboard touch panel + speaker pair
  const sp = new THREE.Group();
  sp.add(slab(0.12, 0.2, 0.16, MAT.plastic(0x2d2f33, 0.5), 0, 0, 0, false, false));
  sp.add(mesh(plane(0.1, 0.16), MAT.plastic(0x1b1d20, 0.7), 0.061, 0, 0, false, false).rotateY(Math.PI / 2));
  sp.position.set(X0 + 0.08, 2.62, -1.9);
  boardGroup.add(sp);
  const sp2 = sp.clone();
  sp2.position.set(X0 + 0.08, 2.62, 1.6);
  boardGroup.add(sp2);
  // wall-mounted projector above the third row
  const proj = new THREE.Group();
  proj.add(slab(0.34, 0.12, 0.28, MAT.plastic(0xe6e4de, 0.42), 0, 0, 0, true, false));
  proj.add(mesh(cyl(0.05, 0.05, 0.05, 14), MAT.plastic(0x17181a, 0.3), 0.0, -0.02, 0.16, false, false).rotateX(Math.PI / 2));
  proj.add(slab(0.06, 0.16, 0.06, MAT.metal, 0, 0.13, 0, false, false));
  proj.position.set(X0 + 0.85, H - 0.2, -0.15);
  boardGroup.add(proj);
  const projLed = mesh(sph(0.012, 8), new THREE.MeshBasicMaterial({ color: 0x7fe0a0 }), X0 + 0.85, H - 0.2, -0.0);
  boardGroup.add(projLed);
  group.add(boardGroup);

  /* --------------------------------------------------- rear notice board */
  const nb = new THREE.Group();
  nb.position.set(X1 - 0.02, 1.75, -1.65);
  nb.rotation.y = -Math.PI / 2;
  nb.add(slab(1.72, 1.18, 0.03, MAT.woodDark, 0, 0, 0, false, true));
  nb.add(slab(1.62, 1.08, 0.02, MAT.plastic(0x9b3b2e, 0.85), 0, 0, 0.02, false, false));
  const R = seeded(12);
  for (let i = 0; i < 9; i++) {
    const pw = 0.2 + R() * 0.16,
      ph = 0.24 + R() * 0.18;
    const p = mesh(plane(pw, ph), MAT.paper, -0.62 + R() * 1.2, -0.34 + R() * 0.62, 0.032, false, false);
    p.rotation.z = (R() - 0.5) * 0.16;
    nb.add(p);
    nb.add(mesh(cyl(0.008, 0.008, 0.02, 6), MAT.plastic(0xd8b26a, 0.4), p.position.x, p.position.y + ph / 2 - 0.02, 0.04, false, false).rotateX(Math.PI / 2));
  }
  group.add(nb);

  /* ---------------------------------------------------------- posters */
  const mkPoster = (texKey, w, h, x, y, z, ry) => {
    const m = new THREE.Mesh(plane(w, h), new THREE.MeshStandardMaterial({ map: TEX.poster(texKey), roughness: 0.78, metalness: 0 }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  mkPoster('energy', 0.86, 0.86, Z1 - 0.012, 1.94, 2.35, -Math.PI / 2);
  mkPoster('timetable', 0.8, 1.0, Z1 - 0.012, 1.86, -1.0, -Math.PI / 2);
  mkPoster('barchart', 0.78, 0.78, X0 + 0.012, 1.78, 2.15, Math.PI / 2);

  /* ------------------------------------------------------------- clock */
  const clock = new THREE.Group();
  clock.position.set(X0 + 0.05, 2.62, 2.45);
  clock.add(mesh(cyl(0.15, 0.15, 0.06, 24), MAT.plastic(0x2b2b2e, 0.5), 0, 0, 0, false, false).rotateZ(Math.PI / 2));
  const face = new THREE.Mesh(plane(0.26, 0.26), new THREE.MeshStandardMaterial({ color: 0xf7f3e8, roughness: 0.4 }));
  face.position.set(0.033, 0, 0);
  face.rotation.y = Math.PI / 2;
  clock.add(face);
  const handMat = new THREE.MeshBasicMaterial({ color: 0x2a2320 });
  const hourHand = mesh(box(0.006, 0.075, 0.012), handMat, 0.036, 0.02, 0, false, false);
  const minHand = mesh(box(0.005, 0.108, 0.01), handMat, 0.037, 0, 0.02, false, false);
  const handPivotH = new THREE.Group();
  const handPivotM = new THREE.Group();
  hourHand.position.set(0, -0.036, 0);
  minHand.position.set(0, -0.052, 0);
  handPivotH.add(hourHand);
  handPivotM.add(minHand);
  const hp = new THREE.Group();
  hp.position.set(0.037, 0, 0);
  hp.rotation.y = Math.PI / 2;
  handPivotH.position.z = 0.001;
  handPivotM.position.z = 0.002;
  hp.add(handPivotH, handPivotM);
  clock.add(hp);
  clock.userData.hands = { h: handPivotH, m: handPivotM };
  group.add(clock);

  /* --------------------------------------------- teacher desk & chair */
  const teacher = new THREE.Group();
  teacher.position.set(-3.95, 0, 1.95);
  teacher.rotation.y = Math.PI;
  const tdTop = slab(1.62, 0.04, 0.78, MAT.laminate, 0, 0.76, 0, true, true);
  teacher.add(tdTop);
  teacher.add(slab(1.56, 0.42, 0.04, MAT.laminateDark, 0, 0.52, -0.36, true, true));
  teacher.add(slab(0.06, 0.72, 0.72, MAT.laminateDark, -0.76, 0.37, 0, true, true));
  teacher.add(slab(0.06, 0.72, 0.72, MAT.laminateDark, 0.76, 0.37, 0, true, true));
  for (const dx of [-0.55, 0.2]) {
    const drawer = slab(0.42, 0.5, 0.6, MAT.laminateDark, dx, 0.28, 0.02, true, true);
    teacher.add(drawer);
    for (const dy of [0.44, 0.24, 0.06]) {
      teacher.add(slab(0.34, 0.02, 0.02, MAT.aluminium, dx, dy, 0.33, false, false));
    }
  }
  // lectern items
  const bookStack = new THREE.Group();
  for (let i = 0; i < 3; i++) bookStack.add(slab(0.22, 0.032, 0.3, MAT.plastic([0x8c3f31, 0x2f4b6e, 0x51663f][i], 0.6), 0, 0.016 + i * 0.034, 0, true, false));
  bookStack.position.set(-0.5, 0.79, 0.02);
  teacher.add(bookStack);
  teacher.add(mesh(cyl(0.042, 0.036, 0.09, 14), MAT.plastic(0xe9e2d2, 0.4), 0.42, 0.825, 0.16, true, false)); // mug
  teacher.add(slab(0.03, 0.05, 0.02, MAT.plastic(0xe9e2d2, 0.4), 0.47, 0.83, 0.16, false, false));
  const papers = mesh(plane(0.21, 0.29), MAT.paper, 0.1, 0.783, -0.05, false, true);
  papers.rotation.x = -Math.PI / 2;
  papers.rotation.z = 0.1;
  teacher.add(papers);
  const tc = new THREE.Group();
  tc.position.set(0.1, 0, 0.72);
  tc.add(slab(0.44, 0.05, 0.44, MAT.woodDark, 0, 0.44, 0, true, true));
  tc.add(slab(0.44, 0.42, 0.05, MAT.woodDark, 0, 0.68, 0.2, true, true));
  for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) tc.add(slab(0.04, 0.44, 0.04, MAT.metal, lx, 0.22, lz, false, false));
  teacher.add(tc);
  group.add(teacher);

  /* ----------------------------------- side furniture: almirah, bins, bench */
  const alm = new THREE.Group();
  alm.position.set(4.05, 0, 2.55);
  alm.add(slab(1.0, 1.9, 0.44, MAT.metal, 0, 0.95, 0, true, true));
  for (const sz of [-0.24, 0.24]) {
    alm.add(slab(0.02, 1.78, 0.46, MAT.metalDark, -0.5 - 0.005, 0.95, sz, true, false));
  }
  alm.add(slab(0.03, 1.78, 0.02, MAT.metalDark, -0.515, 0.95, 0, false, false));
  for (const sz of [-0.1, 0.1]) alm.add(slab(0.02, 0.1, 0.03, MAT.aluminium, -0.53, 1.05, sz * 2.2, false, false));
  alm.add(slab(1.04, 0.05, 0.48, MAT.metal, 0, 1.93, 0, true, false));
  group.add(alm);

  const bin = new THREE.Group();
  bin.position.set(X1 - 0.45, 0, DOOR.x + 1.15);
  bin.add(mesh(cyl(0.17, 0.14, 0.4, 16), MAT.plastic(0x4a4f45, 0.6), 0, 0.2, 0, true, true));
  group.add(bin);
  // broom & mop leaning in the corner
  const stick = (x, z, rot, col) => {
    const s = new THREE.Group();
    s.add(mesh(cyl(0.016, 0.016, 1.25, 8), MAT.wood, 0, 0.62, 0, true, false));
    s.add(slab(0.09, 0.16, 0.05, MAT.plastic(col, 0.6), 0, -0.02, 0, true, false));
    s.position.set(x, 0.06, z);
    s.rotation.set(0.16, 0, rot);
    return s;
  };
  group.add(stick(X1 - 0.28, DOOR.x + 1.5, 0.1, 0xa07542));
  group.add(stick(X1 - 0.28, DOOR.x + 1.72, -0.06, 0x8f9aa2));

  /* ------------------------------------- ecoSwitch demo plinth (front R) */
  // a sturdy side table that carries the prototype — electronics sit on it
  const plinth = new THREE.Group();
  plinth.position.set(-4.12, 0, -2.35);
  plinth.add(slab(1.15, 0.05, 0.62, MAT.wood, 0, 0.74, 0, true, true));
  plinth.add(slab(1.1, 0.06, 0.58, MAT.woodDark, 0, 0.68, 0, true, true));
  for (const [lx, lz] of [[-0.5, -0.24], [0.5, -0.24], [-0.5, 0.24], [0.5, 0.24]]) plinth.add(slab(0.05, 0.7, 0.05, MAT.metal, lx, 0.35, lz, false, false));
  plinth.add(slab(1.06, 0.03, 0.5, MAT.metal, 0, 0.24, 0, true, true));
  group.add(plinth);

  /* ------------------------------------------------- zone floor markers */
  const zoneLabels = [];
  ZONES.forEach((z, i) => {
    const p = makeTextPlate({ w: 512, h: 96, bg: 'none', border: 'none', color: '#7d6a52', font: '600 44px Sora, sans-serif', align: 'left' });
    p.draw([`${z.tag}  ·  ${z.label}`]);
    const m = new THREE.Mesh(plane(1.62, 0.3), new THREE.MeshBasicMaterial({ map: p.tex, transparent: true, opacity: 0.55, depthWrite: false }));
    m.position.set((z.x0 + z.x1) / 2, 0.006, Z1 - 0.42);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 2;
    group.add(m);
    zoneLabels.push({ mesh: m, plate: p, zone: i });
  });

  /* -------------------------------------------------- corridor outside */
  const corridor = new THREE.Group();
  const cx0 = X1 + T,
    cx1 = X1 + 2.5;
  corridor.add(slab(cx1 - cx0, 0.04, ROOM.width + 2 * T, MAT.concrete, (cx0 + cx1) / 2, -0.02, 0, false, true));
  corridor.add(slab(cx1 - cx0, 0.1, ROOM.width + 2 * T, MAT.extWall, (cx0 + cx1) / 2, H + 0.05, 0, false, true));
  for (const cz of [Z0 - T, Z1 + T]) corridor.add(slab(cx1 - cx0, H, T, MAT.extWall, (cx0 + cx1) / 2, H / 2, cz, false, true));
  for (const px of [cx1 - 0.15]) for (const pz of [-2.2, 1.0]) {
    const col = slab(0.3, H, 0.3, MAT.concrete, px, H / 2, pz, true, true);
    corridor.add(col);
  }
  // corridor lights (always on, dim)
  const corrTube = new THREE.Group();
  for (const lz of [-2.2, 1.0]) {
    const t = slab(0.9, 0.07, 0.16, MAT.plastic(0xdcd9d0, 0.5), cx0 + 1.1, H - 0.12, lz, false, false);
    corrTube.add(t);
    const em = new THREE.Mesh(plane(0.8, 0.1), new THREE.MeshBasicMaterial({ color: 0xffeccb }));
    em.position.set(cx0 + 1.1, H - 0.16, lz);
    em.rotation.x = Math.PI / 2;
    corrTube.add(em);
  }
  corridor.add(corrTube);
  // a bench and a notice board in the corridor
  const cb = new THREE.Group();
  cb.add(slab(0.42, 0.05, 1.5, MAT.wood, cx1 - 0.32, 0.44, -1.2, true, true));
  for (const [lx, lz] of [[-0.16, -0.66], [0.16, -0.66], [-0.16, 0.66], [0.16, 0.66]])
    cb.add(slab(0.05, 0.44, 0.05, MAT.metalDark, cx1 - 0.32 + lx, 0.22, -1.2 + lz, false, false));
  corridor.add(cb);
  group.add(corridor);

  /* ------------------------------------------------- exterior context */
  const exterior = new THREE.Group();
  // sky dome
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x8fb3c9) },
      mid: { value: new THREE.Color(0xd9d7c8) },
      bot: { value: new THREE.Color(0xa99f8a) },
      sunDir: { value: new THREE.Vector3(0.3, 0.5, -0.8) },
      sunCol: { value: new THREE.Color(0xffe6b4) },
      haze: { value: 0.55 },
    },
    vertexShader: `varying vec3 vW; void main(){ vW = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `
      varying vec3 vW; uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 sunCol; uniform float haze;
      void main(){
        float h = clamp(vW.y*1.05+0.06, -0.2, 1.0);
        vec3 c = mix(bot, mid, smoothstep(-0.15, 0.16, h));
        c = mix(c, top, smoothstep(0.12, 0.75, h));
        float s = max(dot(normalize(vW), normalize(sunDir)), 0.0);
        c += sunCol * pow(s, 260.0) * 2.4;             // disc
        c += sunCol * pow(s, 7.0) * 0.30 * haze;        // bloom around the sun
        c = mix(c, mix(bot, mid, 0.35), smoothstep(0.35, 0.0, h) * 0.5); // horizon haze
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 18), skyMat);
  exterior.add(sky);
  const ground = mesh(plane(320, 320), MAT.ground, 0, -0.06, -120, false, false);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = false;
  exterior.add(ground);
  // neighbouring academic blocks
  const Rb = seeded(3);
  const winMat = new THREE.MeshStandardMaterial({ color: 0x6c6f70, roughness: 0.2, metalness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const bwid = 9 + Rb() * 10,
      bhgt = 7 + Rb() * 12,
      bdep = 6 + Rb() * 6;
    const bx = -55 + i * 22 + Rb() * 6,
      bz = -34 - Rb() * 26;
    const b = slab(bwid, bhgt, bdep, MAT.building, bx, bhgt / 2 - 0.06, bz, false, false);
    exterior.add(b);
    for (let f = 0; f < Math.floor(bhgt / 3.2); f++) {
      const band = slab(bwid + 0.04, 0.9, bdep + 0.04, winMat, bx, 1.6 + f * 3.2, bz, false, false);
      band.scale.set(1, 1, 0.02);
      exterior.add(band);
    }
  }
  // compound wall + gate piers + trees
  exterior.add(slab(90, 1.9, 0.24, MAT.concrete, -10, 0.95, -14.5, false, false));
  for (let i = 0; i < 7; i++) {
    const tx = -30 + i * 9 + Rb() * 3,
      tz = -12.5 - Rb() * 2.4;
    const tr = new THREE.Group();
    tr.add(mesh(cyl(0.16, 0.22, 2.6, 8), MAT.trunk, 0, 1.3, 0, false, false));
    const f1 = mesh(sph(1.35, 10), MAT.bush, 0, 3.1, 0, false, false);
    const f2 = mesh(sph(0.95, 10), MAT.bush, 0.75, 2.5, 0.3, false, false);
    tr.add(f1, f2);
    tr.position.set(tx, 0, tz);
    exterior.add(tr);
  }
  // flag pole (very Indian-campus)
  const pole = new THREE.Group();
  pole.add(mesh(cyl(0.07, 0.09, 8.4, 10), MAT.metal, 0, 4.2, 0, false, false));
  const flag = mesh(plane(1.5, 0.95), new THREE.MeshStandardMaterial({ color: 0xe7e2d6, roughness: 0.85, side: THREE.DoubleSide }), 0.8, 7.7, 0, false, false);
  pole.add(flag);
  pole.position.set(-2.5, 0, -9.5);
  exterior.add(pole);
  group.add(exterior);

  /* ------------------------------------------- sun shafts + floor pools */
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { col: { value: new THREE.Color(0xffe0a8) }, strength: { value: 0.5 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `varying vec2 vUv; uniform vec3 col; uniform float strength;
      void main(){ float a = (1.0-vUv.y); a *= smoothstep(0.0,0.25,vUv.x)*smoothstep(1.0,0.75,vUv.x);
      a = pow(a,1.6)*strength; gl_FragColor = vec4(col*a, a); }`,
  });
  const shafts = [];
  WINDOWS.forEach((wd) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1]), 2));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    const m = new THREE.Mesh(geo, shaftMat);
    m.frustumCulled = false;
    shafts.push({ mesh: m, geo, win: wd });
    group.add(m);
  });
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xffdca2, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const pools = [];
  WINDOWS.forEach((wd) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    const m = new THREE.Mesh(geo, poolMat);
    m.rotation.x = 0;
    m.frustumCulled = false;
    pools.push({ mesh: m, geo, win: wd });
    group.add(m);
  });

  const tmp = new THREE.Vector3();
  const trav = new THREE.Vector3();
  function updateSunVisuals(towardSun, daylight) {
    shaftMat.uniforms.strength.value = 0.1 + daylight * 0.42;
    poolMat.opacity = 0.05 + daylight * 0.16;
    trav.copy(towardSun).negate(); // direction the light travels (trav.y < 0)
    const dy = Math.min(-0.06, trav.y);
    for (const s of shafts) {
      const w = s.win;
      const hw = w.w / 2;
      const zW = Z0 + 0.03;
      const len = Math.min(12.5, (w.y1 - 0.05) / -dy);
      const yEnd = Math.max(0.0, w.y1 + dy * len);
      const p = s.geo.attributes.position.array;
      p[0] = w.x - hw; p[1] = w.y1; p[2] = zW;
      p[3] = w.x + hw; p[4] = w.y1; p[5] = zW;
      p[6] = w.x - hw + trav.x * len; p[7] = yEnd; p[8] = zW + trav.z * len;
      p[9] = w.x + hw + trav.x * len; p[10] = yEnd; p[11] = zW + trav.z * len;
      s.geo.attributes.position.needsUpdate = true;
    }
    for (const pl of pools) {
      const w = pl.win;
      const hw = w.w / 2;
      const zW = Z0 + 0.04;
      const lenTop = (w.y1 - 0.02) / -dy;
      const lenBot = Math.max(0.05, (w.y0 - 0.02) / -dy);
      const p = pl.geo.attributes.position.array;
      const pts = [
        [w.x - hw + trav.x * lenTop, zW + trav.z * lenTop],
        [w.x + hw + trav.x * lenTop, zW + trav.z * lenTop],
        [w.x - hw + trav.x * lenBot, zW + trav.z * lenBot],
        [w.x + hw + trav.x * lenBot, zW + trav.z * lenBot],
      ];
      pts.forEach((q, i) => {
        p[i * 3] = q[0];
        p[i * 3 + 1] = 0.014;
        p[i * 3 + 2] = q[1];
      });
      pl.geo.attributes.position.needsUpdate = true;
    }
    skyMat.uniforms.sunDir.value.copy(towardSun);
  }

  /* ---------------------------------------------------------- dynamics */
  let t = 0;
  function update(dt, env) {
    t += dt;
    // curtains breathe in the breeze
    const amp = 0.012 + env.breeze * 0.075;
    for (const c of curtains) {
      const pos = c.mesh.geometry.attributes.position;
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        const bx = c.base[i],
          by = c.base[i + 1];
        const w = Math.sin(bx * 7.4 + t * 1.7 + c.phase) * (0.55 + 0.45 * Math.sin(by * 1.3 + t * 0.7));
        arr[i + 2] = c.base[i + 2] + w * amp * (0.35 + 0.65 * smoothstep((0.4 - by) * 0.9));
        arr[i] = bx + Math.sin(t * 1.1 + c.phase) * amp * 0.16;
      }
      pos.needsUpdate = true;
      c.mesh.position.x = c.x0 + Math.sin(t * 0.6 + c.phase) * amp * 0.25;
    }
    // door swings for arrivals & departures
    const want = env.doorOpen > 0.02 ? env.doorOpen : 0;
    doorPivot.rotation.y = lerp(doorPivot.rotation.y, want * 1.16, 1 - Math.exp(-6 * dt));
    // clock hands follow simulated time of day
    const hAng = ((env.timeOfDay % 12) / 12) * TAU;
    const mAng = ((env.timeOfDay * 60) % 60) / 60 * TAU;
    clock.userData.hands.h.rotation.z = -hAng;
    clock.userData.hands.m.rotation.z = -mAng;
    updateSunVisuals(sunDirection(env.timeOfDay, tmp), env.daylight);
    // flag gently flapping
    flag.rotation.y = Math.sin(t * 1.6) * 0.1;
    flag.position.x = 0.8 + Math.sin(t * 1.6) * 0.02;
  }

  return {
    group,
    ceilingGroup,
    corridor,
    exterior,
    floorMesh: floor,
    curtains,
    zoneLabels,
    doorPivot,
    update,
    sunDir: tmp,
  };
}
