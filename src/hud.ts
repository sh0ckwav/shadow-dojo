import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
} from '@iwsdk/core';
import shojumaruUrl from '@fontsource/shojumaru/files/shojumaru-latin-400-normal.woff2?url';
import { MIST_RAW } from './mist.js';

// Head-locked presentation layer: the arcade-style strip across the top of
// the view, the big wave banner, and the mist veil that swallows the view
// between waves. Everything here is a child of the camera.

const FONT = 'Shojumaru';
const FONT_STACK = `"${FONT}", "Times New Roman", serif`;
const INK = '#121512';
const PAPER = '#f2e6c4';
const VERMILION = '#c8402a';
// The faceted ninja's palette (see ninja-model.ts), for the life icons.
const GI = '#a3b2a6';
const GI_SHADE = '#84938a';
const MASK = '#1f2227';
const SASH = '#6a2a9a';

/** Strip size in meters at 1 m from the eye: ~66° wide, centred ~20° up. */
const STRIP_DISTANCE = 1;
const STRIP_WIDTH = 1.3;
const STRIP_HEIGHT = 0.1;
const STRIP_UP = 0.36;
const STRIP_PX = 3072;
const BANNER_DISTANCE = 1.3;
const BANNER_WIDTH = 0.9;
const BANNER_HEIGHT = 0.3;
const BANNER_PX = 1024;

let fontReady: Promise<void> | undefined;
function loadFont(): Promise<void> {
  fontReady ??= new FontFace(FONT, `url(${shojumaruUrl})`)
    .load()
    .then((face) => {
      document.fonts.add(face);
    })
    .catch(() => {
      // The serif fallback is still legible; the font is a nicety.
    });
  return fontReady;
}

function overlayMaterial(texture: CanvasTexture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
}

function canvasTexture(width: number, height: number): { ctx: CanvasRenderingContext2D; texture: CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx == null) throw new Error('2D canvas unavailable');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return { ctx, texture };
}

