import {
  createSystem,
  Entity,
  Matrix4,
  UIKit,
  UIKitMLAsset,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import { Ninja, NinjaPhase, Portal } from './game-components.js';
import { createNinja, createPortal } from './scene-assets/ninja.scene-asset.js';

export const GamePhase = {
  Menu: 'Menu',
  Playing: 'Playing',
  Intermission: 'Intermission',
  GameOver: 'GameOver',
} as const;
export type GamePhase = (typeof GamePhase)[keyof typeof GamePhase];

const STARTING_LIVES = 3;
/** Ninjas only spawn within this yaw of where the player faced at round start. */
const SPAWN_HALF_ANGLE = (65 * Math.PI) / 180;
const WALL_MARGIN = 0.35;
const FALLBACK_RADIUS = 3;
const BEST_SCORE_KEY = 'shadow-dojo.best';

/** The WebXR plane object held by the XRPlane component. */
type DetectedPlane = { orientation?: string; polygon: DOMPointReadOnly[] };

/**
 * Owns the round loop: menu → waves → game over. Picks spawn points on real
 * walls from scene understanding, falling back to a virtual ring when the room
 * has no usable planes (emulator, unscanned room).
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

  private toSpawn = 0;
  private panelPlacementDelay = -1;
  private spawnTimer = 0;
  private ninjaPrototype = createNinja();
  private portalPrototype = createPortal();

  private head = new Vector3();
  private forward = new Vector3();
  private point = new Vector3();
  private normal = new Vector3();
  private toPoint = new Vector3();
  private planeMatrix = new Matrix4();

  private panel?: UIKitMLAsset;
  private panelEntity?: Entity;
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

    this.panel = this.world.getSceneObject<UIKitMLAsset>('hud-panel');
    this.panelEntity = this.world.getSceneEntity('hud-panel');
    if (this.panel != null) {
      this.titleText = this.panel.getElementById<UIKit.Text>('title') ?? undefined;
      this.statusText = this.panel.getElementById<UIKit.Text>('status') ?? undefined;
      this.scoreText = this.panel.getElementById<UIKit.Text>('score') ?? undefined;
      this.livesText = this.panel.getElementById<UIKit.Text>('lives') ?? undefined;
      this.startButton = this.panel.getElementById('start-button') ?? undefined;
      const xrButton = this.panel.getElementById('xr-button');
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
    if (this.panelPlacementDelay >= 0) {
      this.panelPlacementDelay -= delta;
      if (this.panelPlacementDelay < 0) {
        const inRound = this.phase === GamePhase.Playing || this.phase === GamePhase.Intermission;
        this.placePanel(inRound ? 1.1 : 0.85, inRound ? -0.42 : -0.12);
      }
    }

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
      this.spawnTimer = Math.max(0.55, 1.9 - this.wave * 0.15) * (0.7 + Math.random() * 0.6);
    }
    if (this.toSpawn === 0 && alive === 0) {
      this.setPhase(GamePhase.Intermission);
      this.setStatus(`Wave ${this.wave} cleared`);
    }
  }

  /** Called by ShurikenSystem. */
  onNinjaDefeated(distanceToPlayer: number): void {
    // Closer kills are riskier, so they pay a little more.
    const bonus = distanceToPlayer < 1.2 ? 50 : 0;
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

  /** Leap duration in seconds for the current wave. */
  leapDuration(): number {
    return Math.max(1.15, 2.5 - this.wave * 0.13);
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
    this.beginWave(1);
    // Park the HUD low in the view so it stays inside a narrow FoV and out of
    // the ninjas' flight path.
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
    this.setStatus('Ninjas will break through your walls. Point and pinch to throw.');
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

  /** Put the panel in front of the head, `down` meters below eye level, facing it. */
  private placePanel(distance: number, down: number): void {
    const object = this.panelEntity?.object3D;
    if (object == null) return;
    this.readHead();
    object.position
      .copy(this.head)
      .addScaledVector(this.forward, distance);
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

  private spawnNinja(): void {
    this.readHead();
    if (!this.pickWallPoint()) this.pickFallbackPoint();

    const portalObject = this.portalPrototype.clone();
    portalObject.position.copy(this.point).addScaledVector(this.normal, 0.01);
    this.toPoint.copy(portalObject.position).add(this.normal);
    portalObject.lookAt(this.toPoint);
    portalObject.scale.setScalar(0.01);
    const portal = this.world.createTransformEntity(portalObject);
    portal.addComponent(Portal, { age: 0, duration: 1.4 });

    const ninjaObject = this.ninjaPrototype.clone();
    ninjaObject.position.copy(this.point);
    ninjaObject.scale.setScalar(0.2);
    const ninja = this.world.createTransformEntity(ninjaObject);
    ninja.addComponent(Ninja, {
      phase: NinjaPhase.Emerging,
      timer: 0,
      leapDuration: this.leapDuration(),
      arcHeight: 0.35 + Math.random() * 0.35,
      portal,
    });
    ninja.getVectorView(Ninja, 'origin').set([this.point.x, this.point.y, this.point.z]);
    ninja.getVectorView(Ninja, 'normal').set([this.normal.x, this.normal.y, this.normal.z]);
  }

  /** Random point on a detected wall inside the forward spawn cone. */
  private pickWallPoint(): boolean {
    const walls: Entity[] = [];
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as DetectedPlane | undefined;
      if (plane?.orientation === 'vertical' && entity.object3D != null) {
        walls.push(entity);
      }
    }
    if (walls.length === 0) return false;

    for (let attempt = 0; attempt < 12; attempt++) {
      const entity = walls[Math.floor(Math.random() * walls.length)];
      const plane = entity.getValue(XRPlane, '_plane') as DetectedPlane;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of plane.polygon) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      if (maxX - minX < WALL_MARGIN * 2 || maxZ - minZ < WALL_MARGIN * 2) continue;

      entity.object3D!.updateWorldMatrix(true, false);
      this.planeMatrix.copy(entity.object3D!.matrixWorld);
      const x = minX + WALL_MARGIN + Math.random() * (maxX - minX - WALL_MARGIN * 2);
      const z = minZ + WALL_MARGIN + Math.random() * (maxZ - minZ - WALL_MARGIN * 2);
      this.point.set(x, 0, z).applyMatrix4(this.planeMatrix);
      // WebXR planes use local +Y as the surface normal.
      this.normal.setFromMatrixColumn(this.planeMatrix, 1).normalize();

      // Keep emergence near eye height so leaps read clearly.
      if (this.point.y < this.head.y - 0.6 || this.point.y > this.head.y + 0.7) continue;

      this.toPoint.copy(this.point).sub(this.head);
      this.toPoint.y = 0;
      const distance = this.toPoint.length();
      if (distance < 1.2) continue;
      this.toPoint.divideScalar(distance);
      if (Math.acos(Math.min(1, this.toPoint.dot(this.forward))) > SPAWN_HALF_ANGLE) {
        continue;
      }
      // The normal must face into the room, toward the player.
      if (this.normal.dot(this.toPoint) > 0) this.normal.negate();
      return true;
    }
    return false;
  }

  private pickFallbackPoint(): void {
    const yaw = (Math.random() * 2 - 1) * SPAWN_HALF_ANGLE * 0.8;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // Rotate forward around +Y by yaw.
    const dx = this.forward.x * cos + this.forward.z * sin;
    const dz = -this.forward.x * sin + this.forward.z * cos;
    this.point.set(
      this.head.x + dx * FALLBACK_RADIUS,
      this.head.y + (Math.random() - 0.4) * 0.6,
      this.head.z + dz * FALLBACK_RADIUS,
    );
    this.normal.set(-dx, 0, -dz);
  }
}
