import {
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
} from '@iwsdk/core';
import { createNinjaModel } from './ninja-model.js';

const steel = new MeshStandardMaterial({
  color: 0xb8c0c8,
  metalness: 0.9,
  roughness: 0.25,
});

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
