// 탈출구 자물쇠 판 (플레이테스트 a-9, art/keypad.ts · render/keypad.ts): 개방 진행 → 입력 자리 수, 지워짐, 괴물 화면 빈 판(이중 잠금),
// 모르는 조각 '•', 이벤트 id로 자리, 7세그먼트 표, 판 자리(문 왼쪽 벽 칸 — 캐릭터가 설 수 있는 바닥과 안 겹침), 굽기 횟수.
// 그림은 기록용 2D 컨텍스트 · 가짜 장면으로 본다 (objects.test.ts와 같은 방식).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXITS, TILE_PX, tileAt, type ExitView, type GameEvent } from '@decoy/shared';
import {
  KEYPAD,
  SEGMENTS,
  collectedCodes,
  digitAt,
  keypadAt,
  keypadCode,
  keypadFilled,
  keypadLabel,
  keypadText,
  keypadView,
  keypadViewOf,
  segmentRect,
  takeCode,
  type KeypadCodes,
  type KeypadView,
} from '../../client/src/art/keypad';
import { dimmed, exitSignAt } from '../../client/src/art/mapArtBadges';
import { OBJ_COLOR } from '../../client/src/art/mapArtGeom';
import { gfxState } from '../../client/src/gfx/state';
import { rgba } from '../../client/src/render/fogPaint';
import { loadTestBalance } from '../helpers/fixtures';

const T = TILE_PX;
const ALL_SEEN = { N: 1, S: 1 } as const;
/** 서버와 같은 개방 진행 값: 틱마다 dt씩 쌓은 초 ÷ openTime, 소수 4자리 (interest.ts worldView) */
const b = loadTestBalance();
const DT = 1 / b.network.serverTickHz;
const serverProgress = (ticks: number): number => Math.round(((ticks * DT) / b.exit.openTime) * 1e4) / 1e4;

