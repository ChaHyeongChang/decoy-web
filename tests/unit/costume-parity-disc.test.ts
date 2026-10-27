// 몸 가운데 원판 점검 (VISUAL_SPEC 0장 ② '몸 가운데 0.45r 원판은 역할색', 판 밖 메타 c): 생존자 의상 셋(목도리 · 배낭 · 망토)이
// 러너 · 가드 · 스카우트의 아틀라스 프레임 전부에서 몸 가운데 0.45r 원판을 기본 그림과 같게 둔다: 원판 안 칸 중 기본 그림과 색이
// ΔE76 15 넘게 다른 칸이 5% 이하. ΔE76 15 = 같은 역할색의 명암 · 음영 차이보다 크고 다른 색(천 · 끈 · 쇠)으로 덮였을 때보다 작은
// 값. 5% = 44.8px 괴물 원판 약 320칸 중 16칸 — 걷기 비틀림으로 끼어드는 얇은 끈 · 띠 끝 몫.
// 크기 · 화면 (4판, 전에는 44.8px 구운 그대로만): 괴물 크기 열(tests/helpers/parity.ts SIZES)과 같은 화면 · 품질에서 생존자 몸 지름
// (괴물 × 생존자 반지름 / 괴물 반지름 — 아틀라스가 같은 텍셀 배율로 단위 s를 굽는다, 약 18.4 ~ 76.8px), 생존자 상자의 칸 위상으로
// 굽고 그 화면의 방향(0 · 0.6 · 2.5) · 반 화소 위상까지 찍어 잰다. 상한 5%는 크기와 상관없이 같다: 휴대폰 크기에서는 원판이 54 ~
// 104칸뿐이라 원판 둘레 1텍셀 안으로 번지는 의상 가장자리(안티에일리어싱 + 쌍선형)만으로 넘을 수 있는데, 그 번짐도 그 화면에서
// 실제로 역할색 원판을 물들이는 칸이다 — 의상 가장자리는 가장 작은 크기에서도 원판에서 1텍셀 넘게 떨어져야 한다.
// 괴물 의상(두건 · 까마귀 깃 · 사슬)의 원판은 costume-parity-{hood,feathers,chains}.test.ts가 보이는 정도와 같은 화면에서 잰다.
// 역할마다 파일 하나 (러너 여기, costume-parity-disc-guard · costume-parity-disc-scout) — vitest가 나란히 돌린다.
import { describe, expect, it } from 'vitest';
import { path, solid, type Drawing } from '../../client/src/art/chars/kit';
import {
  DISC_MAX,
  DISC_R,
  ParityCache,
  SURVIVOR_SIZES,
  W_SURVIVOR,
  bake,
  bakeDisc,
  describeSurvivorDisc,
  discShare,
  survivorFrames,
  viewName,
  viewsOf,
} from '../helpers/parity';

describeSurvivorDisc('runner');

describe('원판 점검 도구', () => {
  it('원판 둘레 줄만 굽기(bakeDisc): 칠한 줄의 칸은 다 굽기와 같고, 모든 크기 · 화면에서 원판 몫이 다 굽기와 똑같다', () => {
    const frames = survivorFrames('runner', 'cape').filter((_, i) => i % 14 === 0);
    const base = survivorFrames('runner', 'basic').filter((_, i) => i % 14 === 0);
    expect(frames.length).toBe(2);
    const diff: string[] = [];
    for (const size of SURVIVOR_SIZES)
      frames.forEach((f, i) => {
        const b = base[i];
        if (!b) throw new Error('기본 프레임');
        const x = f.draw(W_SURVIVOR);
        const o = b.draw(W_SURVIVOR);
        const full = bake(x, size.d, 'survivor');
        const part = bakeDisc(x, size.d, 'survivor');
        // 칠한 줄 = 원판 둘레: 그 줄 칸은 같은 값, 나머지는 빈 칸
        const n = full.n;
        const cy = full.cy ?? n / 2;
        const R = (DISC_R * size.d) / 2;
        for (let j = Math.ceil(cy - R - 1); j <= Math.floor(cy + R + 1); j += 1)
          for (let q = j * n * 4; q < (j + 1) * n * 4; q += 1)
            if (full.rgba[q] !== part.rgba[q]) diff.push(`${f.name} ${size.d.toFixed(1)}px 줄 ${j}`);
        const cache = new ParityCache();
        for (const v of viewsOf(size)) {
          const a = discShare(
            cache.screen(x, v, undefined, true),
            cache.screen(o, v, undefined, true),
            size.d,
          );
          const w = discShare(cache.screen(x, v), cache.screen(o, v), size.d);
          if (a !== w) diff.push(`${f.name} ${viewName(v)}: ${a} ≠ ${w}`);
        }
      });
    expect([...new Set(diff)]).toEqual([]);
  });
});

describe('원판 점검이 실제로 잡는다 (반례 — 생존자 크기 열 · 방향 · 위상 전부)', () => {
  it('러너 서기 몸 가운데를 가로지르는 0.12r 끈(다른 색)은 모든 크기 · 화면에서 5% 넘게 다르다', () => {
    const rest = survivorFrames('runner', 'basic')[0];
    if (!rest) throw new Error('러너 프레임 없음');
    const base = rest.draw(W_SURVIVOR);
    const strap: Drawing = {
      ops: [
        ...base.ops,
        {
          d: path().poly([
            [-0.6, -0.06],
            [0.6, -0.06],
            [0.6, 0.06],
            [-0.6, 0.06],
          ]).d,
          fill: solid(0x3b2414),
        },
      ],
    };
    const cache = new ParityCache();
    const low: string[] = [];
    for (const size of SURVIVOR_SIZES) {
      for (const v of viewsOf(size)) {
        const share = discShare(
          cache.screen(strap, v, undefined, true),
          cache.screen(base, v, undefined, true),
          size.d,
        );
        if (share <= DISC_MAX * 2) low.push(`${viewName(v)} ${(share * 100).toFixed(1)}%`);
      }
      cache.clear();
    }
    expect(low).toEqual([]);
  });
});
