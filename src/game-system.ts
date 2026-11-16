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
import { Boss, BossPhase, Ninja, NinjaPhase } from './game-components.js';
import { Hud, MistVeil } from './hud.js';
import { Flames } from './flame.js';
import { Lightning } from './lightning.js';
import { setMistRed } from './mist.js';
import { RUN_WAIST_HEIGHT } from './scene-assets/ninja-model.js';
import { createNinja } from './scene-assets/ninja.scene-asset.js';
import { createSamuraiModel, SAMURAI_WAIST_HEIGHT } from './scene-assets/samurai-model.js';

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

/** A samurai boss follows every this many waves. */
const BOSS_EVERY = 3;
const BOSS_BANNER = 'SAMURAI';
/** First boss: hits to defeat and seconds before he attacks. Later ones get tougher. */
const BOSS_HP = 8;
const BOSS_HP_STEP = 2;
const BOSS_TIME = 30;
const BOSS_TIME_STEP = 3;
const BOSS_MIN_TIME = 20;
const BOSS_HIT_SCORE = 100;
const BOSS_DEFEAT_SCORE = 1000;
/** Seconds of the samurai's death to show before the next transition starts. */
const BOSS_DEATH_HOLD = 1.8;
/** Ninjas to clear per wave, plus more after each samurai falls. */
const WAVE_SIZE = 8;
const WAVE_SIZE_STEP = 2;