/** Paper-filled text with a heavy ink edge, readable on any passthrough. */
function inkText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill = PAPER): void {
  ctx.font = `${size}px ${FONT_STACK}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** A hanko-style seal: vermilion square with the numeral cut out in paper. */
function seal(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, size: number): void {
  const half = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.04);
  ctx.fillStyle = INK;
  ctx.fillRect(-half - size * 0.06, -half - size * 0.06, size * 1.12, size * 1.12);
  ctx.fillStyle = VERMILION;
  ctx.fillRect(-half, -half, size, size);
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = size * 0.05;
  ctx.strokeRect(-half + size * 0.09, -half + size * 0.09, size * 0.82, size * 0.82);
  ctx.fillStyle = PAPER;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fit = text.length > 1 ? 0.5 : 0.62;
  ctx.font = `${size * fit}px ${FONT_STACK}`;
  ctx.fillText(text, 0, size * 0.04);
  ctx.restore();
}

/** Faceted ninja head: sage hood, dark mask window, paper eyes, violet tails. */
function ninjaIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const s = size / 2;
  const at = (x: number, y: number): [number, number] => [cx + x * s, cy + y * s];
  const poly = (points: Array<[number, number]>, fill: string) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(...at(x, y)) : ctx.lineTo(...at(x, y))));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const hood: Array<[number, number]> = [
    [0, -0.98], [0.56, -0.8], [0.86, -0.3], [0.84, 0.32], [0.56, 0.8], [0, 0.96],
    [-0.56, 0.8], [-0.84, 0.32], [-0.86, -0.3], [-0.56, -0.8],
  ];
  // Sash tails flutter out behind the head.
  poly([[0.62, -0.1], [1.2, 0.05], [1.05, 0.25], [0.6, 0.12]], SASH);
  poly([[0.6, 0.06], [1.12, 0.42], [0.9, 0.55], [0.55, 0.22]], SASH);
  // Ink outline, then the hood in alternating facet shades.
  ctx.beginPath();
  hood.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(...at(x, y)) : ctx.lineTo(...at(x, y))));
  ctx.closePath();
  ctx.lineWidth = size * 0.1;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.stroke();
  for (let i = 0; i < hood.length; i++) {
    const next = hood[(i + 1) % hood.length];
    poly([[0, -0.05], hood[i], next], i % 2 === 0 ? GI : GI_SHADE);
  }
  // Mask window and the eye slit.
  poly([[-0.62, -0.28], [0.62, -0.28], [0.7, 0.12], [0.42, 0.6], [0, 0.72], [-0.42, 0.6], [-0.7, 0.12]], MASK);
  poly([[-0.5, -0.14], [-0.1, -0.04], [-0.14, 0.08], [-0.46, 0.02]], PAPER);
  poly([[0.5, -0.14], [0.1, -0.04], [0.14, 0.08], [0.46, 0.02]], PAPER);
  // Violet headband across the brow.
  poly([[-0.8, -0.44], [0.8, -0.44], [0.78, -0.3], [-0.78, -0.3]], SASH);
}

/**
 * Arcade-style strip fixed to the top of the view: score left (digits
 * only), the wave in the middle, ninja heads for lives on the right. Plus a
 * centred banner for wave titles.
 */
export class Hud {
  readonly group = new Group();
  private strip: { ctx: CanvasRenderingContext2D; texture: CanvasTexture };
  private banner: { ctx: CanvasRenderingContext2D; texture: CanvasTexture };
  private stripMesh: Mesh;
  private bannerMaterial: MeshBasicMaterial;
  private score = -1;
  private wave = -1;
  private lives = -1;
  private bannerText = '';

  constructor() {
    this.group.name = 'Hud';
    this.strip = canvasTexture(STRIP_PX, Math.round((STRIP_PX * STRIP_HEIGHT) / STRIP_WIDTH));
    this.banner = canvasTexture(BANNER_PX, Math.round((BANNER_PX * BANNER_HEIGHT) / BANNER_WIDTH));

    this.stripMesh = new Mesh(new PlaneGeometry(STRIP_WIDTH, STRIP_HEIGHT), overlayMaterial(this.strip.texture));
    this.stripMesh.position.set(0, STRIP_UP, -STRIP_DISTANCE);
    this.stripMesh.renderOrder = 1001;
    this.bannerMaterial = overlayMaterial(this.banner.texture);
    this.bannerMaterial.opacity = 0;
    const bannerMesh = new Mesh(new PlaneGeometry(BANNER_WIDTH, BANNER_HEIGHT), this.bannerMaterial);
    bannerMesh.position.set(0, 0.04, -BANNER_DISTANCE);
    bannerMesh.renderOrder = 1002;
    for (const mesh of [this.stripMesh, bannerMesh]) {
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.group.visible = false;

    void loadFont().then(() => {
      this.drawStrip();
      this.drawBanner();
    });
  }

  set(score: number, wave: number, lives: number): void {
    if (score === this.score && wave === this.wave && lives === this.lives) return;
    this.score = score;
    this.wave = wave;
    this.lives = lives;
    this.drawStrip();
  }

  /** Banner text and opacity (0 hides it). */
  showBanner(text: string, opacity: number): void {
    if (text !== this.bannerText) {
      this.bannerText = text;
      this.drawBanner();
    }
    this.bannerMaterial.opacity = opacity;
    this.bannerMaterial.visible = opacity > 0.001;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  private drawStrip(): void {
    const { ctx, texture } = this.strip;
    const { width, height } = ctx.canvas;
    const mid = height / 2;
    const pad = height * 0.3;
    ctx.clearRect(0, 0, width, height);
    ctx.textBaseline = 'middle';

    ctx.textAlign = 'left';
    inkText(ctx, String(Math.max(0, this.score)).padStart(6, '0'), pad, mid + height * 0.04, height * 0.62);

    if (this.wave > 0) {
      ctx.textAlign = 'right';
      inkText(ctx, 'WAVE', width / 2 + height * 0.12, mid + height * 0.04, height * 0.5);
      seal(ctx, String(this.wave), width / 2 + height * 0.62, mid, height * 0.72);
    }

    const icon = height * 0.74;
    for (let i = 0; i < this.lives; i++) {
      ninjaIcon(ctx, width - pad - icon * 0.62 - i * icon * 1.32, mid, icon);
    }
    texture.needsUpdate = true;
  }

  private drawBanner(): void {
    const { ctx, texture } = this.banner;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    if (this.bannerText !== '') {
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      // Ink brushed straight onto the mist, with a little paper halo.
      ctx.font = `${height * 0.46}px ${FONT_STACK}`;
      ctx.lineWidth = height * 0.05;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = PAPER;
      ctx.strokeText(this.bannerText, width / 2 - height * 0.28, height / 2);
      ctx.fillStyle = INK;
      ctx.fillText(this.bannerText, width / 2 - height * 0.28, height / 2);
      const textWidth = ctx.measureText(this.bannerText).width;
      ctx.fillStyle = VERMILION;
      ctx.beginPath();
      ctx.arc(width / 2 + textWidth / 2 - height * 0.04, height * 0.3, height * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
    texture.needsUpdate = true;
  }
}

/**
 * Full-view mist that rolls in over everything between waves. `amount` 0–1:
 * wisps first, then a near-solid wall of mist.
 */
export class MistVeil {
  readonly mesh: Mesh;
  private material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: {
        uColor: { value: MIST_RAW },
        uAmount: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      // Raw colour out, like the rest of the mist.
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uAmount;
        uniform float uTime;
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
          // Rises from below: the bottom of the view fills first.
          float n = fbm(vUv * vec2(5.0, 3.0) + vec2(uTime * 0.18, -uTime * 0.07));
          float front = uAmount * 1.7 - (vUv.y * 0.7 + (1.0 - n) * 0.5);
          float alpha = smoothstep(0.0, 0.35, front) * (0.9 + 0.1 * n);
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    // ±68° at 0.6 m covers the Quest field of view with room to spare.
    this.mesh = new Mesh(new PlaneGeometry(3, 3), this.material);
    this.mesh.name = 'MistVeil';
    this.mesh.position.set(0, 0, -0.6);
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  update(time: number, amount: number): void {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uAmount.value = amount;
    this.mesh.visible = amount > 0.001;
  }
}
