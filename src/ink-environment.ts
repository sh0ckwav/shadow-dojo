import {
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  LinearSRGBColorSpace,
  Material,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { makeRandom } from './scene-assets/lib/hardsurface.js';
import { PartList } from './scene-assets/lib/low-poly.js';

// A 180° sumi-e (ink-wash) panorama: unlit ink on rice paper, with distance
// carried entirely by scene fog in the paper colour so far forms dissolve
// into mist. Local +Z is the player's forward; origin is the player's spot
// on the floor.

/** Rice-paper colour as it should reach the display. */
const PAPER_RGB: [number, number, number] = [0.86, 0.82, 0.72];
/**
 * three mixes fog after colour conversion, so the fog colour is used raw:
 * tag it linear. Surface colours meant to match it are tagged sRGB so the
 * conversion lands on the same display value.
 */
export const FOG_COLOR = new Color().setRGB(...PAPER_RGB, LinearSRGBColorSpace);
const ink = (hex: number) => new Color().setHex(hex, SRGBColorSpace);
const PAPER = new Color().setRGB(...PAPER_RGB, SRGBColorSpace);
const GROUND = new Color().setRGB(0.8, 0.76, 0.66, SRGBColorSpace);
const STALK = ink(0x2c332d);
const NODE = ink(0x121512);
const LEAF = ink(0x1b221c);
const RIDGE = ink(0x474c50);
const SUN = ink(0xc8402a);

/** Mist thick enough that a runner only resolves in the last few meters. */
export const FOG_NEAR = 2;
export const FOG_FAR = 18;
/** Runner paths, as azimuths from forward; bamboo stays clear of them. */
export const LANE_AZIMUTHS = [-30, -18, -6, 6, 18, 30].map((d) => (d * Math.PI) / 180);
const LANE_HALF_WIDTH = 0.45;
const BAMBOO_COUNT = 130;
/** Stalks past the fog's far plane would be pure paper, so stop there. */
const BAMBOO_MAX_RADIUS = FOG_FAR + 2;
const SKY_RADIUS = 90;
/** Panorama half-width before the edge fade to passthrough. */
const EDGE_FADE_START = (62 * Math.PI) / 180;
const EDGE_FADE_END = (88 * Math.PI) / 180;
const BAMBOO_HALF_ANGLE = (58 * Math.PI) / 180;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const edgeAlpha = (azimuth: number) => 1 - smoothstep(EDGE_FADE_START, EDGE_FADE_END, Math.abs(azimuth));
/** Local point at `azimuth` (0 = forward along +Z, positive toward +X) and ground `radius`. */
const polar = (azimuth: number, radius: number, y = 0) =>
  new Vector3(Math.sin(azimuth) * radius, y, Math.cos(azimuth) * radius);

function material(options: { vertexColors?: boolean; depthWrite: boolean; fog?: boolean; color?: Color }): MeshBasicMaterial {
  return new MeshBasicMaterial({
    vertexColors: options.vertexColors ?? true,
    color: options.color ?? 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: options.depthWrite,
    side: DoubleSide,
    fog: options.fog ?? true,
    // Unlit ink: no tone mapping, so paper surfaces match the fog exactly.
    toneMapped: false,
  });
}

/** Grid mesh over (azimuth, t) with per-vertex RGBA from `shade`. */
function sweep(
  azimuths: number[],
  ts: number[],
  point: (azimuth: number, t: number) => Vector3,
  shade: (azimuth: number, t: number) => [Color, number],
): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const quad: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
  for (let i = 0; i < azimuths.length - 1; i++) {
    for (let k = 0; k < ts.length - 1; k++) {
      for (const [di, dk] of quad) {
        const a = azimuths[i + di];
        const t = ts[k + dk];
        const p = point(a, t);
        const [c, alpha] = shade(a, t);
        positions.push(p.x, p.y, p.z);
        colors.push(c.r, c.g, c.b, alpha);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4));
  return geometry;
}

const range = (from: number, to: number, count: number) =>
  Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count);

/** Distance to the near edge of the painted ground: a straight line `near` meters ahead. */
const nearEdge = (azimuth: number, near: number) => Math.min(near * 3, near / Math.max(0.2, Math.cos(azimuth)));

