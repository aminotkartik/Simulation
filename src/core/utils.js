/* Small helpers: math, easing, tweens, DOM, procedural canvas textures. */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : clamp((v - a) / (b - a)));
export const smoothstep = (t) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const approach = (cur, target, maxDelta) => {
  const d = target - cur;
  return Math.abs(d) <= maxDelta ? target : cur + Math.sign(d) * maxDelta;
};
export const fmtTime = (s) => {
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
export const fmtNum = (v, d = 2) => (Math.abs(v) < 1e-4 ? (0).toFixed(d) : v.toFixed(d));

/* ---------- easing ---------- */
export const Ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  inQuad: (t) => t * t,
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  outBack: (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
};

/* ---------- tween manager ---------- */
export class Tweens {
  constructor() {
    this.list = [];
  }
  to(obj, props, dur = 0.6, ease = Ease.inOut, onDone = null) {
    const t = { obj, from: {}, to: props, dur, ease, e: 0, onDone };
    for (const k in props) t.from[k] = obj[k];
    this.list.push(t);
    return () => {
      const i = this.list.indexOf(t);
      if (i >= 0) this.list.splice(i, 1);
    };
  }
  num(from, to, dur, ease, onUpdate, onDone) {
    const t = { obj: { v: from }, from: { v: from }, to: { v: to }, dur, ease, e: 0, onUpdate, onDone };
    this.list.push(t);
    return () => {
      const i = this.list.indexOf(t);
      if (i >= 0) this.list.splice(i, 1);
    };
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      t.e += dt;
      const k = t.dur <= 0 ? 1 : clamp(t.e / t.dur);
      const e = t.ease(k);
      for (const key in t.to) t.obj[key] = lerp(t.from[key], t.to[key], e);
      if (t.onUpdate) t.onUpdate(t.obj.v, e);
      if (k >= 1) {
        this.list.splice(i, 1);
        if (t.onDone) t.onDone();
      }
    }
  }
  clear() {
    this.list.length = 0;
  }
}

/* ---------- DOM ---------- */
export function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}
export function qs(sel, root = document) {
  return root.querySelector(sel);
}
export function on(node, ev, fn, opt) {
  node.addEventListener(ev, fn, opt);
  return () => node.removeEventListener(ev, fn, opt);
}
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- procedural canvas textures ---------- */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, x: c.getContext('2d') };
}

export function noiseOverlay(x, w, h, amount = 10, alpha = 0.5) {
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount * 2;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
    d[i + 3] = clamp(d[i + 3] * 1, 0, 255);
  }
  x.putImageData(img, 0, 0);
  if (alpha < 1) {
    x.globalAlpha = alpha;
    x.globalAlpha = 1;
  }
}

/* value-noise (cheap, tileable-ish) used for plaster / wood grain */
export function valueNoise(seed = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const grid = [];
  const N = 8;
  for (let i = 0; i < (N + 1) * (N + 1); i++) grid.push(rnd());
  return (u, v, oct = 3) => {
    let amp = 1,
      freq = 1,
      sum = 0,
      norm = 0;
    for (let o = 0; o < oct; o++) {
      const x = u * N * freq;
      const y = v * N * freq;
      const xi = Math.floor(x) % N;
      const yi = Math.floor(y) % N;
      const xf = x - Math.floor(x);
      const yf = y - Math.floor(y);
      const g = (a, b) => grid[((b % (N + 1)) * (N + 1) + (a % (N + 1))) % grid.length];
      const sm = (t) => t * t * (3 - 2 * t);
      const u2 = sm(xf),
        v2 = sm(yf);
      const a = lerp(g(xi, yi), g(xi + 1, yi), u2);
      const b = lerp(g(xi, yi + 1), g(xi + 1, yi + 1), u2);
      sum += lerp(a, b, v2) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / norm;
  };
}

export function roundedRectPath(x, r, cx, cy, w, h, rad) {
  const l = cx - w / 2,
    t = cy - h / 2;
  x.beginPath();
  x.moveTo(l + rad, t);
  x.lineTo(l + w - rad, t);
  x.quadraticCurveTo(l + w, t, l + w, t + rad);
  x.lineTo(l + w, t + h - rad);
  x.quadraticCurveTo(l + w, t + h, l + w - rad, t + h);
  x.lineTo(l + rad, t + h);
  x.quadraticCurveTo(l, t + h, l, t + h - rad);
  x.lineTo(l, t + rad);
  x.quadraticCurveTo(l, t, l + rad, t);
  x.closePath();
}

/* deterministic pseudo random for scatter details */
export function seeded(seedv) {
  let s = seedv >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
