import { createSystem, Entity, Mesh, Object3D, Vector3, VisibilityState } from '@iwsdk/core';
import { Boss, BossPhase } from './game-components.js';
import { GameSystem } from './game-system.js';
import {
  SAMURAI_FRAMES,
  SAMURAI_WAIST_HEIGHT,
  samuraiBodyMaterial,
  samuraiFlashMaterial,
} from './scene-assets/samurai-model.js';

const STEP_A = SAMURAI_FRAMES.indexOf('StepA');
const STEP_B = SAMURAI_FRAMES.indexOf('StepB');
const RAISE = SAMURAI_FRAMES.indexOf('Raise');
const SLASH = SAMURAI_FRAMES.indexOf('Slash');
/** Side-step key frames per second: choppy on purpose, like the ninjas. */
const STEP_FPS = 5;
/** Seconds to walk in out of the mist before the circling settles. */
const ENTRY_TIME = 2.2;
/** How far beyond his orbit he starts. */
const ENTRY_DISTANCE = 4;
/** The orbit breathes in and out by this much, in and out of the mist. */
const WEAVE = 0.7;
const WINDUP_TIME = 1.4;
const STRIKE_TIME = 0.3;
/** He stops this far from the player; the blade covers the rest. */
const STRIKE_DISTANCE = 1.1;
/** Bolts tear out of him one after another, then he evaporates up the last. */
const BARRAGE = 7;
const BARRAGE_GAP = 0.16;
const FINAL_BOLT_AT = BARRAGE * BARRAGE_GAP + 0.1;
const DEFEAT_TIME = FINAL_BOLT_AT + 0.3;
/** After the cut lands he holds it, then is gone, leaving the game-over panel. */
const HOLD_AFTER_CUT = 1.2;
const FLASH_TIME = 0.15;
/** Each hit reverses him and adds this much angular speed. */
const SPIN_PER_HIT = 0.08;

/**
 * The samurai boss: circles the player, weaving through the wall mist,
 * reverses when hit, and when time runs out raises his sword and cuts.
 */