/** Paper ground from the room's front edge to the horizon, fading in over its first meter. */
function buildGround(near: number): BufferGeometry {
  const ts = [0, 0.4, 1, 2.5, 6, 15, 35, SKY_RADIUS];
  return sweep(
    range(-Math.PI / 2, Math.PI / 2, 36),
    ts,
    (a, t) => polar(a, nearEdge(a, near) + t, 0.002),
    (a, t) => [GROUND, edgeAlpha(a) * smoothstep(0, 1, t)],
  );
}

/** Paper sky band; it sits past the fog's far plane so it renders as pure fog colour. */
function buildSky(): BufferGeometry {
  const elevations = range((-3 * Math.PI) / 180, (58 * Math.PI) / 180, 10);
  return sweep(
    range(-Math.PI / 2, Math.PI / 2, 36),
    elevations,
    (a, e) => polar(a, SKY_RADIUS * Math.cos(e), SKY_RADIUS * Math.sin(e)),
    (a, e) => [PAPER, edgeAlpha(a) * (1 - smoothstep((32 * Math.PI) / 180, (58 * Math.PI) / 180, e))],
  );
}

/**
 * Mountain ridge: brushed crest washing out to paper (mist) at its foot.
 * Ridges sit beyond the fog's far plane, so `wash` sets how much ink shows.
 */
function buildRidge(radius: number, height: number, seed: number, wash: number): BufferGeometry {
  const random = makeRandom(seed);
  const k1 = 2 + random() * 3;
  const k2 = 6 + random() * 5;
  const p1 = random() * 6;
  const p2 = random() * 6;
  const limit = (70 * Math.PI) / 180;
  const crest = (a: number) => {
    const shape = 0.45 + 0.4 * Math.abs(Math.sin(a * k1 + p1)) + 0.15 * Math.sin(a * k2 + p2);
    return height * shape * (1 - smoothstep((48 * Math.PI) / 180, limit, Math.abs(a)));
  };
  const foot = -2;
  return sweep(
    range(-limit, limit, 56),
    [0, 0.45, 0.8, 1],
    (a, t) => polar(a, radius, foot + (crest(a) - foot) * t),
    (_a, t) => [PAPER.clone().lerp(RIDGE, wash * smoothstep(0.1, 1, t)), 1],
  );
}

/** One leaf, or grass blade: a thin diamond from `base` along `dir`. */
function addBlade(parts: PartList, base: Vector3, dir: Vector3, length: number, width: number, color: Color): void {
  const side = new Vector3().crossVectors(dir, new Vector3(0, 1, 0));
  if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
  side.normalize().multiplyScalar(width);
  const mid = base.clone().addScaledVector(dir, length * 0.35);
  const tip = base.clone().addScaledVector(dir, length);
  const left = mid.clone().add(side);
  const right = mid.clone().sub(side);
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([...base.toArray(), ...left.toArray(), ...tip.toArray(), ...base.toArray(), ...tip.toArray(), ...right.toArray()], 3),
  );
  parts.add(geometry, color);
}

/** Bamboo grove: tapered stalks with dark node rings, twig sprays of drooping leaves. */
function buildBamboo(near: number, seed: number): BufferGeometry {
  const random = makeRandom(seed);
  const parts = new PartList();
  const dir = new Vector3();
  // An evenly spread, dense stand that thins into the mist, leaving the
  // runners' paths clear so they burst out between stalks, not through them.
  let placed = 0;
  while (placed < BAMBOO_COUNT) {
    const azimuth = (random() * 2 - 1) * BAMBOO_HALF_ANGLE;
    const minR = nearEdge(azimuth, near) + 2;
    const r = minR + Math.pow(random(), 1.2) * (BAMBOO_MAX_RADIUS - minR);
    if (LANE_AZIMUTHS.some((lane) => Math.abs(Math.sin(azimuth - lane) * r) < LANE_HALF_WIDTH)) continue;
    placed++;
    const base = polar(azimuth, r);
    const height = 6 + random() * 5;
    const radius = 0.045 + random() * 0.04;
    const lean = new Vector3((random() - 0.5) * 0.12, 1, (random() - 0.5) * 0.12).normalize();
    const top = base.clone().addScaledVector(lean, height);
    parts.limb(base, top, radius, radius * 0.6, STALK, 5);

    for (let h = 0.5 + random() * 0.3; h < height - 0.3; h += 0.55 + random() * 0.3) {
      const at = base.clone().addScaledVector(lean, h);
      const ring = at.clone().addScaledVector(lean, 0.035);
      const rr = radius * (1 - (0.4 * h) / height) * 1.22;
      parts.limb(at, ring, rr, rr, NODE, 5);
      if (h < height * 0.5 || random() < 0.35) continue;

      // Twig with a fan of leaves hanging off its end.
      const out = random() * Math.PI * 2;
      dir.set(Math.cos(out), 0.35 + random() * 0.4, Math.sin(out)).normalize();
      const twigEnd = at.clone().addScaledVector(dir, 0.35 + random() * 0.4);
      parts.limb(at, twigEnd, 0.012, 0.006, STALK, 3);
      const leaves = 3 + Math.floor(random() * 4);
      for (let l = 0; l < leaves; l++) {
        const spread = out + (random() - 0.5) * 1.6;
        dir.set(Math.cos(spread), -0.35 - random() * 0.6, Math.sin(spread)).normalize();
        addBlade(parts, twigEnd, dir.clone(), 0.22 + random() * 0.14, 0.022 + random() * 0.01, LEAF);
      }
    }
    // A few grass blades at the foot.
    for (let g = 0; g < 4; g++) {
      const a = random() * Math.PI * 2;
      dir.set(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5).normalize();
      const foot = base.clone().add(new Vector3(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12));
      addBlade(parts, foot, dir.clone(), 0.25 + random() * 0.2, 0.02, LEAF);
    }
  }
  return parts.merge();
}

