/* Hover + click picking for every interactive component in the scene. */
import * as THREE from 'three';
import { clamp } from './utils.js';

export class Picker {
  constructor(camera, dom, roots) {
    this.camera = camera;
    this.dom = dom;
    this.roots = roots; // [group, ...] scanned for userData.pick
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.hover = null;
    this.onHover = null;
    this.onClick = null;
    this.enabled = true;
    this._t = 0;
    dom.addEventListener('pointermove', (e) => {
      this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this._last = { x: e.clientX, y: e.clientY };
      this._moved = true;
    });
    dom.addEventListener('pointerdown', (e) => {
      this._downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    dom.addEventListener('pointerup', (e) => {
      if (!this._downAt) return;
      const d = Math.hypot(e.clientX - this._downAt.x, e.clientY - this._downAt.y);
      const dt = performance.now() - this._downAt.t;
      this._downAt = null;
      if (d > 6 || dt > 520) return; // it was a drag / orbit
      const hit = this.pick(e.clientX, e.clientY);
      if (this.onClick) this.onClick(hit, e);
    });
  }

  pick(cx, cy) {
    if (!this.enabled) return null;
    if (cx == null) {
      cx = window.innerWidth / 2;
      cy = window.innerHeight / 2;
    }
    this.ray.setFromCamera(new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1), this.camera);
    const hits = this.ray.intersectObjects(this.roots, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.pick) o = o.parent;
      if (o && o.visible) return { pick: o.userData.pick, point: h.point, object: o, instanceId: h.instanceId, distance: h.distance };
      if (h.object.material && h.object.material.visible === false) continue;
    }
    return null;
  }

  tick(dt, mode) {
    this._t += dt;
    if (this._t < 0.055) return;
    this._t = 0;
    if (!this._last && mode !== 'fp') return;
    const cx = mode === 'fp' ? null : this._last ? this._last.x : null;
    const cy = mode === 'fp' ? null : this._last ? this._last.y : null;
    const hit = this.pick(cx, cy);
    const key = hit ? (hit.pick.kind + ':' + (hit.pick.id != null ? hit.pick.id : hit.pick.zone)) : null;
    if (key !== this._key) {
      this._key = key;
      this.hover = hit;
      if (this.onHover) this.onHover(hit, { x: cx == null ? window.innerWidth / 2 : cx, y: cy == null ? window.innerHeight / 2 : cy });
    } else if (this.onHoverMove && hit) this.onHoverMove(hit, { x: cx, y: cy });
  }
}
