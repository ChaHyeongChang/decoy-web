// 배지 (M10b, render/objects.ts Badges · art/mapArtBadges.ts): 정보 레이어 항목, 캐릭터 아래 레이어, 상태 색 + 아이콘.
// Badges는 Phaser 객체 · DOM 캔버스를 쓰므로 장면 · 캔버스 · 글자 모듈을 가짜로 바꿔 생성 순서 · 정보 레이어 · 굽기를 본다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURE_POINTS, EXITS, PRISON_CENTER, type ExitView, type PointView } from '@decoy/shared';
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

/** 기록용 2D 컨텍스트: 변환(축 정렬)을 적용한 좌표로 그린 범위를 모으고, 칠 · 선 색을 기록한다 */
class RecCtx {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  lineJoin = 'miter';
  lineCap = 'butt';
  readonly styles: string[] = [];
  /** 그린 것의 기기 px 범위 (선은 두께의 반 + 꼭짓점 마이터를 더한다) */
  readonly ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  calls = 0;
  private m = [1, 0, 0, 1, 0, 0];
  private pts: [number, number][] = [];

  constructor(readonly canvas: { width: number; height: number }) {}

  private tx(x: number, y: number): [number, number] {
    const [a, , , d, e, f] = this.m;
    return [a! * x + e!, d! * y + f!];
  }

  private grow(pts: readonly [number, number][], pad: number): void {
    for (const [x, y] of pts) {
      this.ext.x0 = Math.min(this.ext.x0, x - pad);
      this.ext.y0 = Math.min(this.ext.y0, y - pad);
      this.ext.x1 = Math.max(this.ext.x1, x + pad);
      this.ext.y1 = Math.max(this.ext.y1, y + pad);
    }
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.m = [a, b, c, d, e, f];
  }
  clearRect(): void {}
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
    this.calls += 1;
    this.styles.push(this.fillStyle);
    this.grow(this.pts, 0);
  }
  stroke(): void {
    this.calls += 1;
    this.styles.push(this.strokeStyle);
    // 마름모 꼭짓점(90°) 마이터까지: 두께 × 0.71
    this.grow(this.pts, this.lineWidth * this.m[0]! * 0.75);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls += 1;
    this.styles.push(this.fillStyle);
    this.grow([this.tx(x, y), this.tx(x + w, y + h)], 0);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.calls += 1;
    this.styles.push(this.strokeStyle);
    this.grow([this.tx(x, y), this.tx(x + w, y + h)], (this.lineWidth * this.m[0]!) / 2);
  }
}

interface FakeImage {
  x: number;
  y: number;
  scale: number;
  visible: boolean;
  key: string;
  setOrigin(): FakeImage;
  setVisible(v: boolean): FakeImage;
  setPosition(x: number, y: number): FakeImage;
  setScale(s: number): FakeImage;
  setSizeToFrame(): FakeImage;
  destroy(): void;
}

/** Badges가 쓰는 장면 부분 (가짜): 상자 · 이미지 · 텍스처 · 캔버스 */
function fakeScene(): {
  scene: object;
  box: { list: unknown[] };
  images: FakeImage[];
  ctxs: RecCtx[];
  moveBelow: ReturnType<typeof vi.fn>;
} {
  const images: FakeImage[] = [];
  const ctxs: RecCtx[] = [];
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
  const image = (cfg: { x: number; y: number; key: string }): FakeImage => {
    const img: FakeImage = {
      x: cfg.x,
      y: cfg.y,
      scale: 1,
      visible: true,
      key: cfg.key,
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
      setSizeToFrame: () => img,
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
        return {
          add: () => undefined,
          get: () => ({ setSize: () => undefined }),
          source: [{ width: src.width, height: src.height, isPowerOf2: false, update: () => undefined }],
        };
      },
    },
    children: { moveBelow },
    events: { once: () => undefined },
  };
  return { scene, box, images, ctxs, moveBelow };
}

