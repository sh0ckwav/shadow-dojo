import {
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
} from '@iwsdk/core';

// Placeholder art for the gameplay slice. Origin sits at the ninja's waist
// so the leap arc moves the body's center of mass.

const cloth = new MeshStandardMaterial({ color: 0x15131c, roughness: 0.85 });
const scarf = new MeshStandardMaterial({
  color: 0xc0262d,
  roughness: 0.6,
  emissive: 0x3a0508,
});
const eyes = new MeshBasicMaterial({ color: 0xffe9a8 });
const steel = new MeshStandardMaterial({
  color: 0xb8c0c8,
  metalness: 0.9,
  roughness: 0.25,
});
const ink = new MeshBasicMaterial({ color: 0x050308, side: DoubleSide });
const inkRim = new MeshBasicMaterial({ color: 0x7a1fd1 });

function limb(length: number, radius = 0.045): Mesh {
  const mesh = new Mesh(new CapsuleGeometry(radius, length, 3, 8), cloth);
  mesh.geometry.translate(0, -length / 2, 0);
  return mesh;
}

/** Spread-eagle leaping pose facing +Z. */
export function createNinja(): Group {
  const root = new Group();
  root.name = 'Ninja';

  const torso = new Mesh(new CapsuleGeometry(0.13, 0.32, 4, 10), cloth);
  torso.position.y = 0.16;
  root.add(torso);

  const head = new Mesh(new SphereGeometry(0.12, 14, 10), cloth);
  head.position.y = 0.5;
  root.add(head);

  const eyeSlit = new Mesh(new BoxGeometry(0.17, 0.03, 0.02), eyes);
  eyeSlit.position.set(0, 0.51, 0.11);
  root.add(eyeSlit);

  const band = new Mesh(new TorusGeometry(0.122, 0.018, 6, 18), scarf);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.56;
  root.add(band);

  const tail = new Mesh(new BoxGeometry(0.05, 0.28, 0.01), scarf);
  tail.position.set(0.06, 0.42, -0.12);
  tail.rotation.set(0.5, 0, 0.4);
  root.add(tail);

  const arms: Array<[number, number]> = [
    [-1, 2.2],
    [1, -2.2],
  ];
  for (const [side, angle] of arms) {
    const arm = limb(0.34);
    arm.position.set(side * 0.15, 0.36, 0);
    arm.rotation.z = angle;
    root.add(arm);
  }

  const legs: Array<[number, number]> = [
    [-1, -0.5],
    [1, 0.5],
  ];
  for (const [side, angle] of legs) {
    const leg = limb(0.4, 0.055);
    leg.position.set(side * 0.08, -0.05, 0);
    leg.rotation.z = angle;
    root.add(leg);
  }

  return root;
}

/** Four-point throwing star lying in the XY plane. */
export function createShuriken(): Mesh {
  const shape = new Shape();
  const points = 4;
  const outer = 0.07;
  const inner = 0.022;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: 0.006,
    bevelEnabled: false,
  });
  geometry.center();
  const mesh = new Mesh(geometry, steel);
  mesh.name = 'Shuriken';
  return mesh;
}

/** Ink rift that faces +Z; place it on a wall with +Z along the wall normal. */
export function createPortal(): Group {
  const root = new Group();
  root.name = 'Portal';
  const hole = new Mesh(new CircleGeometry(0.42, 28), ink);
  hole.scale.y = 1.5;
  root.add(hole);
  const rim = new Mesh(new TorusGeometry(0.42, 0.02, 6, 28), inkRim);
  rim.scale.y = 1.5;
  rim.position.z = 0.002;
  root.add(rim);
  return root;
}
