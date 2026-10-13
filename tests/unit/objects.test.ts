// 배지 (M10b, render/objects.ts Badges · art/mapArtBadges.ts): 정보 레이어 항목, 캐릭터 아래 레이어, 상태 색 + 아이콘.
// Badges는 Phaser 객체 · DOM 캔버스를 쓰므로 장면 · 캔버스 · 글자 모듈을 가짜로 바꿔 생성 순서 · 정보 레이어 · 굽기를 본다.
// 렌더링 최적화 2: 배지 다섯 장을 아틀라스 한 장에 굽는다. 예전(배지마다 캔버스 한 장) 굽기 계산을 오라클로 두고
// 프레임 크기 · 변환 · 이미지 자리 · 그린 것이 같은지 본다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURE_POINTS, EXITS, PRISON_CENTER, TILE_PX, type ExitView, type PointView } from '@decoy/shared';
import {
  BADGE,
  PRISON_COLOR,
  PRISON_LOCK,
  badgeInfo,
  dimmed,
  exitColor,
  exitSignAt,
  pointColor,
  pointIcon,
  type BadgeAlpha,
} from '../../client/src/art/mapArtBadges';
import { OBJ_COLOR } from '../../client/src/art/mapArtGeom';
import { NEON, ROLE, WARN } from '../../client/src/art/palette';
import { gfxState } from '../../client/src/gfx/state';
import { paintedRadii } from '../../client/src/render/fogPaint';
import {
  BADGE_BOX,
  BADGE_IDS,
  badgeRect,
  layoutBadgeAtlas,
  paintExitBadge,
  paintLockBadge,
  paintPointBadge,
} from '../../client/src/render/objects';
import { MAP_SCALE, MAP_X, MAP_Y, tileToScreen } from '../../client/src/ui/layout';

interface FakeText {
  x: number;
  y: number;
  text: string;
  alpha: number;
  setOrigin(): FakeText;
  setAlpha(a: number): FakeText;
}

const made: FakeText[] = [];

vi.mock('../../client/src/ui/text', () => ({
  makeText: (_scene: unknown, x: number, y: number, text: string): FakeText => {
    const t: FakeText = {
      x,
      y,
      text,
      alpha: 1,
      setOrigin: () => t,
      setAlpha: (a: number) => {
        t.alpha = a;
        return t;
      },
    };
    made.push(t);
    return t;
  },
}));

const ALL_SEEN: BadgeAlpha = { points: { A: 1, B: 1 }, exits: { N: 1, S: 1 }, prison: 1 };
const NO_BLINK = { A: false, B: false };
const RADII = { point: 2.5, exit: 1.5 };

