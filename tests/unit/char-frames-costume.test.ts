// 의상 프레임 (메타 c, client/src/art/charFrames.ts · costumeBake.ts): 의상은 그 역할 칸을 같은 이름 · 같은 상자로 바꿔 굽는다.
//  - 이름 · 상자 · 순서가 기본과 같다 (텍스처가 늘지 않는다 — 칸만 바꿔 그린다)
//  - 괴물 화면 공통 생존자(hidden) 칸은 어떤 의상이어도 기본 그림 그대로 (VISUAL_SPEC 0장 ③)
//  - 모든 의상 프레임이 굽기 상자 · 크기 기준 안, 게임 화면(위 그림)에 청록 없음
//  - 그림 명령 기억은 의상이 바뀌면 그 칸만 다시 만든다
//  - 판 시작 명단 → 굽기 의상: 괴물 명단(자기뿐)이면 생존자 칸은 기본
import { beforeAll, describe, expect, it } from 'vitest';
import { MONSTER_COSTUMES, SURVIVOR_COSTUMES, type RosterEntry } from '@decoy/shared';
import {
  BASIC_COSTUME_SET,
  DrawingMemo,
  MONSTER_FRAME_NAMES,
  costumeOf,
  newStyleFrameSpecs,
  type CharFrameSpec,
  type CostumeSet,
} from '../../client/src/art/charFrames';
import { registerAllCostumeArt } from '../../client/src/art/chars/costume/art';
import { costumeArtReady } from '../../client/src/art/chars/costume/registry';
import type { Drawing, Paint } from '../../client/src/art/chars/kit';
import {
  SIZE_EPS,
  SIZE_RULE,
  drawingPoints,
  monsterOver,
  survivorOver,
} from '../../client/src/art/chars/measure';
import {
  bakeCostumes,
  costumeSetFromRoster,
  lobbyCostumeSet,
  setBakeCostumes,
} from '../../client/src/art/costumeBake';

const W = 0.19;

beforeAll(() => {
  registerAllCostumeArt();
});

/** 의상 하나를 생존자 셋 모두에 / 괴물에 입힌 세트 (기본 제외) */
function costumeSets(): { label: string; set: CostumeSet }[] {
  const out: { label: string; set: CostumeSet }[] = [];
  for (const c of SURVIVOR_COSTUMES)
    if (c !== 'basic') out.push({ label: c, set: { runner: c, guard: c, scout: c, monster: 'basic' } });
  for (const c of MONSTER_COSTUMES)
    if (c !== 'basic') out.push({ label: c, set: { ...BASIC_COSTUME_SET, monster: c } });
  return out;
}

function paintColors(dr: Drawing): number[] {
  const ps: Paint[] = dr.ops.flatMap((op) => [
    ...(op.fill ? [op.fill] : []),
    ...(op.stroke ? [op.stroke.paint] : []),
  ]);
  return ps.flatMap((p) => (p.kind === 'solid' ? [p.color] : p.stops.map(([, c]) => c)));
}

/** 청록 네온 (정면 그림 예외 색, VISUAL_SPEC 2장 예약 색) — 게임 화면 위 그림에는 쓰지 않는다 */
const TEAL = new Set([0x22d3ee, 0x0e7490, 0x67e8f9]);
/** 색상각 175~200° · 채도 0.3 넘음 = 청록 계열 */
function isTealish(c: number): boolean {
  const r = ((c >> 16) & 255) / 255;
  const g = ((c >> 8) & 255) / 255;
  const b = (c & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.3) return false;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  const deg = (h * 60 + 360) % 360;
  return deg >= 175 && deg <= 200;
}

const basicSpecs = newStyleFrameSpecs();

