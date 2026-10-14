// 캐릭터 리디자인 크기 점검 (Node, 브라우저 없이): 자세 묶음마다 크기 기준(client/src/art/chars/measure.ts SIZE_RULE)을
// 가장 많이 넘는 점과 구역별 최대 거리를 찍는다. `node scripts/char-art.mjs sizes [runner|guard|scout|common|monster ...]`
import { COMMON_ART, MONSTER_ART, SURVIVOR_ART } from '../../client/src/art/chars/index';
import type { Drawing } from '../../client/src/art/chars/kit';
import {
  SIZE_RULE,
  drawingPoints,
  monsterOver,
  survivorOver,
  type SizeOver,
} from '../../client/src/art/chars/measure';
import {
  HIDDEN_REST,
  MONSTER_REST,
  SURVIVOR_REST,
  type CharId,
  type MonsterPose,
  type SurvivorPose,
} from '../../client/src/art/chars/types';

const W = 0.19;
const PHASES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4 + 0.3);

interface Zones {
  front: number;
  side: number;
  back: number;
  radial: number;
}

function zones(dr: Drawing): Zones {
  const z: Zones = { front: 0, side: 0, back: 0, radial: 0 };
  for (const [x, y] of drawingPoints(dr)) {
    const r = Math.hypot(x, y);
    const a = Math.abs(Math.atan2(y, x));
    z.radial = Math.max(z.radial, r);
    if (a <= SIZE_RULE.survivor.sector) z.front = Math.max(z.front, r);
    else if (x >= 0) z.side = Math.max(z.side, r);
    else z.back = Math.max(z.back, r);
  }
  return z;
}

function fmt(o: SizeOver | null): string {
  return o
    ? `넘음 ${o.zone} ${o.r.toFixed(3)} > ${o.limit} (점 ${o.x.toFixed(2)}, ${o.y.toFixed(2)})`
    : '기준 안';
}

function report(
  id: string,
  groups: { label: string; drawings: { d: Drawing; dash: boolean }[] }[],
  over: (d: Drawing, dash: boolean) => SizeOver | null,
): boolean {
  let ok = true;
  console.log(`== ${id}`);
  for (const g of groups) {
    let worst: SizeOver | null = null;
    const z: Zones = { front: 0, side: 0, back: 0, radial: 0 };
    for (const { d, dash } of g.drawings) {
      const o = over(d, dash);
      if (o && (!worst || o.r - o.limit > worst.r - worst.limit)) worst = o;
      const zz = zones(d);
      z.front = Math.max(z.front, zz.front);
      z.side = Math.max(z.side, zz.side);
      z.back = Math.max(z.back, zz.back);
      z.radial = Math.max(z.radial, zz.radial);
    }
    if (worst) ok = false;
    console.log(
      `  ${g.label.padEnd(10)} 앞 ${z.front.toFixed(2)} 옆 ${z.side.toFixed(2)} 뒤 ${z.back.toFixed(2)} 가장 먼 점 ${z.radial.toFixed(2)} — ${fmt(worst)}`,
    );
  }
  return ok;
}

function survivorGroups(
  top: (p: SurvivorPose) => Drawing,
): { label: string; drawings: { d: Drawing; dash: boolean }[] }[] {
  const grid = (extra: Partial<SurvivorPose>): { d: Drawing; dash: boolean }[] =>
    PHASES.flatMap((walk) =>
      [0, 1].map((stride) => ({ d: top({ ...SURVIVOR_REST, walk, stride, ...extra }), dash: false })),
    );
  return [
    { label: '서기·걷기', drawings: grid({}) },
    { label: '능력 0.5', drawings: grid({ action: 0.5 }) },
    { label: '능력 1', drawings: grid({ action: 1 }) },
    { label: '피격', drawings: grid({ hit: 1 }) },
    { label: '수감', drawings: grid({ mode: 'captive' }) },
    { label: '구조 중', drawings: grid({ mode: 'reach' }) },
  ];
}

function monsterGroups(): { label: string; drawings: { d: Drawing; dash: boolean }[] }[] {
  const grid = (extra: Partial<MonsterPose>): { d: Drawing; dash: boolean }[] =>
    PHASES.flatMap((walk) =>
      [0, 1].map((stride) => ({
        d: MONSTER_ART.top({ ...MONSTER_REST, walk, stride, cloak: walk * 1.7, ...extra }, { w: W }),
        dash: (extra.dash ?? 0) > 0,
      })),
    );
  return [
    { label: '서기·걷기', drawings: grid({}) },
    { label: '준비 0.5', drawings: grid({ windup: 0.5 }) },
    { label: '준비 1', drawings: grid({ windup: 1 }) },
    { label: '타격', drawings: grid({ strike: 1 }) },
    { label: '돌진', drawings: grid({ dash: 1 }) },
    { label: '포효', drawings: grid({ roar: 1 }) },
    { label: '기절', drawings: grid({ stun: 1, eyes: 'stun' }) },
  ];
}

export function run(ids: readonly CharId[]): boolean {
  let ok = true;
  const want = ids.length ? ids : (['runner', 'guard', 'scout', 'common', 'monster'] as const);
  for (const id of want) {
    if (id === 'monster') ok = report(id, monsterGroups(), monsterOver) && ok;
    else if (id === 'common') {
      const groups = [false, true].map((captive) => ({
        label: captive ? '수감' : '서기·걷기',
        drawings: PHASES.flatMap((walk) =>
          [0, 1].map((stride) => ({
            d: COMMON_ART.top({ ...HIDDEN_REST, walk, stride, captive }, { w: W }),
            dash: false,
          })),
        ),
      }));
      ok = report(id, groups, (d) => survivorOver(d)) && ok;
    } else
      ok =
        report(
          id,
          survivorGroups((p) => SURVIVOR_ART[id].top(p, { w: W })),
          (d) => survivorOver(d),
        ) && ok;
  }
  console.log(
    `기준: 생존자 앞 ±60° ≤ ${SIZE_RULE.survivor.front} · 옆 ≤ ${SIZE_RULE.survivor.side} · 뒤 ≤ ${SIZE_RULE.survivor.back} / 괴물 ≤ ${SIZE_RULE.monster.all} (돌진 ≤ ${SIZE_RULE.monster.dash})`,
  );
  return ok;
}
