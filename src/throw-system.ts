import {
  createSystem,
  Entity,
  Mesh,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { Ninja, NinjaPhase, Shuriken } from './game-components.js';
import { GamePhase, GameSystem } from './game-system.js';
import { createShuriken } from './scene-assets/ninja.scene-asset.js';

const THROW_SPEED = 11;
const COOLDOWN = 0.18;
const HIT_RADIUS = 0.36;
/** Hit sphere center above the ninja's waist origin (chest height). */
const CHEST_HEIGHT = 0.3;
/** Ignore the pinch that pressed Start. */
const START_GRACE = 0.4;
/** Throws within this angle of a ninja's intercept point snap onto it. */
const AIM_ASSIST_COS = Math.cos((8 * Math.PI) / 180);
const HANDS = ['left', 'right'] as const;

/**
 * Hands-first throwing: point a hand (or controller) and pinch/trigger to
 * throw along its target ray. In the 2D browser view a click throws toward
 * the cursor so the loop is testable without a headset.
 */
export class ThrowSystem extends createSystem({
  stars: { required: [Shuriken] },
  ninjas: { required: [Ninja] },
}) {
  private game?: GameSystem;
  private prototype!: Mesh;
  private cooldown = { left: 0, right: 0 };
  private pendingClick = false;
  private clickNdc = { x: 0, y: 0 };

  private origin = new Vector3();
  private direction = new Vector3();
  private previous = new Vector3();
  private segment = new Vector3();
  private toNinja = new Vector3();
  private closest = new Vector3();
  private head = new Vector3();
  private intercept = new Vector3();
  private bestIntercept = new Vector3();
  private velocity = new Vector3();

  init(): void {
    this.game = this.world.getSystem(GameSystem);
    this.prototype = createShuriken();

    const canvas = this.world.renderer.domElement;
    const onPointerDown = (event: PointerEvent) => {
      if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) return;
      const rect = canvas.getBoundingClientRect();
      this.clickNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.clickNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.pendingClick = true;
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    this.cleanupFuncs.push(() => canvas.removeEventListener('pointerdown', onPointerDown));
  }

  update(delta: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) {
      return;
    }
    const canThrow =
      this.game?.phase === GamePhase.Playing ||
      this.game?.phase === GamePhase.Intermission;
    const armed = canThrow && (this.game?.phaseTime ?? 0) > START_GRACE;

    for (const hand of HANDS) {
      this.cooldown[hand] -= delta;
      const select = this.input.xr.getSelectState(hand);
      if (armed && select.start && this.cooldown[hand] <= 0) {
        const space = this.player.raySpaces[hand];
        space.getWorldPosition(this.origin);
        space.getWorldDirection(this.direction);
        // Object3D.getWorldDirection returns +Z; target rays point down -Z.
        this.direction.negate();
        this.throwStar();
        this.cooldown[hand] = COOLDOWN;
      }
    }

    if (this.pendingClick) {
      this.pendingClick = false;
      if (armed) {
        const camera = this.world.camera;
        camera.getWorldPosition(this.origin);
        this.direction.set(this.clickNdc.x, this.clickNdc.y, 0.5).unproject(camera);
        this.direction.sub(this.origin).normalize();
        this.throwStar();
      }
    }

    this.world.camera.getWorldPosition(this.head);
    for (const star of this.queries.stars.entities) {
      this.moveStar(star, delta);
    }
  }

  private throwStar(): void {
    this.applyAimAssist();
    const object = this.prototype.clone();
    object.position.copy(this.origin).addScaledVector(this.direction, 0.12);
    const star = this.world.createTransformEntity(object);
    star.addComponent(Shuriken, { life: 1.4 });
    star
      .getVectorView(Shuriken, 'velocity')
      .set([
        this.direction.x * THROW_SPEED,
        this.direction.y * THROW_SPEED,
        this.direction.z * THROW_SPEED,
      ]);
  }

  /**
   * Redirect `direction` at the predicted chest position of the ninja closest
   * to the throw line, if one is inside the assist cone. Runners are led by
   * their ground velocity; leapers are close enough to aim at directly.
   */
  private applyAimAssist(): void {
    let bestCos = AIM_ASSIST_COS;
    let found = false;
    for (const ninja of this.queries.ninjas.entities) {
      const phase = ninja.getValue(Ninja, 'phase');
      const target = ninja.object3D;
      if (phase === NinjaPhase.Defeated || target == null) continue;

      this.velocity.set(0, 0, 0);
      if (phase === NinjaPhase.Running) {
        const t = ninja.getVectorView(Ninja, 'target');
        this.velocity.set(t[0] - target.position.x, 0, t[2] - target.position.z);
        this.velocity.normalize().multiplyScalar(ninja.getValue(Ninja, 'speed') ?? 0);
      }
      // Two fixed-point passes on time-to-impact are plenty at these speeds.
      this.intercept.copy(target.position);
      for (let pass = 0; pass < 2; pass++) {
        const flight = this.intercept.distanceTo(this.origin) / THROW_SPEED;
        this.intercept.copy(target.position).addScaledVector(this.velocity, flight);
        this.intercept.y += CHEST_HEIGHT;
      }
      this.intercept.sub(this.origin);
      const distance = this.intercept.length();
      const cos = this.intercept.dot(this.direction) / Math.max(distance, 1e-4);
      if (cos > bestCos) {
        bestCos = cos;
        this.bestIntercept.copy(this.intercept).divideScalar(distance);
        found = true;
      }
    }
    if (found) this.direction.copy(this.bestIntercept);
  }

  private moveStar(star: Entity, delta: number): void {
    const object = star.object3D;
    if (object == null) return;
    const life = (star.getValue(Shuriken, 'life') ?? 0) - delta;
    if (life <= 0) {
      star.dispose({ disposeResources: false });
      return;
    }
    star.setValue(Shuriken, 'life', life);

    const v = star.getVectorView(Shuriken, 'velocity');
    this.previous.copy(object.position);
    object.position.x += v[0] * delta;
    object.position.y += v[1] * delta;
    object.position.z += v[2] * delta;
    object.rotateZ(delta * 30);

    // Swept test so fast stars cannot tunnel through a ninja between frames.
    this.segment.subVectors(object.position, this.previous);
    const lengthSq = this.segment.lengthSq();
    for (const ninja of this.queries.ninjas.entities) {
      if (ninja.getValue(Ninja, 'phase') === NinjaPhase.Defeated) continue;
      const target = ninja.object3D;
      if (target == null) continue;
      this.toNinja.subVectors(target.position, this.previous);
      const u = lengthSq > 0 ? Math.min(1, Math.max(0, this.toNinja.dot(this.segment) / lengthSq)) : 0;
      this.closest.copy(this.previous).addScaledVector(this.segment, u);
      // Aim at the chest: the ninja origin is at the waist.
      this.closest.y -= CHEST_HEIGHT;
      if (this.closest.distanceTo(target.position) < HIT_RADIUS) {
        ninja.setValue(Ninja, 'phase', NinjaPhase.Defeated);
        ninja.setValue(Ninja, 'timer', 0);
        this.game?.onNinjaDefeated(target.position.distanceTo(this.head));
        star.dispose({ disposeResources: false });
        return;
      }
    }
  }
}
