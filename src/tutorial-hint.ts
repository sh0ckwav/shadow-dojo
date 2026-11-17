import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from '@iwsdk/core';
import { canvasTexture, INK, overlayMaterial, PAPER, VERMILION } from './hud.js';

// The wordless first-run lesson: a hand in the HUD's ink-and-paper style
// floats over the practice ninja, alternating between pointing at it and
// pinching, with a vermilion spark at the pinch. No text.

const SIZE = 0.9;
const PX = 512;
/** Seconds per pose. */
const BEAT = 0.7;

type Pose = 'point' | 'pinch';

export class TutorialHint {
  readonly mesh: Mesh;
  private frames: Record<Pose, { ctx: CanvasRenderingContext2D; texture: CanvasTexture }>;
  private material: MeshBasicMaterial;
  private time = 0;
  private look = new Vector3();

  constructor() {
    this.frames = { point: canvasTexture(PX, PX), pinch: canvasTexture(PX, PX) };
    this.draw('point');
    this.draw('pinch');
    this.material = overlayMaterial(this.frames.point.texture);
    this.mesh = new Mesh(new PlaneGeometry(SIZE, SIZE), this.material);
    this.mesh.name = 'TutorialHint';
    this.mesh.renderOrder = 1003;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Hover over `target` (world space), facing `viewer`. */
  update(delta: number, target: Vector3, viewer: Vector3): void {
    this.time += delta;
    const pose: Pose = Math.floor(this.time / BEAT) % 2 === 0 ? 'point' : 'pinch';
    const map = this.frames[pose].texture;
    if (this.material.map !== map) {
      this.material.map = map;
      this.material.needsUpdate = true;
    }
    // Bob gently above the ninja's head, a touch toward the player.
    this.mesh.position.copy(target);
    this.mesh.position.y += 1.3 + Math.sin(this.time * 2.4) * 0.04;
    this.look.copy(viewer);
    this.mesh.lookAt(this.look);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
    this.time = 0;
  }

  private draw(pose: Pose): void {
    const { ctx, texture } = this.frames[pose];
    const s = PX;
    ctx.clearRect(0, 0, s, s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const stroke = s * 0.03;

    const capsule = (x1: number, y1: number, x2: number, y2: number, w: number) => {
      ctx.lineWidth = w + stroke * 2;
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    const fill = (x1: number, y1: number, x2: number, y2: number, w: number) => {
      ctx.lineWidth = w;
      ctx.strokeStyle = PAPER;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    // Back of a right hand, wrist at the bottom, pointing up at the target.
    const palm: [number, number, number, number, number] = [s * 0.5, s * 0.66, s * 0.5, s * 0.78, s * 0.3];
    const fingers: Array<[number, number, number, number, number]> =
      pose === 'point'
        ? [
            [s * 0.47, s * 0.6, s * 0.44, s * 0.2, s * 0.085], // index, straight up
            [s * 0.36, s * 0.66, s * 0.27, s * 0.48, s * 0.085], // thumb, out to the side
            [s * 0.55, s * 0.6, s * 0.58, s * 0.52, s * 0.09], // curled middle
            [s * 0.61, s * 0.63, s * 0.64, s * 0.56, s * 0.085], // curled ring
            [s * 0.66, s * 0.67, s * 0.69, s * 0.61, s * 0.075], // curled little
          ]
        : [
            [s * 0.47, s * 0.6, s * 0.4, s * 0.38, s * 0.085], // index bent down to meet...
            [s * 0.36, s * 0.66, s * 0.38, s * 0.42, s * 0.085], // ...the thumb
            [s * 0.55, s * 0.6, s * 0.58, s * 0.52, s * 0.09],
            [s * 0.61, s * 0.63, s * 0.64, s * 0.56, s * 0.085],
            [s * 0.66, s * 0.67, s * 0.69, s * 0.61, s * 0.075],
          ];
    // Ink outlines first, then paper fills, so overlaps merge into one shape.
    capsule(...palm);
    for (const f of fingers) capsule(...f);
    fill(...palm);
    for (const f of fingers) fill(...f);
    // Knuckle creases.
    ctx.strokeStyle = INK;
    ctx.lineWidth = stroke * 0.6;
    ctx.beginPath();
    ctx.moveTo(s * 0.43, s * 0.6);
    ctx.lineTo(s * 0.6, s * 0.62);
    ctx.stroke();

    if (pose === 'point') {
      // Dashes from the fingertip out toward the target.
      ctx.strokeStyle = VERMILION;
      ctx.lineWidth = stroke;
      for (let i = 0; i < 3; i++) {
        const y = s * (0.13 - i * 0.045);
        ctx.beginPath();
        ctx.moveTo(s * 0.435, y);
        ctx.lineTo(s * 0.43, y - s * 0.02);
        ctx.stroke();
      }
    } else {
      // A vermilion spark where finger and thumb meet.
      const cx = s * 0.39;
      const cy = s * 0.37;
      ctx.fillStyle = VERMILION;
      ctx.strokeStyle = INK;
      ctx.lineWidth = stroke * 0.7;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i % 2 === 0 ? s * 0.09 : s * 0.035;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    texture.needsUpdate = true;
  }
}
