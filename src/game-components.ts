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
