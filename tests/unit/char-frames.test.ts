// 새 캐릭터 스타일 아틀라스 프레임 (캐릭터 리디자인 2단계, client/src/art/charFrames.ts): 굽는 그림 · 이름 표 · 고르기.
//  - 괴물 화면 생존자 프레임은 걷기 위상 · 걷기 세기만으로 고른다 (역할 · 체력 · 능력 · 구조 · 수감 인자 없음, VISUAL_SPEC 0장 ③)
//  - 'survivor-hidden*' 프레임은 공통 생존자 그림(COMMON_ART)뿐이고 무채색이다
//  - 리그가 쓰는 옛 이름이 새 스타일 텍스처에 모두 있다 (Phaser는 없는 프레임에 경고를 낸다)
//  - 모든 프레임 그림이 굽기 상자 안 · 크기 기준 안
import { describe, expect, it } from 'vitest';
import {
  CLOAK_FRAMES,
  DrawingMemo,
  EMPTY_ALIASES,
  HIDDEN_FRAME_NAMES,
  MONSTER_FRAME_NAMES,
  ROLE_FRAME_NAMES,
  SHARED_FRAMES,
  WALK_FRAMES,
  hiddenFrameNew,
  monsterFrameNew,
  newStyleFrameSpecs,
  phaseIndex,
  teamFrameNew,
  type TeamFrameInput,
} from '../../client/src/art/charFrames';
import { COMMON_ART } from '../../client/src/art/chars/index';
import { toSvg, type Drawing, type Paint } from '../../client/src/art/chars/kit';
import { drawingPoints, monsterOver, survivorOver } from '../../client/src/art/chars/measure';
import { HIDDEN_REST } from '../../client/src/art/chars/types';
import { Rng } from '@decoy/shared';

const W = 0.19;
const specs = newStyleFrameSpecs();
const byName = new Map(specs.map((s) => [s.name, s]));
/** 프레임 그림 · 경로 표본 (두 시험이 같이 쓴다: 한 번만 그린다) */
const drawn = new Map<string, Drawing>();
const sampled = new Map<string, [number, number][]>();
function drawingOf(name: string): Drawing {
  let d = drawn.get(name);
  if (!d) {
    d = byName.get(name)!.draw(W);
    drawn.set(name, d);
  }
  return d;
}
function pointsOf(name: string): [number, number][] {
  let p = sampled.get(name);
  if (!p) {
    p = drawingPoints(drawingOf(name));
    sampled.set(name, p);
  }
  return p;
}

/** 새 스타일 텍스처에 있는 이름 (자세 그림 + 옛 그림 그대로 굽는 공용 프레임 + 빈 칸 별칭) */
const NEW_TEXTURE_NAMES = new Set([...byName.keys(), ...SHARED_FRAMES, ...EMPTY_ALIASES]);

/** 옛(기존) 스타일 리그 · 그리기가 쓰는 이름 (render/characters.ts · worldRenderer.ts) */
function classicRigNames(): string[] {
  const out = [
    'shadow-survivor',
    'shadow-monster',
    'ring-self',
    'gloss',
    'bubble',
    'mote',
    'claw',
    'eye-glow',
    'eyes-open',
    'eyes-blink',
    'eyes-stun',
    'survivor-hidden',
    'survivor-hidden-flash',
    'foot-hidden',
    'monster-dash',
    'monster-stun',
  ];
  for (const r of ['runner', 'guard', 'scout'])
    out.push(
      `survivor-${r}`,
      `survivor-${r}-gray`,
      `survivor-${r}-flash`,
      `foot-${r}`,
      `ring-reveal-${r}`,
      `glyph-${r}`,
    );
  for (let i = 0; i < CLOAK_FRAMES; i += 1) out.push(`monster-idle-${i}`, `monster-move-${i}`);
  return out;
}

function chroma(c: number): number {
  const ch = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  return (Math.max(...ch) - Math.min(...ch)) / 255;
}

function paintColors(dr: Drawing): number[] {
  const ps: Paint[] = dr.ops.flatMap((op) => [
    ...(op.fill ? [op.fill] : []),
    ...(op.stroke ? [op.stroke.paint] : []),
  ]);
  return ps.flatMap((p) => (p.kind === 'solid' ? [p.color] : p.stops.map(([, c]) => c)));
}

