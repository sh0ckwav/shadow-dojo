import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Matrix4,
  Object3D,
  Vector3,
} from '@iwsdk/core';
import { alignSpan, LoftSurface } from './hardsurface.js';

/** One colored piece of a model that will be merged into a single mesh. */
export interface Part {
  geometry: BufferGeometry;
  matrix: Matrix4;
  color: Color;
}

const placer = new Object3D();

/** Collects colored, transformed pieces and merges them into one draw call. */
export class PartList {
  readonly parts: Part[] = [];

  add(geometry: BufferGeometry, color: Color, matrix = new Matrix4()): void {
    this.parts.push({ geometry, matrix: matrix.clone(), color });
  }

  /** Faceted tube spanning joint `a` to joint `b`, radius tapering r0 → r1. */
  limb(a: Vector3, b: Vector3, r0: number, r1: number, color: Color, sides = 6): void {
    const length = a.distanceTo(b);
    const geometry = LoftSurface.tube([
      { z: -length / 2, halfW: r0, hUp: r0 },
      { z: length / 2, halfW: r1, hUp: r1 },
    ]).build([-length / 2, length / 2], sides, true);
    // Loft runs along +Z; alignSpan expects a Y-up primitive.
    geometry.rotateX(-Math.PI / 2);
    placer.position.set(0, 0, 0);
    placer.quaternion.identity();
    placer.scale.set(1, 1, 1);
    alignSpan(placer, a, b);
    placer.updateMatrix();
    this.add(geometry, color, placer.matrix);
  }

  /**
   * Vertical faceted body section. Each ring is `{ y, w, d, z }`: height, half
   * width, half depth and a forward (+Z) offset for leaning masses.
   */
  column(
    rings: Array<{ y: number; w: number; d: number; z?: number }>,
    color: Color,
    sides = 8,
  ): void {
    // Loft Z maps to model Y after rotateX(-90°); loft +Y maps to model -Z.
    const surface = LoftSurface.tube(
      rings.map((r) => ({ z: r.y, halfW: r.w, hUp: r.d, cy: -(r.z ?? 0) })),
    );
    const geometry = surface.build(rings.map((r) => r.y), sides, true);
    geometry.rotateX(-Math.PI / 2);
    this.add(geometry, color);
  }

  /** Merge every part into one non-indexed geometry with per-vertex colors. */
  merge(): BufferGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const v = new Vector3();
    for (const part of this.parts) {
      const flat = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
      const source = flat.getAttribute('position');
      for (let i = 0; i < source.count; i++) {
        v.fromBufferAttribute(source, i).applyMatrix4(part.matrix);
        positions.push(v.x, v.y, v.z);
        colors.push(part.color.r, part.color.g, part.color.b);
      }
    }
    const merged = new BufferGeometry();
    merged.setAttribute('position', new Float32BufferAttribute(positions, 3));
    merged.setAttribute('color', new Float32BufferAttribute(colors, 3));
    merged.computeVertexNormals();
    return merged;
  }
}

/**
 * Inverted-hull outline: push each vertex along the averaged normal of every
 * face sharing its position so the shell stays closed across facets.
 */
export function outlineShell(source: BufferGeometry, thickness: number): BufferGeometry {
  const position = source.getAttribute('position');
  const key = (i: number) =>
    `${Math.round(position.getX(i) * 1e4)},${Math.round(position.getY(i) * 1e4)},${Math.round(position.getZ(i) * 1e4)}`;
  const sums = new Map<string, Vector3>();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    // Counter-clockwise winding: (b - a) × (c - b) points outward.
    c.sub(b);
    n.subVectors(b, a).cross(c).normalize();
    for (let k = 0; k < 3; k++) {
      const id = key(i + k);
      const sum = sums.get(id) ?? new Vector3();
      sum.add(n);
      sums.set(id, sum);
    }
  }
  const shifted = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const offset = sums.get(key(i))!.clone().normalize().multiplyScalar(thickness);
    shifted[i * 3] = position.getX(i) + offset.x;
    shifted[i * 3 + 1] = position.getY(i) + offset.y;
    shifted[i * 3 + 2] = position.getZ(i) + offset.z;
  }
  const shell = new BufferGeometry();
  shell.setAttribute('position', new Float32BufferAttribute(shifted, 3));
  shell.computeVertexNormals();
  return shell;
}
