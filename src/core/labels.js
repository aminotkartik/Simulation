/* Canvas text plates used for 3D labels (OLED, door plate, zone markers,
   system-view cards). Kept tiny so updates are cheap. */
import * as THREE from 'three';
import { makeCanvas, roundedRectPath } from './utils.js';

export function makeTextPlate({
  w = 512,
  h = 128,
  bg = 'rgba(20,14,10,0.9)',
  border = 'rgba(226,196,140,0.34)',
  radius = 20,
  pad = 22,
  font = '500 34px "IBM Plex Mono", monospace',
  color = '#f2e3c2',
  align = 'left',
} = {}) {
  const { c, x } = makeCanvas(w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearFilter;
  const api = {
    tex,
    canvas: c,
    ctx: x,
    w,
    h,
    dirty: true,
    last: '',
    clear(fill = bg, stroke = border) {
      x.clearRect(0, 0, w, h);
      if (fill !== 'none') {
        x.fillStyle = fill;
        roundedRectPath(x, 0, w / 2, h / 2, w - 2, h - 2, radius);
        x.fill();
      }
      if (stroke !== 'none') {
        x.strokeStyle = stroke;
        x.lineWidth = 2;
        roundedRectPath(x, 0, w / 2, h / 2, w - 2, h - 2, radius);
        x.stroke();
      }
    },
    draw(lines, opts = {}) {
      const key = JSON.stringify([lines, opts]);
      if (key === api.last) return false;
      api.last = key;
      api.clear(opts.bg ?? bg, opts.border ?? border);
      x.textAlign = opts.align ?? align;
      x.textBaseline = 'top';
      const lh = opts.lineHeight ?? Math.round(h / (lines.length + 0.9));
      lines.forEach((ln, i) => {
        const isArr = Array.isArray(ln);
        const text = isArr ? ln[0] : ln;
        x.font = (isArr && ln[1]?.font) || opts.font || font;
        x.fillStyle = (isArr && ln[1]?.color) || opts.color || color;
        const y = pad * 0.55 + i * lh;
        if (isArr && ln[1]?.align) x.textAlign = ln[1].align;
        else x.textAlign = opts.align ?? align;
        const px = x.textAlign === 'center' ? w / 2 : x.textAlign === 'right' ? w - pad : pad;
        x.fillText(text, px, y);
      });
      tex.needsUpdate = true;
      return true;
    },
    raw: () => x,
  };
  return api;
}

/* OLED — 128×64 pixel look with chunky pixels and a warm amber tint. */
export function makeOledPlate(px = 128, py = 64, scale = 2) {
  const { c, x } = makeCanvas(px * scale, py * scale);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  const pal = { on: '#ffd98a', dim: '#7a6132', hot: '#ff9d5c', off: '#000000' };
  let last = '';
  const api = {
    tex,
    draw(rows) {
      const key = rows.join('|');
      if (key === last) return false;
      last = key;
      x.fillStyle = '#050505';
      x.fillRect(0, 0, c.width, c.height);
      x.font = `${10 * scale}px "IBM Plex Mono", monospace`;
      x.textBaseline = 'top';
      rows.forEach((r, i) => {
        let txt = r,
          col = pal.on;
        if (Array.isArray(r)) {
          txt = r[0];
          col = pal[r[1]] || pal.on;
        }
        // trailing state marker column
        const m = txt.match(/\[([A-Z0-9_ ]*)\]\s*$/);
        x.fillStyle = col;
        x.fillText(txt, 2 * scale, (2 + i * 12) * scale);
      });
      tex.needsUpdate = true;
      return true;
    },
    pixels: pal,
    ctx: x,
    canvas: c,
  };
  return api;
}
