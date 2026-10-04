/* ============================================================================
   Hardware: the sensing hardware, and the protected low-voltage prototype
   bench (ESP32-S3 · OLED · buzzer · breadboard · MOSFET board · 5 V DC motors).

   Control architecture is modelled honestly:
     sensor → ESP32-S3 GPIO (3.3 V logic) → 10 k gate pulldown + MOSFET gate
     → MOSFET switches the 5 V motor circuit → motor (with 1N4007 flyback
     diode across it). No motor is ever wired to a GPIO.
   Everything sits on a surface. Wires follow plausible paths.
   ==========================================================================*/
import * as THREE from 'three';
import { SENSORS, ROOM, ZONES, FANS, LIGHTS, TIMING } from '../config.js';
import { MAT, box, cyl, plane, sph, mesh, cap } from './materials.js';
import { makeTextPlate, makeOledPlate } from '../core/labels.js';
import { TEX } from '../core/textures.js';
import { clamp, lerp, damp, TAU, seeded } from '../core/utils.js';

/* ------------------------------------------------------------ wire helper */
export function wire(points, radius, color, seg = 34, emis = 0) {
  const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
  const geo = new THREE.TubeGeometry(curve, seg, radius, 6, false);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, emissive: new THREE.Color(color).multiplyScalar(emis) });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}
function arc(a, b, lift = 0.05, sag = 0) {
  const A = new THREE.Vector3(...a),
    B = new THREE.Vector3(...b);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  mid.y += lift;
  const q = A.clone().add(mid).multiplyScalar(0.5);
  q.y += lift * 0.45;
  const q2 = mid.clone().add(B).multiplyScalar(0.5);
  q2.y += lift * 0.45;
  if (sag) {
    mid.y -= sag;
    q.y -= sag * 0.6;
    q2.y -= sag * 0.6;
  }
  return [a, [q.x, q.y, q.z], [mid.x, mid.y, mid.z], [q2.x, q2.y, q2.z], b];
}

/* ============================ SENSORS ==================================== */
export function buildSensors() {
  const group = new THREE.Group();
  group.name = 'sensors';
  const list = [];

  for (const s of SENSORS) {
    const g = new THREE.Group();
    g.position.set(s.x, s.y, s.z);
    if (s.kind === 'mmwave') {
      // ceiling back-box + white radar module with a dark lens window
      g.add(mesh(cyl(0.062, 0.062, 0.022, 20), MAT.white, 0, -0.011, 0, false, false));
      const body = mesh(box(0.062, 0.018, 0.046), MAT.plastic(0xf3f0e8, 0.42), 0, -0.03, 0, false, false);
      g.add(body);
      const lens = mesh(plane(0.03, 0.018), new THREE.MeshStandardMaterial({ color: 0x1d2124, roughness: 0.25, metalness: 0.2 }), 0, -0.0395, 0, false, false);
      lens.rotation.x = Math.PI / 2;
      g.add(lens);
      const led = mesh(sph(0.0045, 8), new THREE.MeshBasicMaterial({ color: 0x49d67f }), 0.022, -0.036, 0.016, false, false);
      g.add(led);
      const lab = makeTextPlate({ w: 256, h: 64, bg: 'rgba(250,246,236,0.85)', border: 'rgba(80,66,50,0.3)', color: '#4a3426', font: '600 24px "IBM Plex Mono", monospace', align: 'center' });
      lab.draw(['24 GHz · LD2410']);
      const lp = new THREE.Mesh(plane(0.05, 0.013), new THREE.MeshBasicMaterial({ map: lab.tex, transparent: true }));
      lp.position.set(0, -0.031, 0.0235);
      g.add(lp);
      // tiny screws into the slab
      for (const sx of [-0.024, 0.024]) g.add(mesh(cyl(0.0035, 0.0035, 0.006, 6), MAT.metalDark, sx, -0.023, 0, false, false));
    } else {
      // wall PIR: base + faceted fresnel dome, aimed into the room
      const yaw = s.yaw * (Math.PI / 180);
      const holder = new THREE.Group();
      holder.rotation.y = yaw + Math.PI / 2;
      holder.add(mesh(box(0.072, 0.056, 0.028), MAT.plastic(0xf5f2ea, 0.5), 0, 0, -0.014, false, false));
      const dome = mesh(sph(0.036, 16), new THREE.MeshStandardMaterial({ color: 0xf7f4ea, roughness: 0.28, metalness: 0.02, transparent: true, opacity: 0.88, emissive: new THREE.Color(0x1a1208), emissiveIntensity: 0.2 }), 0, 0, 0.014, false, false);
      dome.scale.set(1.18, 0.86, 0.7);
      holder.add(dome);
      // fresnel facet ring
      const ring = mesh(new THREE.TorusGeometry(0.03, 0.0035, 6, 20), MAT.plastic(0xe6e1d4, 0.4), 0, 0, 0.026, false, false);
      holder.add(ring);
      const led = mesh(sph(0.004, 8), new THREE.MeshBasicMaterial({ color: 0xff6a3d }), 0.026, -0.016, 0.004, false, false);
      holder.add(led);
      g.add(holder);
      g.userData.holder = holder;
    }
    g.userData.pick = { kind: s.kind, id: s.id, zone: s.zone, title: `${s.kind === 'pir' ? 'PIR motion sensor' : '24 GHz mmWave radar'} · ${ZONES[s.zone].tag}` };
    group.add(g);
    list.push({ cfg: s, obj: g, led: g.userData.holder ? g.userData.holder.children[3] : g.children[3], pulse: 0, dome: g.userData.holder ? g.userData.holder.children[1] : null });
  }

  function update(dt, sim) {
    list.forEach((it) => {
      const s = sim.sensors.find((x) => x.id === it.cfg.id);
      const want = s && s.presence ? 1 : 0;
      it.pulse = damp(it.pulse, want, 9, dt);
      if (it.led && it.led.material) {
        const fault = s && !s.enabled;
        it.led.material.color.lerp(new THREE.Color(fault ? 0x8b2f26 : want ? 0xff8a4c : 0x2a2f2a), 1 - Math.exp(-10 * dt));
      }
      if (it.dome) {
        it.dome.material.emissiveIntensity = 0.12 + it.pulse * 0.8;
        it.dome.material.emissive.setRGB(1.0 * it.pulse * 0.5, 0.42 * it.pulse * 0.35, 0.16 * it.pulse * 0.3);
      }
      if (!s || !s.enabled) it.obj.rotation.z = Math.sin(performance.now() * 0.002) * 0.006;
    });
  }
  return { group, list, update };
}

