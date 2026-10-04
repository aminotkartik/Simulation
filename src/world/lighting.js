/* ============================================================================
   Lighting rig. One shadow-casting sun through real window openings, a warm
   sky/ground bounce, a very small indoor fill and an IBL probe. Zone lights
   themselves live in fixtures.js (they are physical spotlight objects).
   ==========================================================================*/
import * as THREE from 'three';
import { ROOM, ZONES } from '../config.js';
import { lerp, clamp, damp } from '../core/utils.js';
import { sunDirection } from './classroom.js';

export function buildLighting(scene, renderer) {
  const amb = new THREE.HemisphereLight(0xd6e3ec, 0xb08a5e, 0.42);
  scene.add(amb);

  const fill = new THREE.AmbientLight(0xfff1d8, 0.16);
  scene.add(fill);

  // sun / skylight through the windows
  const sun = new THREE.DirectionalLight(0xffe3b4, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 8.6;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d * 0.82;
  sun.shadow.camera.bottom = -d * 0.82;
  sun.shadow.camera.near = 4;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.028;
  sun.shadow.radius = 1.6;
  const sunTarget = new THREE.Object3D();
  sunTarget.position.set(0.4, 0.7, -0.2);
  scene.add(sunTarget);
  sun.target = sunTarget;
  scene.add(sun);

  // bounce card: skylight coming in from the corridor door, cool and weak
  const doorFill = new THREE.SpotLight(0xdfe9f2, 6, 12, 1.05, 0.9, 2);
  doorFill.position.set(ROOM.xMax + 1.9, 2.5, 1.55);
  doorFill.target.position.set(ROOM.xMax - 2.4, 0.6, 1.4);
  scene.add(doorFill.target);
  scene.add(doorFill);

  // gentle up-light on the prototype bench so the electronics stay readable
  const benchLight = new THREE.SpotLight(0xfff0d8, 5.4, 6.2, 0.86, 0.8, 2);
  benchLight.position.set(-4.0, 2.62, -2.3);
  benchLight.target.position.set(-4.1, 0.78, -2.35);
  scene.add(benchLight.target);
  scene.add(benchLight);

  // whiteboard wash (a real classroom always has one)
  const boardWash = new THREE.SpotLight(0xf4f7ff, 3.2, 5.2, 0.72, 0.85, 2);
  boardWash.position.set(-4.3, 2.9, -0.15);
  boardWash.target.position.set(-4.78, 1.6, -0.15);
  scene.add(boardWash.target);
  scene.add(boardWash);

  const dir = new THREE.Vector3();
  const cWarm = new THREE.Color(0xffd9a0),
    cNoon = new THREE.Color(0xfff0d4),
    cGold = new THREE.Color(0xffb066);
  function update(dt, sim, env) {
    const day = env.daylight; // 0 (dusk) .. 1 (bright noon)
    sunDirection(env.timeOfDay, dir);
    const R = 26;
    sun.position.set(dir.x * R, Math.max(3, dir.y * R), dir.z * R);
    const low = 1 - day;
    sun.color.copy(cNoon).lerp(cGold, clamp(low * 1.2, 0, 1));
    sun.intensity = 0.35 + day * 3.15;
    sun.castShadow = env.shadows;
    amb.intensity = 0.2 + day * 0.3;
    amb.color.setRGB(lerp(0.72, 0.84, day), lerp(0.74, 0.87, day), lerp(0.8, 0.92, day));
    amb.groundColor.setRGB(lerp(0.34, 0.46, day), lerp(0.28, 0.38, day), lerp(0.2, 0.28, day));
    fill.intensity = 0.1 + day * 0.12 + env.nightBoost * 0.05;
    doorFill.intensity = 2.4 + day * 4.6;
    // the bench light lifts slightly at night so the rig stays legible
    benchLight.intensity = 4.4 + (1 - day) * 3.4;
    boardWash.intensity = 1.6 + day * 2.6;
    scene.environmentIntensity = 0.16 + day * 0.34;
  }
  return { amb, fill, sun, doorFill, benchLight, boardWash, update, dir };
}
