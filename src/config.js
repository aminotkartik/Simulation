/* ============================================================================
   EcoSwitch — global configuration & derived spatial data.
   All dimensions are metres, all angles degrees unless suffixed 'Rad'.
   The classroom is modelled at real-world scale (1 unit = 1 m).
   ==========================================================================*/

export const PALETTE = {
  cream: 0xf3e9d6,
  ivory: 0xfbf5e8,
  wall: 0xe6d9c1,
  wallDark: 0xcdba9c,
  terracotta: 0xc0663c,
  amber: 0xe6a341,
  burnt: 0xa8481c,
  brown: 0x4a3426,
  gold: 0xd8b26a,
  floor: 0xc7ac8a,
  lamp: 0xffe6b8,
  sunDay: 0xffe9c4,
  sky: 0xbcd0d8,
};

export const STATE_COLORS = {
  OCCUPIED: '#e8b24a',
  GRACE: '#e07b39',
  VACANT: '#7d7568',
  MANUAL: '#d9552f',
  FAULT: '#c9403a',
};

/* --- Room shell ---------------------------------------------------------- */
export const ROOM = {
  length: 9.6, // x
  width: 6.6, // z
  height: 3.2, // y
  wallT: 0.18,
  get xMin() {
    return -this.length / 2;
  },
  get xMax() {
    return this.length / 2;
  },
  get zMin() {
    return -this.width / 2;
  },
  get zMax() {
    return this.width / 2;
  },
  skirtingH: 0.12,
  sillH: 0.92,
  winH: 1.52,
};

/* --- Zones: three open occupancy slices along the hall length ------------ */
export const ZONES = [
  { id: 0, name: 'ZONE 1', label: 'FRONT ROWS', x0: -4.8, x1: -1.2, tag: 'Z1' },
  { id: 1, name: 'ZONE 2', label: 'MIDDLE ROWS', x0: -1.2, x1: 1.35, tag: 'Z2' },
  { id: 2, name: 'ZONE 3', label: 'BACK ROWS', x0: 1.35, x1: 4.8, tag: 'Z3' },
];
ZONES.forEach((z) => {
  z.cx = (z.x0 + z.x1) / 2;
  z.depth = z.x1 - z.x0;
});

export const zoneOf = (x) => (x < ZONES[0].x1 ? 0 : x < ZONES[2].x0 ? 1 : 2);

/* --- Furniture grid: 6 rows x 2 three-seat benches = 36 seats ----------- */
export const ROW_X = [-3.2, -1.85, -0.5, 0.85, 2.2, 3.55];
export const BENCH_Z = [-1.42, 1.42];
export const SEATS_PER_BENCH = 2; // double desk
export const BENCH = {
  w: 1.26, // two seats side by side (along x => along the row = z axis)
  d: 0.44,
  topH: 0.755,
  topT: 0.032,
  seatH: 0.42,
  shelfH: 0.18,
};

export const SEATS = [];
{
  let i = 0;
  for (const rx of ROW_X) {
    for (const bz of BENCH_Z) {
      for (let s = 0; s < SEATS_PER_BENCH; s++) {
        const off = s === 0 ? -0.31 : 0.31;
        SEATS.push({
          id: i++,
          x: rx,
          z: bz + off,
          bench: `${rx}|${bz}`,
          zone: zoneOf(rx),
          yaw: 0, // faces -x (towards the whiteboard)
        });
      }
    }
  }
}
export const BENCH_KEYS = [...new Set(SEATS.map((s) => s.bench))].map((k) => {
  const [x, z] = k.split('|').map(Number);
  return { x, z, zone: zoneOf(x) };
});

/* --- Lighting fixtures (6 LED panels, 2 per zone) ------------------------ */
export const LIGHTS = [];
{
  const perZone = [
    { x: -2.5, zone: 0 },
    { x: 0.17, zone: 1 },
    { x: 2.87, zone: 2 },
  ];
  for (const p of perZone) {
    for (const z of [-1.68, 1.68]) {
      LIGHTS.push({
        id: LIGHTS.length,
        zone: p.zone,
        x: p.x,
        y: ROOM.height - 0.075,
        z,
        w: 1.22,
        h: 0.3,
        watt: 22,
      });
    }
  }
}

/* --- Ceiling fans (4: zones 1 & 3 get one, the busy middle zone gets two) */
export const FANS = [
  { id: 0, zone: 0, x: -3.55, z: 0.0, watt: 72 },
  { id: 1, zone: 1, x: -0.62, z: 0.0, watt: 72 },
  { id: 2, zone: 1, x: 0.96, z: 0.0, watt: 72 },
  { id: 3, zone: 2, x: 3.62, z: 0.0, watt: 72 },
];

/* --- Sensors: one mmWave per zone + one PIR per zone --------------------- */
export const SENSORS = [
  // mmWave radar modules, ceiling mounted, downward cone
  { id: 'mm0', kind: 'mmwave', zone: 0, x: -2.5, y: ROOM.height - 0.05, z: 0.0, yaw: 0, range: 3.05, beam: 132, mount: 'ceiling' },
  { id: 'mm1', kind: 'mmwave', zone: 1, x: 0.17, y: ROOM.height - 0.05, z: 0.0, yaw: 0, range: 2.5, beam: 126, mount: 'ceiling' },
  { id: 'mm2', kind: 'mmwave', zone: 2, x: 2.5, y: ROOM.height - 0.05, z: 0.0, yaw: 0, range: 3.15, beam: 132, mount: 'ceiling' },
  // PIR motion sensors, upper wall, horizontal wedge aimed across the rows
  { id: 'pir0', kind: 'pir', zone: 0, x: -2.5, y: 2.42, z: ROOM.zMax - 0.08, yaw: 180, range: 5.5, beam: 104, mount: 'wall' },
  { id: 'pir1', kind: 'pir', zone: 1, x: 0.17, y: 2.5, z: ROOM.zMin + 0.08, yaw: 0, range: 4.9, beam: 100, mount: 'wall' },
  { id: 'pir2', kind: 'pir', zone: 2, x: 2.9, y: 2.42, z: ROOM.zMax - 0.08, yaw: 180, range: 5.5, beam: 104, mount: 'wall' },
];

