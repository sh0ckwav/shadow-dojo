import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';

// Reverse lightning: a jagged bolt that leaps from a defeated enemy up into
// the sky. Each bolt is a ribbon of crossed quads (readable from any side)
// with unfogged shading so it cuts through the mist. A deep violet edge
// around the white core keeps it readable against bright real ceilings,
// where additive light alone would vanish. A fixed pool
// of bolts is rewritten in place, so strikes don't allocate.

const POOL_SIZE = 12;
const MAIN_SEGMENTS = 16;
const BRANCH_SEGMENTS = 6;
const SEGMENTS = MAIN_SEGMENTS + BRANCH_SEGMENTS;
/** Two crossed quads of two triangles per segment. */
const VERTS = SEGMENTS * 2 * 6;
/** The bolt races from the ground to the sky in this long... */
const GROW_TIME = 0.07;
/** ...and is gone after this long. */
const LIFE = 0.5;

const vertexShader = /* glsl */ `
  attribute float aT;
  attribute float aAcross;
  varying float vT;
  varying float vAcross;
  void main() {
    vT = aT;
    vAcross = aAcross;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uGrow;
  uniform float uFade;
  varying float vT;
  varying float vAcross;
  void main() {
    if (vT > uGrow) discard;
    // White-hot core inside a deep violet edge.
    float core = 1.0 - abs(vAcross * 2.0 - 1.0);
    vec3 edge = vec3(0.22, 0.08, 0.5);
    vec3 color = mix(edge, vec3(1.0), smoothstep(0.45, 0.8, core));
    // The leading tip burns brightest as it climbs.
    color = mix(color, vec3(1.0), smoothstep(uGrow - 0.08, uGrow, vT) * step(uGrow, 0.999));
    float alpha = smoothstep(0.0, 0.25, core) * uFade;
    gl_FragColor = vec4(color, alpha);
  }
`;

export interface StrikeOptions {
  /** Meters the bolt climbs. */
  height?: number;
  /** Width multiplier. */
  width?: number;
  /** Seconds before it fires. */
  delay?: number;
}

interface Bolt {
  mesh: Mesh;
  material: ShaderMaterial;
  positions: BufferAttribute;
  t: BufferAttribute;
  across: BufferAttribute;
  /** Seconds since firing; negative while delayed; ≥ LIFE when free. */
  age: number;
  base: Vector3;
  height: number;
  width: number;
  seed: number;
}

export class Lightning {
  readonly group = new Group();
  private bolts: Bolt[] = [];
  private points: Vector3[] = [];
  private a = new Vector3();
  private b = new Vector3();
  private dir = new Vector3();
  private side = new Vector3();
  private side2 = new Vector3();
  private top = new Vector3();

