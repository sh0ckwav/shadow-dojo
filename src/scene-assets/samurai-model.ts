import {
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from '@iwsdk/core';
import { bevelBox, orientBasis } from './lib/hardsurface.js';
import { PartList } from './lib/low-poly.js';
import { applyMist } from '../mist.js';

// The boss: a heavy armoured samurai in the same faceted, flat-shaded,
// vertex-coloured style as the ninjas. One merged mesh per key frame.
//
// Origin: waist. Forward: +Z (toward the player).

const IRON = new Color(0x2b2f36);
const IRON_SHADE = new Color(0x40464f);
const LACING = new Color(0x9a2a22);
const GOLD = new Color(0xc49a3c);
const MENPO = new Color(0x7a1e1a);
const SHADOW = new Color(0x15171a);
const EYES = new Color(0xf2e6c4);
const BRONZE = new Color(0x8c8456);
const HAKAMA = new Color(0x34302c);
const TSUKA = new Color(0x1c1c1e);
const STEEL = new Color(0xd6dade);

/** The samurai is built at ninja proportions, then scaled up to loom. */
const SCALE = 1.18;
/** Waist origin height above the floor (feet rest at local y ≈ -0.92). */
export const SAMURAI_WAIST_HEIGHT = 0.92 * SCALE;

const bodyMaterial = new MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.6,
  metalness: 0.2,
});
applyMist(bodyMaterial);

/** Swapped onto the frame meshes for a moment when a star lands. */
export const samuraiFlashMaterial = new MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.6,
  emissive: new Color(0xff5030),
  emissiveIntensity: 0.9,
});
export const samuraiBodyMaterial = bodyMaterial;

const j = (x: number, y: number, z: number) => new Vector3(x, y, z);
const UP = j(0, 1, 0);
const orienter = new Object3D();

/** Place a box at `center` with local X along `x` and local Y along `y`. */
function boxAt(parts: PartList, w: number, h: number, d: number, center: Vector3, x: Vector3, y: Vector3, color: Color): void {
  orienter.position.copy(center);
  orienter.scale.set(1, 1, 1);
  orientBasis(orienter, x, y.clone().normalize());
  orienter.updateMatrix();
  parts.add(bevelBox(w, h, d, 0.004, 0, 1), color, orienter.matrix);
}

function addTorso(parts: PartList, lean: number): void {
  const z = (y: number) => y * lean;
  // Lacquered breastplate: broad and deep, narrowing into the waist.
  parts.column(
    [
      { y: -0.12, w: 0.19, d: 0.15, z: z(-0.12) },
      { y: 0.02, w: 0.2, d: 0.16, z: 0 },
      { y: 0.2, w: 0.22, d: 0.17, z: z(0.2) },
      { y: 0.38, w: 0.25, d: 0.17, z: z(0.38) },
      { y: 0.48, w: 0.25, d: 0.15, z: z(0.48) },
      { y: 0.55, w: 0.08, d: 0.08, z: z(0.55) },
    ],
    IRON,
    8,
  );
  // Rows of red lacing standing just proud of the plates.
  for (const y of [0.1, 0.22, 0.33]) {
    const w = 0.205 + (y / 0.38) * 0.04;
    parts.column(
      [
        { y, w: w + 0.008, d: 0.172, z: z(y) },
        { y: y + 0.03, w: w + 0.01, d: 0.174, z: z(y + 0.03) },
      ],
      LACING,
      8,
    );
  }
  // Belt.
  parts.column(
    [
      { y: -0.06, w: 0.205, d: 0.165, z: z(-0.06) },
      { y: 0.0, w: 0.205, d: 0.165, z: 0 },
    ],
    HAKAMA,
    8,
  );
  // Kusazuri: a ring of hanging tassets, each with two lacing rows.
  for (const degrees of [-100, -55, -18, 18, 55, 100, 150, -150]) {
    const a = (degrees * Math.PI) / 180;
    const out = j(Math.sin(a), 0, Math.cos(a));
    const tangent = j(Math.cos(a), 0, -Math.sin(a));
    const down = j(0, 1, 0).addScaledVector(out, -0.28).normalize();
    const center = j(out.x * 0.2, -0.22, out.z * 0.17 + z(-0.22));
    boxAt(parts, 0.13, 0.25, 0.025, center, tangent, down, IRON_SHADE);
    for (const dy of [0.05, -0.06]) {
      boxAt(parts, 0.135, 0.022, 0.03, center.clone().addScaledVector(down, dy).addScaledVector(out, 0.004), tangent, down, LACING);
    }
  }
}