describe('의상 프레임: 같은 칸 바꿔 굽기', () => {
  it('어떤 의상이어도 프레임 이름 · 단위 · 상자 · 순서가 기본과 같다 (텍스처가 늘지 않는다)', () => {
    const shape = (ss: CharFrameSpec[]): unknown[] => ss.map((s) => [s.name, s.unit, s.box, s.owner]);
    for (const { label, set } of costumeSets())
      expect(shape(newStyleFrameSpecs(set)), label).toEqual(shape(basicSpecs));
  });

  it('칸마다 입힌 의상 = 그 주인의 의상, 공통 생존자(hidden)는 늘 basic', () => {
    const set: CostumeSet = { runner: 'scarf', guard: 'pack', scout: 'cape', monster: 'chains' };
    for (const s of newStyleFrameSpecs(set)) {
      expect(s.costume, s.name).toBe(costumeOf(set, s.owner));
      if (s.owner === 'hidden') expect(s.costume, s.name).toBe('basic');
    }
    expect(costumeOf(set, 'hidden')).toBe('basic');
  });

  it('괴물 화면 공통 생존자 칸은 어떤 의상이어도 기본 그림과 똑같다 (흰색 위장 · 의상 단서 없음)', () => {
    const basicHidden = new Map(
      basicSpecs.filter((s) => s.owner === 'hidden').map((s) => [s.name, s.draw(W)]),
    );
    expect(basicHidden.size).toBeGreaterThan(0);
    for (const { label, set } of costumeSets())
      for (const s of newStyleFrameSpecs(set).filter((x) => x.owner === 'hidden'))
        expect(s.draw(W), `${label} ${s.name}`).toEqual(basicHidden.get(s.name));
  });

  it('의상을 입힌 칸은 기본 그림과 다르다 (의상 그림 조각이 등록됐을 때)', () => {
    expect(costumeArtReady()).toBe(true);
    const basicByName = new Map(basicSpecs.map((s) => [s.name, s]));
    for (const { label, set } of costumeSets()) {
      const dressed = newStyleFrameSpecs(set).filter((s) => s.costume !== 'basic');
      expect(dressed.length, label).toBeGreaterThan(0);
      // 쉬는 자세 한 칸만 비교 (모든 칸을 그리면 느리다 — 아래 상자 시험이 모두 그린다)
      const rest = dressed.find((s) => !s.name.includes('~'))!;
      expect(rest.draw(W), `${label} ${rest.name}`).not.toEqual(basicByName.get(rest.name)!.draw(W));
    }
  });
});

/** 크기 기준 (measure.ts survivorOver · monsterOver와 같은 기준 — 점을 한 번만 뽑으려고 여기서 같은 식으로 잰다) */
function overRule(unit: 's' | 'm', dash: boolean, x: number, y: number): boolean {
  const r = Math.hypot(x, y);
  if (unit === 'm') return r - (dash ? SIZE_RULE.monster.dash : SIZE_RULE.monster.all) > SIZE_EPS;
  const R = SIZE_RULE.survivor;
  const a = Math.abs(Math.atan2(y, x));
  const limit = a <= R.sector ? R.front : x >= 0 ? R.side : R.back;
  return r - limit > SIZE_EPS;
}

