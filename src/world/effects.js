/* ============================================================================
   Visualisation layer: zone boundaries, radar / PIR fields, detection links,
   soft pings, dust in the sunbeams. Everything here is additive, depth-write
   off, and hidden by default except for the faint zone overlays — so the room
   reads as a real room until the user asks to see the sensing.
   ==========================================================================*/
import * as THREE from 'three';
import { ZONES, SENSORS, ROOM, STATE_COLORS, FANS, LIGHTS } from '../config.js';
import { clamp, lerp, damp, TAU, DEG, seeded } from '../core/utils.js';
import { TEX } from '../core/textures.js';

/* ---------- soft-edged zone floor overlay with animated state ---------- */
const zoneVert = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `;
const zoneFrag = `
uniform vec3 col; uniform float alpha; uniform float edge; uniform float state; uniform float t; uniform float w; uniform float h;
varying vec2 vUv;
void main(){
  // soft inner border
  vec2 p = vUv;
  float bx = smoothstep(0.0, 0.055, p.x) * smoothstep(1.0, 0.945, p.x);
  float bz = smoothstep(0.0, 0.12, p.y) * smoothstep(1.0, 0.88, p.y);
  float body = bx * bz;
  // thin luminous frame
  float fx = min(p.x, 1.0-p.x), fy = min(p.y, 1.0-p.y);
  float lx = smoothstep(0.010, 0.0, fx) * step(0.03, fy);
  float ly = smoothstep(0.012, 0.0, fy) * step(0.03, fx);
  float frame = max(lx, ly);
  // grace countdown sweeps a bar across the zone
  float sweep = 0.0;
  if (state > 0.5 && state < 1.5) {
    float k = fract(t * 0.25);
    sweep = smoothstep(0.02, 0.0, abs(p.x - k)) * 0.8;
  }
  // occupied: warm breathing pool. vacant: dead flat.
  float breathe = 0.82 + 0.18 * sin(t * 1.7);
  float a = alpha * (body * (0.55 + 0.45 * breathe) + frame * 1.5 + sweep);
  gl_FragColor = vec4(col * (0.7 + 0.6 * frame + sweep), a);
}`;

function makeZoneOverlay(z) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: zoneVert,
    fragmentShader: zoneFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      col: { value: new THREE.Color(STATE_COLORS.VACANT) },
      alpha: { value: 0.045 },
      state: { value: 0 },
      t: { value: 0 },
      w: { value: z.depth },
      h: { value: ROOM.width },
      edge: { value: 0.05 },
    },
  });
  const geo = new THREE.PlaneGeometry(z.depth, ROOM.width);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(z.cx, 0.008, 0);
  m.renderOrder = 4;
  return m;
}

/* ---------- mmWave: translucent downward cone with travelling ripples --- */
const radarVert = `
varying vec3 vP; varying vec2 vUv; varying vec3 vN;
void main(){ vUv=uv; vP=position; vN=normalize(normalMatrix*normal);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `;
const radarFrag = `
uniform float t; uniform float h; uniform float r0; uniform float alpha; uniform vec3 col; uniform float live;
varying vec3 vP; varying vec2 vUv; varying vec3 vN;
void main(){
  float y = clamp(vP.y / h + 0.5, 0.0, 1.0);          // 0 at bottom ring, 1 at apex
  float rad = mix(r0, 0.02, y);
  // ripples moving outward and down, like a swept FMCW chirp
  float bands = sin((y * 7.0 - t * 1.15) * 6.2831) * 0.5 + 0.5;
  float rings = smoothstep(0.55, 1.0, bands);
  float fade = mix(1.0, 0.22, y);
  float rim = pow(1.0 - abs(dot(normalize(vN), vec3(0.0,0.0,1.0))), 1.6);
  float a = alpha * fade * (0.30 + 0.55 * rings + 0.5 * rim) * (0.35 + 0.65 * live);
  gl_FragColor = vec4(col * (0.55 + rings * 0.7 + rim * 0.5), a);
}`;

function makeRadarField(sensor) {
  const h = sensor.y - 0.85; // field is drawn down to desk height
  const r = Math.min(sensor.range, Math.tan((sensor.beam / 2) * DEG) * (sensor.y - 1.15));
  const geo = new THREE.ConeGeometry(r, h, 46, 1, true);
  geo.translate(0, -h / 2, 0);
  const mat = new THREE.ShaderMaterial({
    vertexShader: radarVert,
    fragmentShader: radarFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      t: { value: 0 },
      h: { value: h },
      r0: { value: r },
      alpha: { value: 0.1 },
      col: { value: new THREE.Color(0xe8b24a) },
      live: { value: 0 },
    },
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(sensor.x, sensor.y, sensor.z);
  m.renderOrder = 6;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r - 0.02, r + 0.02, 60),
    new THREE.MeshBasicMaterial({ color: 0xe8b24a, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(sensor.x, 0.012, sensor.z);
  return { cone: m, ring, r, h };
}

/* ---------- PIR: horizontal fan of alternating lens lobes --------------- */
function makePirField(sensor) {
  const g = new THREE.Group();
  const half = (sensor.beam / 2) * DEG;
  const lobes = 5;
  const cols = 30;
  const hDown = sensor.y - 0.75;
  const positions = [];
  const uv = [];
  const idx = [];
  let v = 0;
  const inner = 0.25;
  for (let l = 0; l < lobes; l++) {
    const a0 = -half + ((l * 2 + 0.0) / (lobes * 2)) * (half * 2);
    const a1 = -half + ((l * 2 + 1.0) / (lobes * 2)) * (half * 2);
    for (let i = 0; i < cols; i++) {
      const s0 = a0 + ((a1 - a0) * i) / cols;
      const s1 = a0 + ((a1 - a0) * (i + 1)) / cols;
      // one quad per angular step, spanning inner..outer and top..bottom
      const p = (ang, r, ty) => {
        const x = Math.sin(ang) * r;
        const z = Math.cos(ang) * r;
        return [x, ty * hDown, z];
      };
      const A = p(s0, inner, 1),
        B = p(s1, inner, 1),
        C = p(s0, sensor.range, 0),
        D = p(s1, sensor.range, 0);
      [A, B, C, B, D, C].forEach((q) => {
        positions.push(q[0], q[1], q[2]);
        uv.push(clamp(l / lobes + (q[0] === A[0] ? 0 : 0.2), 0, 1), q[1] > 0 ? 1 : 0);
      });
      idx.push(v, v + 1, v + 2, v + 3, v + 4, v + 5);
      v += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      t: { value: 0 },
      alpha: { value: 0.08 },
      col: { value: new THREE.Color(0xf0c07a) },
      live: { value: 0 },
      range: { value: sensor.range },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv=uv; vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `
      uniform float t; uniform float alpha; uniform vec3 col; uniform float live; uniform float range;
      varying vec2 vUv; varying vec3 vP;
      void main(){
        float d = length(vP.xz);
        float fall = smoothstep(range, range*0.25, d);
        float vert = smoothstep(0.0, 0.35, vP.y) * 0.5 + 0.5;
        float pulse = 0.6 + 0.4*sin(t*2.2 - d*2.4);
        float a = alpha * fall * vert * (0.35 + 0.65*live) * pulse;
        gl_FragColor = vec4(col*(0.6+0.5*live), a);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(sensor.x, sensor.y, sensor.z);
  m.rotation.y = sensor.yaw * DEG - Math.PI / 2;
  m.renderOrder = 5;
  g.add(m);
  const body = new THREE.Mesh(
    new THREE.RingGeometry(0.055, 0.075, 20),
    new THREE.MeshBasicMaterial({ color: 0xf0c07a, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })
  );
  body.position.set(sensor.x, sensor.y - 0.02, sensor.z);
  body.lookAt(0, sensor.y - 1, 0);
  g.add(body);
  return { group: g, mesh: m, mat, body };
}

export function buildEffects(sim) {
  const group = new THREE.Group();
  group.name = 'effects';
  const R = seeded(77);

  /* zone overlays ------------------------------------------------------- */
  const zones = ZONES.map((z) => {
    const m = makeZoneOverlay(z);
    group.add(m);
    // boundary ribbon: two thin strips at the zone edges
    const strips = [z.x0, z.x1].map((bx) => {
      const s = new THREE.Mesh(
        new THREE.PlaneGeometry(0.03, ROOM.width),
        new THREE.MeshBasicMaterial({ color: 0xcaa46a, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      s.rotation.x = -Math.PI / 2;
      s.position.set(bx, 0.01, 0);
      group.add(s);
      return s;
    });
    // floating state tag above the zone centre
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    tag.position.set(z.cx, 2.15, 0);
    tag.visible = false;
    const tagCanvas = document.createElement('canvas');
    tagCanvas.width = 384;
    tagCanvas.height = 96;
    const tagTex = new THREE.CanvasTexture(tagCanvas);
    tagTex.colorSpace = THREE.SRGBColorSpace;
    tag.material.map = tagTex;
    group.add(tag);
    return { mesh: m, strips, tag, tagCanvas, tagTex, zone: z, lastTag: '' };
  });

  /* fields -------------------------------------------------------------- */
  const fields = SENSORS.map((s) => {
    if (s.kind === 'mmwave') {
      const f = makeRadarField(s);
      group.add(f.cone);
      group.add(f.ring);
      return { sensor: s, kind: 'mm', ...f, alphaTarget: 0 };
    }
    const f = makePirField(s);
    group.add(f.group);
    return { sensor: s, kind: 'pir', ...f, alphaTarget: 0 };
  });

  /* detection links: one LineSegments for everything (1 draw call) ------- */
  const LINK_MAX = 40;
  const linkGeo = new THREE.BufferGeometry();
  const linkPos = new Float32Array(LINK_MAX * 2 * 3);
  const linkCol = new Float32Array(LINK_MAX * 2 * 3);
  linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPos, 3));
  linkGeo.setAttribute('color', new THREE.BufferAttribute(linkCol, 3));
  const linkMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const links = new THREE.LineSegments(linkGeo, linkMat);
  links.frustumCulled = false;
  links.renderOrder = 7;
  group.add(links);

  /* per-occupant detection ring pool ----------------------------------- */
  const rings = [];
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.2, 28),
      new THREE.MeshBasicMaterial({ color: 0xe8b24a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.02;
    m.visible = false;
    group.add(m);
    rings.push({ mesh: m, life: 0, hold: 0 });
  }

  /* soft pings on state change ------------------------------------------ */
  const pings = [];
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: TEX.glow('rgba(255,215,150,0.9)', 'rgba(255,180,90,0)'), color: 0xffd58a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    s.scale.setScalar(1);
    s.visible = false;
    group.add(s);
    pings.push({ s, life: 0, pos: new THREE.Vector3(), size: 1 });
  }
  function ping(x, y, z, size = 1.6, color = 0xffd58a) {
    const p = pings.find((q) => q.life <= 0) || pings[0];
    p.life = 1;
    p.size = size;
    p.pos.set(x, y, z);
    p.s.material.color.setHex(color);
    p.s.visible = true;
    return p;
  }

  /* dust motes in the room --------------------------------------------- */
  const DN = 700;
  const dpos = new Float32Array(DN * 3);
  const dseed = new Float32Array(DN);
  for (let i = 0; i < DN; i++) {
    dpos[i * 3] = -4.7 + R() * 9.4;
    dpos[i * 3 + 1] = 0.2 + R() * 2.85;
    dpos[i * 3 + 2] = -3.2 + R() * 6.4;
    dseed[i] = R();
  }
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dgeo.setAttribute('seed', new THREE.BufferAttribute(dseed, 1));
  const dust = new THREE.Points(
    dgeo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { t: { value: 0 }, amount: { value: 0.5 }, px: { value: 1 } },
      vertexShader: `attribute float seed; uniform float t; uniform float px; varying float vA;
        void main(){
          vec3 p = position;
          p.x += sin(t*0.21 + seed*6.283)*0.5;
          p.y += sin(t*0.14 + seed*12.3)*0.28;
          p.z += cos(t*0.17 + seed*9.1)*0.42;
          vA = 0.25 + 0.75*fract(seed*7.31);
          vec4 mv = modelViewMatrix*vec4(p,1.0);
          gl_PointSize = (1.1 + seed*1.9) * px * (2.6 / max(0.4, -mv.z));
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: `uniform float amount; varying float vA;
        void main(){ vec2 d = gl_PointCoord-0.5; float m = smoothstep(0.5,0.0,length(d));
          gl_FragColor = vec4(vec3(1.0,0.93,0.8)*m, m*vA*amount*0.32); }`,
    })
  );
  dust.frustumCulled = false;
  group.add(dust);

  /* fan air swirl (subtle disc above the benches when a fan runs) -------- */
  const air = FANS.map((f) => {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 30),
      new THREE.MeshBasicMaterial({ map: TEX.glow('rgba(226,236,244,0.16)', 'rgba(200,214,226,0)'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(f.x, 2.45, f.z);
    group.add(m);
    return { mesh: m, fan: f };
  });

  /* light pool decals under each fixture (helps the "off = darker" read) */
  const pools = LIGHTS.map((L) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.15, 1.5),
      new THREE.MeshBasicMaterial({ map: TEX.glow('rgba(255,222,158,0.5)', 'rgba(255,200,120,0)'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(L.x, 0.016, L.z);
    m.renderOrder = 3;
    group.add(m);
    return { mesh: m, cfg: L };
  });

  let t = 0;
  let viz = 0; // 0 hidden, 1 full sensor viz
  let vizTarget = 0;
  const col = new THREE.Color();

  function update(dt, sim, env) {
    t += dt;
    viz = damp(viz, vizTarget, 6, dt);
    env && (env.viz = viz);

    zones.forEach((z) => {
      const zs = sim.zones[z.zone.id];
      const c =
        zs.manual !== 'AUTO'
          ? zs.manual === 'ON'
            ? STATE_COLORS.MANUAL
            : STATE_COLORS.VACANT
          : zs.fault
          ? STATE_COLORS.FAULT
          : zs.state === 'OCCUPIED'
          ? STATE_COLORS.OCCUPIED
          : zs.state === 'GRACE'
          ? STATE_COLORS.GRACE
          : STATE_COLORS.VACANT;
      col.set(c);
      z.mesh.material.uniforms.col.value.lerp(col, 1 - Math.exp(-7 * dt));
      z.mesh.material.uniforms.t.value = t;
      const base = zs.state === 'OCCUPIED' ? 0.05 : zs.state === 'GRACE' ? 0.075 : 0.018;
      z.mesh.material.uniforms.alpha.value = lerp(base, base * 3.6 + (zs.state === 'VACANT' ? 0.03 : 0.06), viz);
      z.mesh.material.uniforms.state.value = zs.state === 'GRACE' ? 1 : 0;
      z.strips.forEach((s) => {
        s.material.color.lerp(col, 1 - Math.exp(-7 * dt));
        s.material.opacity = lerp(0.1, 0.42, viz) * (zs.state === 'VACANT' ? 0.6 : 1);
      });
      if (env && env.showTags) {
        z.tag.visible = true;
        const txt = `${z.zone.tag} ${zs.manual !== 'AUTO' ? 'MANUAL' : zs.state}`;
        if (txt !== z.lastTag) {
          z.lastTag = txt;
          const cx = z.tagCanvas.getContext('2d');
          cx.clearRect(0, 0, 384, 96);
          cx.fillStyle = 'rgba(24,17,11,0.72)';
          cx.fillRect(0, 20, 384, 56);
          cx.strokeStyle = c;
          cx.lineWidth = 3;
          cx.strokeRect(1.5, 21.5, 381, 53);
          cx.fillStyle = c;
          cx.font = '600 30px Sora, sans-serif';
          cx.textBaseline = 'middle';
          cx.fillText(txt, 22, 50);
          z.tagTex.needsUpdate = true;
        }
        z.tag.lookAt(env.cameraPos);
      } else z.tag.visible = false;
    });

    fields.forEach((f) => {
      const s = sim.sensors.find((x) => x.id === f.sensor.id);
      const live = s.enabled ? (s.presence ? 1 : 0.25) : 0;
      const mat = f.kind === 'mm' ? f.cone.material : f.mat;
      mat.uniforms.t.value = t;
      mat.uniforms.live.value = damp(mat.uniforms.live.value, live, 8, dt);
      const fault = !s.enabled;
      mat.uniforms.col.value.lerp(new THREE.Color(fault ? 0xb0402f : s.presence ? 0xffce7a : 0xe0a95e), 1 - Math.exp(-6 * dt));
      const target = viz * (fault ? 0.34 : 1);
      mat.uniforms.alpha.value = lerp(mat.uniforms.alpha.value, target * (f.kind === 'mm' ? 0.115 : 0.1), 1 - Math.exp(-5 * dt));
      if (f.kind === 'mm') {
        f.ring.material.opacity = lerp(0.06, 0.3, viz) * (fault ? 0.4 : 0.6 + 0.4 * live);
        f.ring.material.color.copy(mat.uniforms.col.value);
        f.ring.scale.setScalar(1 + Math.sin(t * 1.1 + f.sensor.zone) * 0.012);
      } else {
        f.body.material.opacity = 0.18 + 0.5 * live * viz;
      }
    });

    // links from each live sensor to the bodies it sees
    let n = 0;
    if (viz > 0.02) {
      for (const s of sim.sensors) {
        if (!s.enabled || !s.presence) continue;
        const sx = s.x,
          sy = s.y,
          sz = s.z;
        for (const o of sim.occupants) {
          if (n >= LINK_MAX) break;
          if (o.zone !== s.zone) continue;
          if (Math.hypot(o.x - sx, o.z - sz) > s.range * 1.25) continue;
          const still = o.motion < 0.12;
          const warm = still ? [0.72, 0.9, 0.55] : [1.0, 0.78, 0.42];
          const i0 = n * 6;
          linkPos[i0] = sx;
          linkPos[i0 + 1] = sy - 0.05;
          linkPos[i0 + 2] = sz;
          linkPos[i0 + 3] = o.x;
          linkPos[i0 + 4] = o.state === 'seated' ? 1.05 : 1.5;
          linkPos[i0 + 5] = o.z;
          const a = viz * (still ? 0.32 : 0.5);
          for (let k = 0; k < 2; k++) {
            linkCol[i0 + k * 3] = warm[0] * a;
            linkCol[i0 + k * 3 + 1] = warm[1] * a;
            linkCol[i0 + k * 3 + 2] = warm[2] * a;
          }
          n++;
        }
      }
    }
    linkGeo.setDrawRange(0, n * 2);
    linkGeo.attributes.position.needsUpdate = true;
    linkGeo.attributes.color.needsUpdate = true;
    linkMat.opacity = 0.9;

    // occupant rings
    let ri = 0;
    for (const o of sim.occupants) {
      if (ri >= rings.length) break;
      const seen = sim.zones[o.zone].pirSeen || sim.zones[o.zone].mmSeen;
      const r = rings[ri++];
      r.mesh.visible = viz > 0.03;
      if (!r.mesh.visible) continue;
      r.mesh.position.set(o.x, 0.024, o.z);
      const still = o.motion < 0.12;
      const pulse = still ? 0.5 + 0.5 * Math.sin(t * 1.6 + o.id) : 0.75 + 0.25 * Math.sin(t * 6 + o.id);
      r.mesh.scale.setScalar((still ? 0.9 : 1.1) + pulse * 0.16);
      r.mesh.material.color.setHex(seen ? (still ? 0xa8c98a : 0xffc46a) : 0x6d6a63);
      r.mesh.material.opacity = viz * (seen ? 0.4 : 0.14) * (0.6 + 0.4 * pulse);
    }
    for (; ri < rings.length; ri++) rings[ri].mesh.visible = false;

    // pings
    pings.forEach((p) => {
      if (p.life <= 0) {
        p.s.visible = false;
        return;
      }
      p.life -= dt * 1.15;
      const k = 1 - Math.max(0, p.life);
      p.s.position.copy(p.pos);
      p.s.scale.setScalar(p.size * (0.4 + k * 1.5));
      p.s.material.opacity = Math.pow(1 - k, 1.4) * 0.6;
    });

    // dust + air + pools
    dust.material.uniforms.t.value = t;
    dust.material.uniforms.px.value = env ? env.pixelRatio : 1;
    dust.material.uniforms.amount.value = (0.35 + 0.65 * (env ? env.daylight : 0.5)) * (env && env.perf ? 0.5 : 1);
    air.forEach((a) => {
      const lvl = sim.zones[a.fan.zone].fanLevel;
      a.mesh.material.opacity = damp(a.mesh.material.opacity, lvl * 0.16, 4, dt);
      a.mesh.rotation.z += dt * (0.6 + lvl * 3);
    });
    pools.forEach((p) => {
      const lvl = sim.zones[p.cfg.zone].lightLevel;
      p.mesh.material.opacity = damp(p.mesh.material.opacity, lvl * (viz > 0.5 ? 0.3 : 0.16), 5, dt);
    });
  }

  return {
    group,
    update,
    ping,
    setDust(v) {
      dust.visible = !!v;
    },
    setViz(v) {
      vizTarget = v ? 1 : 0;
    },
    get viz() {
      return viz;
    },
    zoneMeshes: zones,
  };
}
