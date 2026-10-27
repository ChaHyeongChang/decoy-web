// 의상 실루엣 겹침 점검 (메타 c 시안): 의상을 입어도 역할끼리 위 그림 실루엣이 갈리는가 (VISUAL_SPEC 0장 ④).
// tests/unit/char-art.test.ts와 같은 마스크 · 크기 · 방향으로, 역할 × 의상 모든 짝(다른 역할끼리)의 IoU ≤ 0.8,
// 공통 생존자와 ≤ 0.85. `npx tsx scripts/char-art/costume-iou.ts` (넘으면 예외 — 종료 코드 1)
import { SURVIVOR_COSTUMES, type SurvivorCostumeId } from '@decoy/shared';
import { registerAllCostumeArt } from '../../client/src/art/chars/costume/art';
import { COMMON_ART, SURVIVOR_ART } from '../../client/src/art/chars/index';
import { drawingMask } from '../../client/src/art/chars/measure';
import { HIDDEN_REST, SURVIVOR_REST, type RoleCharId } from '../../client/src/art/chars/types';
import { maskIoU } from '../../client/src/art/shapes';

registerAllCostumeArt();
const W = 0.19;
const SIZES = [12.7, 18, 36];
const ROTS = [0, 0.6];
const ROLES: RoleCharId[] = ['runner', 'guard', 'scout'];
const mask = (r: RoleCharId, c: SurvivorCostumeId, d: number, rot: number): Uint8Array =>
  drawingMask(SURVIVOR_ART[r].top(SURVIVOR_REST, { w: W, costume: c }), d, rot);
let worst = 0;
let ok = true;
const rows: string[] = [];
for (let i = 0; i < ROLES.length; i += 1)
  for (let j = i + 1; j < ROLES.length; j += 1)
    for (const ca of SURVIVOR_COSTUMES)
      for (const cb of SURVIVOR_COSTUMES) {
        let m = 0;
        for (const d of SIZES)
          for (const rot of ROTS)
            m = Math.max(m, maskIoU(mask(ROLES[i]!, ca, d, rot), mask(ROLES[j]!, cb, d, rot)));
        worst = Math.max(worst, m);
        if (m > 0.8) {
          ok = false;
          rows.push(`넘음 ${ROLES[i]}·${ca} - ${ROLES[j]}·${cb}: ${m.toFixed(3)}`);
        }
      }
let worstHidden = 0;
for (const r of ROLES)
  for (const c of SURVIVOR_COSTUMES) {
    let m = 0;
    for (const d of SIZES)
      for (const rot of ROTS)
        m = Math.max(
          m,
          maskIoU(drawingMask(COMMON_ART.top(HIDDEN_REST, { w: W }), d, rot), mask(r, c, d, rot)),
        );
    worstHidden = Math.max(worstHidden, m);
    if (m > 0.85) {
      ok = false;
      rows.push(`넘음 공통 - ${r}·${c}: ${m.toFixed(3)}`);
    }
  }
// 의상별 최댓값 (그 의상을 한쪽이라도 입은 짝)
for (const c of SURVIVOR_COSTUMES) {
  let m = 0;
  for (let i = 0; i < ROLES.length; i += 1)
    for (let j = i + 1; j < ROLES.length; j += 1)
      for (const other of SURVIVOR_COSTUMES)
        for (const [ca, cb] of [
          [c, other],
          [other, c],
        ] as const)
          for (const d of SIZES)
            for (const rot of ROTS)
              m = Math.max(m, maskIoU(mask(ROLES[i]!, ca, d, rot), mask(ROLES[j]!, cb, d, rot)));
  console.log(`${c.padEnd(6)} 역할끼리 최대 IoU ${m.toFixed(3)}`);
}
console.log(rows.join('\n'));
console.log(
  `역할끼리 최대 ${worst.toFixed(3)} (≤ 0.8) · 공통 생존자와 최대 ${worstHidden.toFixed(3)} (≤ 0.85) — ${ok ? '기준 안' : '넘음'}`,
);
if (!ok) throw new Error('의상 실루엣 겹침이 기준을 넘었다');
