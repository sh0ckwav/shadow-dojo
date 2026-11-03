import { AssetType, defineAssets } from '@iwsdk/core';
import {
  createNinja,
  createPortal,
  createShuriken,
} from './scene-assets/ninja.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  ninja: createNinja(),
  shuriken: createShuriken(),
  portal: createPortal(),
  'hud-panel': {
    url: publicAssetUrl('ui/hud.uikitml'),
    type: AssetType.UIKitML,
    name: 'HUD Panel',
  },
});