function addHelmet(parts: PartList, lean: number): void {
  const z = 0.55 * lean + 0.02;
  // Face in deep shadow under the helmet.
  parts.column(
    [
      { y: 0.55, w: 0.085, d: 0.085, z },
      { y: 0.62, w: 0.1, d: 0.105, z: z + 0.01 },
      { y: 0.72, w: 0.1, d: 0.105, z: z + 0.01 },
    ],
    SHADOW,
    8,
  );
  // Red lacquer face mask over the lower face, with a jutting chin.
  boxAt(parts, 0.15, 0.075, 0.07, j(0, 0.61, z + 0.07), j(1, 0, 0), UP, MENPO);
  boxAt(parts, 0.07, 0.03, 0.04, j(0, 0.575, z + 0.105), j(1, 0, 0), j(0, 1, 0.4), MENPO);
  boxAt(parts, 0.04, 0.012, 0.01, j(-0.035, 0.68, z + 0.098), j(1, 0, 0), UP, EYES);
  boxAt(parts, 0.04, 0.012, 0.01, j(0.035, 0.68, z + 0.098), j(1, 0, 0), UP, EYES);
  // Helmet bowl.
  parts.column(
    [
      { y: 0.71, w: 0.13, d: 0.14, z: z - 0.005 },
      { y: 0.79, w: 0.125, d: 0.13, z: z - 0.01 },
      { y: 0.85, w: 0.085, d: 0.09, z: z - 0.015 },
      { y: 0.88, w: 0.03, d: 0.03, z: z - 0.015 },
    ],
    IRON,
    8,
  );
  // Neck guard: flared plates around the back and sides.
  boxAt(parts, 0.27, 0.15, 0.025, j(0, 0.66, z - 0.13), j(1, 0, 0), j(0, 1, 0.45), IRON_SHADE);
  for (const side of [1, -1]) {
    boxAt(parts, 0.17, 0.15, 0.025, j(side * 0.145, 0.66, z - 0.02), j(0, 0, 1), j(-side * 0.4, 1, 0), IRON_SHADE);
    // Turned-back wings at the temples.
    boxAt(parts, 0.06, 0.07, 0.02, j(side * 0.13, 0.72, z + 0.07), j(side, 0, 0.6), UP, LACING);
    // Crescent crest sweeping up and out from the brow.
    parts.limb(j(side * 0.015, 0.8, z + 0.11), j(side * 0.11, 0.9, z + 0.13), 0.016, 0.012, GOLD, 4);
    parts.limb(j(side * 0.11, 0.9, z + 0.13), j(side * 0.17, 1.03, z + 0.11), 0.012, 0.004, GOLD, 4);
  }
  parts.limb(j(0, 0.79, z + 0.1), j(0, 0.8, z + 0.125), 0.03, 0.03, GOLD, 6);
}

/** Big tiered shoulder guard hanging off `shoulder`, tilted outward. */
function addShoulderGuard(parts: PartList, shoulder: Vector3, side: 1 | -1): void {
  const down = j(side * 0.35, 1, 0).normalize();
  const center = shoulder.clone().add(j(side * 0.07, -0.1, 0));
  boxAt(parts, 0.22, 0.25, 0.03, center, j(0, 0, 1), down, IRON_SHADE);
  for (const dy of [0.07, -0.02, -0.1]) {
    boxAt(parts, 0.225, 0.022, 0.035, center.clone().addScaledVector(down, dy).add(j(side * 0.006, 0, 0)), j(0, 0, 1), down, LACING);
  }
}

