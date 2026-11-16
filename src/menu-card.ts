import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from '@iwsdk/core';
import {
  canvasTexture,
  FONT_STACK,
  INK,
  inkText,
  loadFont,
  ninjaIcon,
  overlayMaterial,
  PAPER,
  seal,
  VERMILION,
} from './hud.js';

// The title and game-over screens, drawn in the same hand as the HUD strip:
// Shojumaru lettering in paper with a heavy ink edge, a vermilion seal for
// the wave, faceted ninja heads. The card is a lacquered ink plaque floating
// in front of the player; each button is its own small vermilion plaque so
// it can carry its own RayInteractable.

const CARD_WIDTH = 0.6;
const CARD_HEIGHT = 0.34;
const CARD_PX = 1024;
const BUTTON_WIDTH = 0.22;
const BUTTON_HEIGHT = 0.07;
const BUTTON_PX = 512;
const BUTTON_GAP = 0.025;
/** Hovered buttons lift toward the player by this much. */
const HOVER_SCALE = 1.08;

const LACQUER = 'rgba(18, 21, 18, 0.86)';
const VERMILION_LIT = '#e0583c';

export type MenuScreen =
  | { kind: 'title'; best: number }
  | { kind: 'over'; title: string; score: number; wave: number; best: number; newBest: boolean };

export class MenuButton {
  readonly mesh: Mesh;
  private canvas: { ctx: CanvasRenderingContext2D; texture: CanvasTexture };
  private material: MeshBasicMaterial;
  private label = '';
  private hovered = false;

  constructor(label: string) {
    this.canvas = canvasTexture(BUTTON_PX, Math.round((BUTTON_PX * BUTTON_HEIGHT) / BUTTON_WIDTH));
    this.material = overlayMaterial(this.canvas.texture);
    this.mesh = new Mesh(new PlaneGeometry(BUTTON_WIDTH, BUTTON_HEIGHT), this.material);
    this.mesh.renderOrder = 1011;
    this.mesh.frustumCulled = false;
    this.setLabel(label);
  }

  setLabel(label: string): void {
    if (label === this.label) return;
    this.label = label;
    this.draw();
  }

