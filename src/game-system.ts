import {
  createSystem,
  Fog,
  Matrix4,
  UIKit,
  UIKitMLAsset,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import { FOG_COLOR, FogBreach } from './fog-breach.js';
import { Ninja, NinjaPhase } from './game-components.js';
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
/** Walls further than this off the facing direction can't host the breach. */
const BREACH_MAX_ANGLE = (50 * Math.PI) / 180;
const BREACH_MAX_WIDTH = 3.2;
const BREACH_MAX_HEIGHT = 2.6;
/** Ninjas start this far behind the wall, beyond the fog's far distance. */
const SPAWN_DEPTH_MIN = 26;
const SPAWN_DEPTH_MAX = 32;
/** Scene fog ramps from clear to solid across this span behind the wall. */
const FOG_NEAR_PAST_WALL = 1;
const FOG_FAR_PAST_WALL = 22;
const FOG_FADE_SECONDS = 1.5;

/** The WebXR plane object held by the XRPlane component. */
type DetectedPlane = { orientation?: string; polygon: DOMPointReadOnly[] };

/**
 * Owns the round loop: menu → waves → game over. At round start the real wall
 * the player faces (from scene understanding) dissolves into a fog breach;
 * ninjas sprint out of it. Falls back to a free-standing breach when the room
 * has no suitable wall.
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
  readonly breach = new FogBreach();

  private toSpawn = 0;
  private spawnTimer = 0;
  private panelPlacementDelay = -1;
  private fogOpacity = 0;
  private fog = new Fog(FOG_COLOR, 50, 80);
  private ninjaPrototype = createNinja();

  private head = new Vector3();
  private forward = new Vector3();
  private point = new Vector3();
  private normal = new Vector3();
  private tangent = new Vector3();
  private planeOrigin = new Vector3();
  private planeMatrix = new Matrix4();

  private panelEntity?: ReturnType<GameSystem['world']['getSceneEntity']>;
  private titleText?: UIKit.Text;
  private statusText?: UIKit.Text;
  private scoreText?: UIKit.Text;
  private livesText?: UIKit.Text;
  private startButton?: ReturnType<UIKitMLAsset['getElementById']>;

  init(): void {
    try {
      this.best = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0) || 0;
    } catch {
      this.best = 0;
    }
    this.world.createTransformEntity(this.breach.group);
    this.breach.update(0, 0);

    const panel = this.world.getSceneObject<UIKitMLAsset>('hud-panel');
    this.panelEntity = this.world.getSceneEntity('hud-panel');
    if (panel != null) {
      this.titleText = panel.getElementById<UIKit.Text>('title') ?? undefined;
      this.statusText = panel.getElementById<UIKit.Text>('status') ?? undefined;
      this.scoreText = panel.getElementById<UIKit.Text>('score') ?? undefined;
      this.livesText = panel.getElementById<UIKit.Text>('lives') ?? undefined;
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
    this.cleanupFuncs.push(() => {
      if (this.world.scene.fog === this.fog) this.world.scene.fog = null;
    });
    this.showMenu();
  }

  update(delta: number, time: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) {
      return;
    }
    this.phaseTime += delta;
    this.updatePanelPlacement(delta);

    const fogTarget =
      this.phase === GamePhase.Playing || this.phase === GamePhase.Intermission ? 1 : 0;
    const step = delta / FOG_FADE_SECONDS;
    this.fogOpacity = fogTarget > this.fogOpacity
      ? Math.min(fogTarget, this.fogOpacity + step)
      : Math.max(fogTarget, this.fogOpacity - step);
    this.breach.update(time, this.fogOpacity);

    if (this.phase === GamePhase.Intermission && this.phaseTime > 2.2) {
      this.beginWave(this.wave + 1);
      return;
    }
    if (this.phase !== GamePhase.Playing) return;

    this.spawnTimer -= delta;
    const alive = this.queries.ninjas.entities.size;
    if (this.toSpawn > 0 && this.spawnTimer <= 0 && alive < this.maxConcurrent()) {
      this.spawnNinja();
      this.toSpawn--;
      this.spawnTimer = Math.max(0.5, 1.6 - this.wave * 0.12) * (0.7 + Math.random() * 0.6);
    }
    if (this.toSpawn === 0 && alive === 0) {
      this.setPhase(GamePhase.Intermission);
      this.setStatus(`Wave ${this.wave} cleared`);
    }
  }

  /** Called by ThrowSystem. */
  onNinjaDefeated(distanceToPlayer: number): void {
    // Picking one off while it's still deep in the fog pays extra.
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
    return Math.min(18, 10 + this.wave * 1.3);
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
    this.openBreach();
    this.beginWave(1);
    // Let the wall dissolve before the first runner appears.
    this.spawnTimer = FOG_FADE_SECONDS + 0.5;
    // Park the HUD low in the view so it stays inside a narrow FoV and out of
    // the ninjas' path.
    this.placePanel(1.1, -0.42);
    this.startButton?.setProperties({ display: 'none' });
    this.titleText?.setProperties({ display: 'none' });
  }

  private beginWave(wave: number): void {
    this.wave = wave;
    this.toSpawn = 3 + wave * 2;
    this.spawnTimer = 1;
    this.setPhase(GamePhase.Playing);
    this.setStatus(`Wave ${wave}`);
    this.refreshHud();
  }

  private endGame(): void {
    this.setPhase(GamePhase.GameOver);
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
    this.placePanel(0.85, -0.12);
  }

  private showMenu(): void {
    this.setPhase(GamePhase.Menu);
    this.setStatus('The wall in front of you will dissolve into fog. Point and pinch to throw.');
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
    this.scoreText?.setProperties({ text: `Score ${this.score}` });
    this.livesText?.setProperties({ text: `Lives ${this.lives}` });
  }

  private updatePanelPlacement(delta: number): void {
    if (this.panelPlacementDelay < 0) return;
    this.panelPlacementDelay -= delta;
    if (this.panelPlacementDelay >= 0) return;
    const inRound = this.phase === GamePhase.Playing || this.phase === GamePhase.Intermission;
    this.placePanel(inRound ? 1.1 : 0.85, inRound ? -0.42 : -0.12);
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

  /** Choose where the fog breaks through and set scene fog to match. */
  private openBreach(): void {
    this.readHead();
    if (!this.placeBreachOnWall()) {
      // No usable wall: a free-standing breach a few meters ahead.
      this.point.copy(this.head).addScaledVector(this.forward, 3.5).setY(0);
      this.normal.copy(this.forward).negate();
      this.breach.place(this.point, this.normal, BREACH_MAX_WIDTH, BREACH_MAX_HEIGHT);
    }
    this.point.subVectors(this.head, this.breach.center);
    const wallDistance = Math.max(0.5, this.point.dot(this.breach.normal));
    this.fog.near = wallDistance + FOG_NEAR_PAST_WALL;
    this.fog.far = wallDistance + FOG_FAR_PAST_WALL;
    this.world.scene.fog = this.fog;
  }

  /** Pick the detected wall most squarely in front of the player. */
  private placeBreachOnWall(): boolean {
    let bestScore = Math.cos(BREACH_MAX_ANGLE);
    let found = false;
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as DetectedPlane | undefined;
      const object = entity.object3D;
      if (plane?.orientation !== 'vertical' || object == null) continue;

      object.updateWorldMatrix(true, false);
      this.planeMatrix.copy(object.matrixWorld);
      this.planeOrigin.setFromMatrixPosition(this.planeMatrix);
      // WebXR planes use local +Y as the surface normal; face it into the room.
      this.normal.setFromMatrixColumn(this.planeMatrix, 1).setY(0).normalize();
      this.point.subVectors(this.head, this.planeOrigin);
      let distance = this.point.dot(this.normal);
      if (distance < 0) {
        this.normal.negate();
        distance = -distance;
      }
      if (distance < 1 || distance > 8) continue;
      const facing = -this.normal.dot(this.forward);
      if (facing < bestScore) continue;

      // Extent of the wall along its horizontal tangent and in height.
      this.tangent.set(this.normal.z, 0, -this.normal.x);
      let aMin = Infinity;
      let aMax = -Infinity;
      let yMax = -Infinity;
      for (const p of plane.polygon) {
        this.point.set(p.x, p.y, p.z).applyMatrix4(this.planeMatrix);
        yMax = Math.max(yMax, this.point.y);
        this.point.sub(this.planeOrigin);
        const along = this.point.dot(this.tangent);
        aMin = Math.min(aMin, along);
        aMax = Math.max(aMax, along);
      }
      const width = Math.min(BREACH_MAX_WIDTH, aMax - aMin - 0.2);
      const height = Math.min(BREACH_MAX_HEIGHT, yMax);
      if (width < 1.4 || height < 1.8) continue;

      // Center on the point of the wall straight ahead of the player.
      this.point.subVectors(this.head, this.planeOrigin);
      const headAlong = this.point.dot(this.tangent);
      const along = Math.min(aMax - width / 2, Math.max(aMin + width / 2, headAlong));
      this.point.copy(this.planeOrigin).addScaledVector(this.tangent, along).setY(0);
      this.breach.place(this.point, this.normal, width, height);
      bestScore = facing;
      found = true;
    }
    return found;
  }

  /** Start a runner deep in the fog corridor behind the breach. */
  private spawnNinja(): void {
    this.readHead();
    const breach = this.breach;
    const depth = SPAWN_DEPTH_MIN + Math.random() * (SPAWN_DEPTH_MAX - SPAWN_DEPTH_MIN);
    const lateral = (Math.random() * 2 - 1) * breach.width * 0.3;
    this.point
      .copy(breach.center)
      .addScaledVector(breach.normal, -depth)
      .addScaledVector(breach.tangent, lateral)
      .setY(RUN_WAIST_HEIGHT);

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
