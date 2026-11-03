import {
  Color,
  CustomBlending,
  DoubleSide,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector2,
  Vector3,
} from '@iwsdk/core';

/**
 * Fog colour shared by the breach card and the scene fog, so fully fogged
 * ninjas vanish into it. three mixes fog after colour-space conversion, so
 * these values reach the display as-is: set them in linear space.
 */
export const FOG_COLOR = new Color().setRGB(0.66, 0.7, 0.72, LinearSRGBColorSpace);
const FOG_DEEP = new Color().setRGB(0.46, 0.5, 0.54, LinearSRGBColorSpace);

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Outputs raw colour (no tonemapping/colour-space chunks) because three mixes
// scene fog in after those chunks; matching that keeps the seam invisible.
const fragmentShader = /* glsl */ `
  uniform vec3 uFog;
  uniform vec3 uDeep;
  uniform vec2 uSize;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uFloor;
  varying vec2 vUv;

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
    vec2 m = vUv * uSize;
    float n = fbm(m * 1.4 + vec2(uTime * 0.18, uTime * 0.05));
    vec3 col;
    float alpha;
    if (uFloor > 0.5) {
      // Mist spilling into the room: dense at the wall (v = 1), gone by the far edge.
      alpha = smoothstep(0.0, 1.0, vUv.y) * smoothstep(0.15, 0.7, n) * 0.75;
      alpha *= smoothstep(0.0, 0.5, min(m.x, uSize.x - m.x));
      col = uFog;
    } else {
      // Ragged sides and top; the bottom edge meets the floor solid.
      float edge = min(min(m.x, uSize.x - m.x), uSize.y - m.y);
      alpha = smoothstep(0.0, 0.5, edge - (n - 0.5) * 0.5);
      col = mix(uFog, uDeep, smoothstep(1.9, uSize.y + 0.4, m.y));
      col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.45, m.y)) * 0.12);
      col += (n - 0.5) * 0.05;
    }
    gl_FragColor = vec4(col, alpha * uOpacity);
  }
`;

function fogMaterial(floor: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uFog: { value: FOG_COLOR },
      uDeep: { value: FOG_DEEP },
      uSize: { value: new Vector2(1, 1) },
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uFloor: { value: floor ? 1 : 0 },
    },
    // Opaque queue + custom blending: drawn before the ninjas without writing
    // depth, so ninjas "behind" the wall render over it and fade with scene fog.
    // Premultiplied-style alpha keeps passthrough compositing correct.
    transparent: false,
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
}

/**
 * The opening where a real wall dissolves into endless fog. The card sits on
 * the wall plane; ninjas run up a corridor behind it with the same cross
 * section, which keeps them inside the opening from a seated viewpoint.
 */
export class FogBreach {
  readonly group = new Group();
  readonly center = new Vector3();
  readonly normal = new Vector3(0, 0, 1);
  /** Horizontal unit vector along the wall. */
  readonly tangent = new Vector3(1, 0, 0);
  width = 3;
  height = 2.5;

  private card = new Mesh(new PlaneGeometry(1, 1), fogMaterial(false));
  private mist = new Mesh(new PlaneGeometry(1, 1), fogMaterial(true));
  private meshes = [this.card, this.mist];
  private lookTarget = new Vector3();
  private static readonly MIST_DEPTH = 1.6;

  constructor() {
    this.group.name = 'FogBreach';
    this.card.name = 'FogCard';
    this.mist.name = 'FloorMist';
    this.card.renderOrder = -10;
    this.mist.renderOrder = -9;
    this.card.frustumCulled = false;
    this.group.add(this.card, this.mist);
  }

  /** Place the opening: `center` is its floor-level midpoint, `normal` faces into the room. */
  place(center: Vector3, normal: Vector3, width: number, height: number): void {
    this.center.copy(center);
    this.normal.copy(normal).setY(0).normalize();
    this.tangent.set(this.normal.z, 0, -this.normal.x);
    this.width = width;
    this.height = height;

    this.card.scale.set(width, height, 1);
    this.card.position.copy(center).setY(center.y + height / 2);
    this.lookTarget.copy(this.card.position).add(this.normal);
    this.card.lookAt(this.lookTarget);
    (this.card.material as ShaderMaterial).uniforms.uSize.value.set(width, height);

    const depth = FogBreach.MIST_DEPTH;
    this.mist.scale.set(width, depth, 1);
    this.mist.position.copy(center).addScaledVector(this.normal, depth / 2).setY(center.y + 0.01);
    // Lay flat with local +Y (uv v = 1) pointing back toward the wall.
    this.lookTarget.copy(this.mist.position).setY(this.mist.position.y + 1);
    this.mist.up.copy(this.normal).negate();
    this.mist.lookAt(this.lookTarget);
    (this.mist.material as ShaderMaterial).uniforms.uSize.value.set(width, depth);
  }

  update(time: number, opacity: number): void {
    for (const mesh of this.meshes) {
      const uniforms = (mesh.material as ShaderMaterial).uniforms;
      uniforms.uTime.value = time;
      uniforms.uOpacity.value = opacity;
    }
    this.group.visible = opacity > 0.001;
  }
}