  setHovered(hovered: boolean): void {
    if (hovered === this.hovered) return;
    this.hovered = hovered;
    this.mesh.scale.setScalar(hovered ? HOVER_SCALE : 1);
    this.draw();
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  set visible(visible: boolean) {
    this.mesh.visible = visible;
  }

  draw(): void {
    const { ctx, texture } = this.canvas;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    const edge = height * 0.08;
    // Ink frame, vermilion plaque, a thin paper rule inside like the seal.
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = this.hovered ? VERMILION_LIT : VERMILION;
    ctx.fillRect(edge, edge, width - edge * 2, height - edge * 2);
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = height * 0.035;
    ctx.strokeRect(edge * 2.2, edge * 2.2, width - edge * 4.4, height - edge * 4.4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    inkText(ctx, this.label, width / 2, height * 0.54, height * 0.5);
    texture.needsUpdate = true;
  }
}

export class MenuCard {
  readonly group = new Group();
  readonly start = new MenuButton('BEGIN');
  readonly enterXR = new MenuButton('ENTER');
  private card: { ctx: CanvasRenderingContext2D; texture: CanvasTexture };
  private screen: MenuScreen = { kind: 'title', best: 0 };

  constructor() {
    this.group.name = 'MenuCard';
    this.card = canvasTexture(CARD_PX, Math.round((CARD_PX * CARD_HEIGHT) / CARD_WIDTH));
    const cardMesh = new Mesh(new PlaneGeometry(CARD_WIDTH, CARD_HEIGHT), overlayMaterial(this.card.texture));
    cardMesh.renderOrder = 1010;
    cardMesh.frustumCulled = false;
    this.group.add(cardMesh);
    this.layoutButtons();
    void loadFont().then(() => {
      this.draw();
      this.start.draw();
      this.enterXR.draw();
    });
  }

  show(screen: MenuScreen): void {
    this.screen = screen;
    this.start.setLabel(screen.kind === 'title' ? 'BEGIN' : 'AGAIN');
    this.draw();
  }

  /** The Enter button only matters in the flat browser view. */
  setEnterVisible(visible: boolean): void {
    this.enterXR.visible = visible;
    this.layoutButtons();
  }

  /** Buttons hang in a row just under the card. */
  private layoutButtons(): void {
    const y = -CARD_HEIGHT / 2 - BUTTON_GAP - BUTTON_HEIGHT / 2;
    const both = this.enterXR.visible;
    const offset = both ? (BUTTON_WIDTH + BUTTON_GAP) / 2 : 0;
    this.enterXR.mesh.position.set(-offset, y, 0.002);
    this.start.mesh.position.set(offset, y, 0.002);
  }

  private draw(): void {
    const { ctx, texture } = this.card;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    this.plaque(ctx, width, height);
    ctx.textBaseline = 'middle';
    if (this.screen.kind === 'title') this.drawTitle(ctx, width, height, this.screen.best);
    else this.drawOver(ctx, width, height, this.screen);
    texture.needsUpdate = true;
  }

  /** Lacquered ink with a paper rule inset and a vermilion corner seal dot. */
  private plaque(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const r = height * 0.06;
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, r);
    ctx.fillStyle = LACQUER;
    ctx.fill();
    const inset = height * 0.045;
    ctx.beginPath();
    ctx.roundRect(inset, inset, width - inset * 2, height - inset * 2, r * 0.6);
    ctx.strokeStyle = PAPER;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = height * 0.008;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawTitle(ctx: CanvasRenderingContext2D, width: number, height: number, best: number): void {
    // A ninja head beside the name, like a life icon grown up.
    const icon = height * 0.2;
    ctx.textAlign = 'left';
    const name = 'SHADOW DOJO';
    let size = height * 0.14;
    ctx.font = `${size}px ${FONT_STACK}`;
    const room = width * 0.84 - icon * 1.3;
    size *= Math.min(1, room / ctx.measureText(name).width);
    ctx.font = `${size}px ${FONT_STACK}`;
    const left = (width - ctx.measureText(name).width - icon * 1.3) / 2;
    ninjaIcon(ctx, left + icon * 0.5, height * 0.29, icon);
    inkText(ctx, name, left + icon * 1.3, height * 0.3, size);
    this.brushRule(ctx, width, height * 0.47);

    ctx.textAlign = 'center';
    inkText(ctx, 'SHADOWS GATHER IN THE BAMBOO', width / 2, height * 0.6, height * 0.075);
    inkText(ctx, 'POINT AND PINCH TO THROW', width / 2, height * 0.715, height * 0.075);
    if (best > 0) {
      inkText(ctx, `BEST ${String(best).padStart(6, '0')}`, width / 2, height * 0.86, height * 0.07, VERMILION_LIT);
    }
  }

  private drawOver(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    screen: Extract<MenuScreen, { kind: 'over' }>,
  ): void {
    ctx.textAlign = 'center';
    const title = screen.title.toUpperCase();
    // Shrink long titles to fit inside the rule.
    let size = height * 0.14;
    ctx.font = `${size}px ${FONT_STACK}`;
    const fit = (width * 0.86) / ctx.measureText(title).width;
    if (fit < 1) size *= fit;
    inkText(ctx, title, width / 2, height * 0.22, size);
    this.brushRule(ctx, width, height * 0.36);

    // Score in the HUD's six digits, the wave reached on its seal.
    inkText(ctx, String(screen.score).padStart(6, '0'), width * 0.33, height * 0.57, height * 0.15);
    ctx.textAlign = 'right';
    inkText(ctx, 'WAVE', width * 0.79, height * 0.58, height * 0.075);
    seal(ctx, String(screen.wave), width * 0.87, height * 0.57, height * 0.15);

    ctx.textAlign = 'center';
    const best = `BEST ${String(screen.best).padStart(6, '0')}`;
    inkText(ctx, screen.newBest ? `NEW ${best}` : best, width / 2, height * 0.83, height * 0.075, screen.newBest ? VERMILION_LIT : PAPER);
  }

  /** A brush stroke rule: thick in the middle, tapering to points. */
  private brushRule(ctx: CanvasRenderingContext2D, width: number, y: number): void {
    const half = width * 0.36;
    const thick = width * 0.006;
    ctx.beginPath();
    ctx.moveTo(width / 2 - half, y);
    ctx.quadraticCurveTo(width / 2, y - thick * 2, width / 2 + half, y);
    ctx.quadraticCurveTo(width / 2, y + thick * 2, width / 2 - half, y);
    ctx.fillStyle = VERMILION;
    ctx.fill();
  }
}
