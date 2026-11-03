import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { GameSystem } from './game-system.js';
import { NinjaSystem } from './ninja-system.js';
import { ThrowSystem } from './throw-system.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  // GameSystem first: the others look it up in init().
  world.registerSystem(GameSystem);
  world.registerSystem(NinjaSystem);
  world.registerSystem(ThrowSystem);
});
