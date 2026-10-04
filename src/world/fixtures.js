/* ============================================================================
   Ceiling fixtures + wall electricals.
   • 6 surface-mounted LED panels (2 per zone) — each drives a real SpotLight
   • 4 induction-style ceiling fans with speed inertia (never instant spin-up)
   • gang switchboards near the door whose rockers mirror / set manual override
   • a small MCB distribution board, exit sign, and regulator plates
   Every object is attached to something: panels and fans to the slab, boards to
   the wall. Nothing floats.
   ==========================================================================*/
import * as THREE from 'three';
import { LIGHTS, FANS, ROOM, ZONES, LOADS } from '../config.js';
import { MAT, box, cyl, plane, sph, mesh } from './materials.js';
import { TEX } from '../core/textures.js';
import { makeTextPlate } from '../core/labels.js';
import { clamp, lerp, damp, TAU, smoothstep } from '../core/utils.js';

export function buildFixtures(scene) {
  const group = new THREE.Group();
  group.name = 'fixtures';

  /* ------------------------------------------------ LED panel fixtures */
  const zoneMats = ZONES.map((z, i) => ({
    diffuser: new THREE.MeshStandardMaterial({
      color: 0xfff4de,
      emissive: new THREE.Color(0xffe0a6),
      emissiveIntensity: 1.7,
      roughness: 0.42,
      transparent: true,
      opacity: 0.97,
    }),
    glow: new THREE.SpriteMaterial({
      map: TEX.glow('rgba(255,231,180,0.75)', 'rgba(255,208,130,0)'),
      color: 0xffdca0,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  }));
  zoneMats.forEach((m) => {
    m.diffuser.userData.xray = false;
    m.glow.userData = m.glow.userData || {};
  });

  const fixtures = [];
  const zoneLights = ZONES.map(() => ({ spots: [], fixtures: [] }));
  LIGHTS.forEach((L) => {
    const g = new THREE.Group();
    g.position.set(L.x, L.y, L.z);
    const zm = zoneMats[L.zone];
    // extruded aluminium housing + diffuser
    g.add(mesh(box(L.w, 0.075, L.h + 0.06), MAT.lampBody, 0, 0.02, 0, false, false));
    g.add(mesh(box(L.w + 0.06, 0.018, L.h + 0.1), MAT.metalDark, 0, 0.062, 0, false, false));
    const dif = mesh(plane(L.w - 0.06, L.h - 0.04), zm.diffuser, 0, -0.019, 0, false, false);
    dif.rotation.x = Math.PI / 2;
    g.add(dif);
    // 2 mounting brackets to the slab
    for (const bx of [-L.w / 2 + 0.08, L.w / 2 - 0.08]) g.add(mesh(box(0.05, 0.05, 0.05), MAT.metalDark, bx, 0.06, 0, false, false));
    const sp = new THREE.Sprite(zm.glow);
    sp.scale.set(L.w * 2.3, L.h * 3.4, 1);
    sp.position.y = -0.06;
    sp.renderOrder = 3;
    g.add(sp);

    // the physical light
    const spot = new THREE.SpotLight(0xffd9a0, 0, 9.5, 1.02, 0.86, 2);
    spot.position.set(0, -0.05, 0);
    spot.target.position.set(0, -3, 0);
    g.add(spot);
    g.add(spot.target);
    // a second, tighter spot to pool light on the benches
    const spot2 = new THREE.SpotLight(0xffe6bd, 0, 7.5, 0.62, 0.7, 2);
    spot2.position.set(0, -0.05, 0);
    spot2.target.position.set(0, -3.4, 0);
    g.add(spot2);
    g.add(spot2.target);

    g.userData.pick = { kind: 'light', id: L.id, zone: L.zone, title: `LED panel · ${ZONES[L.zone].tag}` };
    fixtures.push({ obj: g, zone: L.zone, spot, spot2, sprite: sp, cfg: L });
    zoneLights[L.zone].spots.push(spot, spot2);
    zoneLights[L.zone].fixtures.push(g);
    group.add(g);
  });

  /* ------------------------------------------------------- ceiling fans */
  const fans = [];
  FANS.forEach((F) => {
    const g = new THREE.Group();
    g.position.set(F.x, ROOM.height, F.z);
    // canopy + down rod anchored on the slab
    g.add(mesh(cyl(0.085, 0.1, 0.055, 16), MAT.fanHub, 0, -0.028, 0, false, false));
    g.add(mesh(cyl(0.019, 0.019, 0.3, 10), MAT.metalDark, 0, -0.2, 0, true, false));
    const pin = mesh(cyl(0.03, 0.03, 0.02, 10), MAT.metal, 0, -0.004, 0, false, false);
    g.add(pin);
    // motor housing with vent slots
    const hub = new THREE.Group();
    hub.position.y = -0.4;
    hub.add(mesh(cyl(0.082, 0.07, 0.115, 18), MAT.fanHub, 0, 0, 0, true, false));
    hub.add(mesh(cyl(0.052, 0.052, 0.018, 16), MAT.metal, 0, -0.062, 0, false, false));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      hub.add(mesh(box(0.012, 0.055, 0.02), MAT.black, Math.cos(a) * 0.072, 0.012, Math.sin(a) * 0.072, false, false).rotateY(-a));
    }
    g.add(hub);
    // blade iron + blade, 3 of them (standard 400 mm / 1200 mm sweep)
    const rotor = new THREE.Group();
    rotor.position.y = -0.4;
    const blades = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.3;
      const arm = new THREE.Group();
      arm.rotation.y = -a;
      arm.add(mesh(box(0.14, 0.022, 0.05), MAT.metalDark, 0.115, -0.008, 0, false, false));
      const blade = mesh(box(0.5, 0.008, 0.19), MAT.fanBlade, 0.5, -0.02, 0, false, false);
      blade.rotation.z = 0;
      blade.rotation.x = 0.26;
      arm.add(blade);
      rotor.add(arm);
      blades.push(arm);
    }
    g.add(rotor);
    // motion-blur ring (fades in with rpm — cheap and convincing)
    const blur = new THREE.Mesh(
      new THREE.CircleGeometry(0.74, 40),
      new THREE.MeshBasicMaterial({
        map: TEX.glow('rgba(180,190,200,0.30)', 'rgba(120,130,140,0)'),
        transparent: true,
        opacity: 0,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    blur.rotation.x = -Math.PI / 2;
    blur.position.y = -0.415;
    g.add(blur);

    g.userData.pick = { kind: 'fan', id: F.id, zone: F.zone, title: `Ceiling fan · ${ZONES[F.zone].tag}` };
    const rec = { obj: g, cfg: F, rotor, blades, blur, hub, rpm: 0, level: 0, ang: 0 };
    fans.push(rec);
    group.add(g);
  });

  /* ------------------------------------------- wall switchboards (3-gang) */
  const switchPlates = [];
  const mkBoard = (x, y, z, ry, list, title) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    g.add(mesh(box(0.2 * list.length, 0.13, 0.016), MAT.white, 0, 0, 0, false, false));
    list.forEach((zn, i) => {
      const cell = new THREE.Group();
      cell.position.x = -((list.length - 1) / 2) * 0.2 + i * 0.2;
      cell.add(mesh(box(0.15, 0.09, 0.006), MAT.plastic(0xdedad0, 0.55), 0, 0, 0.011, false, false));
      const rocker = mesh(box(0.05, 0.062, 0.02), MAT.plastic(0xf1ece2, 0.4), 0, 0, 0.019, false, false);
      cell.add(rocker);
      cell.userData.pick = { kind: 'switch', zone: zn, id: i, title: `Override switch · ${ZONES[zn].tag}` };
      g.add(cell);
      switchPlates.push({ rocker, zone: zn, cell, list: title });
    });
    // label strip
    const plate = makeTextPlate({ w: 512, h: 64, bg: 'rgba(246,240,228,0.92)', border: 'rgba(90,70,50,0.25)', color: '#4a3426', font: '600 30px "IBM Plex Mono", monospace', align: 'center' });
    plate.draw([title]);
    const lab = new THREE.Mesh(plane(0.2 * list.length, 0.03), new THREE.MeshBasicMaterial({ map: plate.tex, transparent: true }));
    lab.position.set(0, -0.087, 0.012);
    g.add(lab);
    group.add(g);
    return g;
  };
  // by the door (inside, back wall) — the room's real switch line
  mkBoard(ROOM.xMax - 0.012, 1.32, DOORX() - 0.62, -Math.PI / 2, [0, 1, 2], 'Z1   Z2   Z3');
  // front wall near the prototype bench — lab attendant's board
  mkBoard(ROOM.xMin + 0.012, 1.28, -1.42, Math.PI / 2, [0, 1, 2], 'ECO CTRL');
  function DOORX() {
    return 1.55;
  }

  /* ------------------------------------- MCB distribution board (front R) */
  const db = new THREE.Group();
  db.position.set(ROOM.xMin + 0.05, 2.05, -1.35);
  db.rotation.y = Math.PI / 2;
  db.add(mesh(box(0.42, 0.3, 0.03), MAT.plastic(0xd7d3c8, 0.5), 0, 0, 0, false, false));
  db.add(mesh(box(0.38, 0.26, 0.02), MAT.plastic(0x2c2f33, 0.45), 0, 0, 0.018, false, false));
  for (let i = 0; i < 4; i++) {
    const mcb = new THREE.Group();
    mcb.add(mesh(box(0.062, 0.09, 0.03), MAT.plastic(0xe8e5dc, 0.5), 0, 0, 0, false, false));
    const toggle = mesh(box(0.02, 0.03, 0.014), MAT.plastic(0x2b7a4b, 0.45), 0, 0.015, 0.02, false, false);
    mcb.add(toggle);
    mcb.position.set(-0.13 + i * 0.087, 0.02, 0.032);
    mcb.userData.pick = { kind: 'mcb', id: i, zone: i < 3 ? i : null, title: i < 3 ? `MCB ${i + 1} · ${ZONES[i].tag}` : 'MCB 4 · CONTROL' };
    db.add(mcb);
    db.userData['mcb' + i] = toggle;
  }
  const dbLab = makeTextPlate({ w: 256, h: 64, bg: 'rgba(240,234,220,0.9)', border: 'rgba(70,60,45,0.3)', color: '#41352a', font: '600 26px "IBM Plex Mono", monospace', align: 'center' });
  dbLab.draw(['DB-04 · 6A MCB']);
  const dbl = new THREE.Mesh(plane(0.2, 0.05), new THREE.MeshBasicMaterial({ map: dbLab.tex, transparent: true }));
  dbl.position.set(0, -0.115, 0.016);
  db.add(dbl);
  group.add(db);

  /* ------------------------------------------------- exit sign over door */
  const exit = new THREE.Group();
  exit.position.set(ROOM.xMax - 0.03, 2.42, 1.55);
  exit.rotation.y = -Math.PI / 2;
  exit.add(mesh(box(0.42, 0.15, 0.05), MAT.plastic(0x23301f, 0.5), 0, 0, 0, false, false));
  const exTex = makeTextPlate({ w: 512, h: 128, bg: 'rgba(20,40,22,0.2)', border: 'none', color: '#8ef0a8', font: '700 52px Sora, sans-serif', align: 'center' });
  exTex.draw(['EXIT']);
  const exm = new THREE.Mesh(plane(0.36, 0.1), new THREE.MeshBasicMaterial({ map: exTex.tex, transparent: true, color: 0xa8ffbe }));
  exm.position.z = 0.027;
  exit.add(exm);
  group.add(exit);

  /* ------------------------------------------------------------- update */
  const state = ZONES.map(() => ({ level: 0 }));
  let t = 0;
  function update(dt, sim, env) {
    t += dt;
    // zone lights
    ZONES.forEach((z, zi) => {
      const lvl = sim.zones[zi].lightLevel;
      state[zi].level = lvl;
      const flick = lvl > 0.02 && lvl < 0.98 ? 1 : 1;
      const dimv = (env.dim && env.dim[zi]) || 1;
      const base = 9.2 * lvl * flick * (0.82 + 0.18 * env.daylight) * dimv;
      zoneLights[zi].spots.forEach((sp, i) => {
        sp.intensity = base * (i % 2 === 0 ? 1 : 0.55);
      });
      zoneMats[zi].diffuser.emissiveIntensity = 0.12 + 1.75 * lvl * dimv;
      zoneMats[zi].diffuser.color.setRGB(lerp(0.62, 1, lvl), lerp(0.62, 0.96, lvl), lerp(0.6, 0.87, lvl));
      zoneMats[zi].glow.opacity = (0.06 + 0.5 * lvl) * dimv;
    });
    // fans: inertia, subtle wobble, blur ring
    fans.forEach((f) => {
      const lvl = sim.zones[f.cfg.zone].fanLevel;
      f.level = lvl;
      const target = lvl * 1.72; // rev/s  ≈ 103 rpm — a real classroom fan
      f.rpm = damp(f.rpm, target, 1.05, dt);
      f.ang += f.rpm * TAU * dt;
      f.rotor.rotation.y = f.ang;
      const wob = Math.sin(f.ang * 3) * 0.0016 * f.rpm + Math.sin(t * 0.7 + f.cfg.id) * 0.0009;
      f.obj.rotation.z = wob;
      f.obj.rotation.x = Math.cos(f.ang * 1) * 0.0012 * f.rpm;
      f.blur.material.opacity = clamp((f.rpm / 1.72) * 0.5, 0, 0.5);
      f.blur.rotation.y = f.ang * 0.25;
      f.blades.forEach((b, i) => {
        b.rotation.x = Math.sin(f.ang * 1 + i * 2.1) * 0.012 * f.rpm;
      });
    });
    // rocker positions mirror manual state
    switchPlates.forEach((s) => {
      const z = sim.zones[s.zone];
      const on = z.manual === 'ON' ? 1 : z.manual === 'OFF' ? -1 : z.lightLevel > 0.4 ? 1 : -0.15;
      const target = on * 0.34;
      s.rocker.rotation.x = lerp(s.rocker.rotation.x, target, 1 - Math.exp(-10 * dt));
      const col = z.manual !== 'AUTO' ? (z.manual === 'ON' ? 0xe8b24a : 0xb0402f) : z.lightLevel > 0.4 ? 0xf1ece2 : 0xcfc9bd;
      s.rocker.material.color.lerp(new THREE.Color(col), 1 - Math.exp(-8 * dt));
    });
  }

  return {
    group,
    fixtures,
    fans,
    zoneLights,
    switchPlates,
    update,
    fanAngle: (i) => fans[i].ang,
    fanRpm: (i) => fans[i].rpm,
  };
}
