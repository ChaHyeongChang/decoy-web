// 배지 (M10b, render/objects.ts Badges · art/mapArtBadges.ts): 정보 레이어 항목, 캐릭터 아래 레이어, 상태 색 + 아이콘.
// Badges는 Phaser 객체를 쓰므로 Phaser와 글자 모듈을 가짜로 바꿔 생성 순서 · 정보 레이어만 본다.
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
import { paintedRadii } from '../../client/src/render/fogPaint';
import { tileToScreen } from '../../client/src/ui/layout';

interface FakeText {
  x: number;
  y: number;
  text: string;
  alpha: number;
  setOrigin(): FakeText;
  setAlpha(a: number): FakeText;
}

const made: FakeText[] = [];

vi.mock('phaser', () => {
  class Vector2 {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }
  return { default: { Math: { Vector2 } } };
});

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

/** 모든 메서드 호출을 기록하는 가짜 Graphics */
function fakeGraphics(): { g: object; calls: { name: string; args: unknown[] }[] } {
  const calls: { name: string; args: unknown[] }[] = [];
  const g: object = new Proxy(
    {},
    {
      get:
        (_t, name) =>
        (...args: unknown[]) => {
          calls.push({ name: String(name), args });
          return g;
        },
    },
  );
  return { g, calls };
}

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

describe('Badges (캐릭터 아래 레이어)', () => {
  beforeEach(() => {
    made.length = 0;
    paintedRadii.point = 2.5;
    paintedRadii.exit = 1.5;
  });

  it('그래픽을 맵 컨테이너에 넣고(캐릭터보다 먼저), A · B 글자를 맵 컨테이너 바로 아래로 내린다', async () => {
    const { Badges } = await import('../../client/src/render/objects');
    const { g, calls } = fakeGraphics();
    const container = { add: vi.fn() };
    const moveBelow = vi.fn();
    const scene = { add: { graphics: () => g }, children: { moveBelow } };
    // 가짜 장면 · 컨테이너 (Badges가 쓰는 부분만)
    const badges = new Badges(scene as never, container as never);
    expect(container.add.mock.calls.length).toBe(1);
    expect(container.add.mock.calls[0]?.[0] === g).toBe(true);
    expect(made.map((t) => t.text)).toEqual(['A', 'B']);
    expect(moveBelow.mock.calls.length).toBe(2);
    moveBelow.mock.calls.forEach((call, n) => {
      expect(call[0] === made[n]).toBe(true);
      expect(call[1] === container).toBe(true);
    });
    // 글자 자리: 패드 위쪽 가장자리 (가운데 단말 · 서 있는 캐릭터와 겹치지 않음)
    const pa = tileToScreen(CAPTURE_POINTS.A.x, CAPTURE_POINTS.A.y + BADGE.pointDy);
    expect([made[0]?.x, made[0]?.y]).toEqual([pa.x, pa.y]);

    const points: PointView[] = [
      { id: 'A', progress: 0.5, state: 'capturing' },
      { id: 'B', progress: 0, state: 'idle' },
    ];
    const exits: ExitView[] = [
      { id: 'N', state: 'inactive', progress: null },
      { id: 'S', state: 'inactive', progress: null },
    ];
    const alpha: BadgeAlpha = { points: { A: 1, B: 0.45 }, exits: { N: 0.45, S: 0.45 }, prison: 1 };
    badges.draw(points, exits, alpha, { A: true, B: false });
    expect(badges.info()).toEqual(badgeInfo(points, exits, alpha, { A: true, B: false }, RADII));
    expect(made.map((t) => t.alpha)).toEqual([BADGE.blinkAlpha, 0.45]);
    // 불투명하게 그린다 (알파는 색에 미리 섞음): 채우기 · 선 알파 인자는 모두 1
    for (const c of calls.filter((k) => k.name === 'fillStyle' || k.name === 'lineStyle'))
      expect(c.args[c.name === 'fillStyle' ? 1 : 2]).toBe(1);
    // 감옥 자물쇠 · 탈출구 표지판 자리
    expect(PRISON_LOCK.y).toBeGreaterThan(PRISON_CENTER.y);
    expect(exitSignAt('N').y).toBeLessThan(1);
    expect(exitSignAt('S').y).toBeGreaterThan(31);
  });
});
