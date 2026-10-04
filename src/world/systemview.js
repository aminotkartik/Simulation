/* ============================================================================
   SYSTEM VIEW — a semi-transparent technical layer that materialises in front
   of the classroom and shows the real control chain:

       PIR + mmWave  →  ESP32-S3  →  MOSFET low-side switch  →  Light / Fan
                                        (+ gate pulldown, + flyback diode)

   Each stage is anchored to the physical object it describes, with live values
   read from the simulation. It is an overlay of the actual build, not a
   documentation page.
   ==========================================================================*/
import * as THREE from 'three';
import { ZONES, LIGHTS, FANS, SENSORS, ROOM } from '../config.js';
import { makeTextPlate } from '../core/labels.js';
import { clamp, lerp, TAU, damp, roundedRectPath } from '../core/utils.js';

const PW = 1.28,
  PH = 0.82;

function plateCanvas(w = 620, h = 400) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return { c, x, tex };
}

function frame(x, w, h, accent, title, sub) {
  x.clearRect(0, 0, w, h);
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(30,21,14,0.92)');
  g.addColorStop(1, 'rgba(18,13,9,0.88)');
  roundedRectPath(x, 0, w / 2, h / 2, w - 4, h - 4, 26);
  x.fillStyle = g;
  x.fill();
  x.strokeStyle = 'rgba(228,196,138,0.34)';
  x.lineWidth = 2;
  x.stroke();
  x.strokeStyle = accent;
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(26, 6);
  x.lineTo(w - 90, 6);
  x.stroke();
  x.fillStyle = accent;
  x.font = '600 30px Sora, sans-serif';
  x.textBaseline = 'top';
  x.fillText(title, 26, 26);
  x.fillStyle = 'rgba(240,225,198,0.6)';
  x.font = '400 21px "IBM Plex Mono", monospace';
  x.fillText(sub, 26, 64);
}

function row(x, y, k, v, accent = '#f0e2c4', mono = true) {
  x.font = `${mono ? '400 22px "IBM Plex Mono", monospace' : '400 22px Sora, sans-serif'}`;
  x.fillStyle = 'rgba(232,214,182,0.55)';
  x.fillText(k, 26, y);
  x.fillStyle = accent;
  x.textAlign = 'right';
  x.fillText(v, x.canvas.width - 26, y);
  x.textAlign = 'left';
}

function chip(x, px, py, label, color, on = true) {
  x.font = '600 19px Sora, sans-serif';
  const w = x.measureText(label).width + 26;
  roundedRectPath(x, 0, 0, 0, 0, 0, 0);
  x.beginPath();
  const r = 11;
  x.moveTo(px + r, py);
  x.lineTo(px + w - r, py);
  x.quadraticCurveTo(px + w, py, px + w, py + r);
  x.lineTo(px + w, py + 30 - r);
  x.quadraticCurveTo(px + w, py + 30, px + w - r, py + 30);
  x.lineTo(px + r, py + 30);
  x.quadraticCurveTo(px, py + 30, px, py + 30 - r);
  x.lineTo(px, py + r);
  x.quadraticCurveTo(px, py, px + r, py);
  x.closePath();
  x.fillStyle = on ? color + '44' : 'rgba(120,112,100,0.22)';
  x.fill();
  x.strokeStyle = on ? color : 'rgba(150,140,124,0.5)';
  x.lineWidth = 1.6;
  x.stroke();
  x.fillStyle = on ? color : 'rgba(190,180,164,0.6)';
  x.textBaseline = 'middle';
  x.fillText(label, px + 13, py + 16);
  x.textBaseline = 'top';
  return w;
}