/* ======================= PROTOTYPE BENCH ================================= */
export function buildElectronics(sim) {
  const group = new THREE.Group();
  group.name = 'electronics';
  // the bench top of the plinth in classroom.js is at y≈0.775, x -4.12, z -2.35
  const BX = -4.12,
    BZ = -2.35,
    BY = 0.775;
  const R = seeded(4242);

  /* base board + printed enclosure tray (the "protected area") */
  const base = new THREE.Group();
  group.add(base);
  const bw = 1.02,
    bd = 0.56;
  const basePlate = mesh(box(bw, 0.018, bd), MAT.plastic(0x2f3a33, 0.55), BX, BY + 0.009, BZ, true, true);
  group.add(basePlate);
  // low walls of the printed enclosure around the LV side
  const tray = new THREE.Group();
  const wall = (w, h, d, x, z) => mesh(box(w, h, d), MAT.plastic(0xdedacf, 0.5), x, BY + 0.018 + h / 2, z, true, true);
  tray.add(wall(0.62, 0.055, 0.012, BX + 0.19, BZ - bd / 2 + 0.02));
  tray.add(wall(0.62, 0.055, 0.012, BX + 0.19, BZ + bd / 2 - 0.02));
  tray.add(wall(0.012, 0.055, bd - 0.03, BX + 0.19 + 0.31, BZ));
  group.add(tray);
  // hinged clear acrylic cover, open at 78°
  const cover = new THREE.Group();
  cover.position.set(BX + 0.5, BY + 0.072, BZ - bd / 2 + 0.02);
  cover.add(mesh(box(0.62, 0.006, bd - 0.03), MAT.acrylic, 0.31, 0, (bd - 0.03) / 2, false, false));
  cover.add(mesh(box(0.02, 0.02, 0.03), MAT.metal, 0.005, 0, 0, false, false));
  cover.rotation.x = -1.36;
  group.add(cover);
  group.userData.cover = cover;

  const engrave = (text, w, h, x, y, z, ry = 0, size = 22) => {
    const p = makeTextPlate({ w: 512, h: Math.round((512 * h) / w), bg: 'rgba(232,226,210,0.9)', border: 'rgba(70,60,44,0.25)', color: '#42352a', font: `600 ${size}px "IBM Plex Mono", monospace`, align: 'center' });
    p.draw([text]);
    const m = new THREE.Mesh(plane(w, h), new THREE.MeshBasicMaterial({ map: p.tex, transparent: true }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    group.add(m);
    return m;
  };
  engrave('ECOSWITCH · LV DEMO RIG · 5 V ONLY', 0.5, 0.045, BX + 0.19, BY + 0.0195, BZ + bd / 2 - 0.075, 0, 30);
  group.children[group.children.length - 1].rotation.x = -Math.PI / 2;

  /* ---------------------------- ESP32-S3 DevKitC-1 --------------------- */
  const esp = new THREE.Group();
  const ex = BX - 0.02,
    ez = BZ + 0.02,
    ey = BY + 0.018;
  const pcbW = 0.0515,
    pcbD = 0.0279;
  esp.add(mesh(box(pcbW, 0.0016, pcbD), MAT.pcbBlue, 0, 0.0068, 0, true, false));
  // metal RF shield of the S3 module + antenna area
  esp.add(mesh(box(0.027, 0.008, 0.024), MAT.metal, -0.008, 0.0116, 0, true, false));
  esp.add(mesh(box(0.008, 0.0022, 0.02), MAT.plastic(0xd8c9a8, 0.6), 0.017, 0.0088, 0, false, false)); // antenna keep-out
  // pin headers both edges (2×19)
  for (const sz of [-1, 1]) {
    esp.add(mesh(box(pcbW - 0.006, 0.0085, 0.0026), MAT.black, 0.0, 0.012, sz * (pcbD / 2 - 0.0015), false, false));
  }
  esp.add(mesh(cyl(0.004, 0.004, 0.008, 10), MAT.aluminium, -pcbW / 2 + 0.006, 0.0096, 0, false, false).rotateZ(Math.PI / 2)); // USB-C
  esp.add(mesh(box(0.006, 0.004, 0.008), MAT.metal, -pcbW / 2 + 0.006, 0.012, 0.006, false, false));
  const espLed = mesh(box(0.0022, 0.0022, 0.0022), new THREE.MeshBasicMaterial({ color: 0x62ff9c }), 0.012, 0.0082, -0.008, false, false);
  esp.add(espLed);
  esp.position.set(ex, ey, ez);
  esp.userData.pick = { kind: 'esp32', id: 'esp', title: 'ESP32-S3 DevKitC-1' };
  group.add(esp);
  // two 6 mm standoffs so the board is supported, not floating
  for (const [sx, sz] of [[-0.02, -0.011], [-0.02, 0.011], [0.021, -0.011], [0.021, 0.011]])
    group.add(mesh(cyl(0.0035, 0.0035, 0.006, 8), MAT.metalDark, ex + sx, BY + 0.018 + 0.003, ez + sz, false, false));

  /* ------------------------- full-size solderless breadboard ------------- */
  const bb = new THREE.Group();
  const bbx = BX + 0.19,
    bbz = BZ - 0.055;
  const bbw = 0.165,
    bbd = 0.055;
  bb.add(mesh(box(bbw, 0.009, bbd), MAT.breadboard, 0, 0.0045, 0, true, true));
  bb.add(mesh(box(bbw - 0.01, 0.0012, 0.006), MAT.plastic(0xb9b3a4, 0.6), 0, 0.0096, 0, false, false)); // centre channel
  // hole rows: one instanced strip per side keeps the draw calls flat
  {
    const holeGeo = box(0.0012, 0.0008, 0.0012);
    const hm = new THREE.MeshStandardMaterial({ color: 0x9c968a, roughness: 0.7 });
    const im = new THREE.InstancedMesh(holeGeo, hm, 2 * 30 * 5);
    const mtx = new THREE.Matrix4();
    let n = 0;
    for (const side of [-1, 1])
      for (let c = 0; c < 30; c++)
        for (let r0 = 0; r0 < 5; r0++) {
          mtx.makeTranslation(-bbw / 2 + 0.012 + c * 0.00508, 0.0094, side * (0.0051 + r0 * 0.00254));
          im.setMatrixAt(n++, mtx);
        }
    im.instanceMatrix.needsUpdate = true;
    bb.add(im);
  }
  // power rails
  for (const rz of [-0.0235, 0.0235]) {
    bb.add(mesh(box(bbw - 0.012, 0.0008, 0.0022), MAT.plastic(0xd05a4a, 0.6), 0, 0.0092, rz - 0.004, false, false));
    bb.add(mesh(box(bbw - 0.012, 0.0008, 0.0022), MAT.plastic(0x39424c, 0.6), 0, 0.0092, rz + 0.004, false, false));
  }
  // the "components" plugged into it: resistors + a small logic buffer + wires
  const holeAt = (col, row, side = -1) => [bbx - bbw / 2 + 0.012 + col * 0.00508, BY + 0.018 + 0.009, bbz + side * (0.0051 + row * 0.00254) + side * 0.0025];
  const resistor = (col, row, side, ohms = '10k') => {
    const p = holeAt(col, row, side);
    const g = new THREE.Group();
    g.position.set(p[0], p[1], p[2]);
    g.add(mesh(cyl(0.0022, 0.0022, 0.0062, 8), MAT.plastic(0xe8dcc2, 0.5), 0, 0.006, 0, false, false));
    const bands = { '10k': [0xb0662a, 0x1b1b1b, 0xa8481c], '1k': [0xa02b22, 0x1b1b1b, 0xa8481c], '220': [0xc96a3c, 0xb0662a, 0x1b1b1b] }[ohms] || [0x999999];
    bands.forEach((c, i) => g.add(mesh(cyl(0.0024, 0.0024, 0.0012, 8), MAT.plastic(c, 0.5), 0, 0.0044 + i * 0.0016, 0, false, false)));
    for (const s of [-1, 1]) g.add(mesh(cyl(0.0004, 0.0004, 0.008, 4), MAT.metal, 0, 0.0018, s * 0.0055, false, false).rotateX(Math.PI / 2));
    group.add(g);
    return g;
  };
  resistor(8, 1, -1, '10k');
  resistor(14, 1, -1, '10k');
  resistor(20, 1, -1, '10k');
  resistor(26, 1, -1, '10k');
  resistor(11, 2, 1, '1k');
  resistor(17, 2, 1, '1k');
  group.add(mesh(box(0.019, 0.006, 0.0064), MAT.black, bbx - 0.02, BY + 0.015, bbz + 0.0126, true, false)); // small logic IC
  bb.position.set(bbx, BY + 0.018, bbz);
  group.add(bb);
  // buzzer (through-hole, on the board edge)
  const buz = new THREE.Group();
  const bp = holeAt(24, 3, 1);
  buz.position.set(bp[0], BY + 0.018 + 0.009, bbz + 0.0076 + 3 * 0.00254);
  buz.add(mesh(cyl(0.0062, 0.0062, 0.0092, 16), MAT.plastic(0x1a1c1e, 0.4), 0, 0.0046, 0, true, false));
  const buzHole = mesh(cyl(0.0012, 0.0012, 0.0096, 8), MAT.black, 0, 0.0046, 0, false, false);
  buz.add(buzHole);
  group.add(buz);
  group.userData.buzzer = buz;
  buz.userData.pick = { kind: 'buzzer', title: 'Piezo buzzer · 5 V' };

  /* ------------------------ OLED 0.96" I²C on a small bracket ------------- */
  const oledMod = new THREE.Group();
  const ox = BX - 0.108,
    oz = BZ + 0.16,
    oy = BY + 0.018;
  const oled = makeOledPlate(128, 64, 3);
  const screenMat = new THREE.MeshBasicMaterial({ map: oled.tex, toneMapped: false });
  screenMat.userData.xray = false;
  const modPcb = mesh(box(0.0278, 0.0275, 0.0016), MAT.pcb, 0, 0.02, 0, true, false);
  oledMod.add(modPcb);
  const scr = mesh(plane(0.0222, 0.0111), screenMat, 0, 0.0245, 0.0011, false, false);
  oledMod.add(scr);
  const bezel = mesh(box(0.0248, 0.0136, 0.0008), MAT.black, 0, 0.0245, 0.0007, false, false);
  oledMod.add(bezel);
  // 4 pin header on the bottom edge
  oledMod.add(mesh(box(0.01, 0.0025, 0.0026), MAT.black, 0, 0.0075, -0.0098, false, false));
  // bracket: two angled legs so the display leans back ~20°, standing on the base
  const brk = new THREE.Group();
  for (const sx of [-0.011, 0.011]) {
    const leg = mesh(box(0.0022, 0.026, 0.012), MAT.metalDark, sx, 0.013, -0.006, false, false);
    brk.add(leg);
  }
  brk.add(mesh(box(0.03, 0.002, 0.014), MAT.metalDark, 0, 0.001, -0.004, false, true));
  oledMod.add(brk);
  oledMod.position.set(ox, oy, oz);
  oledMod.rotation.set(-0.22, 0.34, 0);
  oledMod.userData.pick = { kind: 'oled', title: '0.96" I²C OLED (SSD1306)' };
  group.add(oledMod);
  const oledGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: TEX.glow('rgba(255,214,140,0.5)', 'rgba(255,180,90,0)'), color: 0xffd28a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  oledGlow.scale.set(0.1, 0.06, 1);
  oledGlow.position.set(ox, oy + 0.024, oz + 0.002);
  group.add(oledGlow);

  /* ------------------- MOSFET switching board (perfboard) -------------- */
  const mos = new THREE.Group();
  const mx = BX + 0.34,
    mz = BZ + 0.13,
    my = BY + 0.018;
  mos.add(mesh(box(0.14, 0.009, 0.09), MAT.pcbPerf, 0, 0.0045, 0, true, true));
  // screw terminals for the 5 V rail and the motor outputs
  const term = (tx, col) => {
    const g = new THREE.Group();
    g.add(mesh(box(0.02, 0.011, 0.022), MAT.plastic(col, 0.5), 0, 0.014, 0, true, false));
    for (let i = 0; i < 2; i++) g.add(mesh(cyl(0.0026, 0.0026, 0.004, 8), MAT.metal, -0.005 + i * 0.01, 0.021, 0, false, false));
    g.position.set(tx, my, mz);
    return g;
  };
  const tIn = term(-0.05, 0x2c5a4a);
  mos.add(tIn);
  const tOut = term(0.05, 0x2f4b6e);
  mos.add(tOut);
  // four TO-220 MOSFETs with tiny heatsinks + flyback diodes + gate resistors
  const mosfets = [];
  for (let i = 0; i < 4; i++) {
    const px = -0.048 + i * 0.032;
    const g = new THREE.Group();
    g.position.set(px, my + 0.009, mz - 0.02);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.55, metalness: 0.05, emissive: new THREE.Color(0x0a2a14), emissiveIntensity: 1 });
    g.add(mesh(box(0.01, 0.0092, 0.0045), bodyMat, 0, 0.0046, 0, true, false)); // body
    g.userData.body = bodyMat;
    g.add(mesh(box(0.011, 0.0012, 0.0012), MAT.metal, 0, 0.01, 0, false, false)); // tab
    for (let p = -1; p <= 1; p++) g.add(mesh(box(0.0008, 0.005, 0.0008), MAT.metal, p * 0.003, -0.0025, 0.0016, false, false));
    // heatsink fins
    for (let f = 0; f < 4; f++) g.add(mesh(box(0.0104, 0.0012, 0.0036), MAT.metalDark, 0, 0.0022 + f * 0.0022, 0.004, false, false));
    mos.add(g);
    mosfets.push(g);
    // gate pulldown resistor to GND (10 k) lying on the perfboard
    const rr = mesh(cyl(0.0016, 0.0016, 0.0052, 6), MAT.plastic(0xe8dcc2, 0.5), px + 0.008, my + 0.0115, mz + 0.004, false, false);
    rr.rotation.z = Math.PI / 2;
    mos.add(rr);
    // flyback diode 1N4007 on the output side
    const dd = mesh(cyl(0.0018, 0.0018, 0.0062, 6), MAT.plastic(0x1b1b1d, 0.4), px, my + 0.0115, mz + 0.026, false, false);
    dd.rotation.z = Math.PI / 2;
    mos.add(dd);
    mos.add(mesh(cyl(0.0019, 0.0019, 0.0012, 6), MAT.plastic(0xdcd6c6, 0.4), px - 0.003, my + 0.0115, mz + 0.026, false, false).rotateZ(Math.PI / 2));
  }
  mos.position.set(0, 0, 0);
  mos.userData.pick = { kind: 'mosfet', title: 'Low-side MOSFET switch board' };
  group.add(mos);
  const mosPos = (i) => new THREE.Vector3(mx - 0.048 + i * 0.032, my + 0.02, mz - 0.016);

  /* ------------------ 5 V DC motors = zone load stand-ins -------------- */
  const motors = [];
  const motorY = BY + 0.018;
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Group();
    const px = BX + 0.055 + i * 0.072;
    // mount them on a small wooden strip at the back of the base, facing the room
    m.add(mesh(box(0.09, 0.008, 0.028), MAT.woodDark, 0, 0.004, 0, true, true));
    const can = mesh(cyl(0.0135, 0.0135, 0.034, 16), MAT.metal, 0, 0.03, 0, true, false);
    can.rotation.x = Math.PI / 2;
    m.add(can);
    const cap1 = mesh(cyl(0.0125, 0.0125, 0.006, 14), MAT.plastic(0x23262a, 0.5), 0, 0.03, 0.02, false, false);
    cap1.rotation.x = Math.PI / 2;
    m.add(cap1);
    const shaft = mesh(cyl(0.0016, 0.0016, 0.016, 8), MAT.metal, 0, 0.03, -0.024, false, false);
    shaft.rotation.x = Math.PI / 2;
    m.add(shaft);
    // printed two-blade prop
    const prop = new THREE.Group();
    for (const s of [0, Math.PI]) {
      const bl = mesh(box(0.036, 0.0012, 0.009), MAT.plastic(0xdad4c6, 0.42), Math.cos(s) * 0.019, 0, Math.sin(s) * 0.019, false, false);
      bl.rotation.y = s;
      bl.rotation.z = 0.34;
      prop.add(bl);
    }
    prop.add(mesh(cyl(0.004, 0.004, 0.004, 8), MAT.plastic(0xb5ac98, 0.4), 0, 0, 0, false, false));
    prop.position.set(0, 0.03, -0.03);
    m.add(prop);
    // 1N4007 flyback diode soldered across the motor tabs
    const di = mesh(cyl(0.0016, 0.0016, 0.0058, 6), MAT.plastic(0x1b1b1d, 0.4), 0.0075, 0.03, 0.016, false, false);
    di.rotation.z = 0.5;
    m.add(di);
    m.add(mesh(cyl(0.0017, 0.0017, 0.0011, 6), MAT.plastic(0xdcd6c6, 0.4), 0.0092, 0.0325, 0.0185, false, false).rotateZ(0.5));
    // two solder tabs
    for (const s of [-1, 1]) m.add(mesh(box(0.005, 0.0006, 0.004), MAT.metal, s * 0.008, 0.0285, 0.019, false, false));
    m.position.set(px, motorY, BZ - 0.185);
    m.rotation.y = 0.12 - i * 0.02;
    m.userData.pick = { kind: 'motor', id: i, zone: i, title: `5 V DC motor · load for ${ZONES[Math.min(2, i)].tag}` };
    group.add(m);
    motors.push({ obj: m, prop, cfg: i, ang: 0, rpm: 0 });
  }
  // label under the motor row
  engrave('LOAD SIMULATORS · 5 V DC · FLYBACK DIODED', 0.42, 0.03, BX + 0.15, BY + 0.0195, BZ - 0.215, 0, 26);
  group.children[group.children.length - 1].rotation.x = -Math.PI / 2;

  /* ------------------------- manual override slide switches ------------ */
  const ovr = new THREE.Group();
  ovr.position.set(BX + 0.055, BY + 0.018, BZ + 0.19);
  ovr.add(mesh(box(0.15, 0.006, 0.042), MAT.plastic(0x2f3438, 0.5), 0, 0.003, 0, true, true));
  const levers = [];
  for (let i = 0; i < 3; i++) {
    const lx = -0.05 + i * 0.05;
    ovr.add(mesh(box(0.02, 0.006, 0.022), MAT.black, lx, 0.008, 0, false, false));
    const lv = mesh(box(0.006, 0.014, 0.005), MAT.plastic(0xe9e4d8, 0.4), lx, 0.016, 0, false, false);
    ovr.add(lv);
    levers.push(lv);
    const hit = mesh(box(0.026, 0.02, 0.03), new THREE.MeshBasicMaterial({ visible: false }), lx, 0.012, 0, false, false);
    hit.userData.pick = { kind: 'override', zone: i, title: `Manual override · ${ZONES[i].tag}` };
    ovr.add(hit);
    const lp = makeTextPlate({ w: 128, h: 64, bg: 'none', border: 'none', color: '#efe4cd', font: '700 40px Sora, sans-serif', align: 'center' });
    lp.draw([ZONES[i].tag]);
    const lm = new THREE.Mesh(plane(0.016, 0.008), new THREE.MeshBasicMaterial({ map: lp.tex, transparent: true }));
    lm.position.set(lx, 0.0063, 0.0145);
    lm.rotation.x = -Math.PI / 2;
    ovr.add(lm);
  }
  group.add(ovr);
  group.userData.overrideLevers = levers;

  /* ------------------------------------ wall 5 V adapter + USB-C cable -- */
  const psu = new THREE.Group();
  psu.position.set(ROOM.xMin + 0.26, 0.018, BZ + 0.34);
  psu.add(mesh(box(0.075, 0.032, 0.048), MAT.plastic(0xf0ece2, 0.42), 0, 0.016, 0, true, true));
  psu.add(mesh(box(0.02, 0.006, 0.006), MAT.black, 0.03, 0.02, 0, false, false));
  group.add(psu);
  // socket plate on the wall
  const sock = new THREE.Group();
  sock.position.set(ROOM.xMin + 0.012, 0.32, BZ + 0.42);
  sock.rotation.y = Math.PI / 2;
  sock.add(mesh(box(0.086, 0.086, 0.012), MAT.white, 0, 0, 0, false, false));
  sock.add(mesh(box(0.06, 0.05, 0.006), MAT.plastic(0xe4dfd3, 0.5), 0, 0, 0.008, false, false));
  for (const sx of [-0.012, 0.012]) sock.add(mesh(cyl(0.0035, 0.0035, 0.006, 8), MAT.black, sx, 0.006, 0.012, false, false).rotateX(Math.PI / 2));
  sock.add(mesh(cyl(0.004, 0.004, 0.006, 8), MAT.metalDark, 0, -0.014, 0.012, false, false).rotateX(Math.PI / 2));
  group.add(sock);
  group.add(
    wire(
      [[psu.position.x + 0.038, 0.028, psu.position.z], [psu.position.x + 0.05, 0.05, BZ + 0.1], [BX - 0.42, 0.28, BZ + 0.04], [BX - 0.48, BY + 0.03, BZ + 0.02], [ex - pcbW / 2 - 0.014, BY + 0.026, ez + 0.004], [ex - pcbW / 2 + 0.001, BY + 0.021, ez]],
      0.0022,
      0x2b2f33,
      54
    )
  );

  /* -------------------------------------------- jumper wires (breadboard) */
  const Wc = { red: 0xd34a3a, black: 0x23262a, yellow: 0xe0b53c, green: 0x4e9b5c, blue: 0x3f6bb0, white: 0xe8e3d6, orange: 0xd77a2d };
  // ESP32 GPIO → breadboard rails → MOSFET gates
  for (let i = 0; i < 4; i++) {
    const from = [ex + 0.01 + i * 0.006, BY + 0.024, ez + (i < 2 ? pcbD / 2 : -pcbD / 2)];
    const to = [mx - 0.048 + i * 0.032, my + 0.016, mz + 0.012];
    group.add(wire(arc(from, to, 0.026, 0.012), 0.0011, [Wc.yellow, Wc.green, Wc.blue, Wc.orange][i], 26));
  }
  // 3V3 + GND rails
  group.add(wire(arc([ex - 0.02, BY + 0.024, ez + pcbD / 2], [bbx - bbw / 2 + 0.02, BY + 0.027, bbz - 0.0235], 0.022, 0.006), 0.0011, Wc.red, 22));
  group.add(wire(arc([ex - 0.026, BY + 0.024, ez - pcbD / 2], [bbx - bbw / 2 + 0.03, BY + 0.027, bbz + 0.0235], 0.022, 0.006), 0.0011, Wc.black, 22));
  // I2C SDA/SCL to the OLED
  group.add(wire(arc([ex + 0.002, BY + 0.024, ez - pcbD / 2], [ox - 0.004, oy + 0.0085, oz - 0.009], 0.03, 0.014), 0.0009, Wc.white, 26));
  group.add(wire(arc([ex + 0.008, BY + 0.024, ez - pcbD / 2], [ox + 0.002, oy + 0.0085, oz - 0.009], 0.03, 0.014), 0.0009, Wc.blue, 26));
  // buzzer
  group.add(wire(arc([bp[0], BY + 0.02, bp[2]], [ex - 0.012, BY + 0.024, ez + pcbD / 2], 0.018, 0.006), 0.0009, Wc.red, 18));
  // MOSFET board → motor terminal strip → each motor
  for (let i = 0; i < 4; i++) {
    const from = [mx + 0.04, my + 0.02, mz + 0.006];
    const to = [motors[i].obj.position.x - 0.008, motorY + 0.03, BZ - 0.165];
    group.add(wire(arc(from, to, 0.03, 0.018), 0.0014, i % 2 ? Wc.black : Wc.red, 26));
    group.add(wire(arc([mx + 0.05, my + 0.02, mz + 0.006], [motors[i].obj.position.x + 0.008, motorY + 0.03, BZ - 0.165], 0.028, 0.02), 0.0014, i % 2 ? Wc.red : Wc.black, 26));
  }
  // 5 V bus into the MOSFET board from the PSU rail
  group.add(wire(arc([bbx + bbw / 2 - 0.02, BY + 0.027, bbz - 0.0235], [mx - 0.05, my + 0.02, mz + 0.006], 0.03, 0.016), 0.0014, Wc.red, 24));
  // sensor signal cables: out of the tray, up the front wall, along the ceiling
  const wallX = ROOM.xMin + 0.07;
  [
    [-2.5, 0.0],
    [0.17, 0.0],
    [2.87, 0.0],
  ].forEach(([cx, cz], i) => {
    group.add(
      wire(
        [
          [BX + 0.12, BY + 0.03, BZ - bd / 2 + 0.03],
          [BX + 0.1, 1.0 + i * 0.05, BZ - bd / 2 + 0.05],
          [wallX, 2.2 + i * 0.04, BZ - bd / 2 + 0.06],
          [wallX, ROOM.height - 0.09, BZ - 0.12],
          [wallX + 0.3, ROOM.height - 0.085, cz + 0.06],
          [cx, ROOM.height - 0.085, cz],
        ],
        0.0032,
        0x40454b,
        64
      )
    );
  });

  /* ------------------------------------------------------------- update */
  let acc = 0;
  let oledT = 0;
  const rowsCache = { last: '' };
  function update(dt, sim, env) {
    // motor props follow the zone they represent
    motors.forEach((m, i) => {
      const zi = Math.min(2, i);
      const lvl = sim.zones[zi].fanLevel;
      m.rpm = damp(m.rpm, lvl * 12.4, 2.2, dt);
      m.ang += m.rpm * dt;
      m.prop.rotation.z = m.ang;
    });
    // MOSFET gate LEDs (drain indicator) — blink with state
    mosfets.forEach((g, i) => {
      const zi = Math.min(2, i);
      const on = sim.zones[zi].lightLevel > 0.35;
      const c = on ? 0x63f29a : 0x2a2f2a;
      g.userData.body.emissive.lerp(new THREE.Color(on ? 0x2fbf6a : 0x101412), 1 - Math.exp(-7 * dt));
    });
    // ESP32 status LED heartbeat
    const hb = (Math.sin(env.clock * 3.1) > 0.7) * 1;
    espLed.material.color.setRGB(0.2 + hb * 0.5, 1.0 * (0.25 + hb * 0.75), 0.4 + hb * 0.3);
    // buzzer chirp visual (small ring scale) on events
    if (env.chirp > 0.01) {
      const s = 1 + env.chirp * 0.18;
      group.userData.buzzer.scale.setScalar(s);
    } else group.userData.buzzer.scale.setScalar(1);
    // OLED refresh ~6 Hz, tiny display, 4 lines
    oledT += dt;
    if (oledT > 0.16) {
      oledT = 0;
      const rows = [];
      const z0 = sim.zones[0],
        z1 = sim.zones[1],
        z2 = sim.zones[2];
      const fmt = (z) => {
        if (z.manual !== 'AUTO') return ['MANUAL', 'hot'];
        if (z.state === 'OCCUPIED') return ['ON', 'on'];
        if (z.state === 'GRACE') return [(Math.max(0, sim.offAfter - z.t)).toFixed(0) + 's', 'dim'];
        return ['OFF', 'off'];
      };
      const st = [z0, z1, z2].map(fmt);
      rows.push(['ECOSWITCH  ' + (sim.mode === 'HYBRID' ? 'HYB' : sim.mode === 'PIR_ONLY' ? 'PIR' : sim.mode === 'MMWAVE_ONLY' ? 'MMW' : 'ALO')]);
      rows.push([`Z1 ${st[0][0]}   Z2 ${st[1][0]}   Z3 ${st[2][0]}`, st[0][0] === 'MANUAL' || st[1][0] === 'MANUAL' || st[2][0] === 'MANUAL' ? 'hot' : 'on']);
      if (z1.state === 'GRACE') rows[1] = [`Z1 ${st[0][0]}  Z2 ${Math.max(0, sim.offAfter - z1.t).toFixed(0)}s  Z3 ${st[2][0]}`, 'on'];
      const deg = sim.sensors.some((s) => !s.enabled);
      rows.push([`LOAD ${Math.round(sim.zones.reduce((a, z) => a + z.lightW * z.lightLevel + z.fanW * z.fanLevel, 0))}W  ${sim.energy.kwh.toFixed(2)}kWh`]);
      rows.push([deg ? 'DEGRADED - SENSOR ERR' : `PRES ${z0.occupants + z1.occupants + z2.occupants}  OK`]);
      oled.draw(rows);
      oledGlow.material.opacity = 0.34 + 0.16 * Math.sin(env.clock * 0.7);
    }
    // override levers mirror state
    levers.forEach((lv, i) => {
      const m = sim.zones[i].manual;
      lv.rotation.x = m === 'ON' ? -0.5 : m === 'OFF' ? 0.5 : 0;
    });
  }
  return {
    group,
    motors,
    oled,
    oledGlow,
    esp,
    update,
    setCover(open) {
      cover.rotation.x = open ? -1.36 : 0;
    },
  };
}