describe('자물쇠 판 뷰 (art/keypad.ts)', () => {
  it('진행 → 입력 자리 수: 20 · 40 · 60 · 80%에 한 자리씩, 100%도 4, null · NaN · 0 이하는 0, 서버 진행 값에서 뒤로 가지 않는다', () => {
    expect([0, 0.0111, 0.1999, 0.2, 0.3999, 0.4, 0.6, 0.7999, 0.8, 0.9999, 1].map(keypadFilled)).toEqual([
      0, 0, 0, 1, 1, 2, 3, 3, 4, 4, 4,
    ]);
    expect([null, Number.NaN, -0.5].map(keypadFilled)).toEqual([0, 0, 0]);
    // 0초 → 3초(열림) 틱마다: 자리 수가 단조로 늘고, 0.6 · 1.2 · 1.8 · 2.4초에 한 자리씩
    const openTicks = Math.round(b.exit.openTime / DT);
    const firstTickOf = new Map<number, number>();
    let last = 0;
    for (let t = 0; t <= openTicks; t += 1) {
      const f = keypadFilled(serverProgress(t));
      expect(f).toBeGreaterThanOrEqual(last);
      if (!firstTickOf.has(f)) firstTickOf.set(f, t);
      last = f;
    }
    expect([...firstTickOf].map(([f, t]) => [f, Math.round(t * DT * 100) / 100])).toEqual([
      [0, 0],
      [1, 0.6],
      [2, 1.2],
      [3, 1.8],
      [4, 2.4],
    ]);
  });

  it('입력 중에는 왼쪽부터 한 자리씩, 한 명이 나가 진행이 0이 되면 빈 판(지워짐), 꺼진 탈출구는 판 없음, 열리면 네 칸 모두', () => {
    const codes: KeypadCodes = ['07', '40'];
    expect(keypadView('inactive', 0, codes)).toBeNull();
    expect(keypadView('inactive', null, codes)).toBeNull();
    const at = (p: number): string => {
      const v = keypadView('active', p, codes);
      return `${v?.mode}:${keypadText(v)}`;
    };
    expect([0, 0.1, 0.2, 0.45, 0.65, 0.85, 0.99].map(at)).toEqual([
      'idle:____',
      'idle:____',
      'typing:0___',
      'typing:07__',
      'typing:074_',
      'typing:0740',
      'typing:0740',
    ]);
    // 한 명이 나가면 서버가 진행을 0으로 되돌린다 → 지워진다
    expect(at(0)).toBe('idle:____');
    expect(keypadView('open', 1, codes)).toEqual({ mode: 'open', cells: ['0', '7', '4', '0'] });
  });

  it('괴물 화면(진행 null)은 조각을 넘겨도 숫자 · 입력 자리 수가 없다 — 활성은 빈 판, 열림은 열린 빈 판', () => {
    const codes: KeypadCodes = ['07', '40'];
    expect(keypadView('active', null, codes)).toEqual({
      mode: 'idle',
      cells: ['empty', 'empty', 'empty', 'empty'],
    });
    expect(keypadView('open', null, codes)).toEqual({
      mode: 'open',
      cells: ['empty', 'empty', 'empty', 'empty'],
    });
    // 서명 수도 조각과 무관하다 (그림이 조각에 따라 바뀌지 않는다)
    for (const state of ['active', 'open'] as const)
      expect(keypadCode(state, null, codes)).toBe(keypadCode(state, null, [null, null]));
  });

  it('모르는 조각은 •: 한쪽만 알면 그 두 칸만 숫자, 두 자리 숫자가 아닌 값도 •', () => {
    expect(keypadText(keypadView('active', 0.85, [null, '40']))).toBe('••40');
    expect(keypadText(keypadView('active', 0.5, [null, '40']))).toBe('••__');
    expect(keypadText(keypadView('active', 0.5, ['07', null]))).toBe('07__');
    expect(keypadText(keypadView('active', 0.85, [null, null]))).toBe('••••');
    expect(keypadText(keypadView('open', 1, [null, '40']))).toBe('••40');
    expect(keypadText(keypadView('active', 1, ['7', 'ab']))).toBe('••••');
    expect(keypadText(keypadView('active', 1, ['007', '4x']))).toBe('••••');
    expect(keypadText(keypadView('active', 1, ['00', '99']))).toBe('0099');
  });

  it('조각 자리는 메모 이벤트 id로 정한다 (순서가 뒤바뀌어도 · 한쪽만 와도), 메모가 아닌 이벤트는 무시', () => {
    const first: GameEvent = { k: 'text', id: 'NOTE_FIRST', code: '07' };
    const second: GameEvent = { k: 'text', id: 'NOTE_SECOND', code: '40' };
    expect(collectedCodes([second, first])).toEqual(['07', '40']);
    expect(collectedCodes([first, second])).toEqual(['07', '40']);
    expect(collectedCodes([second])).toEqual([null, '40']);
    const other: GameEvent[] = [
      { k: 'text', id: 'ALERT_EXITS_ON' },
      { k: 'text', id: 'ALERT_CAPTURE_DONE', point: 'A' },
      { k: 'hit', you: true, x: 0, y: 0 },
    ];
    expect(collectedCodes(other)).toEqual([null, null]);
    const codes: KeypadCodes = [null, null];
    takeCode(codes, second);
    for (const ev of other) takeCode(codes, ev);
    expect(codes).toEqual([null, '40']);
    takeCode(codes, first);
    expect(codes).toEqual(['07', '40']);
  });

  it('서명 수: 판 뷰와 서로 맞고(되살리면 같은 뷰), 그림이 다르면 수도 다르다', () => {
    const seen = new Map<number, string>();
    const codeSets: (string | null)[][] = [
      [null, null],
      ['07', null],
      [null, '40'],
      ['07', '40'],
      ['99', '00'],
    ];
    for (const state of ['inactive', 'active', 'open'] as const)
      for (const p of [null, 0, 0.1, 0.2, 0.4, 0.6, 0.8, 1])
        for (const codes of codeSets) {
          const v = keypadView(state, p, codes);
          const code = keypadCode(state, p, codes);
          expect(keypadViewOf(code)).toEqual(v);
          // 정보 레이어 값 = '모드:네 칸' (뷰를 글자로 쓴 것과 같다)
          if (v) expect(keypadLabel(code)).toBe(`${v.mode}:${keypadText(v)}`);
          const key = JSON.stringify(v);
          if (seen.has(code)) expect(seen.get(code)).toBe(key);
          seen.set(code, key);
        }
    // 서로 다른 그림 수 = 서로 다른 서명 수
    expect(new Set(seen.values()).size).toBe(seen.size);
  });
});