describe('새 캐릭터 프레임: 괴물 화면 공통 생존자 (VISUAL_SPEC 0장 ③)', () => {
  it('프레임 고르기는 걷기 위상 · 걷기 세기 2개만 받는다 — 역할 · 체력 · 능력 · 구조 · 수감 자리가 없다 (타입 검사)', () => {
    // 실행하지 않는 함수: tsc -p tests가 @ts-expect-error 줄에 타입 에러가 있는지(= 인자 자리가 없는지) 확인한다
    const typeOnly = (): void => {
      hiddenFrameNew(0, 1);
      // @ts-expect-error 역할을 넘길 자리가 없다
      hiddenFrameNew(0, 1, 'runner');
      // @ts-expect-error 수감 여부를 넘길 자리가 없다 (기존 스타일처럼 수감자와 자유 생존자를 같게 그린다)
      hiddenFrameNew(0, 1, true);
      // @ts-expect-error 능력 상태(객체)를 넣을 수 없다
      hiddenFrameNew(0, 1, { abilityActive: 3 });
    };
    expect(typeof typeOnly).toBe('function');
    expect(hiddenFrameNew.length).toBe(2);
  });

  it('결정적: 같은 걷기 값이면 같은 프레임 이름이고(입력은 걷기 값 둘뿐), 이름은 공통 생존자 쉬기 · 걷기 표 안에 있다', () => {
    const names = new Set<string>([HIDDEN_FRAME_NAMES.rest, ...HIDDEN_FRAME_NAMES.walk]);
    const rng = new Rng(11);
    for (let k = 0; k < 2000; k += 1) {
      const phase = rng.next() * 40 - 20;
      const stepping = rng.next() * 1.4 - 0.2;
      const a = hiddenFrameNew(phase, stepping);
      expect(hiddenFrameNew(phase, stepping)).toBe(a);
      expect(names.has(a), a).toBe(true);
    }
    // 멈춰 있으면 옛 이름 그대로 (정지 상태 E2E가 두 스타일에서 같은 키를 본다)
    expect(hiddenFrameNew(1.3, 0)).toBe('survivor-hidden');
  });

  it("'survivor-hidden*' 프레임은 공통 생존자 그림뿐이고 무채색이다 (역할색 · 괴물 빨강 없음)", () => {
    const hidden = specs.filter((s) => s.name.startsWith('survivor-hidden'));
    // 쉬기 · 걷기 · 흰 실루엣뿐 (수감 자세 없음)
    expect(hidden.length).toBe(2 + WALK_FRAMES);
    for (const s of hidden) {
      const d = s.draw(W);
      for (const c of paintColors(d))
        expect(chroma(c), `${s.name} #${c.toString(16)}`).toBeLessThanOrEqual(20 / 255);
    }
    // 쉬는 자세 · 걷기 자세는 COMMON_ART 그림 그대로
    const same = (name: string, pose: Partial<typeof HIDDEN_REST>): void =>
      expect(toSvg(byName.get(name)!.draw(W), { viewBox: [-2, -2, 4, 4], idPrefix: 'a' })).toBe(
        toSvg(COMMON_ART.top({ ...HIDDEN_REST, ...pose }, { w: W }), {
          viewBox: [-2, -2, 4, 4],
          idPrefix: 'a',
        }),
      );
    same(HIDDEN_FRAME_NAMES.rest, {});
    same(HIDDEN_FRAME_NAMES.walk[2] ?? '', { walk: Math.PI / 2, stride: 1 });
  });
});