function addArm(parts: PartList, shoulder: Vector3, elbow: Vector3, wrist: Vector3, side: 1 | -1): void {
  parts.limb(shoulder, elbow, 0.075, 0.066, IRON_SHADE, 6);
  // Bare, heavy forearms and fists.
  parts.limb(elbow, wrist, 0.07, 0.056, BRONZE, 6);
  const f = wrist.clone().sub(elbow).normalize();
  const s = f.clone().cross(UP);
  if (s.lengthSq() < 1e-4) s.set(1, 0, 0);
  s.normalize();
  const u = s.clone().cross(f).normalize();
  boxAt(parts, 0.1, 0.085, 0.1, wrist.clone().addScaledVector(f, 0.045), s, u, BRONZE);
  // Iron bracer at the wrist.
  parts.limb(wrist.clone().addScaledVector(f, -0.1), wrist, 0.064, 0.06, IRON, 6);
  addShoulderGuard(parts, shoulder, side);
}

function addLeg(parts: PartList, hip: Vector3, knee: Vector3, ankle: Vector3, toe: Vector3): void {
  // Wide hakama over the thigh, armoured greaves below the knee.
  parts.limb(hip, knee, 0.12, 0.105, HAKAMA, 6);
  parts.limb(knee, ankle, 0.075, 0.06, IRON, 6);
  parts.limb(knee.clone().lerp(ankle, 0.2), knee.clone().lerp(ankle, 0.3), 0.079, 0.077, LACING, 6, false);
  const footDir = toe.clone().sub(ankle).normalize();
  const footSide = footDir.clone().cross(UP).normalize();
  const footUp = footSide.clone().cross(footDir).normalize();
  boxAt(parts, 0.1, 0.07, 0.22, ankle.clone().lerp(toe, 0.5), footSide, footUp, SHADOW);
}

/** Katana gripped two-handed between the wrists, blade along `dir`. */
function addKatana(parts: PartList, rightWrist: Vector3, leftWrist: Vector3, dir: Vector3): void {
  const d = dir.clone().normalize();
  const grip = rightWrist.clone().lerp(leftWrist, 0.5).addScaledVector(d, 0.04);
  parts.limb(grip.clone().addScaledVector(d, -0.14), grip.clone().addScaledVector(d, 0.12), 0.019, 0.019, TSUKA, 6);
  parts.limb(grip.clone().addScaledVector(d, 0.12), grip.clone().addScaledVector(d, 0.14), 0.05, 0.05, GOLD, 8);
  // Slight curve: the blade bows away from its edge over two segments.
  const back = d.clone().cross(j(1, 0, 0));
  if (back.lengthSq() < 1e-4) back.set(0, 1, 0);
  back.normalize();
  const base = grip.clone().addScaledVector(d, 0.14);
  const mid = base.clone().addScaledVector(d, 0.45).addScaledVector(back, 0.02);
  const tip = base.clone().addScaledVector(d, 0.9).addScaledVector(back, 0.055);
  // Thicker than life so the blade still reads across the room.
  parts.limb(base, mid, 0.026, 0.022, STEEL, 4);
  parts.limb(mid, tip, 0.022, 0.004, STEEL, 4);
}

type Arm = [shoulder: Vector3, elbow: Vector3, wrist: Vector3];
type Leg = [hip: Vector3, knee: Vector3, ankle: Vector3, toe: Vector3];

/** One key pose. Right is the samurai's right (−X when it faces +Z). */
interface Pose {
  lean: number;
  rightArm: Arm;
  leftArm: Arm;
  rightLeg: Leg;
  leftLeg: Leg;
  blade: Vector3;
}

