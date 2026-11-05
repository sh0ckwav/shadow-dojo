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

// Faceted, flat-shaded figure in the spirit of early-90s 3D fighters and
// faceted public sculpture: few sides per form, colour carried per vertex so
// each key frame is one draw call.
//
// Origin: waist. Forward: +Z (toward the player).

const GI = new Color(0xa3b2a6);
const GI_SHADE = new Color(0x84938a);
const MASK = new Color(0x1f2227);
const EYES = new Color(0xf2e6c4);
const SASH = new Color(0x6a2a9a);
const SKIN = new Color(0xc39672);
const WRAP = new Color(0x3b4048);

const bodyMaterial = new MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.82,
  metalness: 0.05,
});

const j = (x: number, y: number, z: number) => new Vector3(x, y, z);
const UP = j(0, 1, 0);
const orienter = new Object3D();

/** Place a box at `center` with local X along `x` and local Y along `y`. */
function boxAt(parts: PartList, w: number, h: number, d: number, center: Vector3, x: Vector3, y: Vector3, color: Color): void {
  orienter.position.copy(center);
  orienter.scale.set(1, 1, 1);
  orientBasis(orienter, x, y);
  orienter.updateMatrix();
  parts.add(bevelBox(w, h, d, 0.004, 0, 1), color, orienter.matrix);
}

function addTorso(parts: PartList, lean: number): void {
  // Rings shear forward with height: `lean` is forward meters per meter up.
  parts.column(
    [
      { y: -0.1, w: 0.15, d: 0.11, z: -0.02 },
      { y: 0.02, w: 0.16, d: 0.115, z: 0 },
      { y: 0.16, w: 0.15, d: 0.105, z: 0.16 * lean },
      { y: 0.34, w: 0.19, d: 0.12, z: 0.34 * lean },
      { y: 0.46, w: 0.2, d: 0.1, z: 0.46 * lean + 0.01 },
      { y: 0.52, w: 0.07, d: 0.065, z: 0.52 * lean + 0.01 },
    ],
    GI,
    8,
  );
  // Sash: a slightly proud band at the waist with a short knot tail.
  parts.column(
    [
      { y: -0.02, w: 0.168, d: 0.123, z: 0 },
      { y: 0.07, w: 0.163, d: 0.118, z: 0.07 * lean },
    ],
    SASH,
    8,
  );
  parts.limb(j(-0.06, 0.02, 0.12), j(-0.1, -0.16, 0.13), 0.022, 0.012, SASH, 4);
  // Crossed gi lapels read as a darker V on the chest.
  parts.limb(j(-0.09, 0.44, 0.44 * lean + 0.11), j(0.05, 0.12, 0.12 * lean + 0.1), 0.018, 0.018, GI_SHADE, 4);
  parts.limb(j(0.09, 0.44, 0.44 * lean + 0.11), j(-0.02, 0.2, 0.2 * lean + 0.105), 0.018, 0.018, GI_SHADE, 4);
}

function addHood(parts: PartList, lean: number): void {
  // Full hood: a faceted egg carried upright on the leaning neck.
  const z = 0.52 * lean + 0.02;
  parts.column(
    [
      { y: 0.52, w: 0.075, d: 0.075, z },
      { y: 0.6, w: 0.1, d: 0.105, z: z + 0.02 },
      { y: 0.69, w: 0.108, d: 0.112, z: z + 0.03 },
      { y: 0.77, w: 0.095, d: 0.1, z: z + 0.03 },
      { y: 0.83, w: 0.045, d: 0.05, z: z + 0.02 },
    ],
    GI,
    8,
  );
  // Mask band across the eyes, sitting proud of the hood's front facets.
  boxAt(parts, 0.19, 0.045, 0.06, j(0, 0.705, z + 0.1), j(1, 0, 0), UP, MASK);
  boxAt(parts, 0.045, 0.014, 0.01, j(-0.042, 0.708, z + 0.132), j(1, 0, 0), UP, EYES);
  boxAt(parts, 0.045, 0.014, 0.01, j(0.042, 0.708, z + 0.132), j(1, 0, 0), UP, EYES);
  // Hood tail falling down the back of the neck.
  parts.limb(j(0, 0.74, z - 0.06), j(0, 0.5, z - 0.12), 0.03, 0.012, GI_SHADE, 4);
}

