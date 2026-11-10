// 탈출구 자물쇠 판 그리기 (플레이테스트 a-9): 문 왼쪽 벽 칸에 자물쇠 + 7세그먼트 네 칸. 무엇을 그릴지 · 자리는 art/keypad.ts.
// 배지(objects.ts)와 같은 층(맵 컨테이너, 캐릭터 아래 — R15) · 같은 알파(안 보이는 곳 0.45, 어두운 바닥에 미리 섞은 불투명 색) ·
// 같은 굽기(기기 픽셀 1:1 캔버스, 판 서명 · 알파 · 배율이 바뀔 때만 — 한 번 여는 동안 6번). 판 둘(북 · 남)은 캔버스 텍스처
// 하나의 두 칸이다(휴대폰 MobilePipeline에서도 그리기 한 번). 텍스처 · 이미지는 탈출구가 처음 켜질 때 만든다(판 시작에는 아무것도
// 그리지 않는다 — 일의 양 예산 그대로). 글자(글꼴)를 쓰지 않고 사각형 · 선만으로 그린다. 색은 표지판과 같은 판 색 · OBJ_COLOR뿐이다.
// 맵 원점 · 월드 배율(MAP_X · WORLD_SCALE)은 판 장면을 만들기 전에 정해지고 판 중에 바뀌지 않는다(layout.configureLayout).
import type Phaser from 'phaser';
import { TILE_PX, type ExitId, type ExitView, type InfoItem } from '@decoy/shared';
import {
  KEYPAD,
  SEGMENTS,
  codeCell,
  digitAt,
  keypadAt,
  keypadCode,
  keypadLabel,
  segmentRect,
} from '../art/keypad';
import { dimmed } from '../art/mapArtBadges';
import { OBJ_COLOR } from '../art/mapArtGeom';
import { UI } from '../art/palette';
import { gfxState } from '../gfx/state';
import { MAP_X, MAP_Y, WORLD_SCALE } from '../ui/layout';
import {
  createCanvasTexture,
  makeCanvas,
  nextFogKey,
  removeCanvasTexture,
  resizeCanvasTexture,
  rgba,
  uploadCanvasTexture,
} from './fogPaint';
import type { BadgeCtx } from './objects';

const T = TILE_PX;
/** 굽는 범위 여유 (월드 px): 테두리 굵기의 반 + 안티에일리어싱 */
const PAD = 2;
/** 칸 사이 · 가장자리 투명 테 (px): 선형 보간이 이웃 칸을 끌어오지 않게 */
const GAP = 2;

/**
 * 자물쇠 판 한 장을 칠한다 (x, y = 판 왼쪽 위, 월드 px · code = art/keypad 판 서명). 어두운 판 + 탈출구 초록 테두리 · 자물쇠(열림은
 * 고리가 들려 오른쪽으로 비켜난다 — 색만으로 구분하지 않기) + 숫자 네 칸(꺼진 획 위에 켜진 획, 모르는 숫자는 가운데 네모 점)
 */
