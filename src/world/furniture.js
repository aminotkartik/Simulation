/* ============================================================================
   Furniture: 12 double student benches (instanced), teacher desk is in
   classroom.js. Desks are real dimensions: 0.755 m top, 0.42 m seat,
   1.26 m wide for two students, metal tube frames, laminate tops.
   ==========================================================================*/
import * as THREE from 'three';
import { BENCH, BENCH_KEYS, SEATS, ROOM } from '../config.js';
import { MAT, box, cyl, plane, mesh } from './materials.js';
import { seeded } from '../core/utils.js';

class InstSet {
  constructor(geo, mat, count, name) {
    this.geo = geo;
    this.mat = mat;
    this.mats = [];
    this.colors = [];
    this.name = name;
    this.count = count;
    this.mesh = null;
  }
  add(pos, rot = null, scale = null, color = null) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    if (rot) q.setFromEuler(new THREE.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0));
    m.compose(new THREE.Vector3(...pos), q, new THREE.Vector3(...(scale || [1, 1, 1])));
    this.mats.push(m);
    this.colors.push(color);
    return this;
  }
  flush(parent, { cast = true, receive = true } = {}) {
    const im = new THREE.InstancedMesh(this.geo, this.mat, this.mats.length);
    im.castShadow = cast;
    im.receiveShadow = receive;
    im.name = this.name;
    im.userData.pickable = false;
    let hasColor = false;
    this.mats.forEach((m, i) => {
      im.setMatrixAt(i, m);
      if (this.colors[i]) {
        im.setColorAt(i, this.colors[i]);
        hasColor = true;
      }
    });
    if (hasColor && im.instanceColor) im.instanceColor.needsUpdate = true;
    im.instanceMatrix.needsUpdate = true;
    parent.add(im);
    this.mesh = im;
    return im;
  }
}