/** Clawed hand: palm down, fingers curling toward the target. */
function addHand(parts: PartList, elbow: Vector3, wrist: Vector3, side: 1 | -1): void {
  const f = wrist.clone().sub(elbow).normalize();
  const s = f.clone().cross(UP).normalize();
  const u = s.clone().cross(f).normalize();
  // Oversized, grasping hands are the figure's focal point when it lunges.
  const k = 1.4;
  const at = (base: Vector3, df: number, ds: number, du: number) =>
    base.clone().addScaledVector(f, df * k).addScaledVector(s, ds * k).addScaledVector(u, du * k);

  boxAt(parts, 0.085 * k, 0.032 * k, 0.09 * k, at(wrist, 0.05, 0, 0), s, u, SKIN);
  const spread = [-0.032, -0.011, 0.011, 0.032];
  for (let i = 0; i < spread.length; i++) {
    const knuckle = at(wrist, 0.092, spread[i] * side, 0.004);
    const middle = at(knuckle, 0.042, spread[i] * side * 0.35, 0.008);
    const tip = at(middle, 0.022, spread[i] * side * 0.25, -0.038);
    parts.limb(knuckle, middle, 0.0115 * k, 0.0095 * k, SKIN, 4);
    parts.limb(middle, tip, 0.0095 * k, 0.004 * k, SKIN, 4);
  }
  // `s` points to the figure's right for a forward reach, so the thumb sits
  // on the inner edge of each hand.
  const thumbBase = at(wrist, 0.035, 0.045 * side, -0.012);
  const thumbTip = at(thumbBase, 0.045, 0.018 * side, -0.022);
  parts.limb(thumbBase, thumbTip, 0.012 * k, 0.005 * k, SKIN, 4);
  // Wrist wrap where the sleeve ends.
  parts.limb(at(wrist, -0.03, 0, 0), at(wrist, 0.012, 0, 0), 0.04, 0.036, WRAP, 6);
}

function addArm(parts: PartList, shoulder: Vector3, elbow: Vector3, wrist: Vector3, side: 1 | -1): void {
  parts.limb(shoulder, elbow, 0.068, 0.058, GI, 6);
  // Gi sleeves flare toward the wrist.
  parts.limb(elbow, wrist.clone().lerp(elbow, 0.12), 0.058, 0.066, GI, 6);
  addHand(parts, elbow, wrist, side);
}

function addLeg(parts: PartList, hip: Vector3, knee: Vector3, ankle: Vector3, toe: Vector3): void {
  parts.limb(hip, knee, 0.09, 0.072, GI, 6);
  const shinTop = knee.clone().lerp(ankle, 0.35);
  parts.limb(knee, shinTop, 0.07, 0.062, GI, 6);
  // Leg wraps from mid-shin into the tabi boot.
  parts.limb(shinTop, ankle, 0.056, 0.045, WRAP, 6);
  const footDir = toe.clone().sub(ankle).normalize();
  const footSide = footDir.clone().cross(UP).normalize();
  const footUp = footSide.clone().cross(footDir).normalize();
  boxAt(parts, 0.085, 0.07, 0.2, ankle.clone().lerp(toe, 0.5), footSide, footUp, WRAP);
}

type Arm = [shoulder: Vector3, elbow: Vector3, wrist: Vector3];
type Leg = [hip: Vector3, knee: Vector3, ankle: Vector3, toe: Vector3];

/** One key pose. Right is the ninja's right (−X when it faces +Z). */
interface Pose {
  lean: number;
  rightArm: Arm;
  leftArm: Arm;
  rightLeg: Leg;
  leftLeg: Leg;
}

