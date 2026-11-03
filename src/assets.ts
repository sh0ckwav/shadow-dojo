import { AssetType, defineAssets } from '@iwsdk/core';
import { createNinjaPose } from './scene-assets/ninja-model.js';
import { createNinja, createShuriken } from './scene-assets/ninja.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  ninja: createNinja(),
  shuriken: createShuriken(),
  'ninja-run-a': createNinjaPose('RunA'),
  'ninja-run-b': createNinjaPose('RunB'),
  'ninja-leap': createNinjaPose('Leap'),
  'hud-panel': {
    url: publicAssetUrl('ui/hud.uikitml'),
    type: AssetType.UIKitML,
    name: 'HUD Panel',
  },
});