describe('7세그먼트 · 판 자리', () => {
  it('숫자 0~9의 켜진 획이 서로 다르고 빈칸이 아니며, 획 일곱은 서로 겹치지 않고 숫자 칸 안이다', () => {
    expect(SEGMENTS).toHaveLength(10);
    expect(new Set(SEGMENTS).size).toBe(10);
    for (const m of SEGMENTS) {
      expect(m).toBeGreaterThan(0);
      expect(m).toBeLessThan(128);
    }
    // 흔히 쓰는 모양: 8은 일곱 획 모두, 1은 오른쪽 두 획
    expect(SEGMENTS[8]).toBe(0x7f);
    expect(SEGMENTS[1]).toBe(0b0000110);
    const [w, h, t] = [KEYPAD.glyphW, KEYPAD.glyphH, KEYPAD.stroke];
    const rects = [0, 1, 2, 3, 4, 5, 6].map((k) => segmentRect(k, 0, 0, w, h, t));
    for (const [x, y, rw, rh] of rects) {
      expect(rw).toBeGreaterThan(0);
      expect(rh).toBeGreaterThan(0);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + rw).toBeLessThanOrEqual(w + 1e-9);
      expect(y + rh).toBeLessThanOrEqual(h + 1e-9);
    }
    for (let i = 0; i < 7; i += 1)
      for (let j = i + 1; j < 7; j += 1) {
        const [ax, ay, aw, ah] = rects[i]!;
        const [bx, by, bw, bh] = rects[j]!;
        const ox = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
        const oy = Math.min(ay + ah, by + bh) - Math.max(ay, by);
        expect(ox > 1e-9 && oy > 1e-9, `획 ${i} · ${j}`).toBe(false);
      }
  });

  it('판 사각형은 문 왼쪽 벽 칸 안이다: 북 · 남 모두 벽 타일만 덮고(캐릭터가 설 수 있는 바닥 · 문 · 문틀 · 표지판과 겹치지 않음) 판정 원 밖, 숫자 · 자물쇠는 판 안', () => {
    for (const id of ['N', 'S'] as const) {
      const r = keypadAt(id);
      const door = EXITS[id].door;
      expect(r.x1 - r.x0).toBeCloseTo(KEYPAD.w, 9);
      expect(r.y1 - r.y0).toBeCloseTo(KEYPAD.h, 9);
      // 덮는 타일이 모두 벽 (바닥 · 문 · 기둥 없음 — 캐릭터 몸은 벽 타일에 들어가지 못한다)
      const kinds = new Set<string>();
      for (let j = Math.floor(r.y0); j < Math.ceil(r.y1); j += 1)
        for (let i = Math.floor(r.x0); i < Math.ceil(r.x1); i += 1) kinds.add(tileAt(i, j));
      expect([...kinds]).toEqual(['wall']);
      // 문 칸 · 왼쪽 문틀 칸(문 바로 왼쪽 타일) · 오른쪽 표지판과 떨어져 있다
      expect(r.x1).toBeLessThanOrEqual(door.x0 - 1);
      expect(r.x1).toBeLessThan(exitSignAt(id).x - KEYPAD.w);
      // 맵 안 · 문 줄 안
      expect(r.y0).toBeGreaterThanOrEqual(door.y0);
      expect(r.y1).toBeLessThanOrEqual(door.y1);
      // 판정 원(반경 exit.radius) 밖
      const c = EXITS[id].center;
      const nx = Math.max(r.x0, Math.min(c.x, r.x1));
      const ny = Math.max(r.y0, Math.min(c.y, r.y1));
      expect(Math.hypot(c.x - nx, c.y - ny)).toBeGreaterThan(b.exit.radius);
    }
    // 숫자 칸: 판 안, 서로 겹치지 않고, 앞 두 칸 · 뒤 두 칸 사이가 더 넓다
    const xs = [0, 1, 2, 3].map((i) => digitAt(i).x);
    expect(xs[0]).toBeGreaterThan(KEYPAD.lockX + KEYPAD.lockW);
    expect(xs[3]! + KEYPAD.glyphW).toBeLessThan(KEYPAD.w);
    expect(digitAt(0).y + KEYPAD.glyphH).toBeLessThan(KEYPAD.h);
    expect(xs[1]! - xs[0]! - KEYPAD.glyphW).toBeGreaterThan(0);
    expect(xs[2]! - xs[1]!).toBeGreaterThan(xs[1]! - xs[0]!);
  });
});

