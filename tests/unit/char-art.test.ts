// 새 캐릭터 그림 모듈 (캐릭터 리디자인 1단계 시안, client/src/art/chars): 게임에 들어가기 전에 그림 도구 · 그림 모듈의 약속을
// 지킨다. 경로는 Node에서 d 문자열을 읽어 곡선을 샘플해 잰다(Canvas · Path2D 없이).
//  - 모든 자세에서 경로 숫자가 유한값이고, 그림이 topExtent(굽기 프레임 반쪽 크기) 안에 든다
//  - 괴물 화면 공통 생존자는 무채색뿐이고, 자세 타입에 역할 · 능력 · 피격 · 구조 값이 없다 (VISUAL_SPEC 0장 ③)
//  - 청록 네온은 생존자 셋의 정면 그림에만, 시설 네온 세 값으로 (VISUAL_SPEC 1.2 예외). 게임 화면 위 그림 · 괴물 · 공통 생존자에는 없다
//  - 그라디언트 정지점 순서, SVG id 충돌 없음, 경로 빌더 · 그림 옮기기의 수식
import { describe, expect, it } from 'vitest';
import { COMMON_ART, MONSTER_ART, SURVIVOR_ART } from '../../client/src/art/chars/index';
import { path, toSvg, transformDrawing, type Drawing, type Paint } from '../../client/src/art/chars/kit';
import {
  drawingMask,
  drawingPoints,
  monsterOver,
  samplePath,
  survivorOver,
} from '../../client/src/art/chars/measure';
import { maskIoU } from '../../client/src/art/shapes';
import {
  FRONT_REST,
  HIDDEN_REST,
  MONSTER_REST,
  SURVIVOR_REST,
  type HiddenPose,
  type MonsterPose,
  type SurvivorPose,
} from '../../client/src/art/chars/types';
import { NEON, NEON_DIM, NEON_TEXT, ROLE } from '../../client/src/art/palette';

const W = 0.19;
const ROLES = ['runner', 'guard', 'scout'] as const;

/** 그림이 차지하는 반쪽 크기 (max |x| · |y|, 선 두께 제외) */
function halfExtent(dr: Drawing): number {
  let m = 0;
  for (const op of dr.ops) for (const [x, y] of samplePath(op.d)) m = Math.max(m, Math.abs(x), Math.abs(y));
  return m;
}

const points = drawingPoints;

function allFinite(dr: Drawing): boolean {
  return dr.ops.every((op) => samplePath(op.d).every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
}

function paints(dr: Drawing): Paint[] {
  return dr.ops.flatMap((op) => [...(op.fill ? [op.fill] : []), ...(op.stroke ? [op.stroke.paint] : [])]);
}

function colors(p: Paint): number[] {
  return p.kind === 'solid' ? [p.color] : p.stops.map(([, c]) => c);
}

/** 채도 대신 쓰는 색 폭 (최대 채널 − 최소 채널, 0~1): 아주 어두운 외곽선에서도 흔들리지 않는다 */
/** 공통 생존자 무채색 한도 (색 폭, 0~1) */
const GRAY_CHROMA = 20 / 255;

function chroma(c: number): number {
  const ch = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  return (Math.max(...ch) - Math.min(...ch)) / 255;
}

const PHASES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4 + 0.3);

function survivorGrid(): SurvivorPose[] {
  const out: SurvivorPose[] = [];
  for (const walk of PHASES)
    for (const stride of [0, 1])
      for (const action of [0, 0.5, 1])
        for (const hit of [0, 1])
          for (const mode of ['free', 'captive', 'reach'] as const)
            out.push({ ...SURVIVOR_REST, walk, stride, action, hit, mode });
  return out;
}

function monsterGrid(): MonsterPose[] {
  const out: MonsterPose[] = [];
  const acts: Partial<MonsterPose>[] = [
    {},
    { windup: 0.5 },
    { windup: 1 },
    { strike: 1 },
    { dash: 1 },
    { roar: 1 },
    { stun: 1, eyes: 'stun' },
  ];
  for (const walk of PHASES)
    for (const stride of [0, 1])
      for (const act of acts) out.push({ ...MONSTER_REST, walk, stride, cloak: walk * 1.7, ...act });
  return out;
}

function hiddenGrid(): HiddenPose[] {
  const out: HiddenPose[] = [];
  for (const walk of PHASES)
    for (const stride of [0, 1])
      for (const captive of [false, true]) out.push({ ...HIDDEN_REST, walk, stride, captive });
  return out;
}