// When the player falls the wall mist bleeds red where it stands, ringing
// the game-over panel; no surge over the view.
const DEATH_RED = [0, 1.2] as const;
/** After a restart the red drains back out of the mist over this long. */
const RED_DRAIN_SECONDS = 1.5;

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
  bosses: { required: [Boss] },
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
  /** Death strikes, shared with BossSystem. */
  readonly lightning = new Lightning();
  /** Ninja death flames. */
  private flames = new Flames();
  private flameBase = new Vector3();

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
  /** Seconds to hold before a pending transition's mist starts rolling. */
  private transitionDelay = 0;
  /** What the current transition leads into, and the banner announcing it. */
  private nextIsBoss = false;
  private bannerText = '';
  /** True while the samurai fight is on instead of a ninja wave. */
  private bossRound = false;
  private bossesBeaten = 0;
  /** Seconds since the player fell, or -1. */
  private deathTime = -1;
  private red = 0;
  private samuraiPrototype = createSamuraiModel();

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
    this.world.createTransformEntity(this.lightning.group);
    this.world.createTransformEntity(this.flames.group);
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
    if (import.meta.env.DEV) {
      // Dev-only: B during a ninja wave skips straight to the samurai.
      const onKey = (event: KeyboardEvent) => {
        if (event.code !== 'KeyB' || this.phase !== GamePhase.Playing || this.bossRound) return;
        for (const ninja of this.queries.ninjas.entities) ninja.dispose({ disposeResources: false });
        this.startTransition(true);
      };
      window.addEventListener('keydown', onKey);
      this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));
    }
    this.showMenu();
  }

  update(delta: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) {
      return;
    }
    this.phaseTime += delta;
    this.time += delta;
    this.lightning.update(delta);
    this.world.camera.getWorldPosition(this.head);
    this.flames.update(delta, this.head);
    this.updatePanelPlacement(delta);

    // The forest stays up through game over, ringed in red mist.
    const revealTarget = this.phase === GamePhase.Menu ? 0 : 1;
    const step = delta / REVEAL_SECONDS;
    this.reveal = revealTarget > this.reveal
      ? Math.min(revealTarget, this.reveal + step)
      : Math.max(revealTarget, this.reveal - step);
    this.updateTransition(delta);

    if (this.phase !== GamePhase.Playing) return;
    if (this.bossRound) {
      this.updateBossHud();
      return;
    }

    this.spawnTimer -= delta;
    if (this.toSpawn > 0 && this.spawnTimer <= 0 && this.queries.ninjas.entities.size < this.maxConcurrent()) {
      this.spawnNinja();
      this.toSpawn--;
      this.spawnTimer = Math.max(0.5, 1.6 - this.wave * 0.12) * (0.7 + Math.random() * 0.6);
      // Never end the wave on the frame its last ninja appears.
      return;
    }
    // The wave is over only once its last ninja is gone.
    if (this.toSpawn === 0 && this.queries.ninjas.entities.size === 0) {
      this.startTransition(this.wave % BOSS_EVERY === 0);
    }
  }

  /** Mist over everything, announce what comes next, then let it sink. */
  private startTransition(toBoss: boolean, delay = 0): void {
    this.setPhase(GamePhase.Intermission);
    this.transition = 0;
    this.transitionDelay = delay;
    this.nextIsBoss = toBoss;
    this.bannerText = toBoss ? BOSS_BANNER : `WAVE ${this.wave + 1}`;
  }

  private updateTransition(delta: number): void {
    let veil = 0;
    let banner = 0;
    if (this.transitionDelay > 0) {
      this.transitionDelay -= delta;
    } else if (this.transition >= 0) {
      const t = (this.transition += delta);
      veil = smoothstep(VEIL_RISE[0], VEIL_RISE[1], t) * (1 - smoothstep(VEIL_FALL[0], VEIL_FALL[1], t));
      banner = smoothstep(BANNER_IN[0], BANNER_IN[1], t) * (1 - smoothstep(BANNER_OUT[0], BANNER_OUT[1], t));
      if (this.phase === GamePhase.Intermission && t >= NEXT_WAVE_AT) {
        if (this.nextIsBoss) this.beginBoss();
        else this.beginWave(this.wave + 1);
      }
      if (t >= VEIL_FALL[1]) this.transition = -1;
    }
    if (this.deathTime >= 0) {
      const t = (this.deathTime += delta);
      this.red = Math.max(this.red, smoothstep(DEATH_RED[0], DEATH_RED[1], t));
    } else {
      this.red = Math.max(0, this.red - delta / RED_DRAIN_SECONDS);
    }
    setMistRed(this.red);
    this.environment.update(this.time, this.reveal, veil);
    this.veil.update(this.time, veil);
    this.hud.showBanner(this.bannerText, banner);
  }

  /** Called by BossSystem when a star lands on the samurai. */
  onBossHit(): void {
    this.score += BOSS_HIT_SCORE;
    this.refreshHud();
  }

  /** Called by BossSystem on the final hit. */
  onBossDefeated(): void {
    if (this.phase !== GamePhase.Playing) return;
    this.score += BOSS_HIT_SCORE + BOSS_DEFEAT_SCORE;
    this.bossesBeaten++;
    this.bossRound = false;
    this.hud.setBoss(null);
    this.refreshHud();
    // Let his death play out in clear air before the mist rolls in.
    this.startTransition(false, BOSS_DEATH_HOLD);
  }

  /** Called by BossSystem when the cut lands: every remaining life is lost. */
  onBossStrike(): void {
    if (this.phase !== GamePhase.Playing) return;
    this.lives = 0;
    this.refreshHud();
    this.endGame('Cut down by the samurai');
  }

  /** Called by ThrowSystem. */
  onNinjaDefeated(position: Vector3, distanceToPlayer: number): void {
    // It evaporates where it stands into an S of spirit flame.
    this.flameBase.set(position.x, Math.max(0, position.y - RUN_WAIST_HEIGHT), position.z);
    this.flames.ignite(this.flameBase);
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
    this.bossRound = false;
    this.bossesBeaten = 0;
    this.deathTime = -1;
    this.hud.setBoss(null);
    // A samurai left standing over the last game leaves with it.
    for (const boss of this.queries.bosses.entities) boss.dispose({ disposeResources: false });
    this.openEnvironment();
    // The forest grows in behind the first mist surge, which announces wave 1.
    this.startTransition(false);
    this.refreshHud();
    this.setPanelVisible(false);
    this.hud.setVisible(true);
    this.startButton?.setProperties({ display: 'none' });
    this.titleText?.setProperties({ display: 'none' });
  }

  private beginWave(wave: number): void {
    this.wave = wave;
    this.toSpawn = WAVE_SIZE + this.bossesBeaten * WAVE_SIZE_STEP;
    this.spawnTimer = FIRST_SPAWN_DELAY;
    this.setPhase(GamePhase.Playing);
    this.refreshHud();
  }

  /** The samurai steps out of the mist and starts circling. */
  private beginBoss(): void {
    this.bossRound = true;
    this.setPhase(GamePhase.Playing);
    this.readHead();
    const origin = this.environment.origin;
    const object = this.samuraiPrototype.clone();
    // Start straight ahead so his entrance is seen.
    const angle = Math.atan2(this.forward.x, this.forward.z);
    object.position.set(origin.x + Math.sin(angle) * 8, SAMURAI_WAIST_HEIGHT, origin.z + Math.cos(angle) * 8);
    const maxHp = BOSS_HP + this.bossesBeaten * BOSS_HP_STEP;
    const boss = this.world.createTransformEntity(object);
    boss.addComponent(Boss, {
      phase: BossPhase.Circling,
      hp: maxHp,
      maxHp,
      attackAt: Math.max(BOSS_MIN_TIME, BOSS_TIME - this.bossesBeaten * BOSS_TIME_STEP),
      angle,
      spin: (Math.random() < 0.5 ? -1 : 1) * 0.55,
      // Inside the walls so he is seen, weaving out into the mist.
      radius: Math.min(3.4, Math.max(1.8, this.environment.roomRadius - 0.5)),
      turnIn: 3 + Math.random() * 2,
    });
    boss.getVectorView(Boss, 'center').set([origin.x, 0, origin.z]);
    this.refreshHud();
    this.updateBossHud();
  }

  private bossEntity() {
    for (const boss of this.queries.bosses.entities) {
      if (boss.getValue(Boss, 'phase') !== BossPhase.Defeated) return boss;
    }
    return undefined;
  }

  private updateBossHud(): void {
    const boss = this.bossEntity();
    if (boss == null) return;
    const attackAt = boss.getValue(Boss, 'attackAt') ?? 30;
    const clock = boss.getValue(Boss, 'clock') ?? 0;
    this.hud.setBoss({
      hp: boss.getValue(Boss, 'hp') ?? 0,
      maxHp: boss.getValue(Boss, 'maxHp') ?? 1,
      timeLeft: Math.max(0, 1 - clock / attackAt),
    });
  }

  private endGame(title = 'The shadows win'): void {
    this.setPhase(GamePhase.GameOver);
    this.transition = -1;
    this.transitionDelay = 0;
    this.deathTime = 0;
    this.bossRound = false;
    this.hud.setBoss(null);
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
    this.setStatus(`Score ${this.score} on wave ${this.wave}. Best ${this.best}`);
    this.titleText?.setProperties({ display: 'flex', text: title });
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