/** Height of the waist origin above the floor in both running frames. */
export const RUN_WAIST_HEIGHT = 0.84;

const mirrorLeg = (leg: Leg): Leg => leg.map((p) => j(-p.x, p.y, p.z)) as Leg;

// Ninja run: torso pitched forward, both arms swept straight back.
const strideForward: Leg = [j(0.09, -0.08, 0), j(0.12, -0.26, 0.34), j(0.12, -0.66, 0.3), j(0.12, -0.74, 0.46)];
const strideBack: Leg = [j(-0.09, -0.08, -0.02), j(-0.12, -0.46, -0.2), j(-0.13, -0.62, -0.56), j(-0.13, -0.8, -0.62)];

const POSES = {
  RunA: {
    lean: 0.7,
    rightArm: [j(-0.2, 0.44, 0.32), j(-0.27, 0.3, 0.08), j(-0.27, 0.34, -0.2)],
    leftArm: [j(0.2, 0.44, 0.32), j(0.27, 0.32, 0.06), j(0.26, 0.38, -0.22)],
    leftLeg: strideForward,
    rightLeg: strideBack,
  },
  RunB: {
    lean: 0.7,
    rightArm: [j(-0.2, 0.44, 0.32), j(-0.28, 0.33, 0.1), j(-0.28, 0.4, -0.18)],
    leftArm: [j(0.2, 0.44, 0.32), j(0.28, 0.33, 0.1), j(0.28, 0.4, -0.18)],
    leftLeg: mirrorLeg(strideBack),
    rightLeg: mirrorLeg(strideForward),
  },
  // Attack leap: one clawed hand raised to strike, the other thrust forward.
  Leap: {
    lean: 0.27,
    rightArm: [j(-0.2, 0.44, 0.12), j(-0.32, 0.6, 0.3), j(-0.24, 0.8, 0.52)],
    leftArm: [j(0.2, 0.44, 0.12), j(0.29, 0.36, 0.36), j(0.2, 0.42, 0.62)],
    rightLeg: [j(-0.09, -0.08, 0.02), j(-0.15, -0.2, 0.32), j(-0.13, -0.56, 0.3), j(-0.13, -0.6, 0.48)],
    leftLeg: [j(0.09, -0.08, -0.02), j(0.14, -0.42, -0.14), j(0.16, -0.66, -0.4), j(0.16, -0.78, -0.56)],
  },
} satisfies Record<string, Pose>;

export type NinjaPose = keyof typeof POSES;
/** Child order inside the ninja root, used by NinjaSystem to flip frames. */
export const NINJA_FRAMES: NinjaPose[] = ['RunA', 'RunB', 'Leap'];

function buildPose(name: NinjaPose): Mesh {
  const pose: Pose = POSES[name];
  const parts = new PartList();
  addTorso(parts, pose.lean);
  addHood(parts, pose.lean);
  addArm(parts, ...pose.rightArm, 1);
  addArm(parts, ...pose.leftArm, -1);
  addLeg(parts, ...pose.rightLeg);
  addLeg(parts, ...pose.leftLeg);
  const mesh = new Mesh(parts.merge(), bodyMaterial);
  mesh.name = name;
  return mesh;
}

/** A single pose, for previewing frames in the editor. */
export function createNinjaPose(name: NinjaPose): Group {
  const root = new Group();
  root.name = `Ninja${name}`;
  root.add(buildPose(name));
  return root;
}

/**
 * Limited-animation ninja: one mesh per key frame, only one visible at a
 * time. Origin at the waist, facing +Z.
 */
export function createNinjaModel(): Group {
  const root = new Group();
  root.name = 'Ninja';
  for (const name of NINJA_FRAMES) {
    const frame = buildPose(name);
    frame.visible = name === 'RunA';
    root.add(frame);
  }
  return root;
}
