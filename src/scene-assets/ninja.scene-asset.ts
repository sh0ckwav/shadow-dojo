import {
  CircleGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Shape,
  TorusGeometry,
} from '@iwsdk/core';
import { createNinjaModel } from './ninja-model.js';

const steel = new MeshStandardMaterial({
  color: 0xb8c0c8,
  metalness: 0.9,
  roughness: 0.25,
});
const ink = new MeshBasicMaterial({ color: 0x050308, side: DoubleSide });
const inkRim = new MeshBasicMaterial({ color: 0x7a1fd1 });

/** Faceted leaping ninja; origin at the waist, facing +Z. */
export function createNinja(): Group {
  return createNinjaModel();
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
