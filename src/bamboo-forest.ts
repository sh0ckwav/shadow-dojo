import {
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { applyMist, mistUniforms } from './mist.js';
import { makeRandom } from './scene-assets/lib/hardsurface.js';
import { PartList } from './scene-assets/lib/low-poly.js';

// The player stays in their real room. Around it: a bank of mist hugging the
// floor and walls up to just above ninja height, and an ink-painted bamboo
// forest rising out of it beyond the walls. Everything else is passthrough,
// apart from a vermilion sun. Local +Z is the player's forward; the origin
// is the player's spot on the floor.

const ink = (hex: number) => new Color().setHex(hex, SRGBColorSpace);
const STALK = ink(0x2c332d);
const NODE = ink(0x121512);
const LEAF = ink(0x1b221c);
const SUN = ink(0xc8402a);

/** Top of the mist bank: just over a running ninja's hood. */
export const MIST_TOP = 1.9;
/** Room radius used in directions where no wall was detected. */
const DEFAULT_ROOM_RADIUS = 3;
const AZIMUTH_STEPS = 96;
/** Runner paths, as azimuths from forward; bamboo stays clear of them. */
export const LANE_AZIMUTHS = [-48, -32, -16, 0, 16, 32, 48].map((d) => (d * Math.PI) / 180);
const LANE_HALF_WIDTH = 0.45;
const BAMBOO_COUNT = 200;
export const FOREST_RADIUS = 14;

/** A wall as a 2D segment on the floor plane (world x/z). */
export interface WallSegment {
  a: Vector3;
  b: Vector3;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Local point at `azimuth` (0 = forward along +Z, positive toward +X), `radius` out, height `y`. */
const polar = (azimuth: number, radius: number, y = 0) =>
  new Vector3(Math.sin(azimuth) * radius, y, Math.cos(azimuth) * radius);

const mistVertex = /* glsl */ `
  attribute float aFade;
  varying vec2 vCoord;
  varying float vFade;
  void main() {
    vCoord = uv;
    vFade = aFade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Raw colour out (no colour-space chunk) to match the mist mixed into
// ninjas and bamboo, which happens after their colour conversion.
const mistFragment = /* glsl */ `
  uniform vec3 uMistColor;
  uniform float uMistTop;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uFloor;
  varying vec2 vCoord;
  varying float vFade;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    float n = fbm(vCoord * 0.9 + vec2(uTime * 0.12, uTime * 0.03));
    float alpha;
    if (uFloor > 0.5) {
      // vFade: 0 around the player, 1 at the walls.
      alpha = smoothstep(0.0, 1.0, vFade) * (0.45 + 0.4 * n);
    } else {
      // vCoord.y is height in meters; a ragged, drifting top edge.
      float top = uMistTop + (n - 0.5) * 0.5;
      alpha = (1.0 - smoothstep(top - 0.9, top, vCoord.y)) * (0.78 + 0.2 * n);
    }
    gl_FragColor = vec4(uMistColor, alpha * uOpacity);
  }
`;

function mistMaterial(floor: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: mistVertex,
    fragmentShader: mistFragment,
    uniforms: {
      uMistColor: mistUniforms.uMistColor,
      uMistTop: mistUniforms.uMistTop,
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uFloor: { value: floor ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/**
 * Distance from the origin to the nearest wall in each of AZIMUTH_STEPS
 * directions (local space), falling back to DEFAULT_ROOM_RADIUS.
 */
function roomOutline(walls: Array<{ a: Vector2; b: Vector2 }>): number[] {
  const radii: number[] = [];
  const dir = new Vector2();
  const edge = new Vector2();
  for (let i = 0; i < AZIMUTH_STEPS; i++) {
    const azimuth = (i / AZIMUTH_STEPS) * Math.PI * 2;
    dir.set(Math.sin(azimuth), Math.cos(azimuth));
    let best = Infinity;
    for (const { a, b } of walls) {
      // Ray (origin + t·dir) against segment (a + s·edge).
      edge.subVectors(b, a);
      const denom = dir.x * edge.y - dir.y * edge.x;
      if (Math.abs(denom) < 1e-6) continue;
      const t = (a.x * edge.y - a.y * edge.x) / denom;
      const s = (a.x * dir.y - a.y * dir.x) / denom;
      if (t > 0.3 && s >= -0.05 && s <= 1.05) best = Math.min(best, t);
    }
    radii.push(Number.isFinite(best) ? Math.min(8, Math.max(1.2, best)) : DEFAULT_ROOM_RADIUS);
  }
  return radii;
}

/** Room radius at any azimuth, interpolated around the outline. */
function radiusAt(radii: number[], azimuth: number): number {
  const f = (((azimuth / (Math.PI * 2)) % 1) + 1) % 1 * AZIMUTH_STEPS;
  const i = Math.floor(f);
  const t = f - i;
  return radii[i % AZIMUTH_STEPS] * (1 - t) + radii[(i + 1) % AZIMUTH_STEPS] * t;
}

/** Mist bank standing just inside the walls, floor to above ninja height. */
function buildMistBank(radii: number[]): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const fades: number[] = [];
  const height = MIST_TOP + 0.4;
  let along = 0;
  const ring: Array<{ p: Vector3; u: number }> = [];
  for (let i = 0; i <= AZIMUTH_STEPS; i++) {
    const azimuth = (i / AZIMUTH_STEPS) * Math.PI * 2;
    const p = polar(azimuth, radii[i % AZIMUTH_STEPS] - 0.05);
    if (ring.length > 0) along += p.distanceTo(ring[ring.length - 1].p);
    ring.push({ p, u: along });
  }
  for (let i = 0; i < AZIMUTH_STEPS; i++) {
    const quad: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
    for (const [di, up] of quad) {
      const { p, u } = ring[i + di];
      positions.push(p.x, up * height, p.z);
      uvs.push(u, up * height);
      fades.push(1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aFade', new Float32BufferAttribute(fades, 1));
  return geometry;
}

/** Floor mist: clear around the player, thickening toward the walls. */
function buildFloorMist(radii: number[]): BufferGeometry {
  const fractions = [0.4, 0.65, 0.85, 1];
  const fadeAt = [0, 0.45, 0.85, 1];
  const positions: number[] = [];
  const uvs: number[] = [];
  const fades: number[] = [];
  const quad: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
  for (let i = 0; i < AZIMUTH_STEPS; i++) {
    for (let k = 0; k < fractions.length - 1; k++) {
      for (const [di, dk] of quad) {
        const step = i + di;
        const azimuth = (step / AZIMUTH_STEPS) * Math.PI * 2;
        const p = polar(azimuth, radii[step % AZIMUTH_STEPS] * fractions[k + dk] - 0.05, 0.01);
        positions.push(p.x, p.y, p.z);
        uvs.push(p.x, p.z);
        fades.push(fadeAt[k + dk]);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aFade', new Float32BufferAttribute(fades, 1));
  return geometry;
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

/**
 * Bamboo all the way around, outside the walls. Distant stalks fade by
 * alpha (not toward a colour) so the room shows through, and stalks are
 * emitted far → near so the single draw blends correctly.
 */
function buildBamboo(radii: number[], seed: number): BufferGeometry {
  const random = makeRandom(seed);
  const stalks: Array<{ azimuth: number; r: number }> = [];
  while (stalks.length < BAMBOO_COUNT) {
    const azimuth = random() * Math.PI * 2;
    const minR = radiusAt(radii, azimuth) + 0.6;
    if (minR > FOREST_RADIUS - 1) continue;
    const r = minR + Math.pow(random(), 1.3) * (FOREST_RADIUS - minR);
    if (LANE_AZIMUTHS.some((lane) => Math.cos(azimuth - lane) > 0 && Math.abs(Math.sin(azimuth - lane) * r) < LANE_HALF_WIDTH)) {
      continue;
    }
    stalks.push({ azimuth, r });
  }
  stalks.sort((p, q) => q.r - p.r);

  const parts = new PartList();
  const dir = new Vector3();
  for (const { azimuth, r } of stalks) {
    parts.alpha = 1 - 0.7 * smoothstep(5, FOREST_RADIUS, r);
    const base = polar(azimuth, r);
    const height = 6 + random() * 5;
    const radius = 0.045 + random() * 0.04;
    const lean = new Vector3((random() - 0.5) * 0.12, 1, (random() - 0.5) * 0.12).normalize();
    parts.limb(base, base.clone().addScaledVector(lean, height), radius, radius * 0.6, STALK, 5, false);

    for (let h = 0.5 + random() * 0.3; h < height - 0.3; h += 0.55 + random() * 0.3) {
      const at = base.clone().addScaledVector(lean, h);
      const rr = radius * (1 - (0.4 * h) / height) * 1.22;
      parts.limb(at, at.clone().addScaledVector(lean, 0.035), rr, rr, NODE, 4, false);
      if (h < height * 0.5 || random() < 0.35) continue;

      // Twig with a fan of leaves hanging off its end.
      const out = random() * Math.PI * 2;
      dir.set(Math.cos(out), 0.35 + random() * 0.4, Math.sin(out)).normalize();
      const twigEnd = at.clone().addScaledVector(dir, 0.35 + random() * 0.4);
      parts.limb(at, twigEnd, 0.012, 0.006, STALK, 3, false);
      const leaves = 3 + Math.floor(random() * 4);
      for (let l = 0; l < leaves; l++) {
        const spread = out + (random() - 0.5) * 1.6;
        dir.set(Math.cos(spread), -0.35 - random() * 0.6, Math.sin(spread)).normalize();
        addBlade(parts, twigEnd, dir.clone(), 0.22 + random() * 0.14, 0.022 + random() * 0.01, LEAF);
      }
    }
  }
  return parts.merge(true);
}

/**
 * The forest around the room. `place()` rebuilds it for the room's walls;
 * `update()` fades it in or out and drifts the mist.
 */
export class BambooForest {
  readonly group = new Group();
  /** World-space origin (player's floor spot) and forward. */
  readonly origin = new Vector3();
  readonly forward = new Vector3(0, 0, -1);
  /** Mean distance to the walls, for tuning how far the ninja mist reaches. */
  roomRadius = DEFAULT_ROOM_RADIUS;

  private bambooMaterial = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
  });
  private sunMaterial = new MeshBasicMaterial({
    color: SUN,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  private bankMaterial = mistMaterial(false);
  private floorMaterial = mistMaterial(true);
  private fadeMaterials: Material[] = [this.bambooMaterial, this.sunMaterial];
  private mistMaterials: ShaderMaterial[] = [this.bankMaterial, this.floorMaterial];
  private meshes: Mesh[] = [];
  private lookTarget = new Vector3();

  constructor() {
    this.group.name = 'BambooForest';
    this.group.visible = false;
    applyMist(this.bambooMaterial);
  }

  /** `walls` are world-space floor segments of the detected walls. */
  place(origin: Vector3, forward: Vector3, walls: WallSegment[]): void {
    this.origin.copy(origin).setY(0);
    this.forward.copy(forward).setY(0).normalize();
    this.group.position.copy(this.origin);
    this.lookTarget.copy(this.origin).add(this.forward);
    this.group.lookAt(this.lookTarget);
    this.group.updateMatrixWorld(true);

    const local = walls.map(({ a, b }) => {
      const la = this.group.worldToLocal(a.clone());
      const lb = this.group.worldToLocal(b.clone());
      return { a: new Vector2(la.x, la.z), b: new Vector2(lb.x, lb.z) };
    });
    const radii = roomOutline(local);
    this.roomRadius = radii.reduce((sum, r) => sum + r, 0) / radii.length;
    // Below ninja height, anything past the walls sinks into the mist: clear
    // inside the room, fully swallowed a few meters beyond it.
    mistUniforms.uMistCenter.value.copy(this.origin);
    mistUniforms.uMistNear.value = this.roomRadius + 0.5;
    mistUniforms.uMistFar.value = this.roomRadius + 5;

    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.meshes = [];
    // Transparent pass order: bamboo first (writes depth), then the floor
    // mist and the bank over anything behind them; sun last, behind all.
    this.addMesh('Bamboo', buildBamboo(radii, 23), this.bambooMaterial, 0);
    this.addMesh('FloorMist', buildFloorMist(radii), this.floorMaterial, 1);
    this.addMesh('MistBank', buildMistBank(radii), this.bankMaterial, 2);
    const sun = this.addMesh('Sun', new CircleGeometry(4.5, 24), this.sunMaterial, 3);
    sun.position.copy(polar((-24 * Math.PI) / 180, 85, 26));
    sun.lookAt(0, 1.2, 0);
    this.group.updateMatrixWorld(true);
  }

  /** World-space point `radius` meters out at `azimuth` from forward. */
  pointAt(azimuth: number, radius: number, target: Vector3): Vector3 {
    target.copy(polar(azimuth, radius));
    return this.group.localToWorld(target);
  }

  update(time: number, opacity: number): void {
    for (const m of this.fadeMaterials) m.opacity = opacity;
    for (const m of this.mistMaterials) {
      m.uniforms.uTime.value = time;
      m.uniforms.uOpacity.value = opacity;
    }
    this.group.visible = opacity > 0.001;
  }

  private addMesh(name: string, geometry: BufferGeometry, material: Material, order: number): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }
}