// ───────────── 칠하기 · 굽기 (가짜 컨텍스트 · 장면) ─────────────

interface Rect {
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 기록용 2D 컨텍스트: 변환(축 정렬 배율 + 이동)을 적용한 fillRect · 선 경로를 모은다 */
class RecCtx {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  lineJoin = 'miter';
  lineCap = 'butt';
  readonly rects: Rect[] = [];
  readonly strokes: { style: string; pts: [number, number][] }[] = [];
  readonly clears: number[][] = [];
  /** 굽기 = setTransform으로 배율을 건 뒤 그린 묶음 수 */
  transforms = 0;
  private m = [1, 0, 0, 1, 0, 0];
  private pts: [number, number][] = [];

  constructor(readonly canvas: { width: number; height: number }) {}

  private tx(x: number, y: number): [number, number] {
    return [this.m[0]! * x + this.m[4]!, this.m[3]! * y + this.m[5]!];
  }
  setTransform(a: number, bb: number, c: number, d: number, e: number, f: number): void {
    this.m = [a, bb, c, d, e, f];
    if (a !== 1) this.transforms += 1;
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.clears.push([x, y, w, h]);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const [x0, y0] = this.tx(x, y);
    const [x1, y1] = this.tx(x + w, y + h);
    this.rects.push({ style: this.fillStyle, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  strokeRect(): void {}
  beginPath(): void {
    this.pts = [];
  }
  moveTo(x: number, y: number): void {
    this.pts.push(this.tx(x, y));
  }
  lineTo(x: number, y: number): void {
    this.pts.push(this.tx(x, y));
  }
  arc(x: number, y: number, r: number): void {
    this.pts.push(this.tx(x - r, y - r), this.tx(x + r, y - r));
  }
  arcTo(): void {}
  closePath(): void {}
  fill(): void {}
  stroke(): void {
    this.strokes.push({ style: this.strokeStyle, pts: this.pts });
  }
  drawImage(): void {}
}

const popcount = (m: number): number => m.toString(2).replace(/0/g, '').length;

/** 판 뷰 → 판 서명 수 (시험용: keypadCode가 만들지 않는 칸 조합도 칠해 본다). keypadViewOf로 되살려 맞는지도 본다 */
function encode(v: KeypadView): number {
  const mode = ['idle', 'typing', 'open'].indexOf(v.mode);
  const code = v.cells.reduce(
    (sum, c, i) => sum + (c === 'empty' ? 0 : c === 'unknown' ? 1 : 2 + Number(c)) * 12 ** i,
    mode * 12 ** KEYPAD.digits,
  );
  expect(keypadViewOf(code)).toEqual(v);
  return code;
}

describe('칠하기 (render/keypad.ts paintKeypad)', () => {
  /** 판을 (0, 0)에 칠하고 숫자 칸 i 안의 켜진 색 사각형 수 */
  async function litPerCell(v: KeypadView, a = 1): Promise<number[]> {
    const { paintKeypad } = await import('../../client/src/render/keypad');
    const c = new RecCtx({ width: 0, height: 0 });
    paintKeypad(c as never, 0, 0, encode(v), a);
    const lit = rgba(dimmed(v.mode === 'open' ? OBJ_COLOR.go : OBJ_COLOR.gauge, a), 1);
    return [0, 1, 2, 3].map((i) => {
      const p = digitAt(i);
      const [x0, y0, x1, y1] = [p.x * T, p.y * T, (p.x + KEYPAD.glyphW) * T, (p.y + KEYPAD.glyphH) * T];
      return c.rects.filter(
        (r) =>
          r.style === lit &&
          r.x >= x0 - 1e-6 &&
          r.y >= y0 - 1e-6 &&
          r.x + r.w <= x1 + 1e-6 &&
          r.y + r.h <= y1 + 1e-6,
      ).length;
    });
  }

  it('숫자 칸마다 켜진 획 수가 7세그먼트 표와 같고, 모르는 숫자는 가운데 점 하나, 빈칸 · 괴물 화면 판은 켜진 획이 없다', async () => {
    for (let d = 0; d <= 9; d += 1) {
      const ch = String(d) as KeypadView['cells'][number];
      expect(await litPerCell({ mode: 'typing', cells: [ch, 'unknown', 'empty', ch] })).toEqual([
        popcount(SEGMENTS[d]!),
        1,
        0,
        popcount(SEGMENTS[d]!),
      ]);
    }
    expect(await litPerCell({ mode: 'open', cells: ['0', '7', '4', '0'] }, 0.45)).toEqual([6, 3, 4, 6]);
    // 괴물 화면: 조각을 넘겨도 keypadView가 빈 칸만 준다 → 켜진 획 0 (활성 · 열림)
    for (const state of ['active', 'open'] as const)
      expect(await litPerCell(keypadView(state, null, ['88', '88'])!)).toEqual([0, 0, 0, 0]);
  });

  it('열림은 색 말고 자물쇠 모양도 다르다: 닫힘은 고리 두 다리가 몸통에 닿고, 열림은 고리가 들려 한쪽 다리가 몸통 밖에 뜬다', async () => {
    const { paintKeypad } = await import('../../client/src/render/keypad');
    const shackle = (mode: KeypadView['mode']): [number, number][] => {
      const c = new RecCtx({ width: 0, height: 0 });
      paintKeypad(c as never, 0, 0, encode({ mode, cells: ['empty', 'empty', 'empty', 'empty'] }), 1);
      expect(c.strokes).toHaveLength(1);
      return c.strokes[0]!.pts;
    };
    const body = { x0: KEYPAD.lockX * T, x1: (KEYPAD.lockX + KEYPAD.lockW) * T, y0: KEYPAD.lockY * T };
    const closed = shackle('idle');
    expect(shackle('typing')).toEqual(closed);
    const open = shackle('open');
    expect(open).not.toEqual(closed);
    const ends = (pts: [number, number][]): [[number, number], [number, number]] => [
      pts[0]!,
      pts[pts.length - 1]!,
    ];
    // 닫힘: 두 다리 끝이 몸통 윗변 · 몸통 가로 안
    for (const [x, y] of ends(closed)) {
      expect(y).toBeCloseTo(body.y0, 9);
      expect(x).toBeGreaterThan(body.x0);
      expect(x).toBeLessThan(body.x1);
    }
    // 열림: 오른쪽 다리 끝이 몸통 위에 떠 있고 몸통 가로 밖, 고리 꼭대기가 닫힘보다 높다
    const [, right] = ends(open);
    expect(right[1]).toBeLessThan(body.y0);
    expect(right[0]).toBeGreaterThan(body.x1);
    expect(Math.min(...open.map((p) => p[1]))).toBeLessThan(Math.min(...closed.map((p) => p[1])));
    // 고리 · 자물쇠는 판 안 · 첫 숫자 칸 왼쪽
    for (const [x, y] of [...open, ...closed]) {
      expect(x).toBeLessThan(digitAt(0).x * T);
      expect(y).toBeGreaterThan(0);
    }
  });
});

interface FakeImage {
  x: number;
  y: number;
  scale: number;
  visible: boolean;
  frame: string;
  setOrigin(): FakeImage;
  setVisible(v: boolean): FakeImage;
  setPosition(x: number, y: number): FakeImage;
  setScale(s: number): FakeImage;
  setFrame(f: string): FakeImage;
  destroy(): void;
}

/** ExitKeypads가 쓰는 장면 부분 (가짜): 상자 · 이미지 · 텍스처(프레임) · 캔버스 */
function fakeScene() {
  const images: FakeImage[] = [];
  const ctxs: RecCtx[] = [];
  const created: string[] = [];
  const frameSets: string[] = [];
  let uploads = 0;
  let shutdown: (() => void) | null = null;
  const box = {
    list: [] as unknown[],
    visible: true,
    add(o: unknown): void {
      box.list.push(o);
    },
    setVisible(v: boolean) {
      box.visible = v;
      return box;
    },
  };
  const keys = new Set<string>();
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = { width: 0, height: 0, getContext: (): RecCtx => ctx };
      const ctx = new RecCtx(canvas);
      ctxs.push(ctx);
      return canvas;
    },
  });
  const image = (cfg: { frame: string }): FakeImage => {
    const img: FakeImage = {
      x: 0,
      y: 0,
      scale: 1,
      visible: true,
      frame: cfg.frame,
      setOrigin: () => img,
      setVisible: (v) => {
        img.visible = v;
        return img;
      },
      setPosition: (x, y) => {
        img.x = x;
        img.y = y;
        return img;
      },
      setScale: (k) => {
        img.scale = k;
        return img;
      },
      setFrame: (f) => {
        img.frame = f;
        return img;
      },
      destroy: () => undefined,
    };
    images.push(img);
    return img;
  };
  const frames = new Map<string, number[]>();
  const scene = {
    make: { container: () => box, image },
    textures: {
      exists: (k: string) => keys.has(k),
      remove: (k: string) => keys.delete(k),
      create: (k: string, src: { width: number; height: number }) => {
        keys.add(k);
        created.push(k);
        const setFrame = (name: string, x: number, y: number, w: number, h: number): void => {
          frames.set(name, [x, y, w, h]);
          if (name !== '__BASE') frameSets.push(name);
        };
        return {
          add: (name: string, _i: number, x: number, y: number, w: number, h: number) =>
            setFrame(name, x, y, w, h),
          has: (name: string) => frames.has(name),
          get: (name: string) => ({
            setSize: (w: number, h: number, x = 0, y = 0) => setFrame(name, x, y, w, h),
          }),
          source: [
            {
              width: src.width,
              height: src.height,
              isPowerOf2: false,
              update: () => {
                uploads += 1;
              },
            },
          ],
        };
      },
    },
    events: {
      once: (_e: string, f: () => void) => {
        shutdown = f;
      },
    },
    game: { renderer: {} },
  };
  return {
    scene,
    box,
    images,
    ctxs,
    created,
    frameSets,
    frames,
    keys,
    uploads: () => uploads,
    shutdown: () => shutdown?.(),
  };
}

describe('굽기 (render/keypad.ts ExitKeypads)', () => {
  beforeEach(() => {
    gfxState.zoom = 1;
  });

  const exits = (n: ExitView['state'], pn: number | null, s: ExitView['state'] = n, ps = pn): ExitView[] => [
    { id: 'N', state: n, progress: pn },
    { id: 'S', state: s, progress: ps },
  ];

  it('판 시작(탈출구 꺼짐)에는 텍스처 · 이미지 · 정보 항목을 만들지 않는다 — 상자가 비어 있다 (일의 양 예산 장면 그대로)', async () => {
    const { ExitKeypads } = await import('../../client/src/render/keypad');
    const f = fakeScene();
    const container = { add: vi.fn() };
    const kp = new ExitKeypads(f.scene as never, container as never);
    // 상자 하나만 맵 컨테이너에 넣는다 (배지 바로 뒤 · 캐릭터 레이어보다 먼저)
    expect(container.add.mock.calls.length).toBe(1);
    expect(container.add.mock.calls[0]?.[0] === f.box).toBe(true);
    for (let i = 0; i < 30; i += 1) kp.draw(exits('inactive', null), ['07', '40'], ALL_SEEN);
    expect([f.created.length, f.images.length, f.ctxs.length, f.uploads(), f.box.list.length]).toEqual([
      0, 0, 0, 0, 0,
    ]);
    expect(kp.info()).toEqual([]);
  });

  it('같은 판이면 다시 굽지 않는다: 한 번 여는 동안 굽기 6번(빈 판 → 1 → 2 → 3 → 4자리 → 열림), 진행 값만 바뀌면 0번, 지워지면 다시', async () => {
    const { ExitKeypads } = await import('../../client/src/render/keypad');
    const f = fakeScene();
    const kp = new ExitKeypads(f.scene as never, { add: vi.fn() } as never);
    const codes: KeypadCodes = ['07', '40'];
    const bakesOf = (id: string): number => f.frameSets.filter((n) => n === id).length;
    /** 실제 앱에서 E2E · 성능 기록이 읽는 굽기 누계 (gfx.features.keypadBakes) */
    const counter = (): number => Number(gfxState.features.keypadBakes ?? 0);
    const counter0 = counter();
    const values: string[] = [];
    /** 그리고 정보 값을 모은다. 구운 draw는 텍스처를 한 번 올리고, 굽지 않은 draw는 올리지 않는다 */
    const draw = (list: ExitView[]): void => {
      const [b0, u0] = [f.frameSets.length, f.uploads()];
      kp.draw(list, codes, ALL_SEEN);
      expect(f.uploads() - u0).toBe(f.frameSets.length > b0 ? 1 : 0);
      const v = String(kp.info().find((i) => i.tag === 'keypad-N')?.value);
      if (values[values.length - 1] !== v) values.push(v);
    };
    // 탈출구가 켜짐: 북 · 남 빈 판 한 번씩
    draw(exits('active', 0));
    expect([bakesOf('N'), bakesOf('S'), f.uploads(), f.created.length, f.box.list.length]).toEqual([
      1, 1, 1, 1, 2,
    ]);
    expect(f.images.every((i) => i.visible)).toBe(true);
    // 북쪽에 둘이 서서 3초 (같은 프레임을 두 번씩 그려도 다시 굽지 않는다), 1.2초쯤 한 명이 나갔다 돌아온다
    const openTicks = Math.round(b.exit.openTime / DT);
    for (let t = 1; t <= 40; t += 1)
      for (let k = 0; k < 2; k += 1) draw(exits('active', serverProgress(t), 'active', 0));
    expect(values).toEqual(['idle:____', 'typing:0___', 'typing:07__']);
    draw(exits('active', 0));
    expect(values[values.length - 1]).toBe('idle:____');
    const before = bakesOf('N');
    values.length = 0;
    for (let t = 1; t < openTicks; t += 1) draw(exits('active', serverProgress(t), 'active', 0));
    for (let k = 0; k < 5; k += 1) draw(exits('open', 1, 'active', 0));
    expect(values).toEqual([
      'idle:____',
      'typing:0___',
      'typing:07__',
      'typing:074_',
      'typing:0740',
      'open:0740',
    ]);
    // 지워진 뒤 다시 연 한 번: 빈 판(진행 0 < p < 0.2도 같은 그림이라 굽지 않는다) → 1 → 2 → 3 → 4자리 → 열림 = 5번.
    // 처음부터 세면 켜짐 1 + 두 자리까지 2 + 지워짐 1 + 다시 5
    expect(bakesOf('N') - before).toBe(5);
    expect(bakesOf('N')).toBe(1 + 2 + 1 + 5);
    // 남쪽은 그동안 다시 굽지 않았다
    expect(bakesOf('S')).toBe(1);
    // 남쪽을 끊김 없이 한 번 연다: 켜짐(빈 판)부터 세어 6번
    for (let t = 1; t < openTicks; t += 1) draw(exits('open', 1, 'active', serverProgress(t)));
    for (let k = 0; k < 5; k += 1) draw(exits('open', 1, 'open', 1));
    expect(bakesOf('S')).toBe(6);
    // 굽기 누계(gfx.features.keypadBakes)가 실제 굽기 수와 같다 (북 9 + 남 6)
    expect(counter() - counter0).toBe(f.frameSets.length);
    expect(counter() - counter0).toBe(15);
  });

  it('괴물 화면(진행 null): 문이 열리는 동안 판은 빈 판 그대로라 굽기는 켜짐 · 열림 두 번뿐이고 정보 값에 숫자가 없다', async () => {
    const { ExitKeypads } = await import('../../client/src/render/keypad');
    const f = fakeScene();
    const kp = new ExitKeypads(f.scene as never, { add: vi.fn() } as never);
    const values = new Set<string>();
    // 괴물 클라이언트는 메모를 받지 않지만, 받았다고 쳐도(이중 잠금) 숫자가 없다
    const codes: KeypadCodes = ['07', '40'];
    kp.draw(exits('active', null), codes, ALL_SEEN);
    for (let t = 0; t < 100; t += 1) {
      kp.draw(exits('active', null), codes, ALL_SEEN);
      for (const i of kp.info()) values.add(`${i.tag}=${String(i.value)}`);
    }
    kp.draw(exits('open', null, 'active', null), codes, ALL_SEEN);
    for (const i of kp.info()) values.add(`${i.tag}=${String(i.value)}`);
    expect([...values].sort()).toEqual(['keypad-N=idle:____', 'keypad-N=open:____', 'keypad-S=idle:____']);
    expect(f.frameSets).toEqual(['N', 'S', 'N']);
    // 켜진 획 색(개방 게이지 색)은 어느 굽기에도 없다
    const gauge = rgba(dimmed(OBJ_COLOR.gauge, 1), 1);
    expect(f.ctxs.flatMap((c) => c.rects).filter((r) => r.style === gauge)).toEqual([]);
  });

  it('알파 · 배율이 바뀌면 다시 굽고(배율은 칸을 다시 나눠 두 판 모두), 이미지는 기기 픽셀 격자 · 텍셀 = 기기 픽셀, 장면이 끝나면 텍스처를 지운다', async () => {
    const { ExitKeypads, keypadRect } = await import('../../client/src/render/keypad');
    const f = fakeScene();
    const kp = new ExitKeypads(f.scene as never, { add: vi.fn() } as never);
    const codes: KeypadCodes = [null, '40'];
    kp.draw(exits('active', 0.85), codes, ALL_SEEN);
    expect(kp.info().map((i) => [i.tag, i.value, i.alpha])).toEqual([
      ['keypad-N', 'typing:••40', 1],
      ['keypad-S', 'typing:••40', 1],
    ]);
    f.frameSets.length = 0;
    kp.draw(exits('active', 0.85), codes, { N: 1, S: 0.45 });
    expect(f.frameSets).toEqual(['S']);
    expect(kp.info()[1]?.alpha).toBe(0.45);
    f.frameSets.length = 0;
    gfxState.zoom = 2.625;
    kp.draw(exits('active', 0.85), codes, { N: 1, S: 0.45 });
    expect(f.frameSets).toEqual(['N', 'S']);
    // 캔버스는 하나(처음 만든 것)를 크기만 바꿔 쓴다
    expect(f.created.length).toBe(1);
    const { MAP_X, MAP_Y, WORLD_SCALE } = await import('../../client/src/ui/layout');
    for (const id of ['N', 'S'] as const) {
      const img = f.images.find((i) => i.frame === id)!;
      const r = keypadRect(id, 2.625);
      expect(f.frames.get(id)?.slice(2)).toEqual([r.w, r.h]);
      expect(img.scale).toBeCloseTo(1 / (WORLD_SCALE * 2.625), 12);
      // 이미지 왼쪽 위가 기기 픽셀 정수 자리
      const devX = (img.x * WORLD_SCALE + MAP_X) * 2.625;
      const devY = (img.y * WORLD_SCALE + MAP_Y) * 2.625;
      expect(Math.abs(devX - Math.round(devX))).toBeLessThan(1e-6);
      expect(Math.abs(devY - Math.round(devY))).toBeLessThan(1e-6);
      // 판 사각형이 구운 사각형 안
      const p = keypadAt(id);
      const kd = WORLD_SCALE * 2.625;
      expect(r.dx0).toBeLessThanOrEqual(2.625 * MAP_X + p.x0 * T * kd);
      expect(r.dx0 + r.w).toBeGreaterThanOrEqual(2.625 * MAP_X + p.x1 * T * kd);
    }
    // 두 칸이 겹치지 않는다
    const [nx, , nw] = f.frames.get('N')!;
    const [sx] = f.frames.get('S')!;
    expect(nx! + nw!).toBeLessThan(sx!);
    // 꺼지면 숨기고 정보 항목도 없다
    kp.draw(exits('inactive', null), codes, ALL_SEEN);
    expect(f.images.every((i) => !i.visible)).toBe(true);
    expect(kp.info().length).toBe(0);
    f.shutdown();
    expect(f.keys.size).toBe(0);
  });

  it('프레임마다 새로 만들지 않는다: 같은 판이면 정보 목록 · 항목이 같은 객체이고 값 문자열도 그대로다', async () => {
    const { ExitKeypads } = await import('../../client/src/render/keypad');
    const f = fakeScene();
    const kp = new ExitKeypads(f.scene as never, { add: vi.fn() } as never);
    kp.draw(exits('active', 0.45), ['07', '40'], ALL_SEEN);
    const list = kp.info();
    const item = list[0];
    const value = item?.value;
    for (let t = 0; t < 10; t += 1) kp.draw(exits('active', 0.45 + t * 0.001), ['07', '40'], ALL_SEEN);
    expect(kp.info()).toBe(list);
    expect(kp.info()[0]).toBe(item);
    expect(kp.info()[0]?.value).toBe(value);
  });
});