/* --- Windows / openings -------------------------------------------------- */
export const WINDOWS = [-3.35, -1.12, 1.12, 3.35].map((x, i) => ({
  id: i,
  x,
  w: 1.66,
  y0: ROOM.sillH,
  y1: ROOM.sillH + ROOM.winH,
  wall: 'z-',
}));
export const DOOR = { x: 1.55, w: 0.98, h: 2.08, wall: 'x+' };

/* --- Electrical loads ---------------------------------------------------- */
export const LOADS = {
  perZone: ZONES.map((z) => {
    const lights = LIGHTS.filter((l) => l.zone === z.id);
    const fans = FANS.filter((f) => f.zone === z.id);
    const lightW = lights.reduce((a, l) => a + l.watt, 0);
    const fanW = fans.reduce((a, f) => a + f.watt, 0);
    return {
      zone: z.id,
      lightCount: lights.length,
      fanCount: fans.length,
      lightW,
      fanW,
      totalW: lightW + fanW,
      lux: Math.round(300 + lightW * 3.4),
    };
  }),
  tariff: 8.2, // ₹ / kWh (simulated)
  allOnW: 0, // filled below
  gridCO2: 0.82, // kg CO2 / kWh (simulated)
};

/* --- Timing defaults (accelerated for demonstration) --------------------- */
export const TIMING = {
  warnAfter: 10, // sim-seconds of no presence before vacancy warning
  offAfter: 15, // sim-seconds of no presence before shutdown
  pirHold: 1.6, // PIR re-trigger hold window
  timeScale: 1.0, // sim-seconds per real second
  ramp: 0.34, // load fade time
};

/* --- Sensing model ------------------------------------------------------- */
export const SENSE = {
  pirMotionThreshold: 0.13, // motion level a PIR needs to re-trigger
  pirRangeFalloff: 0.55,
  mmMotionThreshold: 0.035, // gross motion
  mmMicroThreshold: 0.012, // breathing / micro-motion
  mmHold: 0.9,
  fanClutter: 0.62, // how strongly a spinning blade fools the radar
  maxRangeScale: 1.0,
};

export const OCCUPANT_NAMES = [
  'Aarav', 'Diya', 'Rohan', 'Meera', 'Kabir', 'Ananya', 'Vikram', 'Sneha',
  'Arjun', 'Priya', 'Nikhil', 'Kavya', 'Aditya', 'Ishita', 'Manav', 'Tara',
  'Yash', 'Nisha', 'Rehan', 'Farida', 'Gaurav', 'Lakshmi', 'Imran', 'Sara',
];

export const SKIN = [0x9c6b4c, 0x8a5a3c, 0xb07f5c, 0x74452c, 0xa3714f];
export const SHIRTS = [
  0xe9e2d2, 0xc9d7d2, 0xd9b7a4, 0x8fa2b3, 0xe2c98f, 0xa8b98f,
  0xb98f9c, 0x7f8ea3, 0xd9d2b6, 0xa9705c, 0x6f8f86, 0xc4b0d0,
];

/* --- Scenarios ----------------------------------------------------------- */
export const SCENARIOS = [
  { id: 1, name: 'Empty Classroom', short: 'EMPTY', desc: 'All zones empty → controlled loads shut down after the grace window.' },
  { id: 2, name: 'One Zone Occupied', short: 'Z1 ONLY', desc: 'Zone 1 occupied, Zones 2 & 3 empty → only Zone 1 loads stay ON.' },
  { id: 3, name: 'Stationary Student', short: 'STILLNESS', desc: 'A student reads quietly: PIR drops out, mmWave holds the zone ON.' },
  { id: 4, name: 'Student Leaves', short: 'DEPARTURE', desc: 'Occupancy disappears → warning countdown → automatic shutdown.' },
  { id: 5, name: 'Fan Reflection', short: 'RADAR CLUTTER', desc: 'Empty room, fan spinning → mmWave may falsely report presence.' },
  { id: 6, name: 'Manual Override', short: 'OVERRIDE', desc: 'A vacant zone is manually forced ON and locked.' },
  { id: 7, name: 'Sensor Failure', short: 'DEGRADED', desc: 'One sensor is disabled → system continues in DEGRADED mode.' },
  { id: 8, name: 'Three-Zone Mixed', short: 'MIXED', desc: 'Zone 1 occupied · Zone 2 vacant · Zone 3 occupied.' },
];

export const STRATEGIES = [
  { id: 'ALWAYS_ON', name: 'ALWAYS ON', desc: 'Baseline — every load runs all day regardless of occupancy.' },
  { id: 'PIR_ONLY', name: 'PIR ONLY', desc: 'Motion-only sensing. Cheap, but drops out on still occupants.' },
  { id: 'MMWAVE_ONLY', name: 'MMWAVE ONLY', desc: 'Presence radar. Holds still people, but can be fooled by clutter.' },
  { id: 'HYBRID', name: 'HYBRID ECOSWITCH', desc: 'PIR OR mmWave → occupied. Both clear → grace → shutdown.' },
];

LOADS.allOnW = LOADS.perZone.reduce((a, z) => a + z.totalW, 0);

export const TOTALS = {
  seats: SEATS.length,
  benches: BENCH_KEYS.length,
  lights: LIGHTS.length,
  fans: FANS.length,
  sensors: SENSORS.length,
};
