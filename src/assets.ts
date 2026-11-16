import { defineAssets } from '@iwsdk/core';
import { createNinjaPose } from './scene-assets/ninja-model.js';
import { createNinja, createShuriken } from './scene-assets/ninja.scene-asset.js';
import { createSamuraiModel, createSamuraiPose } from './scene-assets/samurai-model.js';

export default defineAssets({
  ninja: createNinja(),
  shuriken: createShuriken(),
  'ninja-run-a': createNinjaPose('RunA'),
  'ninja-run-b': createNinjaPose('RunB'),
  'ninja-leap': createNinjaPose('Leap'),
  samurai: createSamuraiModel(),
  'samurai-step-a': createSamuraiPose('StepA'),
  'samurai-step-b': createSamuraiPose('StepB'),
  'samurai-raise': createSamuraiPose('Raise'),
  'samurai-slash': createSamuraiPose('Slash'),
});
