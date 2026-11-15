import {
  createSystem,
  Matrix4,
  UIKit,
  UIKitMLAsset,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import { BambooForest, LANE_AZIMUTHS, type WallSegment } from './bamboo-forest.js';
import { Ninja, NinjaPhase } from './game-components.js';
import { Hud, MistVeil } from './hud.js';
import { RUN_WAIST_HEIGHT } from './scene-assets/ninja-model.js';
import { createNinja } from './scene-assets/ninja.scene-asset.js';

export const GamePhase = {
  Menu: 'Menu',
  Playing: 'Playing',
  Intermission: 'Intermission',
  GameOver: 'GameOver',
} as const;
export type GamePhase = (typeof GamePhase)[keyof typeof GamePhase];

const STARTING_LIVES = 3;
const BEST_SCORE_KEY = 'shadow-dojo.best';
/** Walls further than this from the player are ignored (other rooms, bad scans). */
const MAX_WALL_DISTANCE = 8;
/** Runners start at the back of the bamboo, hidden until they close in. */
const SPAWN_RADIUS_MIN = 15;
const SPAWN_RADIUS_MAX = 17;
const REVEAL_SECONDS = 2;
// Between waves the mist rolls over everything, the next wave is announced,
// then it sinks back to the walls. Seconds from the start of the transition:
const VEIL_RISE = [0.4, 1.6] as const;
const VEIL_FALL = [2.6, 4.0] as const;
const BANNER_IN = [1.2, 1.6] as const;
const BANNER_OUT = [2.4, 2.8] as const;
/** The next wave starts while the mist is still sinking... */
const NEXT_WAVE_AT = 2.8;
/** ...and its first runner leaves the bamboo once the view is clear. */
const FIRST_SPAWN_DELAY = 1.6;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The WebXR plane object held by the XRPlane component. */
type DetectedPlane = { orientation?: string; polygon: DOMPointReadOnly[] };

/**
 * Owns the round loop: menu → waves → game over. At round start a bamboo
 * forest fades in all around the room, beyond the real walls found by scene
 * understanding, with mist pooled along the floor and walls; ninjas sprint
 * out of it.
 */
export class GameSystem extends createSystem({
  planes: { required: [XRPlane] },
  ninjas: { required: [Ninja] },
}) {
  phase: GamePhase = GamePhase.Menu;
  score = 0;
  lives = STARTING_LIVES;
  wave = 0;
  best = 0;
  /** Seconds since the current phase began; throws are ignored briefly after Start. */
  phaseTime = 0;
  readonly environment = new BambooForest();
  readonly hud = new Hud();
  readonly veil = new MistVeil();

  private toSpawn = 0;
  private spawnTimer = 0;
  private panelPlacementDelay = -1;
  private reveal = 0;
  private ninjaPrototype = createNinja();

  private head = new Vector3();
  private forward = new Vector3();
  private point = new Vector3();
  private tangent = new Vector3();
  private normal = new Vector3();
  private planeOrigin = new Vector3();
  private planeMatrix = new Matrix4();
  private time = 0;
  /** Seconds into the between-wave mist transition, or -1 when none. */
  private transition = -1;

  private panelEntity?: ReturnType<GameSystem['world']['getSceneEntity']>;
  private titleText?: UIKit.Text;
  private statusText?: UIKit.Text;
  private startButton?: ReturnType<UIKitMLAsset['getElementById']>;

  init(): void {
    try {
      this.best = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0) || 0;
    } catch {
      this.best = 0;
    }
    this.world.createTransformEntity(this.environment.group);
    this.environment.update(0, 0);
    // Head-locked: the HUD strip, wave banner and veil ride on the camera.
    const camera = this.world.camera;
    camera.add(this.hud.group, this.veil.mesh);
    this.cleanupFuncs.push(() => camera.remove(this.hud.group, this.veil.mesh));
    // Passthrough stays clear above the mist: no scene-wide fog.
    this.world.scene.fog = null;

    const panel = this.world.getSceneObject<UIKitMLAsset>('hud-panel');
    this.panelEntity = this.world.getSceneEntity('hud-panel');
    if (panel != null) {
      this.titleText = panel.getElementById<UIKit.Text>('title') ?? undefined;
      this.statusText = panel.getElementById<UIKit.Text>('status') ?? undefined;
      this.startButton = panel.getElementById('start-button') ?? undefined;
      const xrButton = panel.getElementById('xr-button');
      const onStart = () => this.startGame();
      const onEnterXR = () => this.world.launchXR();
      this.startButton?.addEventListener('click', onStart);
      xrButton?.addEventListener('click', onEnterXR);
      this.cleanupFuncs.push(
        () => this.startButton?.removeEventListener('click', onStart),
        () => xrButton?.removeEventListener('click', onEnterXR),
        this.world.visibilityState.subscribe((state) => {
          const is2D = state === VisibilityState.NonImmersive;
          xrButton?.setProperties({
            display: is2D && this.world.xrEnabled ? 'flex' : 'none',
          });
          // The XR head pose lands a few frames after the session starts.
          if (!is2D) this.panelPlacementDelay = 0.3;
        }),
      );
    }
    this.showMenu();
  }

  update(delta: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) {
      return;
    }
    this.phaseTime += delta;
    this.time += delta;
    this.updatePanelPlacement(delta);

    const revealTarget =
      this.phase === GamePhase.Playing || this.phase === GamePhase.Intermission ? 1 : 0;
    const step = delta / REVEAL_SECONDS;
    this.reveal = revealTarget > this.reveal
      ? Math.min(revealTarget, this.reveal + step)
      : Math.max(revealTarget, this.reveal - step);
    this.updateTransition(delta);

    if (this.phase !== GamePhase.Playing) return;

    this.spawnTimer -= delta;
    const alive = this.queries.ninjas.entities.size;
    if (this.toSpawn > 0 && this.spawnTimer <= 0 && alive < this.maxConcurrent()) {
      this.spawnNinja();
      this.toSpawn--;
      this.spawnTimer = Math.max(0.5, 1.6 - this.wave * 0.12) * (0.7 + Math.random() * 0.6);
    }
    if (this.toSpawn === 0 && alive === 0) {
      this.startTransition();
    }
  }

  /** Mist over everything, announce the next wave, then let it sink. */
  private startTransition(): void {
    this.setPhase(GamePhase.Intermission);
    this.transition = 0;
  }

  private updateTransition(delta: number): void {
    let veil = 0;
    let banner = 0;
    if (this.transition >= 0) {
      const t = (this.transition += delta);
      veil = smoothstep(VEIL_RISE[0], VEIL_RISE[1], t) * (1 - smoothstep(VEIL_FALL[0], VEIL_FALL[1], t));
      banner = smoothstep(BANNER_IN[0], BANNER_IN[1], t) * (1 - smoothstep(BANNER_OUT[0], BANNER_OUT[1], t));
      if (this.phase === GamePhase.Intermission && t >= NEXT_WAVE_AT) this.beginWave(this.wave + 1);
      if (t >= VEIL_FALL[1]) this.transition = -1;
    }
    this.environment.update(this.time, this.reveal, veil);
    this.veil.update(this.time, veil);
    this.hud.showBanner(`WAVE ${this.wave + (this.phase === GamePhase.Intermission ? 1 : 0)}`, banner);
  }

  /** Called by ThrowSystem. */
  onNinjaDefeated(distanceToPlayer: number): void {
    // Picking one off while it's still deep in the mist pays extra.
    const bonus = distanceToPlayer > 6 ? 50 : 0;
    this.score += 100 + bonus;
    this.refreshHud();
  }

  /** Called by NinjaSystem when a leap reaches the player. */
  onPlayerHit(): void {
    if (this.phase !== GamePhase.Playing) return;
    this.lives--;
    this.refreshHud();
    if (this.lives <= 0) this.endGame();
  }

  /** Attack leap duration in seconds for the current wave. */
  leapDuration(): number {
    return Math.max(0.45, 0.75 - this.wave * 0.04);
  }

  /** Ground sprint speed in m/s for the current wave. */
  runSpeed(): number {
    return Math.min(20, 9 + this.wave * 1.5);
  }

  private maxConcurrent(): number {
    return Math.min(5, 1 + Math.ceil(this.wave / 2));
  }

  private startGame(): void {
    if (this.phase === GamePhase.Playing || this.phase === GamePhase.Intermission) {
      return;
    }
    this.score = 0;
    this.lives = STARTING_LIVES;
    this.wave = 0;
    this.openEnvironment();
    // The forest grows in behind the first mist surge, which announces wave 1.
    this.startTransition();
    this.refreshHud();
    this.setPanelVisible(false);
    this.hud.setVisible(true);
    this.startButton?.setProperties({ display: 'none' });
    this.titleText?.setProperties({ display: 'none' });
  }

  private beginWave(wave: number): void {
    this.wave = wave;
    this.toSpawn = 3 + wave * 2;
    this.spawnTimer = FIRST_SPAWN_DELAY;
    this.setPhase(GamePhase.Playing);
    this.refreshHud();
  }

  private endGame(): void {
    this.setPhase(GamePhase.GameOver);
    this.transition = -1;
    for (const ninja of this.queries.ninjas.entities) {
      ninja.setValue(Ninja, 'phase', NinjaPhase.Defeated);
      ninja.setValue(Ninja, 'timer', 0);
    }
    if (this.score > this.best) {
      this.best = this.score;
      try {
        localStorage.setItem(BEST_SCORE_KEY, String(this.best));
      } catch {
        // Storage can be unavailable in private sessions; the best score is a nicety.
      }
    }
    this.setStatus(`Defeated on wave ${this.wave}. Best ${this.best}`);
    this.titleText?.setProperties({ display: 'flex', text: 'The shadows win' });
    this.startButton?.setProperties({ display: 'flex' });
    this.setPanelVisible(true);
    this.placePanel(0.85, -0.12);
  }

  private showMenu(): void {
    this.setPhase(GamePhase.Menu);
    this.setStatus('Shadows gather in the bamboo around you. Point and pinch to throw.');
    this.refreshHud();
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase;
    this.phaseTime = 0;
  }

  private setStatus(text: string): void {
    this.statusText?.setProperties({ text });
  }

  private refreshHud(): void {
    this.hud.set(this.score, this.wave, this.lives);
  }

  /** The menu panel is only for menus; the round uses the head-locked HUD. */
  private setPanelVisible(visible: boolean): void {
    const object = this.panelEntity?.object3D;
    if (object != null) object.visible = visible;
  }

  private updatePanelPlacement(delta: number): void {
    if (this.panelPlacementDelay < 0) return;
    this.panelPlacementDelay -= delta;
    if (this.panelPlacementDelay >= 0) return;
    this.placePanel(0.85, -0.12);
  }

  /** Put the panel in front of the head, `down` meters below eye level, facing it. */
  private placePanel(distance: number, down: number): void {
    const object = this.panelEntity?.object3D;
    if (object == null) return;
    this.readHead();
    object.position.copy(this.head).addScaledVector(this.forward, distance);
    object.position.y += down;
    object.lookAt(this.head);
  }

  /** World-space head position and its horizontal forward direction. */
  private readHead(): void {
    const camera = this.world.camera;
    camera.getWorldPosition(this.head);
    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, -1);
    this.forward.normalize();
  }

  /** Grow the forest around the room and switch on its mist. */
  private openEnvironment(): void {
    this.readHead();
    this.environment.place(this.head, this.forward, this.wallSegments());
  }

  /**
   * Floor-level footprint of each detected wall near the player, as a
   * segment between its two horizontal extremes.
   */
  private wallSegments(): WallSegment[] {
    const walls: WallSegment[] = [];
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as DetectedPlane | undefined;
      const object = entity.object3D;
      if (plane?.orientation !== 'vertical' || object == null || plane.polygon.length < 2) continue;

      object.updateWorldMatrix(true, false);
      this.planeMatrix.copy(object.matrixWorld);
      this.planeOrigin.setFromMatrixPosition(this.planeMatrix);
      // WebXR planes use local +Y as the surface normal; the wall runs along
      // the horizontal direction perpendicular to it.
      this.normal.setFromMatrixColumn(this.planeMatrix, 1).setY(0);
      if (this.normal.lengthSq() < 1e-4) continue;
      this.normal.normalize();
      this.point.subVectors(this.head, this.planeOrigin);
      if (Math.abs(this.point.dot(this.normal)) > MAX_WALL_DISTANCE) continue;
      this.tangent.set(-this.normal.z, 0, this.normal.x);

      let min = Infinity;
      let max = -Infinity;
      for (const p of plane.polygon) {
        this.point.set(p.x, p.y, p.z).applyMatrix4(this.planeMatrix).sub(this.planeOrigin);
        const along = this.point.dot(this.tangent);
        min = Math.min(min, along);
        max = Math.max(max, along);
      }
      if (max - min < 0.3) continue;
      walls.push({
        a: this.planeOrigin.clone().addScaledVector(this.tangent, min).setY(0),
        b: this.planeOrigin.clone().addScaledVector(this.tangent, max).setY(0),
      });
    }
    return walls;
  }

  /** Start a runner at the back of the forest. */
  private spawnNinja(): void {
    this.readHead();
    // Come down one of the paths kept clear through the bamboo.
    const lane = LANE_AZIMUTHS[Math.floor(Math.random() * LANE_AZIMUTHS.length)];
    const azimuth = lane + (Math.random() - 0.5) * 0.02;
    const radius = SPAWN_RADIUS_MIN + Math.random() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);
    this.environment.pointAt(azimuth, radius, this.point).setY(RUN_WAIST_HEIGHT);

    const object = this.ninjaPrototype.clone();
    object.position.copy(this.point);
    const ninja = this.world.createTransformEntity(object);
    ninja.addComponent(Ninja, {
      phase: NinjaPhase.Running,
      timer: Math.random(),
      speed: this.runSpeed() * (0.9 + Math.random() * 0.2),
      leapDuration: this.leapDuration(),
      arcHeight: 0.15 + Math.random() * 0.2,
    });
    // Run at the spot on the floor beneath the player's head.
    ninja.getVectorView(Ninja, 'target').set([this.head.x, RUN_WAIST_HEIGHT, this.head.z]);
  }
}
