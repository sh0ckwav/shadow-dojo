import { createSystem, Entity, Vector3, VisibilityState } from '@iwsdk/core';
import { Ninja, NinjaPhase, Portal } from './game-components.js';
import { GameSystem } from './game-system.js';

const EMERGE_TIME = 0.55;
const CROUCH_TIME = 0.35;
const DEFEAT_TIME = 0.35;
/** Leaps end this far in front of the face, which counts as a hit. */
const STRIKE_DISTANCE = 0.3;

/** Animates portals and the emerge → crouch → leap → strike sequence. */
export class NinjaSystem extends createSystem({
  ninjas: { required: [Ninja] },
  portals: { required: [Portal] },
}) {
  private game?: GameSystem;
  private head = new Vector3();
  private origin = new Vector3();
  private normal = new Vector3();
  private target = new Vector3();

  init(): void {
    this.game = this.world.getSystem(GameSystem);
  }

  update(delta: number, time: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) {
      return;
    }
    this.world.camera.getWorldPosition(this.head);

    for (const portal of this.queries.portals.entities) {
      const age = (portal.getValue(Portal, 'age') ?? 0) + delta;
      const duration = portal.getValue(Portal, 'duration') ?? 1.4;
      portal.setValue(Portal, 'age', age);
      const u = age / duration;
      // Snap open, hold, then pinch shut.
      const open = u < 0.2 ? u / 0.2 : u > 0.75 ? Math.max(0, (1 - u) / 0.25) : 1;
      portal.object3D?.scale.setScalar(Math.max(0.01, open));
      if (u >= 1) portal.dispose({ disposeResources: false });
    }

    for (const ninja of this.queries.ninjas.entities) {
      const object = ninja.object3D;
      if (object == null) continue;
      const phase = ninja.getValue(Ninja, 'phase');
      const timer = (ninja.getValue(Ninja, 'timer') ?? 0) + delta;
      ninja.setValue(Ninja, 'timer', timer);
      const o = ninja.getVectorView(Ninja, 'origin');
      const n = ninja.getVectorView(Ninja, 'normal');
      this.origin.set(o[0], o[1], o[2]);
      this.normal.set(n[0], n[1], n[2]);

      if (phase === NinjaPhase.Emerging) {
        const u = Math.min(1, timer / EMERGE_TIME);
        object.position.copy(this.origin).addScaledVector(this.normal, 0.3 * u);
        object.scale.setScalar(0.2 + 0.8 * u);
        object.lookAt(this.head);
        if (u >= 1) this.setPhase(ninja, NinjaPhase.Crouching);
      } else if (phase === NinjaPhase.Crouching) {
        const u = Math.min(1, timer / CROUCH_TIME);
        object.scale.set(1, 1 - 0.25 * Math.sin(u * Math.PI), 1);
        object.lookAt(this.head);
        if (u >= 1) {
          // Lock the strike point at takeoff so the player can dodge by leaning.
          this.target.copy(this.head).sub(object.position).normalize();
          this.target.multiplyScalar(-STRIKE_DISTANCE).add(this.head);
          this.target.y -= 0.15;
          ninja.getVectorView(Ninja, 'target').set([this.target.x, this.target.y, this.target.z]);
          ninja.getVectorView(Ninja, 'origin').set([object.position.x, object.position.y, object.position.z]);
          this.setPhase(ninja, NinjaPhase.Leaping);
        }
      } else if (phase === NinjaPhase.Leaping) {
        const duration = ninja.getValue(Ninja, 'leapDuration') ?? 2;
        const height = ninja.getValue(Ninja, 'arcHeight') ?? 0.5;
        const t = ninja.getVectorView(Ninja, 'target');
        this.target.set(t[0], t[1], t[2]);
        const u = Math.min(1, timer / duration);
        object.position.lerpVectors(this.origin, this.target, u);
        object.position.y += height * 4 * u * (1 - u);
        object.scale.setScalar(1);
        object.lookAt(this.head);
        // A little tumble sells the jump.
        object.rotateZ(Math.sin(time * 9) * 0.15);
        if (u >= 1) {
          this.game?.onPlayerHit();
          ninja.dispose({ disposeResources: false });
        }
      } else if (phase === NinjaPhase.Defeated) {
        const u = Math.min(1, timer / DEFEAT_TIME);
        object.scale.setScalar(Math.max(0.01, 1 - u));
        object.rotateY(delta * 25);
        object.position.y -= delta * 0.6;
        if (u >= 1) ninja.dispose({ disposeResources: false });
      }
    }
  }

  private setPhase(ninja: Entity, phase: (typeof NinjaPhase)[keyof typeof NinjaPhase]): void {
    ninja.setValue(Ninja, 'phase', phase);
    ninja.setValue(Ninja, 'timer', 0);
  }
}
