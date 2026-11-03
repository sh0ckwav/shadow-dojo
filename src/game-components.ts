import { createComponent, Types } from '@iwsdk/core';

export const NinjaPhase = {
  Emerging: 'Emerging',
  Crouching: 'Crouching',
  Leaping: 'Leaping',
  Defeated: 'Defeated',
} as const;

/**
 * A shadow ninja that steps out of a wall portal, crouches, then leaps on an
 * arc toward the player. Positions are world space.
 */
export const Ninja = createComponent('Ninja', {
  phase: { type: Types.Enum, default: NinjaPhase.Emerging, enum: NinjaPhase },
  timer: { type: Types.Float32, default: 0 },
  leapDuration: { type: Types.Float32, default: 2 },
  arcHeight: { type: Types.Float32, default: 0.5 },
  origin: { type: Types.Vec3, default: [0, 1.4, -3] },
  normal: { type: Types.Vec3, default: [0, 0, 1] },
  target: { type: Types.Vec3, default: [0, 1.2, -0.4] },
  portal: { type: Types.Entity, default: null },
});

/** A thrown star. Moves ballistically-straight and expires after `life`. */
export const Shuriken = createComponent('Shuriken', {
  velocity: { type: Types.Vec3, default: [0, 0, -10] },
  life: { type: Types.Float32, default: 1.5 },
});

/** Ink rift on a wall that opens before a ninja emerges and then closes. */
export const Portal = createComponent('Portal', {
  age: { type: Types.Float32, default: 0 },
  duration: { type: Types.Float32, default: 1.4 },
});