describe('Badges (캐릭터 아래 레이어, 바뀔 때만 구운 이미지)', () => {
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

  for (const zoom of [1, 2, 1.5]) {
    it(`배율 ${zoom}: 배지 5개를 기기 픽셀 1:1 이미지로 굽고, 그린 것이 캔버스 안이며, 색은 불투명(미리 섞음)이다`, async () => {
      const { Badges } = await import('../../client/src/render/objects');
      const { scene, box, images, ctxs } = fakeScene();
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
      badges.draw(points, exits, alpha, { A: true, B: false });
      expect(badges.info()).toEqual(badgeInfo(points, exits, alpha, { A: true, B: false }, RADII));
      expect(made.map((t) => t.alpha)).toEqual([BADGE.blinkAlpha, 0.45]);
      expect(images.length).toBe(5);
      expect(box.list.length).toBe(5);
      expect(gfxState.features.badgeGfxCmds).toBe(0);
      for (const [n, img] of images.entries()) {
        const ctx = ctxs[n]!;
        expect(img.visible).toBe(true);
        // 텍셀 = 기기 픽셀: 이미지 왼쪽 위가 기기 픽셀 정수, 배율 1/(맵 배율 × zoom)
        const devX = (MAP_X + img.x * MAP_SCALE) * zoom;
        const devY = (MAP_Y + img.y * MAP_SCALE) * zoom;
        expect(Math.abs(devX - Math.round(devX))).toBeLessThan(1e-6);
        expect(Math.abs(devY - Math.round(devY))).toBeLessThan(1e-6);
        expect(img.scale).toBeCloseTo(1 / (MAP_SCALE * zoom), 9);
        // 그린 것이 캔버스 안 (잘리지 않음)
        expect(ctx.calls).toBeGreaterThan(0);
        expect(ctx.ext.x0).toBeGreaterThanOrEqual(0);
        expect(ctx.ext.y0).toBeGreaterThanOrEqual(0);
        expect(ctx.ext.x1).toBeLessThanOrEqual(ctx.canvas.width);
        expect(ctx.ext.y1).toBeLessThanOrEqual(ctx.canvas.height);
        // 불투명하게 그린다 (알파는 색에 미리 섞음)
        for (const st of ctx.styles) expect(st).toMatch(/^rgba\(\d+, \d+, \d+, 1\)$/);
      }
    });
  }

  it('상태 · 알파 · 배율이 바뀐 배지만 다시 굽는다 (진행 값만 바뀌면 굽지 않는다)', async () => {
    const { Badges } = await import('../../client/src/render/objects');
    const { scene, ctxs } = fakeScene();
    const badges = new Badges(scene as never, { add: vi.fn() } as never);
    const exits: ExitView[] = [
      { id: 'N', state: 'inactive', progress: null },
      { id: 'S', state: 'inactive', progress: null },
    ];
    const pts = (p: number, s: PointView['state']): PointView[] => [
      { id: 'A', progress: p, state: s },
      { id: 'B', progress: 0, state: 'idle' },
    ];
    const calls = (): number[] => ctxs.map((c) => c.calls);
    badges.draw(pts(0.1, 'capturing'), exits, ALL_SEEN, NO_BLINK);
    const first = calls();
    badges.draw(pts(0.6, 'capturing'), exits, ALL_SEEN, NO_BLINK);
    expect(calls()).toEqual(first);
    badges.draw(pts(0.6, 'blocked'), exits, ALL_SEEN, NO_BLINK);
    const second = calls();
    expect(second[0]).toBeGreaterThan(first[0]!);
    expect(second.slice(1)).toEqual(first.slice(1));
    gfxState.zoom = 2;
    badges.draw(pts(0.6, 'blocked'), exits, ALL_SEEN, NO_BLINK);
    calls().forEach((c, n) => expect(c).toBeGreaterThan(second[n]!));
    // 감옥 자물쇠 · 탈출구 표지판 자리
    expect(PRISON_LOCK.y).toBeGreaterThan(PRISON_CENTER.y);
    expect(exitSignAt('N').y).toBeLessThan(1);
    expect(exitSignAt('S').y).toBeGreaterThan(31);
  });
});
