import { DoubleSide, Group, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from '@iwsdk/core';

// Spirit flame: a defeated ninja evaporates in place into an S-shaped tongue
// of fire, coloured like the lightning (white core, deep violet edge). Each
// flame is a single upright quad turned to face the player; the shape is
// drawn in the fragment shader, so a burst costs one draw and no geometry
// writes. A fixed pool is reused, so bursts don't allocate.

const POOL_SIZE = 8;
/** Seconds from ignition until the last wisp is gone. */
const LIFE = 0.85;
const WIDTH = 1.1;
const HEIGHT = 2.3;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uAge;   // 0..1 through the flame's life
  uniform float uSeed;
  uniform float uMirror;
  varying vec2 vUv;
  void main() {
    float v = vUv.y;
    float x = (vUv.x - 0.5) * uMirror;
    // The flame shoots up fast, then its base lifts off and rises after it.
    float top = min(1.0, uAge / 0.22);
    float bottom = smoothstep(0.3, 1.0, uAge) * 1.05;
    if (v > top || v < bottom) discard;
    // One full S along its height, swaying as it burns.
    float sway = uAge * 7.0 + uSeed;
    float center = 0.16 * sin((v - 0.05) * 6.2832 + sway * 0.6) * (0.35 + 0.65 * v);
    // Fat near the base, licking to a point at the tip, rounded underneath.
    float width = 0.3 * pow(1.0 - v, 0.6) * (1.0 + 0.15 * sin(v * 23.0 - sway * 3.0));
    width *= smoothstep(bottom - 0.02, bottom + 0.1, v);
    width *= 1.0 - smoothstep(top - 0.15, top, v) * 0.85;
    float core = 1.0 - abs(x - center) / max(width, 1e-4);
    if (core <= 0.0) discard;
    vec3 edge = vec3(0.22, 0.08, 0.5);
    // A broad violet rim keeps it readable against bright real walls.
    vec3 color = mix(edge, vec3(1.0), smoothstep(0.6, 0.9, core));
    float fade = 1.0 - smoothstep(0.55, 1.0, uAge);
    float flicker = sin(uAge * 70.0 + uSeed) > -0.5 ? 1.0 : 0.6;
    float alpha = smoothstep(0.0, 0.12, core) * fade * flicker;
    gl_FragColor = vec4(color, alpha);
  }
`;

interface Flame {
  mesh: Mesh;
  material: ShaderMaterial;
  /** Seconds since ignition; ≥ LIFE when free. */
  age: number;
}

export class Flames {
  readonly group = new Group();
  private flames: Flame[] = [];

  constructor() {
    this.group.name = 'Flames';
    const geometry = new PlaneGeometry(WIDTH, HEIGHT);
    geometry.translate(0, HEIGHT / 2, 0);
    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { uAge: { value: 0 }, uSeed: { value: 0 }, uMirror: { value: 1 } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 10;
      this.group.add(mesh);
      this.flames.push({ mesh, material, age: LIFE });
    }
  }

  /** Ignite a flame standing on the floor point `base` (world space). */
  ignite(base: Vector3): void {
    let flame = this.flames[0];
    for (const candidate of this.flames) {
      if (candidate.age >= LIFE) {
        flame = candidate;
        break;
      }
      if (candidate.age > flame.age) flame = candidate;
    }
    flame.age = 0;
    flame.mesh.position.copy(base);
    flame.material.uniforms.uSeed.value = Math.random() * 100;
    flame.material.uniforms.uMirror.value = Math.random() < 0.5 ? -1 : 1;
  }

  /** Advance every flame and turn each to face `viewer` (world space). */
  update(delta: number, viewer: Vector3): void {
    for (const flame of this.flames) {
      if (flame.age >= LIFE) continue;
      flame.age += delta;
      if (flame.age >= LIFE) {
        flame.mesh.visible = false;
        continue;
      }
      const p = flame.mesh.position;
      flame.mesh.rotation.y = Math.atan2(viewer.x - p.x, viewer.z - p.z);
      flame.material.uniforms.uAge.value = flame.age / LIFE;
      flame.mesh.visible = true;
    }
  }
}