export class BossSystem extends createSystem({
  bosses: { required: [Boss] },
}) {
  private game?: GameSystem;
  private head = new Vector3();
  private previous = new Vector3();
  private toward = new Vector3();
  private look = new Vector3();
  private strikePoint = new Vector3();

  init(): void {
    this.game = this.world.getSystem(GameSystem);
  }

  update(delta: number, time: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) {
      return;
    }
    this.world.camera.getWorldPosition(this.head);

    for (const boss of this.queries.bosses.entities) {
      const object = boss.object3D;
      if (object == null) continue;
      const phase = boss.getValue(Boss, 'phase');
      const timer = (boss.getValue(Boss, 'timer') ?? 0) + delta;
      boss.setValue(Boss, 'timer', timer);

      const flash = Math.max(0, (boss.getValue(Boss, 'flash') ?? 0) - delta);
      boss.setValue(Boss, 'flash', flash);
      this.setFlash(object, flash > 0);

      if (phase === BossPhase.Circling) {
        this.circle(boss, object, delta);
      } else if (phase === BossPhase.Windup) {
        this.windup(boss, object, timer, time);
      } else if (phase === BossPhase.Striking) {
        this.strike(boss, object, timer, delta);
      } else if (phase === BossPhase.Defeated) {
        this.defeated(boss, object, timer, time);
      }
    }
  }

  /** A star landed. Returns true if it counted. */
  hit(boss: Entity): boolean {
    const phase = boss.getValue(Boss, 'phase');
    if (phase !== BossPhase.Circling && phase !== BossPhase.Windup) return false;
    const hp = (boss.getValue(Boss, 'hp') ?? 1) - 1;
    boss.setValue(Boss, 'hp', hp);
    boss.setValue(Boss, 'flash', FLASH_TIME);
    if (hp <= 0) {
      boss.setValue(Boss, 'phase', BossPhase.Defeated);
      boss.setValue(Boss, 'timer', 0);
      boss.setValue(Boss, 'flash', DEFEAT_TIME);
      boss.getVectorView(Boss, 'velocity').fill(0);
      this.strikeBarrage(boss);
      this.game?.onBossDefeated();
      return true;
    }
    // Stung: reverse and quicken.
    const spin = boss.getValue(Boss, 'spin') ?? 0.7;
    boss.setValue(Boss, 'spin', -Math.sign(spin) * (Math.abs(spin) + SPIN_PER_HIT));
    boss.setValue(Boss, 'turnIn', 2 + Math.random() * 3);
    this.game?.onBossHit();
    return true;
  }

  /** Schedule the bolts: a ragged barrage from all over his body, then a big one. */
  private strikeBarrage(boss: Entity): void {
    const object = boss.object3D;
    const lightning = this.game?.lightning;
    if (object == null || lightning == null) return;
    for (let i = 0; i < BARRAGE; i++) {
      this.strikePoint.set(
        object.position.x + (Math.random() - 0.5) * 0.6,
        object.position.y + (Math.random() - 0.4) * 0.9,
        object.position.z + (Math.random() - 0.5) * 0.6,
      );
      lightning.strike(this.strikePoint, { delay: i * BARRAGE_GAP, height: 10 + Math.random() * 6, width: 1.1 });
    }
    this.strikePoint.copy(object.position);
    lightning.strike(this.strikePoint, { delay: FINAL_BOLT_AT, height: 22, width: 2.2 });
  }

  /** Arms flung up, shuddering under the barrage, then pulled up the last bolt. */
  private defeated(boss: Entity, object: Object3D, timer: number, time: number): void {
    this.showFrame(object, RAISE);
    this.faceHead(object);
    object.rotateZ(Math.sin(time * 55) * 0.04);
    object.rotateX(-Math.min(1, timer / FINAL_BOLT_AT) * 0.25);
    const u = Math.max(0, (timer - FINAL_BOLT_AT) / (DEFEAT_TIME - FINAL_BOLT_AT));
    const thin = Math.max(0.01, 1 - u * u);
    object.scale.set(thin, 1 + u * 1.5, thin);
    object.position.y = SAMURAI_WAIST_HEIGHT + u * 0.8;
    if (u >= 1) boss.dispose({ disposeResources: false });
  }

  private circle(boss: Entity, object: Object3D, delta: number): void {
    const clock = (boss.getValue(Boss, 'clock') ?? 0) + delta;
    boss.setValue(Boss, 'clock', clock);

    let spin = boss.getValue(Boss, 'spin') ?? 0.7;
    const turnIn = (boss.getValue(Boss, 'turnIn') ?? 4) - delta;
    if (turnIn <= 0) {
      spin = -spin;
      boss.setValue(Boss, 'spin', spin);
      boss.setValue(Boss, 'turnIn', 2.5 + Math.random() * 3);
    } else {
      boss.setValue(Boss, 'turnIn', turnIn);
    }
    const angle = (boss.getValue(Boss, 'angle') ?? 0) + spin * delta;
    boss.setValue(Boss, 'angle', angle);

    const base = boss.getValue(Boss, 'radius') ?? 2.6;
    let radius = base + WEAVE * Math.sin(clock * 0.9);
    if (clock < ENTRY_TIME) {
      const u = clock / ENTRY_TIME;
      radius += ENTRY_DISTANCE * (1 - u * u * (3 - 2 * u));
    }
    const c = boss.getVectorView(Boss, 'center');
    this.previous.copy(object.position);
    object.position.set(c[0] + Math.sin(angle) * radius, SAMURAI_WAIST_HEIGHT, c[2] + Math.cos(angle) * radius);
    const v = boss.getVectorView(Boss, 'velocity');
    const inv = delta > 0 ? 1 / delta : 0;
    v[0] = (object.position.x - this.previous.x) * inv;
    v[1] = 0;
    v[2] = (object.position.z - this.previous.z) * inv;

    // Always squared up to the player, guard pointed at them.
    const frame = Math.floor(clock * STEP_FPS) % 2 === 0 ? STEP_A : STEP_B;
    this.showFrame(object, frame);
    if (frame === STEP_B) object.position.y += 0.03;
    this.faceHead(object);

    if (clock >= (boss.getValue(Boss, 'attackAt') ?? 30)) {
      boss.setValue(Boss, 'phase', BossPhase.Windup);
      boss.setValue(Boss, 'timer', 0);
      v.fill(0);
      this.showFrame(object, RAISE);
    }
  }

  private windup(boss: Entity, object: Object3D, timer: number, time: number): void {
    // Rooted, trembling with the blade overhead: the last chance to finish him.
    this.faceHead(object);
    object.rotateZ(Math.sin(time * 40) * 0.015);
    if (timer < WINDUP_TIME) return;

    this.toward.set(object.position.x - this.head.x, 0, object.position.z - this.head.z).normalize();
    const target = this.look.copy(this.head).addScaledVector(this.toward, STRIKE_DISTANCE);
    target.y = SAMURAI_WAIST_HEIGHT;
    boss.getVectorView(Boss, 'origin').set([object.position.x, object.position.y, object.position.z]);
    boss.getVectorView(Boss, 'target').set([target.x, target.y, target.z]);
    boss.setValue(Boss, 'phase', BossPhase.Striking);
    boss.setValue(Boss, 'timer', 0);
    this.showFrame(object, SLASH);
  }

  private strike(boss: Entity, object: Object3D, timer: number, delta: number): void {
    const o = boss.getVectorView(Boss, 'origin');
    const t = boss.getVectorView(Boss, 'target');
    const u = Math.min(1, timer / STRIKE_TIME);
    object.position.set(o[0] + (t[0] - o[0]) * u, o[1] + (t[1] - o[1]) * u, o[2] + (t[2] - o[2]) * u);
    this.faceHead(object);
    if (timer >= STRIKE_TIME && timer - delta < STRIKE_TIME) this.game?.onBossStrike();
    if (timer >= STRIKE_TIME + HOLD_AFTER_CUT) boss.dispose({ disposeResources: false });
  }

  private faceHead(object: Object3D): void {
    this.look.set(this.head.x, object.position.y, this.head.z);
    object.lookAt(this.look);
  }

  private showFrame(object: Object3D, frame: number): void {
    const frames = object.children;
    for (let i = 0; i < frames.length; i++) frames[i].visible = i === frame;
  }

  private setFlash(object: Object3D, on: boolean): void {
    const material = on ? samuraiFlashMaterial : samuraiBodyMaterial;
    for (const child of object.children) (child as Mesh).material = material;
  }
}
