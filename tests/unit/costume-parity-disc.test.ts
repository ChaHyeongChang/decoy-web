// 몸 가운데 원판 점검 (VISUAL_SPEC 0장 ② '몸 가운데 0.45r 원판은 역할색', 판 밖 메타 c): 의상 여섯(괴물 두건 · 까마귀 깃 · 사슬,
// 생존자 목도리 · 배낭 · 망토 × 러너 · 가드 · 스카우트)이 아틀라스가 굽는 프레임 전부에서 몸 가운데 0.45r 원판을 기본 그림과
// 같게 둔다: 원판 안 칸 중 기본 그림과 색이 ΔE76 15 넘게 다른 칸이 5% 이하. ΔE76 15 = 같은 역할색의 명암 · 음영 차이보다 크고
// 다른 색(쇠 · 깃 · 천)으로 덮였을 때보다 작은 값. 5% = 몸 지름 44.8px에서 원판 약 320칸 중 16칸 — 가장자리 안티에일리어싱 ·
// 걷기 비틀림으로 끼어드는 얇은 끈 · 띠 끝 몫. 몸 지름은 낮음 상한 44.8px(괴물 · 생존자 같은 지름 — 원판은 몸 반지름 비율이라
// 크기와 상관없다), 구운 그대로(방향 0, 원점은 칸 가운데). 기본 그림과의 차이를 보므로 역할 그림의 음영은 견주지 않는다.
import { describe, expect, it } from 'vitest';
import type { MonsterCostumeId, SurvivorCostumeId } from '@decoy/shared';
import type { CharFrameSpec } from '../../client/src/art/charFrames';
import { drawingRaster } from '../../client/src/art/chars/measure';
import type { RoleCharId } from '../../client/src/art/chars/types';
import {
  DISC_DE,
  DISC_MAX,
  DISC_R,
  W,
  W_SURVIVOR,
  capPx,
  discShare,
  monsterFrames,
  survivorFrames,
} from '../helpers/parity';

const D = capPx('low');
const ROLES: readonly RoleCharId[] = ['runner', 'guard', 'scout'];

/** 프레임마다 원판 몫 (의상 / 기본 같은 이름 프레임) */
function shares(
  dressed: readonly CharFrameSpec[],
  base: readonly CharFrameSpec[],
  w: number,
): { frame: string; share: number }[] {
  const b = new Map(base.map((s) => [s.name, s]));
  return dressed.map((s) => {
    const o = b.get(s.name);
    if (!o) throw new Error(`기본 프레임 없음: ${s.name}`);
    return { frame: s.name, share: discShare(drawingRaster(s.draw(w), D), drawingRaster(o.draw(w), D), D) };
  });
}

function over(rows: readonly { frame: string; share: number }[]): string[] {
  return rows
    .filter((r) => r.share > DISC_MAX)
    .sort((a, b) => b.share - a.share)
    .map((r) => `${r.frame} ${(r.share * 100).toFixed(1)}%`);
}

describe(`몸 가운데 ${DISC_R}r 원판: 의상을 입어도 기본 그림과 ΔE76 ${DISC_DE} 넘게 다른 칸이 ${DISC_MAX * 100}% 이하 (몸 지름 ${D.toFixed(1)}px)`, () => {
  for (const costume of ['hood', 'feathers', 'chains'] as MonsterCostumeId[])
    it(`괴물 ${costume}: 21프레임`, () => {
      const rows = shares(monsterFrames(costume), monsterFrames('basic'), W);
      expect(rows.length).toBe(21);
      expect(over(rows)).toEqual([]);
    });

  for (const costume of ['scarf', 'pack', 'cape'] as SurvivorCostumeId[])
    it(`생존자 ${costume}: 러너 · 가드 · 스카우트 모든 프레임 (걷기 · 질주 · 능력 · 수감 · 구조 · 피격 · 번쩍 · 회색)`, () => {
      const bad: string[] = [];
      for (const role of ROLES) {
        const rows = shares(survivorFrames(role, costume), survivorFrames(role, 'basic'), W_SURVIVOR);
        expect(rows.length).toBeGreaterThan(15);
        bad.push(...over(rows));
      }
      expect(bad).toEqual([]);
    });
});
