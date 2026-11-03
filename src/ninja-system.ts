import { createSystem, Entity, Object3D, Vector3, VisibilityState } from '@iwsdk/core';
import { Ninja, NinjaPhase } from './game-components.js';
import { GameSystem } from './game-system.js';
import { NINJA_FRAMES, RUN_WAIST_HEIGHT } from './scene-assets/ninja-model.js';

const RUN_A = NINJA_FRAMES.indexOf('RunA');
const RUN_B = NINJA_FRAMES.indexOf('RunB');
const LEAP = NINJA_FRAMES.indexOf('Leap');
/** Key-frame rate for the run cycle: deliberately choppy, like limited animation. */
const RUN_FPS = 8;
/** Horizontal distance from the player's head at which a runner leaps. */
const STRIKE_RANGE = 2.4;
/** Leaps end this far in front of the face, which counts as a hit. */
const STRIKE_DISTANCE = 0.3;
const DEFEAT_TIME = 0.35;

/** Sprint out of the fog → leap → strike, plus the defeat tumble. */
export class NinjaSystem extends createSystem({
  ninjas: { required: [Ninja] },
}) {
  private game?: GameSystem;
  private head = new Vector3();
  private origin = new Vector3();
  private target = new Vector3();
  private toward = new Vector3();

  init(): void {
    this.game = this.world.getSystem(GameSystem);
  }

  update(delta: number, time: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) {
      return;
    }
    this.world.camera.getWorldPosition(this.head);

    for (const ninja of this.queries.ninjas.entities) {
      const object = ninja.object3D;
      if (object == null) continue;
      const phase = ninja.getValue(Ninja, 'phase');
      const timer = (ninja.getValue(Ninja, 'timer') ?? 0) + delta;
      ninja.setValue(Ninja, 'timer', timer);

      if (phase === NinjaPhase.Running) {
        this.run(ninja, object, timer, delta);
      } else if (phase === NinjaPhase.Leaping) {
        this.leap(ninja, object, timer, time);
      } else if (phase === NinjaPhase.Defeated) {
        const u = Math.min(1, timer / DEFEAT_TIME);
        object.scale.setScalar(Math.max(0.01, 1 - u));
        object.rotateY(delta * 25);
        object.position.y = Math.max(0.1, object.position.y - delta * 1.5);
        if (u >= 1) ninja.dispose({ disposeResources: false });
      }
    }
  }

  private run(ninja: Entity, object: Object3D, timer: number, delta: number): void {
    const t = ninja.getVectorView(Ninja, 'target');
    this.toward.set(t[0] - object.position.x, 0, t[2] - object.position.z);
    const remaining = this.toward.length();
    this.toward.divideScalar(Math.max(remaining, 1e-4));
    const speed = ninja.getValue(Ninja, 'speed') ?? 12;
    object.position.addScaledVector(this.toward, Math.min(remaining, speed * delta));

    // Two held key frames with a hop on the contact frame; no tweening.
    const frame = Math.floor(timer * RUN_FPS) % 2 === 0 ? RUN_A : RUN_B;
    this.showFrame(object, frame);
    object.position.y = RUN_WAIST_HEIGHT + (frame === RUN_B ? 0.04 : 0);
    this.origin.copy(object.position).add(this.toward);
    object.lookAt(this.origin);

    const dx = this.head.x - object.position.x;
    const dz = this.head.z - object.position.z;
    if (dx * dx + dz * dz <= STRIKE_RANGE * STRIKE_RANGE || remaining < 0.3) {
      // Lock the strike point at takeoff so the player can dodge by leaning.
      this.target.copy(this.head).sub(object.position).normalize();
      this.target.multiplyScalar(-STRIKE_DISTANCE).add(this.head);
      this.target.y -= 0.15;
      ninja.getVectorView(Ninja, 'target').set([this.target.x, this.target.y, this.target.z]);
      ninja.getVectorView(Ninja, 'origin').set([object.position.x, object.position.y, object.position.z]);
      ninja.setValue(Ninja, 'phase', NinjaPhase.Leaping);
      ninja.setValue(Ninja, 'timer', 0);
      this.showFrame(object, LEAP);
    }
  }

  private leap(ninja: Entity, object: Object3D, timer: number, time: number): void {
    const o = ninja.getVectorView(Ninja, 'origin');
    const t = ninja.getVectorView(Ninja, 'target');
    this.origin.set(o[0], o[1], o[2]);
    this.target.set(t[0], t[1], t[2]);
    const duration = ninja.getValue(Ninja, 'leapDuration') ?? 0.6;
    const height = ninja.getValue(Ninja, 'arcHeight') ?? 0.25;
    const u = Math.min(1, timer / duration);
    object.position.lerpVectors(this.origin, this.target, u);
    object.position.y += height * 4 * u * (1 - u);
    object.lookAt(this.head);
    object.rotateZ(Math.sin(time * 9) * 0.12);
    if (u >= 1) {
      this.game?.onPlayerHit();
      ninja.dispose({ disposeResources: false });
    }
  }

  private showFrame(object: Object3D, frame: number): void {
    const frames = object.children;
    for (let i = 0; i < frames.length; i++) frames[i].visible = i === frame;
  }
}