// 크기 기준 (사용자 결정: 기존 시각 명세를 지킨다, client/src/art/chars/measure.ts SIZE_RULE)
describe('새 캐릭터 그림: 크기 기준 (판정보다 커 보이지 않게)', () => {
  it('역할 생존자 셋: 모든 자세에서 앞 ±60° 1.15r · 옆 1.05r · 뒤 1.0r 안', () => {
    for (const id of ROLES)
      for (const p of survivorGrid()) {
        const over = survivorOver(SURVIVOR_ART[id].top(p, { w: W }));
        expect(over, `${id} ${JSON.stringify(p)}`).toBeNull();
      }
  });

  it('공통 생존자: 모든 자세에서 같은 기준 안', () => {
    for (const p of hiddenGrid()) {
      const over = survivorOver(COMMON_ART.top(p, { w: W }));
      expect(over, JSON.stringify(p)).toBeNull();
    }
  });

  it('괴물: 모든 자세 1.12r 안 (발톱 · 팔 · 자락 모두), 돌진만 1.15r', () => {
    for (const p of monsterGrid()) {
      const over = monsterOver(MONSTER_ART.top(p, { w: W }), p.dash > 0);
      expect(over, JSON.stringify(p)).toBeNull();
    }
  });
});

describe('새 캐릭터 그림: 범위 · 유한값', () => {
  it('역할 생존자 셋: 모든 자세에서 경로가 유한값이고 topExtent 안에 든다', () => {
    for (const id of ROLES) {
      const art = SURVIVOR_ART[id];
      let max = 0;
      for (const p of survivorGrid()) {
        const d = art.top(p, { w: W });
        expect(allFinite(d), id).toBe(true);
        max = Math.max(max, halfExtent(d));
      }
      expect(max, id).toBeLessThanOrEqual(art.topExtent);
    }
  });

  it('공통 생존자: 모든 자세에서 topExtent 안에 든다', () => {
    let max = 0;
    for (const p of hiddenGrid()) {
      const d = COMMON_ART.top(p, { w: W });
      expect(allFinite(d)).toBe(true);
      max = Math.max(max, halfExtent(d));
    }
    expect(max).toBeLessThanOrEqual(COMMON_ART.topExtent);
  });

  it('괴물: 걸으며 공격 준비 · 포효 같은 겹친 자세까지 topExtent 안에 든다', () => {
    let max = 0;
    for (const p of monsterGrid()) {
      const d = MONSTER_ART.top(p, { w: W });
      expect(allFinite(d)).toBe(true);
      max = Math.max(max, halfExtent(d));
    }
    expect(max).toBeLessThanOrEqual(MONSTER_ART.topExtent);
  });

  it('범위 밖 자세 값은 잘린다: 세기 5는 1과 같은 그림, NaN 위상은 0과 같은 그림', () => {
    const guard = SURVIVOR_ART.guard;
    expect(guard.top({ ...SURVIVOR_REST, action: 5 }, { w: W })).toEqual(
      guard.top({ ...SURVIVOR_REST, action: 1 }, { w: W }),
    );
    expect(guard.top({ ...SURVIVOR_REST, action: -1 }, { w: W })).toEqual(
      guard.top({ ...SURVIVOR_REST, action: 0 }, { w: W }),
    );
    expect(MONSTER_ART.top({ ...MONSTER_REST, roar: 3 }, { w: W })).toEqual(
      MONSTER_ART.top({ ...MONSTER_REST, roar: 1 }, { w: W }),
    );
    expect(SURVIVOR_ART.runner.top({ ...SURVIVOR_REST, walk: NaN, stride: 1 }, { w: W })).toEqual(
      SURVIVOR_ART.runner.top({ ...SURVIVOR_REST, walk: 0, stride: 1 }, { w: W }),
    );
    expect(COMMON_ART.front({ ...FRONT_REST, t: Infinity }, { w: 0.04 })).toEqual(
      COMMON_ART.front({ ...FRONT_REST, t: 0 }, { w: 0.04 }),
    );
  });

  it('정면 그림은 상자 [−1, 1]² 안: 전신은 모두, 상반신은 좌우 · 위 (아래는 아이콘 상자가 잘라 가슴까지 보인다)', () => {
    const fronts = [...ROLES.map((id) => SURVIVOR_ART[id].front), COMMON_ART.front, MONSTER_ART.front];
    for (const front of fronts)
      for (const t of [0, 0.65, 1.3]) {
        const full = points(front({ ...FRONT_REST, t }, { w: 0.04 }));
        for (const [x, y] of full) expect(Math.max(Math.abs(x), Math.abs(y))).toBeLessThanOrEqual(1);
        const bust = points(front({ ...FRONT_REST, t, bust: true }, { w: 0.04 }));
        for (const [x, y] of bust) {
          expect(Math.abs(x)).toBeLessThanOrEqual(1);
          expect(y).toBeGreaterThanOrEqual(-1);
        }
      }
  });
});

