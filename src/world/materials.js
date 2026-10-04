/* Shared material library — all materials are created once and reused so the
   whole classroom can be faded for the system view with a handful of writes. */
import * as THREE from 'three';
import { TEX } from '../core/textures.js';
import { PALETTE } from '../config.js';

export const MAT = {};

function std(opts = {}, tag = {}) {
  const { env, ...rest } = opts; // `env` is ours, not a material property
  const m = new THREE.MeshStandardMaterial(rest);
  m.envMapIntensity = env ?? tag.env ?? 0.55;
  m.userData.xray = tag.xray !== false;
  m.userData.baseOpacity = 1;
  Object.assign(m.userData, tag);
  return m;
}

export function buildMaterials(renderer) {
  const M = MAT;

  M.floor = std({
    map: TEX.floor([8.2, 5.6]),
    roughness: 0.42,
    metalness: 0.02,
    color: 0xffffff,
    env: 0.7,
  });
  M.wall = std({ map: TEX.wallInner([5, 1.5]), bumpMap: TEX.wallBump([5, 1.5]), bumpScale: 0.35, roughness: 0.92, metalness: 0, color: 0xf6efdf, env: 0.35 });
  M.wallPaintLow = std({ map: TEX.wall([5, 0.6]), roughness: 0.86, color: 0xd9c7a6, env: 0.3 });
  M.extWall = std({ map: TEX.wall([3, 1.2]), roughness: 0.95, color: 0xcdbfa6, env: 0.25 });
  M.ceiling = std({ map: TEX.ceiling([5.5, 3.8]), roughness: 0.95, color: 0xf4efe4, env: 0.28 });
  M.concrete = std({ color: 0xbdb3a3, roughness: 0.95, env: 0.25 });
  M.skirting = std({ color: 0x6f6357, roughness: 0.55, metalness: 0.05, env: 0.5 });
  M.laminate = std({ map: TEX.laminate([1.6, 1]), roughness: 0.36, metalness: 0.02, color: 0xffffff, env: 0.8 });
  M.laminateDark = std({ map: TEX.laminate([1, 1]), roughness: 0.44, color: 0xa07c55, env: 0.6 });
  M.metal = std({ color: 0x8f9296, roughness: 0.42, metalness: 0.86, env: 1.05 });
  M.metalDark = std({ color: 0x54585c, roughness: 0.55, metalness: 0.7, env: 0.8 });
  M.aluminium = std({ color: 0xc8ccd0, roughness: 0.3, metalness: 0.9, env: 1.15 });
  M.chalk = std({ color: 0xf7f8f4, roughness: 0.22, metalness: 0.02, env: 1.2 });
  M.paint = (c, r = 0.6) => std({ color: c, roughness: r, env: 0.5 });
  M.glass = new THREE.MeshPhysicalMaterial({
    color: 0xdfeef2,
    roughness: 0.06,
    metalness: 0,
    transmission: 0.92,
    thickness: 0.02,
    transparent: true,
    opacity: 0.42,
    ior: 1.5,
    side: THREE.DoubleSide,
  });
  M.glass.userData.xray = false;
  M.curtain = std({ map: TEX.curtain([1.4, 2.2]), roughness: 0.94, color: 0xcdbd9d, side: THREE.DoubleSide, env: 0.4 });
  M.fabric = std({ map: TEX.fabric([2, 2]), roughness: 0.9, color: 0x6c7f74, env: 0.3 });
  M.paper = std({ map: TEX.paper([1, 1]), roughness: 0.85, color: 0xfbf6e8, env: 0.3 });
  M.whiteboard = std({ map: TEX.whiteboard(), roughness: 0.16, metalness: 0.03, env: 1.35 });
  M.boardFrame = std({ color: 0xb8bcc0, roughness: 0.35, metalness: 0.55, env: 0.9 });
  M.plastic = (c, r = 0.5) => std({ color: c, roughness: r, metalness: 0.02, env: 0.6 });
  M.pcb = std({ color: 0x123c2b, roughness: 0.42, metalness: 0.06, env: 0.8 });
  M.pcbBlue = std({ color: 0x123152, roughness: 0.44, metalness: 0.06, env: 0.8 });
  M.pcbPerf = std({ color: 0xa8912f, roughness: 0.6, metalness: 0.05, env: 0.6 });
  M.gold = std({ color: 0xd9b26a, roughness: 0.3, metalness: 0.85, env: 1.2 });
  M.copper = std({ color: 0xb87333, roughness: 0.35, metalness: 0.9, env: 1.1 });
  M.black = std({ color: 0x1b1a19, roughness: 0.6, metalness: 0.05, env: 0.4 });
  M.white = std({ color: 0xece7de, roughness: 0.5, metalness: 0.02, env: 0.5 });
  M.breadboard = std({ color: 0xe9e4d8, roughness: 0.75, env: 0.35 });
  M.acrylic = new THREE.MeshPhysicalMaterial({
    color: 0xdfe7ea,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.86,
    thickness: 0.006,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  });
  M.acrylic.userData.xray = false;
  M.diffuser = new THREE.MeshStandardMaterial({
    color: 0xfff6e2,
    emissive: new THREE.Color(0xffe3ab),
    emissiveIntensity: 1.55,
    roughness: 0.5,
    transparent: true,
    opacity: 0.96,
  });
  M.diffuser.userData.xray = false;
  M.lampBody = std({ color: 0xdadad6, roughness: 0.5, metalness: 0.25, env: 0.7 });
  M.fanBlade = std({ color: 0x38424a, roughness: 0.42, metalness: 0.25, env: 0.8, side: THREE.DoubleSide });
  M.fanHub = std({ color: 0x2b3138, roughness: 0.36, metalness: 0.6, env: 1 });
  M.wood = std({ map: TEX.laminate([1, 1]), color: 0x9c7450, roughness: 0.55, env: 0.5 });
  M.woodDark = std({ map: TEX.laminate([1, 1]), color: 0x6a4a30, roughness: 0.58, env: 0.45 });
  M.ground = std({ map: TEX.ground([60, 60]), color: 0x9a958a, roughness: 1, env: 0.2 });
  M.bush = std({ color: 0x4d6141, roughness: 0.9, env: 0.25 });
  M.trunk = std({ color: 0x5b4634, roughness: 0.95, env: 0.2 });
  M.building = std({ color: 0xc3b6a2, roughness: 0.95, env: 0.3 });
  M.bag = std({ color: 0x5b4f6a, roughness: 0.7, env: 0.4 });

  // emissive / additive helpers
  M.glowSprite = (color, opacity = 0.6) =>
    new THREE.SpriteMaterial({
      map: TEX.glow('rgba(255,236,196,0.85)', 'rgba(255,214,140,0)'),
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  return M;
}

/* material cache for per-instance colors (bags / books / shirts) */
const tinted = new Map();
export function tintedMat(base, hex) {
  const key = base.uuid + ':' + hex;
  if (tinted.has(key)) return tinted.get(key);
  const m = base.clone();
  m.color = new THREE.Color(hex);
  tinted.set(key, m);
  return m;
}

/* ---------------- geometry cache ---------------- */
const gcache = new Map();
export function box(w, h, d, key) {
  const k = key || `box${w},${h},${d}`;
  if (!gcache.has(k)) gcache.set(k, new THREE.BoxGeometry(w, h, d));
  return gcache.get(k);
}
export function cyl(rt, rb, h, seg = 16, key) {
  const k = key || `cyl${rt},${rb},${h},${seg}`;
  if (!gcache.has(k)) gcache.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
  return gcache.get(k);
}
export function sph(r, seg = 16, key) {
  const k = key || `sph${r},${seg}`;
  if (!gcache.has(k)) gcache.set(k, new THREE.SphereGeometry(r, seg, Math.max(8, seg / 2)));
  return gcache.get(k);
}
export function plane(w, h, key) {
  const k = key || `plane${w},${h}`;
  if (!gcache.has(k)) gcache.set(k, new THREE.PlaneGeometry(w, h));
  return gcache.get(k);
}
export function cap(r, len, key) {
  const k = key || `cap${r},${len}`;
  if (!gcache.has(k)) gcache.set(k, new THREE.CapsuleGeometry(r, len, 4, 10));
  return gcache.get(k);
}

export function mesh(geo, mat, x = 0, y = 0, z = 0, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