describe('배지 정보 레이어 (badgeInfo)', () => {
  const points: PointView[] = [
    { id: 'A', progress: 0.25, state: 'blocked' },
    { id: 'B', progress: 1, state: 'done' },
  ];

  it('거점 배지 2 · 탈출구 배지 2 · 감옥 배지 1 + 거점 진행 2 + (생존자 화면) 탈출구 진행', () => {
    const exits: ExitView[] = [
      { id: 'N', state: 'active', progress: 0.4 },
      { id: 'S', state: 'inactive', progress: 0 },
    ];
    const info = badgeInfo(points, exits, ALL_SEEN, NO_BLINK, RADII);
    expect(info.filter((i) => i.kind === 'badge').map((i) => i.tag)).toEqual([
      'point-A',
      'point-B',
      'exit-N',
      'exit-S',
      'prison',
    ]);
    expect(info.filter((i) => i.kind === 'progress').map((i) => [i.tag, i.value])).toEqual([
      ['point-A', 0.25],
      ['point-B', 1],
      ['exit-N', 0.4],
      ['exit-S', 0],
    ]);
    const a = info.find((i) => i.kind === 'badge' && i.tag === 'point-A');
    expect(a).toMatchObject({
      x: CAPTURE_POINTS.A.x,
      y: CAPTURE_POINTS.A.y,
      r: 2.5,
      value: 'blocked',
      color: WARN,
    });
    const n = info.find((i) => i.kind === 'badge' && i.tag === 'exit-N');
    expect(n).toMatchObject({
      x: EXITS.N.center.x,
      y: EXITS.N.center.y,
      r: 1.5,
      value: 'active',
      color: OBJ_COLOR.go,
    });
    const p = info.find((i) => i.tag === 'prison');
    expect(p).toMatchObject({
      x: PRISON_CENTER.x,
      y: PRISON_CENTER.y,
      r: null,
      value: null,
      color: PRISON_COLOR,
    });
    for (const i of info) {
      expect(i.dir).toBeNull();
      expect(i.arc).toBeNull();
    }
  });

  it('괴물 화면(탈출구 progress = null)에는 탈출구 진행 항목이 없다', () => {
    const exits: ExitView[] = [
      { id: 'N', state: 'active', progress: null },
      { id: 'S', state: 'open', progress: null },
    ];
    const info = badgeInfo(points, exits, ALL_SEEN, NO_BLINK, RADII);
    expect(info.filter((i) => i.kind === 'progress').map((i) => i.tag)).toEqual(['point-A', 'point-B']);
    expect(info.filter((i) => i.kind === 'badge').length).toBe(5);
  });

  it('알파 규칙: 안 보이는 곳 45%, 괴물 화면 점령 중 깜빡임 0.25 (진행 값 · 색은 그대로)', () => {
    const exits: ExitView[] = [{ id: 'N', state: 'inactive', progress: null }];
    const capturing: PointView[] = [{ id: 'A', progress: 0.5, state: 'capturing' }];
    const dim: BadgeAlpha = { points: { A: 0.45, B: 1 }, exits: { N: 0.45, S: 1 }, prison: 0.45 };
    const seen = badgeInfo(capturing, exits, dim, NO_BLINK, RADII);
    const blink = badgeInfo(capturing, exits, dim, { A: true, B: false }, RADII);
    const alphaOf = (list: typeof seen, tag: string): number | undefined =>
      list.find((i) => i.kind === 'badge' && i.tag === tag)?.alpha;
    expect(alphaOf(seen, 'point-A')).toBe(0.45);
    expect(alphaOf(blink, 'point-A')).toBe(BADGE.blinkAlpha);
    expect(alphaOf(seen, 'exit-N')).toBe(0.45);
    expect(alphaOf(seen, 'prison')).toBe(0.45);
    expect(seen.find((i) => i.kind === 'progress')).toEqual(blink.find((i) => i.kind === 'progress'));
  });

  it('상태는 색만이 아니라 아이콘으로도 갈린다 (점령 중 ▶ · 정지 ‖ · 완료 ✓), 경고 주황은 정지에만', () => {
    expect(pointIcon('idle')).toBeNull();
    expect(pointIcon('capturing')).toBe('play');
    expect(pointIcon('blocked')).toBe('pause');
    expect(pointIcon('done')).toBe('check');
    expect(pointColor('blocked')).toBe(WARN);
    for (const s of ['idle', 'capturing', 'done'] as const) expect(pointColor(s)).not.toBe(WARN);
    expect(pointColor('capturing')).toBe(NEON);
    expect(exitColor('inactive')).not.toBe(exitColor('active'));
    // 예약 색: 역할 4색은 배지에 쓰지 않는다
    for (const c of [exitColor('active'), exitColor('inactive'), PRISON_COLOR, pointColor('idle')])
      expect(Object.values(ROLE)).not.toContain(c);
  });

  it('미리 섞은 불투명 색: 알파 1이면 원래 색, 0이면 어두운 바닥색', () => {
    expect(dimmed(0x22d3ee, 1)).toBe(0x22d3ee);
    expect(dimmed(0x22d3ee, 0)).toBe(BADGE.backdrop);
  });
});

/** 그린 것 하나 (기기 px 좌표로 바꾼 점들 · 칠/선 색 · 두께) */
interface Draw {
  fn: string;
  pts: [number, number][];
  style: string;
  width: number;
}

/** save ~ restore 한 번 = 배지 한 장 굽기: 그때 캔버스 크기와 그 안에서 그린 것 */
interface Bake {
  size: [number, number];
  draws: Draw[];
  /** 그린 것의 범위 (선은 두께의 반 + 꼭짓점 마이터를 더한다) */
  ext: { x0: number; y0: number; x1: number; y1: number };
}