describe('새 캐릭터 그림: 색만으로 구분하지 않기 (VISUAL_SPEC 0장 ④)', () => {
  // 기존 실루엣 시험(shapes.test)과 같은 기준 · 크기 · 방향. 마스크 = 불투명한 칠(은은한 빛 · 네온 번짐 제외)
  const SIZES = [12.7, 18, 36];
  const roleMask = (r: (typeof ROLES)[number], d: number, rot: number): Uint8Array =>
    drawingMask(SURVIVOR_ART[r].top(SURVIVOR_REST, { w: W }), d, rot);

  it('역할끼리 겹침(IoU) 0.8 이하 — 12.7 · 18 · 36px, 두 방향', () => {
    for (const d of SIZES)
      for (const rot of [0, 0.6])
        for (let i = 0; i < ROLES.length; i += 1)
          for (let j = i + 1; j < ROLES.length; j += 1) {
            const a = ROLES[i]!;
            const b = ROLES[j]!;
            expect(maskIoU(roleMask(a, d, rot), roleMask(b, d, rot)), `${a}-${b} ${d}px`).toBeLessThanOrEqual(
              0.8,
            );
          }
  });

  it('괴물 화면 공통 생존자와 각 역할의 겹침 0.85 이하', () => {
    for (const d of SIZES)
      for (const rot of [0, 0.6]) {
        const hidden = drawingMask(COMMON_ART.top(HIDDEN_REST, { w: W }), d, rot);
        for (const r of ROLES)
          expect(maskIoU(hidden, roleMask(r, d, rot)), `hidden-${r} ${d}px`).toBeLessThanOrEqual(0.85);
      }
  });

  it('마스크 자체 확인: 같은 그림은 겹침 1, 비어 있지 않다', () => {
    const m = roleMask('runner', 18, 0);
    expect(m.some((v) => v === 1)).toBe(true);
    expect(maskIoU(m, roleMask('runner', 18, 0))).toBe(1);
  });
});

describe('새 캐릭터 그림: 괴물 화면 공통 생존자 (VISUAL_SPEC 0장 ③)', () => {
  it('칠하는 색은 무채색 계열뿐 (색 폭 20/255 이하: 옛 숨은 생존자와 같은 차가운 회색까지) — 역할색 · 괴물 빨강이 없다', () => {
    const roleColors = new Set<number>([ROLE.runner, ROLE.guard, ROLE.scout, ROLE.monster]);
    for (const p of hiddenGrid())
      for (const tone of ['normal', 'gray', 'flash'] as const)
        for (const pa of paints(COMMON_ART.top({ ...p, tone }, { w: W })))
          for (const c of colors(pa)) {
            expect(chroma(c), c.toString(16)).toBeLessThanOrEqual(GRAY_CHROMA);
            expect(roleColors.has(c)).toBe(false);
          }
    for (const pa of paints(COMMON_ART.front(FRONT_REST, { w: 0.04 })))
      for (const c of colors(pa)) expect(chroma(c), c.toString(16)).toBeLessThanOrEqual(GRAY_CHROMA);
  });

  it('자세 타입에 역할 · 능력 · 피격 · 구조 값이 없다 (타입 검사)', () => {
    // @ts-expect-error 능력 값은 공통 생존자 자세에 없다
    COMMON_ART.top({ ...HIDDEN_REST, action: 1 }, { w: W });
    // @ts-expect-error 구조 중(reach) 같은 역할 자세 mode는 받지 않는다
    COMMON_ART.top({ ...HIDDEN_REST, mode: 'reach' }, { w: W });
    // @ts-expect-error 공통 생존자는 역할 그림 표에 없다
    expect(SURVIVOR_ART.common).toBeUndefined();
    expect(Object.keys(SURVIVOR_ART).sort()).toEqual(['guard', 'runner', 'scout']);
  });

  it('결정적: 같은 자세면 같은 그림 (다른 입력이 들어올 자리가 없다는 것은 자세 타입 시험이 본다)', () => {
    const a = COMMON_ART.top({ ...HIDDEN_REST, walk: 1.2, stride: 1 }, { w: W });
    const b = COMMON_ART.top({ ...HIDDEN_REST, walk: 1.2, stride: 1 }, { w: W });
    expect(a).toEqual(b);
  });
});

