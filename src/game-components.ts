import { createComponent, Types } from '@iwsdk/core';

export const NinjaPhase = {
  Running: 'Running',
  Leaping: 'Leaping',
  Defeated: 'Defeated',
} as const;

/**
 * A shadow ninja that sprints out of the fog along the floor, then leaps at
 * the player once inside striking range. Positions are world space.
 */
export const Ninja = createComponent('Ninja', {
  phase: { type: Types.Enum, default: NinjaPhase.Running, enum: NinjaPhase },
  timer: { type: Types.Float32, default: 0 },
  /** Ground speed while running, m/s. */
  speed: { type: Types.Float32, default: 12 },
  leapDuration: { type: Types.Float32, default: 0.6 },
  arcHeight: { type: Types.Float32, default: 0.25 },
  /** Leap start; written at takeoff. */
  origin: { type: Types.Vec3, default: [0, 0.84, -3] },
  /** Running: floor point to run at. Leaping: strike point in front of the face. */
  target: { type: Types.Vec3, default: [0, 0.84, 0] },
});

/** A thrown star. Moves in a straight line and expires after `life`. */
export const Shuriken = createComponent('Shuriken', {
  velocity: { type: Types.Vec3, default: [0, 0, -10] },
  life: { type: Types.Float32, default: 1.5 },
});

export const BossPhase = {
  Circling: 'Circling',
  Windup: 'Windup',
  Striking: 'Striking',
  Defeated: 'Defeated',
} as const;

/**
 * The samurai boss. Circles the player around the room, takes several hits,
 * and if still standing when `attackAt` runs out, raises his sword and cuts
 * the player down. Angles are around `center`, world space.
 */
export const Boss = createComponent('Boss', {
  phase: { type: Types.Enum, default: BossPhase.Circling, enum: BossPhase },
  /** Seconds in the current phase. */
  timer: { type: Types.Float32, default: 0 },
  /** Seconds since the fight began. */
  clock: { type: Types.Float32, default: 0 },
  /** The fight's time limit in seconds; the windup starts when it runs out. */
  attackAt: { type: Types.Float32, default: 30 },
  hp: { type: Types.Int16, default: 8 },
  maxHp: { type: Types.Int16, default: 8 },
  /** Orbit angle (radians) and angular velocity (radians/s, signed). */
  angle: { type: Types.Float32, default: 0 },
  spin: { type: Types.Float32, default: 0.7 },
  /** Orbit radius the circling settles around, meters. */
  radius: { type: Types.Float32, default: 2.6 },
  /** Seconds until the next change of direction. */
  turnIn: { type: Types.Float32, default: 4 },
  /** Seconds of hit flash left. */
  flash: { type: Types.Float32, default: 0 },
  center: { type: Types.Vec3, default: [0, 0, 0] },
  /** Current ground velocity, for aim assist. */
  velocity: { type: Types.Vec3, default: [0, 0, 0] },
  /** Strike: lunge start and end. */
  origin: { type: Types.Vec3, default: [0, 1, -3] },
  target: { type: Types.Vec3, default: [0, 1, 0] },
});