/** 기록용 2D 컨텍스트: 변환(축 정렬)을 적용한 좌표로 그린 것을 모으고, save ~ restore마다 한 굽기로 나눈다 */
class RecCtx {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  lineJoin = 'miter';
  lineCap = 'butt';
  readonly bakes: Bake[] = [];
  readonly clears: [number, number, number, number][] = [];
  /** drawImage (복사): 원본 캔버스 · 자리 · 그때 변환 */
  readonly copies: { src: unknown; x: number; y: number; m: number[] }[] = [];
  private cur: Bake | null = null;
  private m = [1, 0, 0, 1, 0, 0];
  private pts: [number, number][] = [];

  constructor(readonly canvas: { width: number; height: number }) {}

  private tx(x: number, y: number): [number, number] {
    const [a, , , d, e, f] = this.m;
    return [a! * x + e!, d! * y + f!];
  }

  private push(fn: string, pts: [number, number][], style: string, pad: number): void {
    const d: Draw = { fn, pts, style, width: this.lineWidth * this.m[0]! };
    // save 없이 그리면 그 캔버스의 굽기 하나로 본다 (굽기마다 새 작업 캔버스)
    if (!this.cur) {
      this.cur = {
        size: [this.canvas.width, this.canvas.height],
        draws: [],
        ext: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
      };
      this.bakes.push(this.cur);
    }
    const b = this.cur;
    b.draws.push(d);
    for (const [x, y] of pts) {
      b.ext.x0 = Math.min(b.ext.x0, x - pad);
      b.ext.y0 = Math.min(b.ext.y0, y - pad);
      b.ext.x1 = Math.max(b.ext.x1, x + pad);
      b.ext.y1 = Math.max(b.ext.y1, y + pad);
    }
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.m = [a, b, c, d, e, f];
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.clears.push([x, y, w, h]);
  }
  private stack: {
    m: number[];
    lineWidth: number;
    lineJoin: string;
    lineCap: string;
    fill: string;
    stroke: string;
  }[] = [];
  save(): void {
    this.cur = {
      size: [this.canvas.width, this.canvas.height],
      draws: [],
      ext: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
    };
    this.bakes.push(this.cur);
    this.stack.push({
      m: this.m,
      lineWidth: this.lineWidth,
      lineJoin: this.lineJoin,
      lineCap: this.lineCap,
      fill: this.fillStyle,
      stroke: this.strokeStyle,
    });
  }
  restore(): void {
    // 변환 · 선 상태를 save 때로 되돌린다
    this.cur = null;
    const st = this.stack.pop();
    if (!st) return;
    this.m = st.m;
    this.lineWidth = st.lineWidth;
    this.lineJoin = st.lineJoin;
    this.lineCap = st.lineCap;
    this.fillStyle = st.fill;
    this.strokeStyle = st.stroke;
  }
  drawImage(src: unknown, x: number, y: number): void {
    this.copies.push({ src, x, y, m: this.m });
  }
  beginPath(): void {
    this.pts = [];
  }
  moveTo(x: number, y: number): void {
    this.pts.push(this.tx(x, y));
  }
  lineTo(x: number, y: number): void {
    this.pts.push(this.tx(x, y));
  }
  arcTo(x1: number, y1: number, x2: number, y2: number): void {
    this.pts.push(this.tx(x1, y1), this.tx(x2, y2));
  }
  arc(x: number, y: number, r: number): void {
    this.pts.push(this.tx(x - r, y - r), this.tx(x + r, y + r));
  }
  closePath(): void {}
  fill(): void {
    this.push('fill', this.pts, this.fillStyle, 0);
  }
  stroke(): void {
    // 마름모 꼭짓점(90°) 마이터까지: 두께 × 0.71
    this.push('stroke', this.pts, this.strokeStyle, this.lineWidth * this.m[0]! * 0.75);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.push('fillRect', [this.tx(x, y), this.tx(x + w, y + h)], this.fillStyle, 0);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.push(
      'strokeRect',
      [this.tx(x, y), this.tx(x + w, y + h)],
      this.strokeStyle,
      (this.lineWidth * this.m[0]!) / 2,
    );
  }
}