/** 청록 계열인가 (색상 170~200°, 색 폭 0.25 넘음) — 게임 화면에서 시설 · 목표 뜻 */
function cyanish(c: number): boolean {
  const r = ((c >> 16) & 255) / 255;
  const g = ((c >> 8) & 255) / 255;
  const b = (c & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx - mn <= 0.25) return false;
  const d = mx - mn;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const deg = (h * 60 + 360) % 360;
  return deg >= 170 && deg <= 200;
}

/** 정면 그림에 쓸 수 있는 청록 (VISUAL_SPEC 1.2 예외: 시설 네온 · 꺼진 네온 · UI 청록 글자색) */
const FRONT_CYANS = new Set<number>([NEON, NEON_DIM, NEON_TEXT]);

describe('새 캐릭터 그림: 청록 네온은 정면 그림에만 (VISUAL_SPEC 1.2 예외)', () => {
  it('위에서 본 그림(게임 화면)에는 청록이 없다 — 역할 셋 · 모든 자세 · 톤, 괴물 · 공통 생존자', () => {
    for (const role of ROLES)
      for (const p of survivorGrid())
        for (const tone of ['normal', 'gray', 'flash'] as const)
          for (const pa of paints(SURVIVOR_ART[role].top({ ...p, tone }, { w: W })))
            for (const c of colors(pa)) expect(cyanish(c), `${role} #${c.toString(16)}`).toBe(false);
    for (const p of monsterGrid())
      for (const pa of paints(MONSTER_ART.top(p, { w: W })))
        for (const c of colors(pa)) expect(cyanish(c), `monster #${c.toString(16)}`).toBe(false);
    for (const p of hiddenGrid())
      for (const pa of paints(COMMON_ART.top(p, { w: W })))
        for (const c of colors(pa)) expect(cyanish(c), `common #${c.toString(16)}`).toBe(false);
  });

  it('정면 그림: 생존자 셋에는 청록 네온이 있고 그 색은 시설 네온 세 값뿐, 괴물 · 공통 생존자에는 없다', () => {
    for (const role of ROLES)
      for (const bust of [false, true]) {
        const cy = paints(SURVIVOR_ART[role].front({ ...FRONT_REST, bust }, { w: 0.04 }))
          .flatMap(colors)
          .filter(cyanish);
        expect(cy.length, `${role} 청록 있음`).toBeGreaterThan(0);
        for (const c of cy) expect(FRONT_CYANS.has(c), `${role} #${c.toString(16)}`).toBe(true);
      }
    for (const pa of paints(MONSTER_ART.front(FRONT_REST, { w: 0.04 })))
      for (const c of colors(pa)) expect(cyanish(c), `monster #${c.toString(16)}`).toBe(false);
  });

  it('정면 그림 사망 회색 톤에는 청록이 남지 않는다 (네온도 꺼진다)', () => {
    for (const role of ROLES)
      for (const pa of paints(SURVIVOR_ART[role].front({ ...FRONT_REST, tone: 'gray' }, { w: 0.04 })))
        for (const c of colors(pa)) expect(cyanish(c), `${role} #${c.toString(16)}`).toBe(false);
  });
});