export function buildFurniture() {
  const group = new THREE.Group();
  group.name = 'furniture';
  const R = seeded(9182);
  const parts = {
    top: new InstSet(box(BENCH.d, BENCH.topT, BENCH.w), MAT.laminate, 0, 'benchTop'),
    edge: new InstSet(box(BENCH.d + 0.02, 0.012, BENCH.w + 0.02), MAT.metalDark, 0, 'benchEdge'),
    rail: new InstSet(box(0.05, 0.06, BENCH.w - 0.05), MAT.metal, 0, 'rail'),
    leg: new InstSet(box(0.048, BENCH.topH, 0.048), MAT.metal, 0, 'leg'),
    shelf: new InstSet(box(0.3, 0.02, BENCH.w - 0.08), MAT.laminateDark, 0, 'shelf'),
    seat: new InstSet(box(0.42, 0.03, BENCH.w - 0.04), MAT.laminate, 0, 'seat'),
    seatLeg: new InstSet(box(0.044, BENCH.seatH, 0.044), MAT.metal, 0, 'seatLeg'),
    back: new InstSet(box(0.036, 0.25, BENCH.w - 0.02), MAT.laminate, 0, 'backrest'),
    brace: new InstSet(box(0.03, 0.03, BENCH.w - 0.1), MAT.metalDark, 0, 'brace'),
  };

  BENCH_KEYS.forEach((b) => {
    const { x, z } = b;
    // desktop, slightly towards the front of the frame
    parts.top.add([x, BENCH.topH, z]);
    parts.edge.add([x, BENCH.topH - BENCH.topT / 2 - 0.006, z]);
    parts.rail.add([x - BENCH.d / 2 + 0.03, BENCH.topH - 0.14, z]);
    parts.shelf.add([x + 0.02, BENCH.shelfH + 0.06, z]);
    parts.seat.add([x + 0.5, BENCH.seatH, z]);
    parts.back.add([x + 0.68, BENCH.seatH + 0.16, z]);
    parts.brace.add([x + 0.5, 0.14, z]);
    for (const [lx, lz] of [
      [-0.19, -0.57],
      [-0.19, 0.57],
      [0.19, -0.57],
      [0.19, 0.57],
    ])
      parts.leg.add([x + lx, BENCH.topH / 2, z + lz]);
    for (const [lx, lz] of [
      [0.33, -0.55],
      [0.33, 0.55],
      [0.66, -0.55],
      [0.66, 0.55],
    ])
      parts.seatLeg.add([x + lx, BENCH.seatH / 2, z + lz]);
  });
  for (const k in parts) parts[k].flush(group);

  /* ------------------------------- lived-in details ---------------------- */
  const bagCols = [0x4c4a63, 0x6b4a3a, 0x2f4a3f, 0x5b5b5b, 0x7a4b52, 0x3d5a6c];
  const bookCols = [0xd8cdb4, 0xa8481c, 0x2f4b6e, 0x6b7f56, 0xc9a227, 0x8c5f78, 0xdad4c6];
  const bags = new InstSet(box(0.3, 0.36, 0.16), MAT.plastic(0xffffff, 0.72), 0, 'bags');
  const books = new InstSet(box(0.2, 0.03, 0.28), MAT.plastic(0xffffff, 0.62), 0, 'books');
  const bottles = new InstSet(cyl(0.032, 0.032, 0.19, 10), MAT.plastic(0xbfd8dd, 0.25), 0, 'bottles');
  const papers = new InstSet(plane(0.2, 0.28), MAT.paper, 0, 'papers');
  const cases = new InstSet(box(0.2, 0.05, 0.1), MAT.plastic(0x3b3f46, 0.5), 0, 'pencils');

  SEATS.forEach((s, i) => {
    const r = seeded(i * 7717 + 3);
    const occupiedish = r() > 0.24;
    if (!occupiedish) return;
    // a book or notebook on the desk
    if (r() > 0.25) {
      const nb = 1 + Math.floor(r() * 2);
      for (let k = 0; k < nb; k++)
        books.add([s.x - 0.02, BENCH.topH + BENCH.topT / 2 + 0.016 + k * 0.032, s.z + (r() - 0.5) * 0.1, null, [0.92, 1, 0.94], new THREE.Color(bookCols[Math.floor(r() * bookCols.length)])]);
    } else {
      papers.add([s.x, BENCH.topH + BENCH.topT / 2 + 0.003, s.z, [-Math.PI / 2, 0, (r() - 0.5) * 0.5]]);
    }
    if (r() > 0.62) bottles.add([s.x + 0.14, BENCH.topH + 0.11, s.z + 0.28 * (r() > 0.5 ? 1 : -1)]);
    if (r() > 0.78) cases.add([s.x + 0.06, BENCH.topH + BENCH.topT / 2 + 0.026, s.z - 0.3]);
    // bag on the floor beside the seat or hung on the backrest
    if (r() > 0.42) {
      const side = r() > 0.5 ? 1 : -1;
      bags.add([s.x + 0.52, 0.19, s.z + side * 0.5, [0.06 * side, (r() - 0.5) * 0.7, 0.05], null, new THREE.Color(bagCols[Math.floor(r() * bagCols.length)])]);
    }
  });
  bags.flush(group);
  books.flush(group);
  bottles.flush(group);
  papers.flush(group, { cast: false });
  cases.flush(group);

  /* ----------------------- teacher-side & perimeter extras -------------- */
  // low storage bench along the right wall (studio-cum-storage), and a plant
  const store = new THREE.Group();
  store.position.set(-1.3, 0, ROOM.zMax - 0.26);
  store.add(mesh(box(2.6, 0.44, 0.42), MAT.woodDark, 0, 0.22, 0));
  store.add(mesh(box(2.64, 0.04, 0.46), MAT.wood, 0, 0.46, 0));
  for (let i = 0; i < 4; i++) store.add(mesh(box(0.6, 0.36, 0.02), MAT.laminateDark, -0.94 + i * 0.63, 0.22, 0.215, false, false));
  group.add(store);
  const bins = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = mesh(box(0.3, 0.26, 0.4), MAT.plastic([0x7d8a6a, 0x8a7a5f, 0x6d7c86][i], 0.7), -1.9 + i * 0.34, 0.13, 0.0, true, true);
    bins.add(b);
  }
  bins.position.set(-1.3, 0, ROOM.zMax - 0.5);
  group.add(bins);

  // a couple of stacked spare benches in the back corner (very common)
  const spare = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    g.add(mesh(box(BENCH.d, BENCH.topT, BENCH.w), MAT.laminate, 0, 0, 0, true, true));
    for (const [lx, lz] of [[-0.18, -0.55], [-0.18, 0.55], [0.18, -0.55], [0.18, 0.55]]) g.add(mesh(box(0.05, 0.6, 0.05), MAT.metal, lx, -0.32, lz, true, false));
    g.position.set(4.15, 0.78 + i * 0.12, -1.5 + i * 0.1);
    g.rotation.z = 0.03 * (i ? -1 : 1);
    spare.add(g);
  }
  group.add(spare);

  // notice: shoes rack by the door?  (kept as a simple mat)
  const mat = mesh(plane(1.3, 0.7), MAT.fabric, ROOM.xMax - 0.42, 0.006, 1.55, false, true);
  mat.rotation.x = -Math.PI / 2;
  group.add(mat);

  return { group };
}