export function paintKeypad(c: BadgeCtx, x: number, y: number, code: number, a: number): void {
  const K = KEYPAD;
  const open = codeCell(code, K.digits) === 2;
  /** 판 왼쪽 위 기준 타일 사각형을 색으로 채운다 */
  const fill = (color: number, rx: number, ry: number, w: number, h: number): void => {
    c.fillStyle = rgba(dimmed(color, a), 1);
    c.fillRect(x + rx * T, y + ry * T, w * T, h * T);
  };
  fill(UI.background, 0, 0, K.w, K.h);
  c.lineWidth = 1.6;
  c.strokeStyle = rgba(dimmed(OBJ_COLOR.go, a), 1);
  c.strokeRect(x, y, K.w * T, K.h * T);
  // 자물쇠 몸통 + 고리 (두 다리 + 반원)
  fill(OBJ_COLOR.go, K.lockX, K.lockY, K.lockW, K.lockH);
  const r = 0.11 * T;
  const cx = x + (K.lockX + K.lockW / 2 + (open ? 0.18 : 0)) * T;
  const ly = y + K.lockY * T;
  const cy = ly - (open ? 0.16 : 0.1) * T;
  c.beginPath();
  c.moveTo(cx - r, ly);
  c.lineTo(cx - r, cy);
  c.arc(cx, cy, r, Math.PI, 0);
  c.lineTo(cx + r, open ? cy + 0.06 * T : ly);
  c.lineWidth = 0.07 * T;
  c.stroke();
  const lit = open ? OBJ_COLOR.go : OBJ_COLOR.gauge;
  const s = K.stroke * 1.4;
  for (let i = 0; i < K.digits; i += 1) {
    const p = digitAt(i);
    // 칸 번호: 빈칸 0 · 모름 1(켜진 획 없이 가운데 점) · 숫자 d는 2 + d
    const cell = codeCell(code, i);
    const on = SEGMENTS[cell - 2] ?? 0;
    for (let k = 0; k < 7; k += 1) {
      const [sx, sy, sw, sh] = segmentRect(k, p.x, p.y, K.glyphW, K.glyphH, K.stroke);
      fill((on >> k) & 1 ? lit : OBJ_COLOR.gaugeOff, sx, sy, sw, sh);
    }
    if (cell === 1) fill(lit, p.x + (K.glyphW - s) / 2, p.y + (K.glyphH - s) / 2, s, s);
  }
}

/** 판 하나를 구울 기기 px 사각형 (배지 badgeRect와 같은 식: 판 사각형 + 여유를 기기 픽셀 격자로 넓힌 것) */
export function keypadRect(id: ExitId, zoom: number): { dx0: number; dy0: number; w: number; h: number } {
  const p = keypadAt(id);
  const kd = WORLD_SCALE * zoom;
  const dx0 = Math.floor(zoom * MAP_X + (p.x0 * T - PAD) * kd);
  const dy0 = Math.floor(zoom * MAP_Y + (p.y0 * T - PAD) * kd);
  return {
    dx0,
    dy0,
    w: Math.ceil(zoom * MAP_X + (p.x1 * T + PAD) * kd) - dx0,
    h: Math.ceil(zoom * MAP_Y + (p.y1 * T + PAD) * kd) - dy0,
  };
}

interface Slot {
  /** 지금 판 서명 (art/keypad keypadCode, −1 = 판 없음) */
  code: number;
  /** 마지막으로 구운 서명 · 알파 · 배율 */
  baked: number;
  alpha: number;
  zoom: number;
  img: Phaser.GameObjects.Image | null;
  /** 정보 레이어 항목 (프레임마다 새로 만들지 않는다) */
  item: InfoItem;
}

/** 탈출구 자물쇠 판 둘. draw는 매 프레임(바뀐 판만 다시 굽는다), info는 지난 draw의 정보 레이어 */
export class ExitKeypads {
  /**
   * 판 이미지를 담는 상자: 맵 컨테이너에 배지 바로 뒤 · 캐릭터보다 먼저 넣어 캐릭터 아래에 그린다. 판 시작에는 비어 있다(빈 상자는
   * 그리지 않는다). 이미지는 상자와 함께 장면이 끝날 때 지워진다
   */
  private readonly box: Phaser.GameObjects.Container;
  private readonly key = nextFogKey('keypads');
  private atlas: {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    tex: Phaser.Textures.Texture;
  } | null = null;
  /** 칸을 나눈 배율 · 칸 크기 (기기 px) */
  private zoom = NaN;
  private slotW = 0;
  private slotH = 0;
  private readonly slots: Record<ExitId, Slot>;
  private readonly shown: InfoItem[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
  ) {
    this.box = scene.make.container({ x: 0, y: 0 }, false);
    container.add(this.box);
    const slot = (id: ExitId): Slot => {
      const p = keypadAt(id);
      return {
        code: -1,
        baked: -1,
        alpha: NaN,
        zoom: NaN,
        img: null,
        item: {
          kind: 'keypad',
          tag: `keypad-${id}`,
          x: (p.x0 + p.x1) / 2,
          y: (p.y0 + p.y1) / 2,
          r: null,
          dir: null,
          arc: null,
          value: null,
          color: OBJ_COLOR.go,
          alpha: 1,
        },
      };
    };
    this.slots = { N: slot('N'), S: slot('S') };
    scene.events.once('shutdown', () => {
      if (this.atlas) removeCanvasTexture(scene.textures, this.key);
    });
  }