const mirrorLeg = (leg: Leg): Leg => leg.map((p) => j(-p.x, p.y, p.z)) as Leg;
const wideStance: Leg = [j(-0.12, -0.1, 0), j(-0.27, -0.45, 0.1), j(-0.33, -0.85, 0.02), j(-0.33, -0.88, 0.2)];
const closeStance: Leg = [j(-0.12, -0.1, 0), j(-0.16, -0.47, 0.12), j(-0.1, -0.85, 0), j(-0.1, -0.88, 0.18)];
// Sword held forward at the middle guard, point toward the player's throat.
const guardRight: Arm = [j(-0.27, 0.46, 0.04), j(-0.24, 0.2, 0.2), j(-0.03, 0.18, 0.4)];
const guardLeft: Arm = [j(0.27, 0.46, 0.04), j(0.22, 0.14, 0.15), j(0.02, 0.13, 0.3)];

const POSES = {
  // Side-step: feet apart, then together. The guard never drops.
  StepA: { lean: 0.08, rightArm: guardRight, leftArm: guardLeft, rightLeg: wideStance, leftLeg: mirrorLeg(wideStance), blade: j(0, 0.55, 1) },
  StepB: { lean: 0.08, rightArm: guardRight, leftArm: guardLeft, rightLeg: closeStance, leftLeg: mirrorLeg(closeStance), blade: j(0, 0.5, 1) },
  // Windup: blade lifted overhead and back, the tell before the killing cut.
  Raise: {
    lean: -0.04,
    rightArm: [j(-0.27, 0.46, -0.02), j(-0.24, 0.76, 0.12), j(-0.03, 0.98, 0.06)],
    leftArm: [j(0.27, 0.46, -0.02), j(0.22, 0.7, 0.1), j(0.02, 0.9, 0.02)],
    rightLeg: wideStance,
    leftLeg: mirrorLeg(wideStance),
    blade: j(0, 0.55, -1),
  },
  // The cut: lunging, blade brought down through the target.
  Slash: {
    lean: 0.35,
    rightArm: [j(-0.27, 0.44, 0.15), j(-0.2, 0.3, 0.45), j(-0.03, 0.2, 0.68)],
    leftArm: [j(0.27, 0.44, 0.15), j(0.18, 0.24, 0.38), j(0.02, 0.17, 0.58)],
    rightLeg: [j(-0.12, -0.1, 0.02), j(-0.2, -0.3, 0.42), j(-0.22, -0.85, 0.45), j(-0.22, -0.88, 0.63)],
    leftLeg: [j(0.12, -0.1, -0.02), j(0.16, -0.5, -0.3), j(0.18, -0.8, -0.68), j(0.18, -0.9, -0.8)],
    blade: j(0, -0.35, 1),
  },
} satisfies Record<string, Pose>;

export type SamuraiPose = keyof typeof POSES;
/** Child order inside the samurai root, used by BossSystem to flip frames. */
export const SAMURAI_FRAMES: SamuraiPose[] = ['StepA', 'StepB', 'Raise', 'Slash'];

function buildPose(name: SamuraiPose): Mesh {
  const pose: Pose = POSES[name];
  const parts = new PartList();
  addTorso(parts, pose.lean);
  addHelmet(parts, pose.lean);
  addArm(parts, ...pose.rightArm, -1);
  addArm(parts, ...pose.leftArm, 1);
  addLeg(parts, ...pose.rightLeg);
  addLeg(parts, ...pose.leftLeg);
  addKatana(parts, pose.rightArm[2], pose.leftArm[2], pose.blade);
  const mesh = new Mesh(parts.merge(), bodyMaterial);
  mesh.name = name;
  mesh.scale.setScalar(SCALE);
  return mesh;
}

/** A single pose, for previewing frames in the editor. */
export function createSamuraiPose(name: SamuraiPose): Group {
  const root = new Group();
  root.name = `Samurai${name}`;
  root.add(buildPose(name));
  return root;
}

/**
 * Limited-animation samurai boss: one mesh per key frame, only one visible
 * at a time. Origin at the waist, facing +Z.
 */
export function createSamuraiModel(): Group {
  const root = new Group();
  root.name = 'Samurai';
  for (const name of SAMURAI_FRAMES) {
    const frame = buildPose(name);
    frame.visible = name === 'StepA';
    root.add(frame);
  }
  return root;
}
