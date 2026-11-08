import { Color, LinearSRGBColorSpace, Material, SRGBColorSpace, Vector3 } from '@iwsdk/core';

// Ground-hugging mist. Unlike scene fog it only exists below `top`, so the
// real room above it stays clear. Materials opt in with `applyMist()`.
// Kept free of World/DOM access: the ninja asset module uses it too.

/** Mist colour as it reaches the display. */
const MIST_RGB: [number, number, number] = [0.84, 0.86, 0.86];
/** For shaders that mix after colour conversion (as three's fog does): use raw. */
export const MIST_RAW = new Color().setRGB(...MIST_RGB, LinearSRGBColorSpace);
/** For ordinary material colours that should land on the same display value. */
export const MIST_SRGB = new Color().setRGB(...MIST_RGB, SRGBColorSpace);

/** Shared by every misted material; GameSystem updates them per round. */
export const mistUniforms = {
  uMistColor: { value: MIST_RAW },
  uMistCenter: { value: new Vector3() },
  /** Horizontal distance from the player where mist starts and becomes solid. */
  uMistNear: { value: 1000 },
  uMistFar: { value: 1001 },
  /** Height of the mist bank's top edge. */
  uMistTop: { value: 1.9 },
};

/** Fade this material into the mist with horizontal distance, below the mist top. */
export function applyMist(material: Material): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mistUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMistWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvMistWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vMistWorld;
uniform vec3 uMistColor;
uniform vec3 uMistCenter;
uniform float uMistNear;
uniform float uMistFar;
uniform float uMistTop;`,
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
float mistReach = smoothstep(uMistNear, uMistFar, distance(vMistWorld.xz, uMistCenter.xz));
float mistBelow = 1.0 - smoothstep(uMistTop - 0.5, uMistTop, vMistWorld.y);
gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistColor, mistReach * mistBelow);`,
      );
  };
}
