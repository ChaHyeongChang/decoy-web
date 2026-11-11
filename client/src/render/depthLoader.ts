// 입체감 조각(render/depthChunk.ts — 나눠 받는 조각 'depth')을 받는다. 첫 묶음에 남는 작은 모듈이다.
// 판 밖 쉬는 시간에 미리 받고(main.ts — 입체감을 그릴 수 있는 렌더러 · 품질 · 설정일 때만), 판 장면은 조각이 오기 전까지 입체감
// 없이 그린다(지금 그대로 — 판 중에 품질을 올리면 그때 받는다). 받지 못하면 다음에 다시 (새 배포 직후 옛 화면: 입체감 없이 계속)
import type * as DepthChunk from './depthChunk';

let mod: typeof DepthChunk | null = null;
let loading: Promise<typeof DepthChunk | null> | null = null;
/** 마지막으로 받지 못한 시각 (performance.now, 없으면 −∞) */
let failedAt = Number.NEGATIVE_INFINITY;
/** 받지 못하면 이만큼 기다렸다 다시 (ms) — 판 장면이 프레임마다 부르므로 끊긴 회선에서 요청을 쏟지 않게 */
export const DEPTH_RETRY_MS = 15_000;
/** 기다리는 동안 돌려주는 값 (프레임마다 새 약속을 만들지 않게) */
const NOT_YET: Promise<null> = Promise.resolve(null);

/** 조각을 받는다 (한 번만, 실패하면 DEPTH_RETRY_MS 뒤에 다시) */
export function loadDepth(now: number = performance.now()): Promise<typeof DepthChunk | null> {
  if (mod) return Promise.resolve(mod);
  if (!loading && now - failedAt < DEPTH_RETRY_MS) return NOT_YET;
  loading ??= import('./depthChunk').then(
    (m) => {
      mod = m;
      return m;
    },
    () => {
      loading = null;
      failedAt = performance.now();
      return null;
    },
  );
  return loading;
}

/** 받은 조각 (아직이면 null) */
export function depthModule(): typeof DepthChunk | null {
  return mod;
}