  /** 지난 draw의 정보 레이어 항목 (보이는 판만, 값 '모드:네 칸' 예 'typing:07__'). 품질과 상관없이 같은 값 */
  info(): readonly InfoItem[] {
    return this.shown;
  }

  draw(
    exits: readonly ExitView[],
    codes: readonly (string | null)[],
    alpha: Readonly<Record<ExitId, number>>,
  ): void {
    this.shown.length = 0;
    const zoom = gfxState.zoom;
    let baked = false;
    for (const e of exits) {
      const s = this.slots[e.id];
      const code = keypadCode(e.state, e.progress, codes);
      const on = code >= 0;
      if (code !== s.code) {
        s.code = code;
        s.item.value = on ? keypadLabel(code) : null;
      }
      const a = alpha[e.id];
      if (on && (s.baked !== code || s.alpha !== a || s.zoom !== zoom)) {
        this.bake(e.id, s, a, zoom);
        baked = true;
      }
      s.img?.setVisible(on);
      if (!on) continue;
      s.item.alpha = a;
      this.shown.push(s.item);
    }
    if (baked && this.atlas) uploadCanvasTexture(this.atlas.tex);
  }

  /** 판 하나를 제 칸에 굽고 이미지를 그 프레임 · 자리에 맞춘다 (텍셀 = 기기 픽셀: 자리는 기기 픽셀 정수, 배율 1/(맵 배율 × zoom)) */
  private bake(id: ExitId, s: Slot, a: number, zoom: number): void {
    const kd = WORLD_SCALE * zoom;
    // 배율이 바뀌면(처음 포함) 칸을 다시 나눈다: 칸 크기 = 판이 어떤 소수 자리에 놓여도 들어가는 크기(굽는 범위 × 배율, 올림 + 1).
    // 캔버스 크기를 바꾸면 내용이 지워지므로 다른 판도 다시 굽게 한다
    if (zoom !== this.zoom || !this.atlas) {
      this.zoom = zoom;
      this.slotW = Math.ceil((KEYPAD.w * T + PAD * 2) * kd) + 1;
      this.slotH = Math.ceil((KEYPAD.h * T + PAD * 2) * kd) + 1;
      const w = GAP * 3 + this.slotW * 2;
      const h = GAP * 2 + this.slotH;
      if (this.atlas) resizeCanvasTexture(this.key, this.atlas.tex, this.atlas.canvas, w, h, false);
      else {
        const m = makeCanvas(w, h);
        this.atlas = { ...m, tex: createCanvasTexture(this.scene.textures, this.key, m.canvas) };
      }
      this.slots.N.zoom = this.slots.S.zoom = NaN;
    }
    s.baked = s.code;
    s.alpha = a;
    s.zoom = zoom;
    const { ctx: c, tex } = this.atlas;
    const sx = id === 'N' ? GAP : GAP * 2 + this.slotW;
    const r = keypadRect(id, zoom);
    const p = keypadAt(id);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(sx, GAP, this.slotW, this.slotH);
    c.setTransform(kd, 0, 0, kd, sx + zoom * MAP_X - r.dx0, GAP + zoom * MAP_Y - r.dy0);
    paintKeypad(c, p.x0 * T, p.y0 * T, s.code, a);
    if (tex.has(id)) tex.get(id).setSize(r.w, r.h, sx, GAP);
    else tex.add(id, 0, sx, GAP, r.w, r.h);
    if (!s.img) {
      s.img = this.scene.make.image({ x: 0, y: 0, key: this.key, frame: id }, false).setOrigin(0, 0);
      this.box.add(s.img);
    }
    s.img
      .setFrame(id)
      .setPosition((r.dx0 / zoom - MAP_X) / WORLD_SCALE, (r.dy0 / zoom - MAP_Y) / WORLD_SCALE)
      .setScale(1 / kd);
  }
}
