/* Procedural canvas textures — tiny, tiling, no external assets. */
import * as THREE from 'three';
import { makeCanvas, valueNoise, seeded, roundedRectPath, clamp } from '../core/utils.js';

const cache = new Map();
function cached(key0, make, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const key = `${key0}|${repeat[0]}x${repeat[1]}|${srgb ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  const tex = make();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/* ---------------- Indian classroom floor: 600x600 vitrified tiles ---------- */
function drawFloorTiles(S = 1024, tiles = 4) {
  const { c, x } = makeCanvas(S, S);
  const cell = S / tiles;
  const n = valueNoise(7);
  x.fillStyle = '#cdb79a';
  x.fillRect(0, 0, S, S);
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const r = seeded(tx * 131 + ty * 977);
      const base = 208 + r() * 16 - 8;
      const g = Math.round(base - 16);
      const b = Math.round(base - 40);
      x.save();
      x.beginPath();
      x.rect(tx * cell + 2, ty * cell + 2, cell - 4, cell - 4);
      x.clip();
      x.fillStyle = `rgb(${base},${g},${b})`;
      x.fillRect(tx * cell, ty * cell, cell, cell);
      // marbling streaks
      for (let i = 0; i < 26; i++) {
        const u = r(),
          v = r();
        const amp = 0.09 + r() * 0.12;
        x.strokeStyle = `rgba(${120 + r() * 50},${100 + r() * 40},${70 + r() * 30},${0.05 + r() * 0.09})`;
        x.lineWidth = 1 + r() * 7;
        x.beginPath();
        for (let k = 0; k <= 12; k++) {
          const p = k / 12;
          const px = tx * cell + p * cell;
          const py = ty * cell + (v + Math.sin(p * 6 + u * 9) * amp) * cell;
          k ? x.lineTo(px, py) : x.moveTo(px, py);
        }
        x.stroke();
      }
      // speckles
      for (let i = 0; i < 90; i++) {
        const px = tx * cell + r() * cell,
          py = ty * cell + r() * cell;
        x.fillStyle = `rgba(90,70,50,${r() * 0.06})`;
        x.fillRect(px, py, 1.5, 1.5);
      }
      x.restore();
    }
  }
  // grout
  x.strokeStyle = 'rgba(88,72,54,0.42)';
  x.lineWidth = 3.4;
  for (let i = 0; i <= tiles; i++) {
    x.beginPath();
    x.moveTo(i * cell, 0);
    x.lineTo(i * cell, S);
    x.moveTo(0, i * cell);
    x.lineTo(S, i * cell);
    x.stroke();
  }
  // soft soiling near grout lines
  for (let i = 0; i < 420; i++) {
    const px = Math.random() * S,
      py = Math.random() * S;
    const gx = Math.abs((px % cell) - cell / 2) / (cell / 2);
    const gy = Math.abs((py % cell) - cell / 2) / (cell / 2);
    const edge = Math.max(gx, gy);
    if (edge > 0.93) {
      x.fillStyle = `rgba(70,55,40,${0.02 + Math.random() * 0.05})`;
      x.beginPath();
      x.arc(px, py, 2 + Math.random() * 8, 0, 6.283);
      x.fill();
    }
  }
  return new THREE.CanvasTexture(c);
}

/* ---------------- plaster wall with imperfections ---------------- */
function drawPlaster(S = 512, tint = [232, 220, 198], seedv = 3, scuffs = true) {
  const { c, x } = makeCanvas(S, S);
  const n = valueNoise(seedv);
  const img = x.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let i = 0; i < S; i++) {
      const u = i / S,
        v = y / S;
      const q = n(u, v, 4);
      const q2 = n(u * 3.7 + 0.3, v * 3.7, 2);
      const sh = (q - 0.5) * 16 + (q2 - 0.5) * 7;
      const o = (y * S + i) * 4;
      img.data[o] = clamp(tint[0] + sh, 0, 255);
      img.data[o + 1] = clamp(tint[1] + sh, 0, 255);
      img.data[o + 2] = clamp(tint[2] + sh, 0, 255);
      img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  if (scuffs) {
    const r = seeded(seedv * 77 + 5);
    for (let i = 0; i < 26; i++) {
      x.strokeStyle = `rgba(${tint[0] - 46},${tint[1] - 42},${tint[2] - 40},${0.03 + r() * 0.06})`;
      x.lineWidth = 0.6 + r() * 3;
      x.beginPath();
      let px = r() * S,
        py = r() * S;
      x.moveTo(px, py);
      for (let k = 0; k < 5; k++) {
        px += (r() - 0.5) * 90;
        py += (r() - 0.5) * 60;
        x.lineTo(px, py);
      }
      x.stroke();
    }
    // a few faint pencil marks / tape residue
    for (let i = 0; i < 10; i++) {
      x.fillStyle = `rgba(120,104,84,${0.04 + r() * 0.05})`;
      const w = 8 + r() * 40,
        h = 4 + r() * 16;
      x.fillRect(r() * S, r() * S, w, h);
    }
  }
  return new THREE.CanvasTexture(c);
}

/* bump map for plaster (grayscale, non-srgb) */
function drawPlasterBump(S = 512, seedv = 11) {
  const { c, x } = makeCanvas(S, S);
  const n = valueNoise(seedv);
  const img = x.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let i = 0; i < S; i++) {
      const q = n(i / S, y / S, 4);
      const v = clamp(150 + (q - 0.5) * 130, 0, 255);
      const o = (y * S + i) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  return new THREE.CanvasTexture(c);
}

/* ---------------- ceiling: concrete with faint grid of old paint rolls ---- */
function drawCeiling(S = 512) {
  const { c, x } = makeCanvas(S, S);
  x.fillStyle = '#efe8db';
  x.fillRect(0, 0, S, S);
  const r = seeded(31);
  for (let i = 0; i < 300; i++) {
    x.fillStyle = `rgba(${190 + r() * 40},${182 + r() * 36},${166 + r() * 30},${0.05 + r() * 0.09})`;
    const w = 20 + r() * 120;
    x.save();
    x.translate(r() * S, r() * S);
    x.rotate((r() - 0.5) * 0.4);
    x.fillRect(-w / 2, -6 - r() * 10, w, 12 + r() * 18);
    x.restore();
  }
  for (let i = 0; i < 1400; i++) {
    x.fillStyle = `rgba(150,140,124,${r() * 0.05})`;
    x.fillRect(r() * S, r() * S, 2, 2);
  }
  // damp patch near one corner for authenticity
  const g = x.createRadialGradient(S * 0.78, S * 0.2, 4, S * 0.78, S * 0.2, 150);
  g.addColorStop(0, 'rgba(158,132,96,0.30)');
  g.addColorStop(1, 'rgba(158,132,96,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

/* ---------------- laminate desk surface ---------------- */
function drawLaminate(S = 512) {
  const { c, x } = makeCanvas(S, S);
  x.fillStyle = '#c9a379';
  x.fillRect(0, 0, S, S);
  const r = seeded(88);
  for (let i = 0; i < 190; i++) {
    const y = r() * S;
    x.strokeStyle = `rgba(${120 + r() * 60},${80 + r() * 40},${44 + r() * 30},${0.05 + r() * 0.13})`;
    x.lineWidth = 0.6 + r() * 3.4;
    x.beginPath();
    x.moveTo(-10, y);
    for (let k = 0; k <= 16; k++) {
      x.lineTo((k / 16) * (S + 20) - 10, y + Math.sin(k * 0.7 + i) * (3 + r() * 8));
    }
    x.stroke();
  }
  // scratches & ring stains
  for (let i = 0; i < 26; i++) {
    x.strokeStyle = `rgba(90,64,40,${0.05 + r() * 0.07})`;
    x.lineWidth = 0.8;
    x.beginPath();
    x.arc(r() * S, r() * S, 8 + r() * 26, 0, 6.283);
    x.stroke();
  }
  for (let i = 0; i < 60; i++) {
    x.strokeStyle = `rgba(255,240,220,${0.05 + r() * 0.09})`;
    x.lineWidth = 0.7;
    x.beginPath();
    const px = r() * S,
      py = r() * S;
    x.moveTo(px, py);
    x.lineTo(px + (r() - 0.5) * 130, py + (r() - 0.5) * 24);
    x.stroke();
  }
  return new THREE.CanvasTexture(c);
}

/* ---------------- curtain cloth ---------------- */
function drawCurtain(S = 256) {
  const { c, x } = makeCanvas(S, S);
  x.fillStyle = '#b9a989';
  x.fillRect(0, 0, S, S);
  const r = seeded(4);
  for (let i = 0; i < S; i += 2) {
    x.fillStyle = `rgba(${140 + r() * 30},${124 + r() * 26},${98 + r() * 22},${0.14 + r() * 0.1})`;
    x.fillRect(i, 0, 1, S);
  }
  for (let i = 0; i < S; i += 3) {
    x.fillStyle = `rgba(255,246,226,${0.05 + r() * 0.05})`;
    x.fillRect(0, i, S, 1);
  }
  return new THREE.CanvasTexture(c);
}

/* ---------------- whiteboard with faint lecture content ---------------- */
function drawWhiteboard(S = 1024) {
  const { c, x } = makeCanvas(S, S / 2.4);
  const H = S / 2.4;
  x.fillStyle = '#f6f7f2';
  x.fillRect(0, 0, S, H);
  const r = seeded(21);
  for (let i = 0; i < 260; i++) {
    x.fillStyle = `rgba(190,196,190,${r() * 0.05})`;
    x.fillRect(r() * S, r() * H, 20 + r() * 90, 2 + r() * 4);
  }
  const ink = (a) => `rgba(38,46,58,${a})`;
  x.strokeStyle = ink(0.8);
  x.fillStyle = ink(0.85);
  x.lineWidth = 2.6;
  x.font = '500 26px "IBM Plex Mono", monospace';
  x.fillText('ECOSWITCH — ZONE CONTROL LOGIC', 42, 52);
  x.strokeStyle = ink(0.55);
  x.lineWidth = 1.6;
  x.beginPath();
  x.moveTo(42, 64);
  x.lineTo(S * 0.52, 64);
  x.stroke();

  x.font = '400 21px "IBM Plex Mono", monospace';
  const lines = [
    'if (PIR || mmWave) state = OCCUPIED;',
    'else if (state == OCCUPIED) state = GRACE;',
    'if (t_grace > 10s) warn();',
    'if (t_grace > 15s) { LOADS_OFF(); state = VACANT; }',
  ];
  lines.forEach((L, i) => x.fillText(L, 42, 104 + i * 30));

  // hand-drawn PIR wedge sketch
  x.strokeStyle = ink(0.7);
  x.lineWidth = 1.8;
  x.beginPath();
  x.moveTo(S * 0.66, H * 0.32);
  x.lineTo(S * 0.66, H * 0.86);
  x.lineTo(S * 0.94, H * 0.86);
  x.stroke();
  for (let i = 1; i <= 3; i++) {
    x.beginPath();
    x.arc(S * 0.66, H * 0.32, i * 44, 0.15 * Math.PI, 0.5 * Math.PI);
    x.stroke();
  }
  x.fillStyle = ink(0.72);
  x.font = '400 17px "IBM Plex Mono", monospace';
  x.fillText('PIR wedge', S * 0.7, H * 0.66);
  x.fillText('θ ~ 96°', S * 0.7, H * 0.8);
  return new THREE.CanvasTexture(c);
}

/* ---------------- notice board / posters ---------------- */
function drawPoster(kind = 'time', S = 512) {
  const { c, x } = makeCanvas(S, S);
  const r = seeded(kind.length * 13 + 7);
  if (kind === 'timetable') {
    x.fillStyle = '#f7f1e2';
    x.fillRect(0, 0, S, S);
    x.fillStyle = '#a8481c';
    x.fillRect(0, 0, S, 62);
    x.fillStyle = '#fdf7e8';
    x.font = '600 30px Sora, sans-serif';
    x.fillText('CLASS TIME-TABLE — SEM VI', 18, 42);
    x.strokeStyle = '#b9a882';
    x.lineWidth = 1.4;
    const rows = 8,
      cols = 6;
    for (let i = 0; i <= rows; i++) {
      x.beginPath();
      x.moveTo(14, 92 + i * ((S - 110) / rows));
      x.lineTo(S - 14, 92 + i * ((S - 110) / rows));
      x.stroke();
    }
    for (let j = 0; j <= cols; j++) {
      x.beginPath();
      x.moveTo(14 + j * ((S - 28) / cols), 92);
      x.lineTo(14 + j * ((S - 28) / cols), S - 18);
      x.stroke();
    }
    x.fillStyle = '#463a2c';
    x.font = '400 15px "IBM Plex Mono", monospace';
    const sub = ['PHYS', 'MATH', 'ES LAB', 'DE', 'ECO', 'LIB', 'PTE', 'ES'];
    for (let i = 0; i < rows; i++) {
      x.fillText(sub[i % sub.length], 22 + (i % 2) * 40, 92 + i * ((S - 110) / rows) + 30);
      for (let j = 1; j < cols; j++) if (r() > 0.45) x.fillText(sub[(i + j) % sub.length], 14 + j * ((S - 28) / cols) + 12, 92 + i * ((S - 110) / rows) + 30);
    }
  } else if (kind === 'energy') {
    x.fillStyle = '#1f2d24';
    x.fillRect(0, 0, S, S);
    x.fillStyle = '#e8b24a';
    x.font = '700 44px Sora, sans-serif';
    x.fillText('SWITCH OFF', 40, 96);
    x.fillText('WHEN YOU LEAVE', 40, 150);
    x.strokeStyle = '#e8b24a';
    x.lineWidth = 4;
    x.beginPath();
    x.arc(S - 110, S - 130, 58, 0, 6.283);
    x.stroke();
    x.beginPath();
    x.moveTo(S - 110, S - 176);
    x.lineTo(S - 110, S - 132);
    x.stroke();
    x.fillStyle = '#c9d6c4';
    x.font = '400 22px "IBM Plex Mono", monospace';
    x.fillText('ENERGY CONSERVATION CELL', 40, S - 60);
    x.fillText('DEPT. OF ELECTRICAL ENGINEERING', 40, S - 30);
  } else {
    // column chart poster
    x.fillStyle = '#f3e9d6';
    x.fillRect(0, 0, S, S);
    x.fillStyle = '#4a3426';
    x.font = '600 26px Sora, sans-serif';
    x.fillText('BLOCK C — ROOM 204', 26, 44);
    x.strokeStyle = '#c3b092';
    x.beginPath();
    x.moveTo(26, S - 60);
    x.lineTo(S - 26, S - 60);
    x.stroke();
    const cols = ['ALWAYS', 'PIR', 'RADAR', 'HYBRID'];
    const vals = [1, 0.63, 0.55, 0.34];
    cols.forEach((label, i) => {
      const h = vals[i] * (S - 170);
      const bw = (S - 90) / 4;
      x.fillStyle = ['#8a7b66', '#c78d3f', '#c96a3c', '#5d7d5a'][i];
      x.fillRect(40 + i * bw, S - 66 - h, bw - 22, h);
      x.fillStyle = '#4a3426';
      x.font = '400 16px "IBM Plex Mono", monospace';
      x.fillText(label, 40 + i * bw, S - 40);
      x.fillText(Math.round((1 - vals[i]) * 100) + '%', 40 + i * bw, S - 80 - h);
    });
  }
  return new THREE.CanvasTexture(c);
}

/* ---------------- corridor / exterior ground ---------------- */
function drawExteriorGround(S = 256) {
  const { c, x } = makeCanvas(S, S);
  x.fillStyle = '#9d9587';
  x.fillRect(0, 0, S, S);
  const r = seeded(66);
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(${100 + r() * 90},${96 + r() * 80},${86 + r() * 70},${r() * 0.35})`;
    x.fillRect(r() * S, r() * S, 2 + r() * 5, 2 + r() * 5);
  }
  for (let i = 0; i < 8; i++) {
    x.fillStyle = `rgba(70,64,56,${0.05 + r() * 0.12})`;
    x.fillRect(0, (i / 8) * S, S, 3);
  }
  return new THREE.CanvasTexture(c);
}