interface FakeImage {
  x: number;
  y: number;
  scale: number;
  visible: boolean;
  key: string;
  frame: string;
  setOrigin(): FakeImage;
  setVisible(v: boolean): FakeImage;
  setPosition(x: number, y: number): FakeImage;
  setScale(s: number): FakeImage;
  setFrame(f: string): FakeImage;
  destroy(): void;
}

interface FakeFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Badges가 쓰는 장면 부분 (가짜): 상자 · 이미지 · 텍스처(프레임) · 캔버스 */
function fakeScene(): {
  scene: object;
  box: { list: unknown[] };
  images: FakeImage[];
  ctxs: RecCtx[];
  frames: Map<string, FakeFrame>;
  frameSets: string[];
  uploads: () => number;
  moveBelow: ReturnType<typeof vi.fn>;
} {
  const images: FakeImage[] = [];
  const ctxs: RecCtx[] = [];
  const frames = new Map<string, FakeFrame>();
  const frameSets: string[] = [];
  let uploads = 0;
  const box = {
    list: [] as unknown[],
    add(o: unknown): void {
      box.list.push(o);
    },
  };
  const keys = new Set<string>();
  const moveBelow = vi.fn();
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = { width: 0, height: 0, getContext: (): RecCtx => ctx };
      const ctx = new RecCtx(canvas);
      ctxs.push(ctx);
      return canvas;
    },
  });
  const image = (cfg: { x: number; y: number; key: string; frame: string }): FakeImage => {
    const img: FakeImage = {
      x: cfg.x,
      y: cfg.y,
      scale: 1,
      visible: true,
      key: cfg.key,
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
  const scene = {
    make: { container: () => box, image },
    textures: {
      exists: (k: string) => keys.has(k),
      remove: (k: string) => keys.delete(k),
      create: (k: string, src: { width: number; height: number }) => {
        keys.add(k);
        const setFrame = (name: string, x: number, y: number, w: number, h: number): void => {
          frames.set(name, { x, y, w, h });
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
    children: { moveBelow },
    events: { once: () => undefined },
  };
  return { scene, box, images, ctxs, frames, frameSets, uploads: () => uploads, moveBelow };
}

// ───────────── 오라클: 렌더링 최적화 2 전의 배지 굽기 (배지마다 캔버스 한 장) ─────────────

const T = TILE_PX;

/** 예전 BadgePatch.bake의 캔버스 자리 · 크기 · 변환 · 이미지 자리 */
function oldBake(at: readonly [number, number], box: (typeof BADGE_BOX)['point'], zoom: number) {
  const kd = MAP_SCALE * zoom;
  const ex = zoom * MAP_X;
  const ey = zoom * MAP_Y;
  const dx0 = Math.floor(ex + (at[0] + box.x0) * kd);
  const dy0 = Math.floor(ey + (at[1] + box.y0) * kd);
  const w = Math.ceil(ex + (at[0] + box.x1) * kd) - dx0;
  const h = Math.ceil(ey + (at[1] + box.y1) * kd) - dy0;
  return {
    w,
    h,
    transform: [kd, 0, 0, kd, ex - dx0, ey - dy0] as const,
    pos: [(dx0 / zoom - MAP_X) / MAP_SCALE, (dy0 / zoom - MAP_Y) / MAP_SCALE] as const,
    scale: 1 / kd,
  };
}

/** 예전 배지 다섯 장 (그린 순서) */
function oldBadges(
  points: PointView[],
  exits: ExitView[],
  alpha: BadgeAlpha,
  blink: Record<'A' | 'B', boolean>,
) {
  const out: {
    id: string;
    at: [number, number];
    box: (typeof BADGE_BOX)['point'];
    paint: (c: RecCtx) => void;
  }[] = [];
  for (const p of points) {
    const a = blink[p.id] ? BADGE.blinkAlpha : alpha.points[p.id];
    const c = CAPTURE_POINTS[p.id];
    const at: [number, number] = [c.x * T, (c.y + BADGE.pointDy) * T];
    out.push({
      id: `point-${p.id}`,
      at,
      box: BADGE_BOX.point,
      paint: (g) => paintPointBadge(g as never, at[0], at[1], pointColor(p.state), pointIcon(p.state), a),
    });
  }
  for (const e of exits) {
    const s = exitSignAt(e.id);
    const at: [number, number] = [s.x * T, s.y * T];
    out.push({
      id: `exit-${e.id}`,
      at,
      box: BADGE_BOX.exit,
      paint: (g) => paintExitBadge(g as never, at[0], at[1], exitColor(e.state), alpha.exits[e.id]),
    });
  }
  const lock: [number, number] = [PRISON_LOCK.x * T, PRISON_LOCK.y * T];
  out.push({
    id: 'prison',
    at: lock,
    box: BADGE_BOX.lock,
    paint: (g) => paintLockBadge(g as never, lock[0], lock[1], alpha.prison),
  });
  return out;
}

describe('Badges (캐릭터 아래 레이어, 바뀔 때만 구운 아틀라스 한 장)', () => {
  beforeEach(() => {
    made.length = 0;
    paintedRadii.point = 2.5;
    paintedRadii.exit = 1.5;
    gfxState.zoom = 1;
  });

  it('배지 상자를 맵 컨테이너에 넣고(캐릭터보다 먼저), A · B 글자를 맵 컨테이너 바로 아래로 내린다', async () => {
    const { Badges } = await import('../../client/src/render/objects');
    const { scene, box, moveBelow } = fakeScene();
    const container = { add: vi.fn() };
    const badges = new Badges(scene as never, container as never);
    // 상자 하나만 넣는다 (그 뒤에 캐릭터 레이어가 들어온다: 늘 캐릭터 아래)
    expect(container.add.mock.calls.length).toBe(1);
    expect(container.add.mock.calls[0]?.[0] === box).toBe(true);
    expect(made.map((t) => t.text)).toEqual(['A', 'B']);
    expect(moveBelow.mock.calls.length).toBe(2);
    moveBelow.mock.calls.forEach((call, n) => {
      expect(call[0] === made[n]).toBe(true);
      expect(call[1] === container).toBe(true);
    });
    // 글자 자리: 패드 위쪽 가장자리 (가운데 단말 · 서 있는 캐릭터와 겹치지 않음)
    const pa = tileToScreen(CAPTURE_POINTS.A.x, CAPTURE_POINTS.A.y + BADGE.pointDy);
    expect([made[0]?.x, made[0]?.y]).toEqual([pa.x, pa.y]);
    expect(badges.info()).toEqual([]);
  });

  for (const zoom of [1, 2, 1.5, 2.625, 3]) {
    it(`배율 ${zoom}: 배지 5개를 아틀라스 한 장의 겹치지 않는 칸에 굽고, 예전(배지마다 캔버스)과 같은 크기 · 변환 · 이미지 자리 · 그림이다`, async () => {
      const { Badges } = await import('../../client/src/render/objects');
      const { scene, box, images, ctxs, frames, uploads } = fakeScene();
      gfxState.zoom = zoom;
      const badges = new Badges(scene as never, { add: vi.fn() } as never);
      const points: PointView[] = [
        { id: 'A', progress: 0.5, state: 'capturing' },
        { id: 'B', progress: 0.2, state: 'done' },
      ];
      const exits: ExitView[] = [
        { id: 'N', state: 'inactive', progress: null },
        { id: 'S', state: 'active', progress: null },
      ];
      const alpha: BadgeAlpha = { points: { A: 1, B: 0.45 }, exits: { N: 0.45, S: 1 }, prison: 1 };
      const blink = { A: true, B: false };
      badges.draw(points, exits, alpha, blink);
      expect(badges.info()).toEqual(badgeInfo(points, exits, alpha, blink, RADII));
      expect(made.map((t) => t.alpha)).toEqual([BADGE.blinkAlpha, 0.45]);
      // 텍스처(아틀라스 캔버스) 한 장 + 굽기마다 새 작업 캔버스, 이미지 다섯 개 (프레임만 다르다), 한 번만 올린다
      expect(ctxs.length).toBe(6);
      const atlas = ctxs[0]!;
      const works = ctxs.slice(1);
      expect(images.length).toBe(5);
      expect(box.list.length).toBe(5);
      expect(new Set(images.map((i) => i.key)).size).toBe(1);
      expect(images.map((i) => i.frame)).toEqual(['point-A', 'point-B', 'exit-N', 'exit-S', 'prison']);
      expect(uploads()).toBe(1);
      expect(gfxState.features.badgeGfxCmds).toBe(0);
      // 아틀라스에는 그리지 않고 복사만 한다 (정수 자리, 변환 없음)
      expect(atlas.bakes).toEqual([]);
      expect(atlas.copies.length).toBe(5);
      for (const w of works) expect(w.bakes.length).toBe(1);
      const old = oldBadges(points, exits, alpha, blink);
      const rects: FakeFrame[] = [];
      for (const [n, img] of images.entries()) {
        const o = old[n]!;
        const ob = oldBake(o.at, o.box, zoom);
        const f = frames.get(img.frame)!;
        const work = works[n]!;
        const bake = work.bakes[0]!;
        const copy = atlas.copies[n]!;
        // 작업 캔버스 = 예전 배지 캔버스 크기, 프레임 = 그 크기, 복사 자리 = 프레임 왼쪽 위 (정수, 변환 없음)
        expect(bake.size).toEqual([ob.w, ob.h]);
        expect([f.w, f.h]).toEqual([ob.w, ob.h]);
        expect(copy.src).toBe(work.canvas);
        expect([copy.x, copy.y]).toEqual([f.x, f.y]);
        expect(Number.isInteger(f.x) && Number.isInteger(f.y)).toBe(true);
        expect(copy.m).toEqual([1, 0, 0, 1, 0, 0]);
        // 복사 전에 칸을 지운다 (칸 크기 ≥ 프레임)
        expect(atlas.clears.some(([x, y, w, h]) => x === f.x && y === f.y && w >= f.w && h >= f.h)).toBe(
          true,
        );
        // 이미지 자리 · 배율이 예전과 같다 (텍셀 = 기기 픽셀: 왼쪽 위가 기기 픽셀 정수)
        expect([img.x, img.y]).toEqual(ob.pos);
        expect(img.scale).toBe(ob.scale);
        expect(img.visible).toBe(true);
        const devX = (MAP_X + img.x * MAP_SCALE) * zoom;
        const devY = (MAP_Y + img.y * MAP_SCALE) * zoom;
        expect(Math.abs(devX - Math.round(devX))).toBeLessThan(1e-6);
        expect(Math.abs(devY - Math.round(devY))).toBeLessThan(1e-6);
        // 그림: 예전 배지 캔버스와 같은 변환 · 같은 호출 (좌표까지 그대로)
        const ref = new RecCtx({ width: ob.w, height: ob.h });
        ref.setTransform(...ob.transform);
        ref.save();
        o.paint(ref);
        expect(bake.draws).toEqual(ref.bakes[0]!.draws);
        // 그린 것이 프레임 안 (잘리지 않음), 불투명하게 그린다 (알파는 색에 미리 섞음)
        expect(bake.draws.length).toBeGreaterThan(0);
        expect(bake.ext.x0).toBeGreaterThanOrEqual(0);
        expect(bake.ext.y0).toBeGreaterThanOrEqual(0);
        expect(bake.ext.x1).toBeLessThanOrEqual(f.w);
        expect(bake.ext.y1).toBeLessThanOrEqual(f.h);
        for (const d of bake.draws) expect(d.style).toMatch(/^rgba\(\d+, \d+, \d+, 1\)$/);
        rects.push(f);
      }
      // 칸은 아틀라스 안이고 서로 겹치지 않으며 사이에 투명 테가 있다
      for (const [i, a] of rects.entries()) {
        expect(a.x).toBeGreaterThanOrEqual(1);
        expect(a.y).toBeGreaterThanOrEqual(1);
        expect(a.x + a.w).toBeLessThanOrEqual(atlas.canvas.width - 1);
        expect(a.y + a.h).toBeLessThanOrEqual(atlas.canvas.height - 1);
        for (const c of rects.slice(i + 1))
          expect(
            a.x + a.w + 1 <= c.x || c.x + c.w + 1 <= a.x || a.y + a.h + 1 <= c.y || c.y + c.h + 1 <= a.y,
          ).toBe(true);
      }
    });
  }

  it('칸은 배지가 어떤 소수 자리에 놓여도 들어가는 크기다 (배율 여러 개 × 기준점 소수 자리)', () => {
    for (let k = 0; k < 400; k += 1) {
      const zoom = 0.5 + k * 0.0123;
      const l = layoutBadgeAtlas(zoom);
      for (const id of BADGE_IDS) {
        const r = badgeRect(id, zoom);
        const s = l.slots[id];
        expect(r.w).toBeLessThanOrEqual(s.w);
        expect(r.h).toBeLessThanOrEqual(s.h);
      }
    }
  });

  it('상태 · 알파 · 배율이 바뀐 배지만 다시 굽고, 바뀐 프레임에만 한 번 올린다 (진행 값만 바뀌면 굽지도 올리지도 않는다)', async () => {
    const { Badges } = await import('../../client/src/render/objects');
    const { scene, ctxs, frameSets, uploads, images } = fakeScene();
    const badges = new Badges(scene as never, { add: vi.fn() } as never);
    const exits: ExitView[] = [
      { id: 'N', state: 'inactive', progress: null },
      { id: 'S', state: 'inactive', progress: null },
    ];
    const pts = (p: number, s: PointView['state']): PointView[] => [
      { id: 'A', progress: p, state: s },
      { id: 'B', progress: 0, state: 'idle' },
    ];
    let total = 0;
    const baked = (): string[] => {
      const out = frameSets.splice(0);
      total += out.length;
      return out;
    };
    badges.draw(pts(0.1, 'capturing'), exits, ALL_SEEN, NO_BLINK);
    expect(baked()).toEqual(['point-A', 'point-B', 'exit-N', 'exit-S', 'prison']);
    expect(uploads()).toBe(1);
    badges.draw(pts(0.6, 'capturing'), exits, ALL_SEEN, NO_BLINK);
    expect(baked()).toEqual([]);
    expect(uploads()).toBe(1);
    badges.draw(pts(0.6, 'blocked'), exits, ALL_SEEN, NO_BLINK);
    expect(baked()).toEqual(['point-A']);
    expect(uploads()).toBe(2);
    // 알파만 바뀐 탈출구 · 감옥
    badges.draw(
      pts(0.6, 'blocked'),
      exits,
      { ...ALL_SEEN, exits: { N: 1, S: 0.45 }, prison: 0.45 },
      NO_BLINK,
    );
    expect(baked()).toEqual(['exit-S', 'prison']);
    expect(uploads()).toBe(3);
    // 깜빡임 (괴물 화면 점령 중)
    badges.draw(
      pts(0.6, 'blocked'),
      exits,
      { ...ALL_SEEN, exits: { N: 1, S: 0.45 }, prison: 0.45 },
      {
        A: true,
        B: false,
      },
    );
    expect(baked()).toEqual(['point-A']);
    // 배율이 바뀌면 칸을 다시 나누고 모두 다시 굽는다
    gfxState.zoom = 2;
    badges.draw(pts(0.6, 'blocked'), exits, ALL_SEEN, NO_BLINK);
    expect(baked()).toEqual(['point-A', 'point-B', 'exit-N', 'exit-S', 'prison']);
    // 아틀라스 한 장 + 굽기마다 작업 캔버스 하나 (굽지 않은 프레임에는 만들지 않는다)
    expect(ctxs.length).toBe(1 + total);
    expect(images.every((i) => i.visible)).toBe(true);
    // 감옥 자물쇠 · 탈출구 표지판 자리
    expect(PRISON_LOCK.y).toBeGreaterThan(PRISON_CENTER.y);
    expect(exitSignAt('N').y).toBeLessThan(1);
    expect(exitSignAt('S').y).toBeGreaterThan(31);
  });
});
