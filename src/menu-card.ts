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
const BUTTON_WIDTH = 0.19;
const BUTTON_HEIGHT = 0.07;
const BUTTON_PX = 512;
const BUTTON_GAP = 0.025;
/** Hovered buttons lift toward the player by this much. */
const HOVER_SCALE = 1.08;

const LACQUER = 'rgba(18, 21, 18, 0.86)';
const VERMILION_LIT = '#e0583c';

export type MenuScreen =
  | { kind: 'title'; best: number; dailyBest: number; noWalls: boolean }
  | {
      kind: 'over';
      title: string;
      score: number;
      wave: number;
      best: number;
      newBest: boolean;
      daily: boolean;
    };

/** Score thresholds for the end-of-run rank, lowest first. */
const RANKS: Array<[number, string]> = [
  [0, 'NOVICE'],
  [1500, 'STUDENT'],
  [4000, 'ADEPT'],
  [8000, 'MASTER'],
  [15000, 'SHADOW MASTER'],
];

export function rankFor(score: number): string {
  let rank = RANKS[0][1];
  for (const [min, name] of RANKS) if (score >= min) rank = name;
  return rank;
}

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
  readonly daily = new MenuButton('DAILY');
  readonly enterXR = new MenuButton('ENTER');
  readonly scan = new MenuButton('SCAN');
  /** Left to right, as they hang under the card. */
  private readonly row = [this.enterXR, this.scan, this.start, this.daily];
  private card: { ctx: CanvasRenderingContext2D; texture: CanvasTexture };
  private screen: MenuScreen = { kind: 'title', best: 0, dailyBest: 0, noWalls: false };

  constructor() {
    this.group.name = 'MenuCard';
    this.card = canvasTexture(CARD_PX, Math.round((CARD_PX * CARD_HEIGHT) / CARD_WIDTH));
    const cardMesh = new Mesh(new PlaneGeometry(CARD_WIDTH, CARD_HEIGHT), overlayMaterial(this.card.texture));
    cardMesh.renderOrder = 1010;
    cardMesh.frustumCulled = false;
    this.group.add(cardMesh);
    this.scan.visible = false;
    this.layoutButtons();
    void loadFont().then(() => {
      this.draw();
      for (const button of this.row) button.draw();
    });
  }

  show(screen: MenuScreen): void {
    this.screen = screen;
    this.start.setLabel(screen.kind === 'title' ? 'BEGIN' : 'AGAIN');
    this.scan.visible = screen.kind === 'title' && screen.noWalls;
    this.layoutButtons();
    this.draw();
  }

  /** The Enter button only matters in the flat browser view. */
  setEnterVisible(visible: boolean): void {
    this.enterXR.visible = visible;
    this.layoutButtons();
  }

  /** Visible buttons hang in a centred row just under the card. */
  private layoutButtons(): void {
    const y = -CARD_HEIGHT / 2 - BUTTON_GAP - BUTTON_HEIGHT / 2;
    const shown = this.row.filter((b) => b.visible);
    const span = shown.length * BUTTON_WIDTH + (shown.length - 1) * BUTTON_GAP;
    shown.forEach((button, i) => {
      button.mesh.position.set(-span / 2 + BUTTON_WIDTH / 2 + i * (BUTTON_WIDTH + BUTTON_GAP), y, 0.002);
    });
  }

  private draw(): void {
    const { ctx, texture } = this.card;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    this.plaque(ctx, width, height);
    ctx.textBaseline = 'middle';
    if (this.screen.kind === 'title') this.drawTitle(ctx, width, height, this.screen);
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

  private drawTitle(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    { best, dailyBest, noWalls }: Extract<MenuScreen, { kind: 'title' }>,
  ): void {
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
    if (noWalls) {
      // No walls found: the forest falls back to a small circle until the room is scanned.
      inkText(ctx, 'NO WALLS FOUND: SCAN YOUR ROOM', width / 2, height * 0.715, height * 0.075, VERMILION_LIT);
    } else {
      inkText(ctx, 'POINT AND PINCH TO THROW', width / 2, height * 0.715, height * 0.075);
    }
    const scores: string[] = [];
    if (best > 0) scores.push(`BEST ${String(best).padStart(6, '0')}`);
    if (dailyBest > 0) scores.push(`DAILY ${String(dailyBest).padStart(6, '0')}`);
    if (scores.length > 0) inkText(ctx, scores.join('   '), width / 2, height * 0.86, height * 0.07, VERMILION_LIT);
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
    inkText(ctx, title, width / 2, height * 0.18, size);
    this.brushRule(ctx, width, height * 0.3);

    // Score in the HUD's six digits, the wave reached on its seal.
    inkText(ctx, String(screen.score).padStart(6, '0'), width * 0.33, height * 0.48, height * 0.15);
    ctx.textAlign = 'right';
    inkText(ctx, 'WAVE', width * 0.79, height * 0.49, height * 0.075);
    seal(ctx, String(screen.wave), width * 0.87, height * 0.48, height * 0.15);

    // The rank, stamped in vermilion.
    this.rankStamp(ctx, width / 2, height * 0.69, height * 0.12, rankFor(screen.score));

    ctx.textAlign = 'center';
    const best = `${screen.daily ? 'DAILY BEST' : 'BEST'} ${String(screen.best).padStart(6, '0')}`;
    inkText(ctx, screen.newBest ? `NEW ${best}` : best, width / 2, height * 0.88, height * 0.065, screen.newBest ? VERMILION_LIT : PAPER);
  }

  /** A hanko-style rectangular stamp with the rank cut out in paper. */
  private rankStamp(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, rank: string): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.03);
    ctx.font = `${size * 0.7}px ${FONT_STACK}`;
    const w = ctx.measureText(rank).width + size * 1.2;
    const h = size * 1.25;
    ctx.fillStyle = INK;
    ctx.fillRect(-w / 2 - size * 0.08, -h / 2 - size * 0.08, w + size * 0.16, h + size * 0.16);
    ctx.fillStyle = VERMILION;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = size * 0.06;
    ctx.strokeRect(-w / 2 + size * 0.14, -h / 2 + size * 0.14, w - size * 0.28, h - size * 0.28);
    ctx.fillStyle = PAPER;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rank, 0, size * 0.05);
    ctx.restore();
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