export function buildSystemView({ sim, refs }) {
  const group = new THREE.Group();
  group.name = 'systemView';
  group.visible = false;

  const stages = [
    { key: 'sense', title: 'SENSING', sub: 'per zone · 1× PIR + 1× mmWave', accent: '#e8b24a', x: -2.02, y: 1.52, z: -6.15, ry: 0.3 },
    { key: 'ctrl', title: 'ESP32-S3', sub: 'logic · state machine · OLED', accent: '#8ec7a0', x: -0.67, y: 1.52, z: -6.42, ry: 0.11 },
    { key: 'sw', title: 'MOSFET SWITCH', sub: 'gate pulldown 10 k · flyback 1N4007', accent: '#e07b39', x: 0.67, y: 1.52, z: -6.42, ry: -0.11 },
    { key: 'load', title: 'LOADS', sub: '24 V-rated LED panels · 5 V demo motors', accent: '#d9b26a', x: 2.02, y: 1.52, z: -6.15, ry: -0.3 },
  ];

  const cards = stages.map((st) => {
    const p = plateCanvas();
    const mat = new THREE.MeshBasicMaterial({ map: p.tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), mat);
    m.position.set(st.x, st.y, st.z);
    m.rotation.y = st.ry;
    m.renderOrder = 20;
    group.add(m);
    // hairline underline glow
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: new THREE.Color(st.accent), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, map: p.tex })
    );
    glow.scale.set(PW * 1.3, PH * 0.4, 1);
    glow.position.set(st.x, st.y - PH / 2 - 0.02, st.z + 0.01);
    group.add(glow);
    return { st, p, mat, m, glow };
  });

  /* flow links between stages, with travelling pulses */
  const links = [];
  for (let i = 0; i < stages.length - 1; i++) {
    const a = new THREE.Vector3(stages[i].x + PW / 2, stages[i].y, stages[i].z);
    const b = new THREE.Vector3(stages[i + 1].x - PW / 2, stages[i + 1].y, stages[i + 1].z);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.z -= 0.16;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xe8b24a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    group.add(line);
    const pulses = [];
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd894, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.scale.setScalar(0.06);
      group.add(s);
      pulses.push(s);
    }
    links.push({ curve, line, pulses, phase: i * 0.2 });
  }
  // return path (5 V / GND) drawn as a dashed underline
  {
    const pts = [];
    for (let i = 0; i < stages.length; i++) pts.push(new THREE.Vector3(stages[i].x, stages[i].y - PH / 2 - 0.09, stages[i].z));
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(64));
    const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0x9fb0a4, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0, depthWrite: false }));
    line.computeLineDistances();
    group.add(line);
    cards.push({ gnd: line });
  }

  /* anchor lines from a card down into the real device it describes */
  const anchors = [];
  const mkAnchor = (stageIdx, target, label) => {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xcaa46a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    line.frustumCulled = false;
    group.add(line);
    anchors.push({ line, from: stageIdx, target, label });
  };
  mkAnchor(0, new THREE.Vector3(-2.5, ROOM.height - 0.2, 0), 'zone sensors');
  mkAnchor(1, new THREE.Vector3(-4.02, 0.82, -2.33), 'esp32');
  mkAnchor(2, new THREE.Vector3(-3.78, 0.8, -2.22), 'mosfets');
  mkAnchor(3, new THREE.Vector3(-2.5, ROOM.height - 0.2, -1.68), 'loads');

  /* header strip */
  const head = makeTextPlate({ w: 1024, h: 96, bg: 'none', border: 'none', color: '#f2e3c2', font: '600 46px Sora, sans-serif', align: 'center' });
  const headMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.23), new THREE.MeshBasicMaterial({ map: head.tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  headMesh.position.set(0, 2.16, -6.3);
  headMesh.renderOrder = 21;
  group.add(headMesh);

  const note = makeTextPlate({ w: 1024, h: 64, bg: 'none', border: 'none', color: '#cbbda4', font: '400 27px "IBM Plex Mono", monospace', align: 'center' });
  const noteMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.16), new THREE.MeshBasicMaterial({ map: note.tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  noteMesh.position.set(0, 0.96, -6.3);
  group.add(noteMesh);

  let open = 0,
    openTarget = 0,
    t = 0,
    acc = 0;

  function setOpen(v) {
    openTarget = v ? 1 : 0;
  }

  function drawCard(cd, sim) {
    const { x } = cd.p;
    const w = cd.p.c.width,
      h = cd.p.c.height;
    const st = cd.st;
    if (st.key === 'sense') {
      frame(x, w, h, st.accent, '1 · SENSING', 'per zone · 1× PIR + 1× mmWave');
      ZONES.forEach((z, i) => {
        const pir = sim.sensors.find((s) => s.id === 'pir' + i);
        const mm = sim.sensors.find((s) => s.id === 'mm' + i);
        const y = 108 + i * 62;
        x.fillStyle = 'rgba(240,225,198,0.85)';
        x.font = '600 24px Sora, sans-serif';
        x.fillText(z.tag, 26, y);
        let cx = 78;
        cx += chip(x, cx, y - 6, 'PIR ' + (pir.enabled ? (sim.zones[i].pirSeen ? 'MOTION' : 'clear') : 'FAULT'), pir.enabled ? '#e8b24a' : '#c9403a', pir.enabled) + 8;
        cx += chip(x, cx, y - 6, 'mmW ' + (mm.enabled ? (sim.zones[i].mmSeen ? 'PRESENT' : 'clear') : 'FAULT'), mm.enabled ? (sim.zones[i].mmSeen ? '#8ec7a0' : '#7d7568') : '#c9403a', mm.enabled) + 8;
        x.fillStyle = 'rgba(232,214,182,0.5)';
        x.font = '400 20px "IBM Plex Mono", monospace';
        x.fillText(`bodies ${sim.zones[i].occupants}`, cx + 4, y + 2);
      });
      x.fillStyle = 'rgba(232,214,182,0.44)';
      x.font = '400 19px "IBM Plex Mono", monospace';
      x.fillText('PIR needs a changing IR signal · mmWave holds micro-motion', 26, h - 34);
    } else if (st.key === 'ctrl') {
      frame(x, w, h, st.accent, '2 · ESP32-S3', 'GPIO logic · 3.3 V · I²C OLED live');
      row(x, 112, 'input PIR Z1..Z3', sim.sensors.filter((s) => s.kind === 'pir' && s.enabled).map((s, i) => (sim.zones[s.zone].pirSeen ? 1 : 0)).join(''), '#e8b24a');
      row(x, 148, 'input mmW Z1..Z3', sim.zones.map((z) => (z.mmSeen ? 1 : 0)).join(''), '#8ec7a0');
      row(x, 184, 'output Q1..Q3', sim.zones.map((z) => (z.lightLevel > 0.35 ? 1 : 0)).join(''), '#f0e2c4');
      row(x, 220, 'state', sim.zones.map((z) => z.state[0]).join(''), sim.zones.some((z) => z.fault) ? '#c9403a' : '#f0e2c4');
      row(x, 256, 'grace timer', sim.zones.some((z) => z.state === 'GRACE') ? Math.max(...sim.zones.map((z) => z.countdown)).toFixed(1) + ' s' : 'idle', '#e07b39');
      row(x, 292, 'buzzer', sim.stats ? 'chirp on change' : 'idle', 'rgba(232,214,182,0.7)');
      x.fillStyle = 'rgba(232,214,182,0.44)';
      x.font = '400 19px "IBM Plex Mono", monospace';
      x.fillText('GPIO never drives a load directly', 26, h - 34);
    } else if (st.key === 'sw') {
      frame(x, w, h, st.accent, '3 · LOW-SIDE SWITCH', 'IRFZ44N · gate pulldown 10 k · 5 V loop');
      sim.zones.forEach((z, i) => {
        const y = 108 + i * 40;
        const gate = z.lightLevel > 0.05 || z.fanLevel > 0.05;
        row(x, y, `Z${i + 1}  gate ${gate ? '3.3 V' : '0 V'}`, `${Math.round(z.lightW * z.lightLevel + z.fanW * z.fanLevel)} W`, gate ? '#e8b24a' : 'rgba(232,214,182,0.6)');
      });
      x.fillStyle = 'rgba(232,214,182,0.5)';
      x.font = '400 20px "IBM Plex Mono", monospace';
      x.fillText('flyback 1N4007 across every motor', 26, 236);
      x.fillText('pulldown keeps the load OFF at boot', 26, 264);
      x.fillStyle = '#e07b39';
      x.font = '600 21px Sora, sans-serif';
      x.fillText('DEMONSTRATION VOLTAGE ONLY — NO 230 V HERE', 26, h - 38);
    } else {
      frame(x, w, h, st.accent, '4 · LOADS', 'simulated from rated power × on-time');
      sim.zones.forEach((z, i) => {
        const y = 108 + i * 52;
        const wl = Math.round(z.lightW * z.lightLevel),
          wf = Math.round(z.fanW * z.fanLevel);
        row(x, y, `${ZONES[i].tag} · ${z.lightCount} LED + ${z.fanCount} fan`, `${wl + wf} W`, z.lightLevel > 0.35 ? '#d9b26a' : 'rgba(232,214,182,0.55)');
        // mini bar
        x.fillStyle = 'rgba(120,112,100,0.3)';
        x.fillRect(26, y + 26, w - 52, 6);
        x.fillStyle = ZONES[i] && z.lightLevel > 0.35 ? '#e8b24a' : '#7d7568';
        x.fillRect(26, y + 26, (w - 52) * clamp((wl + wf) / (z.totalW || 1), 0, 1), 6);
      });
      row(x, 268, 'room total', `${Math.round(sim.zones.reduce((a, z) => a + z.lightW * z.lightLevel + z.fanW * z.fanLevel, 0))} W`, '#f0e2c4');
      x.fillStyle = 'rgba(232,214,182,0.44)';
      x.font = '400 19px "IBM Plex Mono", monospace';
      x.fillText('LED panels & ceiling fans are driven by contactors in a real build', 26, h - 34);
    }
    cd.p.tex.needsUpdate = true;
  }

  function update(dt, sim2, env) {
    const s = sim2 || sim;
    open = damp(open, openTarget, 5.4, dt);
    t += dt;
    group.visible = open > 0.01;
    if (!group.visible) return open;
    cards.forEach((cd) => {
      if (!cd.mat) return;
      cd.mat.opacity = open;
      cd.glow.material.opacity = open * 0.16;
      cd.m.scale.setScalar(lerp(0.9, 1, open));
      cd.m.position.y = cd.st.y - (1 - open) * 0.14;
      cd.glow.position.y = cd.st.y - PH / 2 - 0.02 - (1 - open) * 0.14;
    });
    acc += dt;
    if (acc > 0.14) {
      acc = 0;
      cards.forEach((cd) => cd.p && drawCard(cd, s));
      head.draw(['ECOSWITCH SIGNAL CHAIN'], {});
      headMesh.material.opacity = open * 0.95;
      note.draw([`mode ${s.mode.replace('_', '- ')} · grace ${s.offAfter}s · ${s.status}`], {});
      noteMesh.material.opacity = open * 0.8;
    }
    headMesh.scale.setScalar(lerp(0.94, 1, open));
    noteMesh.scale.setScalar(lerp(0.94, 1, open));
    links.forEach((l, i) => {
      const flow = s.zones.some((z) => z.lightLevel > 0.3) ? 1 : 0.25;
      l.line.material.opacity = open * 0.75;
      l.line.material.color.setHex(flow > 0.5 ? 0xffd07a : 0x8f8676);
      l.pulses.forEach((p, k) => {
        const u = (t * (0.28 * flow) + k / 3 + l.phase) % 1;
        p.position.copy(l.curve.getPointAt(u));
        p.material.opacity = open * (0.25 + 0.75 * Math.sin(u * Math.PI)) * flow;
        p.scale.setScalar(0.045 + 0.03 * Math.sin(u * Math.PI));
      });
    });
    if (cards[4] && cards[4].gnd) cards[4].gnd.material.opacity = open * 0.5;
    anchors.forEach((a) => {
      const cd = cards[a.from];
      const from = new THREE.Vector3(cd.st.x, cd.st.y - PH / 2 - 0.02, cd.st.z + 0.02);
      const pos = a.line.geometry.attributes.position;
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, a.target.x, a.target.y, a.target.z);
      pos.needsUpdate = true;
      a.line.material.opacity = open * 0.34;
    });
    return open;
  }

  return { group, update, setOpen, get open() { return open; } };
}