describe('의상 프레임: 굽기 상자 · 크기 기준 · 색', () => {
  for (const { label, set } of costumeSets())
    it(`${label}: 입힌 모든 프레임이 굽기 상자 · 크기 기준 안이고 청록이 없다`, () => {
      // 모양이 같은 칸(회색 · 번쩍 변형 — 색만 다르다)은 점을 한 번만 잰다 (색은 칸마다 본다)
      const seen = new Set<string>();
      for (const s of newStyleFrameSpecs(set).filter((x) => x.costume !== 'basic')) {
        const d = s.draw(W);
        for (const c of paintColors(d)) {
          expect(TEAL.has(c), `${s.name} #${c.toString(16)}`).toBe(false);
          expect(isTealish(c), `${s.name} #${c.toString(16)}`).toBe(false);
        }
        const shape = `${s.unit}|${s.name === MONSTER_FRAME_NAMES.dash}|${d.ops.map((o) => o.d).join('')}`;
        if (seen.has(shape)) continue;
        seen.add(shape);
        const b = s.box;
        const dash = s.name === MONSTER_FRAME_NAMES.dash;
        let outBox: [number, number] | null = null;
        let outRule: [number, number] | null = null;
        for (const [x, y] of drawingPoints(d)) {
          if (!outBox && (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1)) outBox = [x, y];
          if (!outRule && overRule(s.unit, dash, x, y)) outRule = [x, y];
        }
        expect(outBox, `${s.name} 굽기 상자 밖`).toBeNull();
        expect(outRule, `${s.name} 크기 기준 밖`).toBeNull();
      }
    });

  it('크기 기준 식이 measure.ts와 같다 (표본 그림)', () => {
    const dressed = newStyleFrameSpecs({
      runner: 'cape',
      guard: 'pack',
      scout: 'scarf',
      monster: 'feathers',
    });
    for (const s of dressed.filter((x) => !x.name.includes('~')).slice(0, 8)) {
      const d = s.draw(W);
      const dash = s.name === MONSTER_FRAME_NAMES.dash;
      const mine = drawingPoints(d).some(([x, y]) => overRule(s.unit, dash, x, y));
      const theirs = (s.unit === 's' ? survivorOver(d) : monsterOver(d, dash)) !== null;
      expect(mine, s.name).toBe(theirs);
    }
  });
});

describe('의상 프레임: 그림 명령 기억', () => {
  it('같은 이름이어도 의상이 바뀌면 다시 만들고, 같은 의상이면 기억한 것을 쓴다', () => {
    const memo = new DrawingMemo();
    const name = 'survivor-runner';
    const plain = basicSpecs.find((s) => s.name === name)!;
    const dressed = newStyleFrameSpecs({ ...BASIC_COSTUME_SET, runner: 'scarf' }).find(
      (s) => s.name === name,
    )!;
    const d1 = memo.get(plain, W);
    const d2 = memo.get(dressed, W);
    expect(d2).not.toBe(d1);
    expect(memo.get(dressed, W)).toBe(d2);
    expect(memo.made).toBe(2);
    expect(memo.size).toBe(1);
  });
});

describe('굽기 의상 (costumeBake)', () => {
  const roster = (entries: Partial<RosterEntry>[]): RosterEntry[] =>
    entries.map((e, i) => ({ id: `p${i}`, name: '', bot: false, role: 'runner', ...e }) as RosterEntry);

  it('생존자 명단: 역할마다 받은 의상, 없는 역할 · 모르는 id는 기본', () => {
    const set = costumeSetFromRoster(
      roster([
        { role: 'runner', costume: 'scarf' },
        { role: 'guard' },
        { role: 'scout', costume: 'crown' as never },
        { role: 'monster', costume: 'chains' },
      ]),
    );
    expect(set).toEqual({ runner: 'scarf', guard: 'basic', scout: 'basic', monster: 'chains' });
  });

  it('괴물 명단(자기뿐)이면 생존자 칸은 모두 기본', () => {
    expect(costumeSetFromRoster(roster([{ role: 'monster', costume: 'feathers' }]))).toEqual({
      ...BASIC_COSTUME_SET,
      monster: 'feathers',
    });
  });

  it('로비 미리 굽기: 내가 고른 역할에만 내 의상', () => {
    const mine = { survivor: 'cape', monster: 'hood' } as const;
    expect(lobbyCostumeSet('guard', mine)).toEqual({ ...BASIC_COSTUME_SET, guard: 'cape' });
    expect(lobbyCostumeSet('monster', mine)).toEqual({ ...BASIC_COSTUME_SET, monster: 'hood' });
    expect(lobbyCostumeSet(null, mine)).toEqual(BASIC_COSTUME_SET);
  });

  it('그림 조각이 등록됐으면 입힐 의상을 굽기 값으로 낸다', () => {
    setBakeCostumes({ ...BASIC_COSTUME_SET, scout: 'pack' });
    expect(bakeCostumes()).toEqual({ ...BASIC_COSTUME_SET, scout: 'pack' });
    setBakeCostumes(BASIC_COSTUME_SET);
    expect(bakeCostumes()).toEqual(BASIC_COSTUME_SET);
  });
});