/* ---------------- soft radial sprite (glow / AO decal) ---------------- */
function drawRadial(S = 128, inner = 'rgba(255,225,170,0.95)', outer = 'rgba(255,225,170,0)') {
  const { c, x } = makeCanvas(S, S);
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, inner.replace(/[\d.]+\)$/, '0.35)'));
  g.addColorStop(1, outer);
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

/* ---------------- fabric upholstery / chair ---------------- */
function drawFabric(S = 256) {
  const { c, x } = makeCanvas(S, S);
  x.fillStyle = '#7d6f5c';
  x.fillRect(0, 0, S, S);
  const r = seeded(52);
  for (let i = 0; i < S; i += 2) {
    x.fillStyle = `rgba(255,244,222,${0.02 + r() * 0.05})`;
    x.fillRect(i, 0, 1, S);
    x.fillRect(0, i, S, 1);
  }
  return new THREE.CanvasTexture(c);
}

/* ---------------- blackboard-ish chalk dust for teacher desk ------------ */
function drawPaper(S = 256) {
  const { c, x } = makeCanvas(S, S);
  x.fillStyle = '#f7f2e4';
  x.fillRect(0, 0, S, S);
  const r = seeded(9);
  for (let i = 0; i < 1200; i++) {
    x.fillStyle = `rgba(190,178,150,${r() * 0.12})`;
    x.fillRect(r() * S, r() * S, 2, 2);
  }
  x.strokeStyle = 'rgba(120,120,120,0.16)';
  for (let i = 1; i < 14; i++) {
    x.beginPath();
    x.moveTo(18, 26 + i * 16);
    x.lineTo(S - 18, 26 + i * 16);
    x.stroke();
  }
  return new THREE.CanvasTexture(c);
}