  constructor() {
    this.group.name = 'Lightning';
    for (let i = 0; i <= MAIN_SEGMENTS; i++) this.points.push(new Vector3());
    for (let i = 0; i < POOL_SIZE; i++) {
      const geometry = new BufferGeometry();
      const positions = new BufferAttribute(new Float32Array(VERTS * 3), 3).setUsage(DynamicDrawUsage);
      const t = new BufferAttribute(new Float32Array(VERTS), 1).setUsage(DynamicDrawUsage);
      const across = new BufferAttribute(new Float32Array(VERTS), 1).setUsage(DynamicDrawUsage);
      geometry.setAttribute('position', positions);
      geometry.setAttribute('aT', t);
      geometry.setAttribute('aAcross', across);
      const material = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { uGrow: { value: 0 }, uFade: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 10;
      this.group.add(mesh);
      this.bolts.push({ mesh, material, positions, t, across, age: LIFE, base: new Vector3(), height: 14, width: 1, seed: 0 });
    }
  }

  /** Fire a bolt from `base` (world space) up into the sky. */
  strike(base: Vector3, options: StrikeOptions = {}): void {
    // Reuse a free bolt, or the oldest one.
    let bolt = this.bolts[0];
    for (const candidate of this.bolts) {
      if (candidate.age >= LIFE) {
        bolt = candidate;
        break;
      }
      if (candidate.age > bolt.age) bolt = candidate;
    }
    bolt.age = -(options.delay ?? 0);
    bolt.base.copy(base);
    bolt.height = options.height ?? 14;
    bolt.width = options.width ?? 1;
    bolt.seed = Math.random() * 1000;
    if (bolt.age >= 0) this.build(bolt);
    bolt.mesh.visible = false;
  }

  update(delta: number): void {
    for (const bolt of this.bolts) {
      if (bolt.age >= LIFE) continue;
      const before = bolt.age;
      bolt.age += delta;
      if (bolt.age < 0) continue;
      if (before < 0) this.build(bolt);
      if (bolt.age >= LIFE) {
        bolt.mesh.visible = false;
        continue;
      }
      const grow = Math.min(1, bolt.age / GROW_TIME);
      // Fade with a hard flicker, like a lightning channel re-striking.
      const fall = 1 - Math.max(0, bolt.age - GROW_TIME) / (LIFE - GROW_TIME);
      const flicker = Math.sin(bolt.age * 90 + bolt.seed) > -0.3 ? 1 : 0.35;
      bolt.material.uniforms.uGrow.value = grow;
      bolt.material.uniforms.uFade.value = fall * fall * flicker;
      bolt.mesh.visible = true;
    }
  }

  /** Lay out a fresh jagged path for `bolt`. */
  private build(bolt: Bolt): void {
    const { base, height, width } = bolt;
    // The channel drifts sideways as it climbs.
    this.top.set(base.x + (Math.random() - 0.5) * 3, base.y + height, base.z + (Math.random() - 0.5) * 3);
    for (let i = 0; i <= MAIN_SEGMENTS; i++) {
      const f = i / MAIN_SEGMENTS;
      const p = this.points[i].lerpVectors(base, this.top, f);
      if (i > 0 && i < MAIN_SEGMENTS) {
        // Jag harder low down, where it tears out of the body.
        const jag = 0.45 * (1 - 0.4 * f) * (height / 14);
        p.x += (Math.random() - 0.5) * jag * 2;
        p.z += (Math.random() - 0.5) * jag * 2;
        p.y += (Math.random() - 0.5) * (height / MAIN_SEGMENTS) * 0.5;
      }
    }

    let v = 0;
    for (let i = 0; i < MAIN_SEGMENTS; i++) {
      const f0 = i / MAIN_SEGMENTS;
      const f1 = (i + 1) / MAIN_SEGMENTS;
      v = this.segment(bolt, v, this.points[i], this.points[i + 1], f0, f1, 0.13 * width * (1 - 0.6 * f0), 0.13 * width * (1 - 0.6 * f1));
    }
    // One fork splitting off partway up.
    const at = 3 + Math.floor(Math.random() * 6);
    const forkT = at / MAIN_SEGMENTS;
    this.a.copy(this.points[at]);
    const heading = Math.random() * Math.PI * 2;
    const reach = height * 0.18;
    for (let i = 0; i < BRANCH_SEGMENTS; i++) {
      const f = (i + 1) / BRANCH_SEGMENTS;
      this.b.set(
        this.points[at].x + Math.cos(heading) * reach * f + (Math.random() - 0.5) * 0.3,
        this.points[at].y + reach * 0.8 * f + (Math.random() - 0.5) * 0.3,
        this.points[at].z + Math.sin(heading) * reach * f + (Math.random() - 0.5) * 0.3,
      );
      const t0 = forkT + (i / BRANCH_SEGMENTS) * 0.25;
      const t1 = forkT + f * 0.25;
      v = this.segment(bolt, v, this.a, this.b, t0, t1, 0.07 * width * (1 - f * 0.7 + 0.7 / BRANCH_SEGMENTS), 0.07 * width * (1 - f * 0.7));
      this.a.copy(this.b);
    }
    bolt.mesh.geometry.setDrawRange(0, v);
    bolt.positions.needsUpdate = true;
    bolt.t.needsUpdate = true;
    bolt.across.needsUpdate = true;
  }

  /** Write two crossed quads from `a` to `b`; returns the next vertex index. */
  private segment(bolt: Bolt, v: number, a: Vector3, b: Vector3, t0: number, t1: number, w0: number, w1: number): number {
    this.dir.subVectors(b, a).normalize();
    this.side.set(1, 0, 0).cross(this.dir);
    if (this.side.lengthSq() < 1e-4) this.side.set(0, 0, 1).cross(this.dir);
    this.side.normalize();
    this.side2.crossVectors(this.dir, this.side).normalize();
    for (const s of [this.side, this.side2]) {
      // Corners: (end, across) → a-left, a-right, b-right, b-left.
      const corners: Array<[Vector3, number, number, number]> = [
        [a, -w0, t0, 0], [a, w0, t0, 1], [b, w1, t1, 1],
        [a, -w0, t0, 0], [b, w1, t1, 1], [b, -w1, t1, 0],
      ];
      for (const [p, w, t, across] of corners) {
        bolt.positions.setXYZ(v, p.x + s.x * w, p.y + s.y * w, p.z + s.z * w);
        bolt.t.setX(v, t);
        bolt.across.setX(v, across);
        v++;
      }
    }
    return v;
  }
}