describe('새 캐릭터 프레임: 이름 표 · 고르기', () => {
  it('리그가 쓰는 옛 이름이 새 스타일 텍스처에 모두 있다 (없는 프레임 경고 방지)', () => {
    for (const n of classicRigNames()) expect(NEW_TEXTURE_NAMES.has(n), n).toBe(true);
  });

  it('고르기 함수가 내는 이름은 모두 굽는 프레임에 있다', () => {
    const rng = new Rng(3);
    for (let k = 0; k < 3000; k += 1) {
      const role = (['runner', 'guard', 'scout'] as const)[k % 3]!;
      const input: TeamFrameInput = {
        walkPhase: rng.next() * 30 - 10,
        stepping: rng.next() * 1.2,
        action: rng.next() < 0.4 ? rng.next() : 0,
        captive: rng.next() < 0.2,
        reach: rng.next() < 0.2,
        hit: rng.next() < 0.1,
        gray: rng.next() < 0.05,
      };
      const t = teamFrameNew(role, input);
      expect(byName.has(t), t).toBe(true);
      const m = monsterFrameNew({
        stunned: rng.next() < 0.1,
        dashing: rng.next() < 0.1,
        windup: rng.next() < 0.2,
        strike: rng.next() < 0.1,
        roar: rng.next() < 0.1,
        moving: rng.next() < 0.5,
        cloak: Math.floor(rng.next() * CLOAK_FRAMES),
      });
      expect(byName.has(m), m).toBe(true);
    }
    expect(byName.has(ROLE_FRAME_NAMES.runner.hitFlash)).toBe(true);
    expect(byName.has(MONSTER_FRAME_NAMES.roar)).toBe(true);
  });

  it('우선순위: 사망 회색 > 피격 > 수감 > 구조 > 능력 > 걷기 > 쉬기, 괴물은 기절 > 돌진 > 타격 > 준비 > 포효', () => {
    const base: TeamFrameInput = {
      walkPhase: 0,
      stepping: 0,
      action: 0,
      captive: false,
      reach: false,
      hit: false,
      gray: false,
    };
    const N = ROLE_FRAME_NAMES.guard;
    expect(teamFrameNew('guard', base)).toBe(N.rest);
    expect(teamFrameNew('guard', { ...base, stepping: 1 })).toBe(N.walk[0]);
    expect(teamFrameNew('guard', { ...base, action: 1, stepping: 1 })).toBe(N.action[1]);
    expect(teamFrameNew('guard', { ...base, action: 0.5 })).toBe(N.action[0]);
    expect(teamFrameNew('guard', { ...base, action: 1, reach: true })).toBe(N.reach);
    expect(teamFrameNew('guard', { ...base, reach: true, captive: true })).toBe(N.captive);
    expect(teamFrameNew('guard', { ...base, captive: true, hit: true })).toBe(N.hit);
    expect(teamFrameNew('guard', { ...base, hit: true, gray: true })).toBe(N.gray);
    // 러너 질주 중 걸으면 질주 걷기 프레임
    expect(teamFrameNew('runner', { ...base, action: 1, stepping: 1, walkPhase: Math.PI })).toBe(
      ROLE_FRAME_NAMES.runner.sprint[4],
    );
    const m = {
      stunned: false,
      dashing: false,
      windup: false,
      strike: false,
      roar: false,
      moving: false,
      cloak: 3,
    };
    expect(monsterFrameNew(m)).toBe('monster-idle-3');
    expect(monsterFrameNew({ ...m, moving: true })).toBe('monster-move-3');
    expect(monsterFrameNew({ ...m, roar: true, windup: true })).toBe(MONSTER_FRAME_NAMES.windup);
    expect(monsterFrameNew({ ...m, windup: true, strike: true })).toBe(MONSTER_FRAME_NAMES.strike);
    expect(monsterFrameNew({ ...m, strike: true, dashing: true })).toBe(MONSTER_FRAME_NAMES.dash);
    expect(monsterFrameNew({ ...m, dashing: true, stunned: true })).toBe(MONSTER_FRAME_NAMES.stun);
  });

  it('걷기 위상 → 칸 번호: 가장 가까운 칸, 음수 · 큰 위상 · NaN도 0..n−1', () => {
    expect(phaseIndex(0, 8)).toBe(0);
    expect(phaseIndex(Math.PI, 8)).toBe(4);
    expect(phaseIndex(-Math.PI / 2, 8)).toBe(6);
    expect(phaseIndex(2 * Math.PI * 7 + Math.PI / 4, 8)).toBe(1);
    expect(phaseIndex(Number.NaN, 8)).toBe(0);
    // 품질 낮음은 걷기 위상을 4단계로 끊어 넘긴다 → 짝수 칸만
    for (let q = 0; q < 12; q += 1) expect(phaseIndex((q * Math.PI) / 2, 8) % 2).toBe(0);
  });

  it('프레임 이름은 겹치지 않는다', () => {
    expect(byName.size).toBe(specs.length);
    for (const n of SHARED_FRAMES) expect(byName.has(n), n).toBe(false);
  });
});

describe('새 캐릭터 프레임: 굽기 상자 · 크기 기준', () => {
  it('모든 프레임 그림이 굽기 상자 안에 든다 (직사각 칸이 그림을 자르지 않게)', () => {
    for (const s of specs) {
      const b = s.box;
      for (const [x, y] of pointsOf(s.name)) {
        expect(x, s.name).toBeGreaterThanOrEqual(b.x0);
        expect(x, s.name).toBeLessThanOrEqual(b.x1);
        expect(y, s.name).toBeGreaterThanOrEqual(b.y0);
        expect(y, s.name).toBeLessThanOrEqual(b.y1);
      }
    }
  });

  it('굽는 모든 자세가 크기 기준 안 (생존자 앞 1.55r · 옆 1.05r · 뒤 1.0r, 괴물 1.12r · 돌진 1.35r)', () => {
    for (const s of specs) {
      const d = drawingOf(s.name);
      const over = s.unit === 's' ? survivorOver(d) : monsterOver(d, s.name === MONSTER_FRAME_NAMES.dash);
      expect(over, s.name).toBeNull();
    }
  });
});

describe('새 캐릭터 프레임: 그림 명령 기억 (판 중 배율이 바뀌어 다시 굽기)', () => {
  it('같은 외곽선 두께면 다시 만들지 않고, 두께가 바뀌면(반지름이 바뀌면) 그 자리를 바꾼다', () => {
    const memo = new DrawingMemo();
    const a = specs[0]!;
    const b = specs[1]!;
    const d1 = memo.get(a, W);
    expect(memo.get(a, W)).toBe(d1);
    memo.get(b, W);
    expect(memo.made).toBe(2);
    const d2 = memo.get(a, W * 2);
    expect(d2).not.toBe(d1);
    expect(memo.made).toBe(3);
    expect(memo.size).toBe(2);
    memo.clear();
    expect(memo.size).toBe(0);
  });

  it('기억한 그림은 새로 그린 그림과 같다 (같은 입력 → 같은 명령)', () => {
    const memo = new DrawingMemo();
    for (const s of specs.slice(0, 12)) expect(memo.get(s, W)).toEqual(s.draw(W));
  });
});