/**
 * The painted half-world in front of the player. `place()` rebuilds it for
 * the room (the painted ground begins at the real front wall) and
 * `update()` fades it in or out.
 */
export class InkEnvironment {
  readonly group = new Group();
  readonly fog = new Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
  /** World-space origin (player's floor spot) and forward of the panorama. */
  readonly origin = new Vector3();
  readonly forward = new Vector3(0, 0, -1);

  private groundMaterial = material({ depthWrite: true });
  private skyMaterial = material({ depthWrite: false });
  private inkMaterial = material({ depthWrite: true });
  private ridgeMaterial = material({ depthWrite: true, fog: false });
  private sunMaterial = material({ vertexColors: false, depthWrite: false, fog: false, color: SUN });
  private materials: Material[] = [this.groundMaterial, this.skyMaterial, this.inkMaterial, this.ridgeMaterial, this.sunMaterial];
  private meshes: Mesh[] = [];
  private lookTarget = new Vector3();

  constructor() {
    this.group.name = 'InkEnvironment';
    this.group.visible = false;
  }

  place(origin: Vector3, forward: Vector3, near: number): void {
    this.origin.copy(origin).setY(0);
    this.forward.copy(forward).setY(0).normalize();
    this.group.position.copy(this.origin);
    this.lookTarget.copy(this.origin).add(this.forward);
    this.group.lookAt(this.lookTarget);

    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.meshes = [];
    // Draw order inside the transparent pass: ground (writes depth so ridge
    // feet below it are hidden), sky, sun, ridges far → near, then bamboo.
    this.addMesh('Ground', buildGround(near), this.groundMaterial, -6);
    this.addMesh('Sky', buildSky(), this.skyMaterial, -5);
    const sun = this.addMesh('Sun', new CircleGeometry(4.5, 24), this.sunMaterial, -4);
    sun.position.copy(polar((-24 * Math.PI) / 180, SKY_RADIUS - 5, 26));
    sun.lookAt(0, 1.2, 0);
    // Faint silhouettes through the mist.
    this.addMesh('RidgeFar', buildRidge(66, 15, 3, 0.18), this.ridgeMaterial, -3);
    this.addMesh('RidgeMid', buildRidge(52, 11, 7, 0.28), this.ridgeMaterial, -2);
    this.addMesh('RidgeNear', buildRidge(40, 7, 11, 0.4), this.ridgeMaterial, -1);
    this.addMesh('Bamboo', buildBamboo(near, 23), this.inkMaterial, 0);
    this.group.updateMatrixWorld(true);
  }

  /** World-space spawn point `radius` meters out at `azimuth` from forward. */
  pointAt(azimuth: number, radius: number, target: Vector3): Vector3 {
    target.copy(polar(azimuth, radius));
    return this.group.localToWorld(target);
  }

  update(opacity: number): void {
    for (const m of this.materials) m.opacity = opacity;
    this.group.visible = opacity > 0.001;
  }

  private addMesh(name: string, geometry: BufferGeometry, mat: Material, order: number): Mesh {
    const mesh = new Mesh(geometry, mat);
    mesh.name = name;
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }
}