/* ---------------- Textures API ---------------- */
export const TEX = {
  floor(repeat = [8, 5.6]) {
    return cached('floor', () => drawFloorTiles(), { repeat, srgb: true });
  },
  wall(repeat = [4, 1.6]) {
    return cached('wall', () => drawPlaster(512, [233, 221, 199], 3), { repeat });
  },
  wallInner(repeat = [6, 1.4]) {
    return cached('wall2', () => drawPlaster(512, [240, 229, 208], 9), { repeat });
  },
  wallBump(repeat = [4, 1.6]) {
    return cached('wallB', () => drawPlasterBump(512, 13), { repeat, srgb: false });
  },
  ceiling(repeat = [6, 4]) {
    return cached('ceil', () => drawCeiling(), { repeat });
  },
  laminate(repeat = [1, 1]) {
    return cached('lam', () => drawLaminate(), { repeat });
  },
  curtain(repeat = [2, 2]) {
    return cached('cur', () => drawCurtain(), { repeat });
  },
  whiteboard() {
    return cached('wb', () => drawWhiteboard(), { repeat: [1, 1], aniso: 4 });
  },
  poster(kind) {
    return cached('post' + kind, () => drawPoster(kind), { repeat: [1, 1], aniso: 4 });
  },
  ground(repeat = [40, 40]) {
    return cached('gnd', () => drawExteriorGround(), { repeat });
  },
  fabric(repeat = [3, 3]) {
    return cached('fab', () => drawFabric(), { repeat });
  },
  paper(repeat = [1, 1]) {
    return cached('paper', () => drawPaper(), { repeat });
  },
  glow(inner, outer) {
    return cached('glow' + (inner || '') + (outer || ''), () => drawRadial(128, inner, outer), { repeat: [1, 1] });
  },
};

/* Dynamic OLED canvas — exposed so the electronics module can update it. */
export function makeOledTexture(w = 256, h = 128) {
  const { c, x } = makeCanvas(w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearFilter;
  return { tex, canvas: c, ctx: x, w, h };
}

/* Generic live-label texture for 3D info plates. */
export function makeLabelTexture(w = 512, h = 128) {
  const { c, x } = makeCanvas(w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return { tex, canvas: c, ctx: x, w, h };
}

/* Rounded plate used by 3D overlay cards. */
export function drawPlate(ctx, w, h, { bg = 'rgba(28,20,14,0.86)', border = 'rgba(226,196,140,0.35)', rad = 22 } = {}) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bg;
  roundedRectPath(ctx, 0, w / 2, h / 2, w - 2, h - 2, rad);
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 2;
  ctx.stroke();
}