describe('새 캐릭터 그림: 그림 도구 (kit)', () => {
  it('그라디언트 정지점은 0~1 안에서 커지는 순서', () => {
    const drawings: Drawing[] = [
      ...ROLES.flatMap((id) =>
        survivorGrid()
          .slice(0, 24)
          .map((p) => SURVIVOR_ART[id].top(p, { w: W })),
      ),
      ...monsterGrid()
        .slice(0, 14)
        .map((p) => MONSTER_ART.top(p, { w: W })),
      ...hiddenGrid().map((p) => COMMON_ART.top(p, { w: W })),
      ...ROLES.map((id) => SURVIVOR_ART[id].front(FRONT_REST, { w: 0.04 })),
      MONSTER_ART.front(FRONT_REST, { w: 0.04 }),
    ];
    for (const dr of drawings)
      for (const pa of paints(dr)) {
        if (pa.kind === 'solid') continue;
        const offs = pa.stops.map(([o]) => o);
        for (const o of offs) expect(o >= 0 && o <= 1).toBe(true);
        for (let i = 1; i < offs.length; i += 1) expect(offs[i]!).toBeGreaterThanOrEqual(offs[i - 1]!);
        if (pa.kind === 'radial') expect(pa.r).toBeGreaterThan(0);
      }
  });

  it('SVG 여러 장을 한 문서에 넣어도 그라디언트 id가 겹치지 않는다 (앞붙이를 주지 않아도)', () => {
    const a = toSvg(SURVIVOR_ART.runner.front(FRONT_REST, { w: 0.04 }), { viewBox: [-1, -1, 2, 2] });
    const b = toSvg(SURVIVOR_ART.guard.front(FRONT_REST, { w: 0.04 }), { viewBox: [-1, -1, 2, 2] });
    const ids = (s: string): string[] => [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!);
    const all = [...ids(a), ...ids(b)];
    expect(all.length).toBeGreaterThan(10);
    expect(new Set(all).size).toBe(all.length);
    // 앞붙이와 번호 사이 구분자: 'a1' + 1과 'a' + 11이 같은 id가 되지 않는다
    const p1 = toSvg(SURVIVOR_ART.scout.front(FRONT_REST, { w: 0.04 }), {
      viewBox: [-1, -1, 2, 2],
      idPrefix: 'a1',
    });
    const p2 = toSvg(SURVIVOR_ART.scout.front(FRONT_REST, { w: 0.04 }), {
      viewBox: [-1, -1, 2, 2],
      idPrefix: 'a',
    });
    const s1 = new Set(ids(p1));
    expect(ids(p2).some((id) => s1.has(id))).toBe(false);
  });

  it('SVG 접근성 제목은 속성 값으로 이스케이프된다', () => {
    const svg = toSvg({ ops: [] }, { viewBox: [0, 0, 1, 1], title: '러너 "빠름" <b>&' });
    expect(svg).toContain('aria-label="러너 &quot;빠름&quot; &lt;b&gt;&amp;"');
  });

  it('경로 빌더: 타원 · 닫기 뒤 Q는 지금 점(하위 경로 시작점)에서 이어진다', () => {
    // 타원은 (6, 5)에서 시작해 닫힌다 → Q의 첫 조절점은 (6, 5) + 2/3 × ((6, 8) − (6, 5)) = (6, 7)
    expect(path().ellipse(5, 5, 1, 1).Q(6, 8, 7, 5).d.endsWith('C6 7 6.333 7 7 5')).toBe(true);
    // 닫기(Z) 뒤에는 하위 경로 시작점 (0, 0)에서 이어진다
    expect(path().M(0, 0).L(2, 0).Z().Q(1, 3, 2, 0).d.endsWith('C0.667 2 1.333 2 2 0')).toBe(true);
  });

  it('그림 옮기기: 좌표 · 칠 · 선 두께가 같이 옮겨지고, 세로 배율 −1은 위아래를 뒤집는다', () => {
    const dr: Drawing = {
      ops: [
        {
          d: path().M(1, 2).L(3, -4).Z().d,
          fill: {
            kind: 'radial',
            cx: 1,
            cy: 1,
            r: 2,
            stops: [
              [0, 0xffffff],
              [1, 0],
            ],
          },
          stroke: { paint: { kind: 'linear', x0: 0, y0: 1, x1: 2, y1: 3, stops: [[0, 0]] }, width: 0.5 },
        },
      ],
    };
    const t = transformDrawing(dr, 2, 10, 20);
    expect(t.ops[0]!.d).toBe('M12 24L16 12Z');
    expect(t.ops[0]!.fill).toMatchObject({ cx: 12, cy: 22, r: 4 });
    expect(t.ops[0]!.stroke).toMatchObject({ width: 1, paint: { x0: 10, y0: 22, x1: 14, y1: 26 } });
    const m = transformDrawing(dr, 1, 0, 0, -1);
    expect(m.ops[0]!.d).toBe('M1 -2L3 4Z');
    expect(m.ops[0]!.fill).toMatchObject({ cx: 1, cy: -1, r: 2 });
    expect(() => transformDrawing({ ops: [{ d: 'M0 0LNaN 1Z' }] }, 2, 0, 0)).toThrow(/NaN/);
  });
});
