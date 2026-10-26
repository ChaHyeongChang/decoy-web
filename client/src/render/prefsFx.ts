// 판 중 설정 효과 (설정 화면 통합): '번쩍임 줄이기'와 '지도 크게 보기'의 장식 값 · 순수 계산. Phaser · DOM을 import하지 않는다
// (단위 시험 · VISUAL_SPEC 표가 읽는다). 모두 그림 값이라 balance.json이 아니라 여기 둔다 — 규칙 · 판정 · 정보 차단과 무관하다.
//  - 번쩍임 줄이기: 피격 붉은 가장자리를 옅게 · 서서히(맞은 순간 확 켜지지 않게), 발각 빛 테두리는 맥동 없이 고정 알파
//    (발각 정보는 그대로 보인다). 잘라 옮김 어두워짐은 cameraDirector.noDip이 끈다(카메라 값은 camera.ts CAMERA)
//  - 지도 크게 보기: 맵 창 가운데에 같은 미니맵 내용을 크게 (틀 높이 = 맵 창 높이 비율). 정보는 작은 미니맵과 같다(minimap.ts)
// 화면 흔들림 줄이기는 camera.ts ScreenShake.scale(prefs.shakeScaleOf) 한 곳이다

/**
 * 번쩍임 줄이기의 피격 붉은 가장자리: 가장 진할 때 세기(보통 1의 0.35배) · 그 세기까지 오르는 시간(ms). 길이는 보통과 같은
 * HIT_FLASH_MS(0.2초)라 맞았다는 신호는 남고, 맞은 순간 화면 가장자리가 확 켜지지 않는다
 */
export const HIT_FLASH_REDUCED = { peak: 0.35, riseMs: 60 } as const;

/**
 * 피격 붉은 가장자리 세기 0~1 (맞은 뒤 elapsedMs, 효과 길이 durMs). 보통 = 맞은 순간 1에서 선형으로 0(예전 식 그대로),
 * 번쩍임 줄이기 = riseMs 동안 peak까지 오른 뒤 durMs에 0
 */
export function hitFlashLevel(elapsedMs: number, durMs: number, reduced: boolean): number {
  if (!reduced) return Math.max(0, 1 - elapsedMs / durMs);
  if (!(elapsedMs >= 0) || elapsedMs >= durMs) return 0;
  const { peak, riseMs } = HIT_FLASH_REDUCED;
  if (elapsedMs < riseMs) return (peak * elapsedMs) / riseMs;
  return peak * (1 - (elapsedMs - riseMs) / Math.max(1, durMs - riseMs));
}

/**
 * 발각 빛 테두리 (생존자 화면, 깊이 38): 보통은 pulseHz로 mid ± swing(0.6~1) 맥동, 번쩍임 줄이기면 맥동 없이 steady.
 * steady는 맥동 평균(0.8)보다 조금 진하게 — 발각 정보가 흐려지지 않게
 */
export const SPOTTED_EDGE = { pulseHz: 1.2, mid: 0.8, swing: 0.2, steady: 0.9 } as const;

/** 발각 빛 테두리 알파 (장식 시계 tMs) */
export function spottedEdgeAlpha(tMs: number, reduced: boolean): number {
  if (reduced) return SPOTTED_EDGE.steady;
  return SPOTTED_EDGE.mid + SPOTTED_EDGE.swing * Math.cos((tMs / 1000) * Math.PI * 2 * SPOTTED_EDGE.pulseHz);
}

/**
 * 지도 크게 보기: 틀(제목 줄 포함) 높이 = 맵 창 높이 × heightFrac, 틀 폭 상한 = 맵 창 폭 × maxWidthFrac. 엔티티 · 거점 · 탈출구 ·
 * 감옥 표시 그림은 iconScale배(작은 미니맵 그림을 키워 쓴다 — 큰 지도에서도 알아보게), 보이는 창 선 굵기는 lineScale배.
 * depthShift = 작은 미니맵 깊이(39~42.5)에 더하는 값: 56~59.5 — 화면 효과(피격 52 · 수감 페이드 55) 위, 배너(60~)와
 * 조작 안내 · 점수판(70~) 아래(알림 · 안내가 큰 지도에 묻히지 않게)
 */
export const MINIMAP_BIG = {
  heightFrac: 0.66,
  maxWidthFrac: 0.96,
  iconScale: 1.6,
  lineScale: 1.5,
  depthShift: 17,
} as const;

/**
 * 크게 본 지도 바닥 해상도 (지도 크게 보기가 흐리던 것 고침): 그림이 화면에서 차지하는 기기 px에 맞춰 바닥을 따로 합성한다.
 * budgetMargin = 텍스처 예산에서 남겨 두는 여유(바이트 — 판 중 잠깐 생기는 작은 텍스처 몫), maxW = 폭 상한(텍셀 — 굽기 · 합성 ·
 * 올리기 비용의 상한), stepMs = 그 해상도 정적 맵을 판 중에 나눠 굽는 한 프레임 예산(ms — 다 구울 때까지는 작은 지도 합성을 늘린다)
 */
export const MINIMAP_BIG_TEXELS = { budgetMargin: 256 * 1024, maxW: 2048, stepMs: 4 } as const;

/**
 * 크게 본 지도 바닥 폭 (텍셀). needW = 그림 폭이 화면에서 차지하는 기기 px(논리 폭 × 백버퍼 배율), baseW = 작은 미니맵 합성 폭,
 * aspect = 맵 가로 / 세로, budget = 이 품질의 텍스처 예산, others = 크게 본 지도를 뺀 지금 텍스처 바이트.
 * 바닥 텍스처(폭 × 폭 / aspect × 4바이트)가 others와 합쳐 budget − 여유를 넘지 않는 만큼만 키운다. 결과가 작은 미니맵 합성 폭
 * 이하면 null — 작은 지도 합성을 그대로 늘려 쓴다(예전과 같다: 휴대폰 높음 · 중간은 이미 기기 px 이상)
 */
export function bigMinimapTexels(
  needW: number,
  baseW: number,
  aspect: number,
  budget: number,
  others: number,
): number | null {
  if (!(needW > 0) || !(aspect > 0)) return null;
  const room = budget - MINIMAP_BIG_TEXELS.budgetMargin - others;
  const fit = room > 0 ? Math.floor(Math.sqrt((room / 4) * aspect)) : 0;
  // 높이 반올림이 바이트를 넘기지 않게 한 칸 여유
  const w = Math.min(Math.ceil(needW), fit - 1, MINIMAP_BIG_TEXELS.maxW);
  return w > baseW ? w : null;
}

export interface PlaceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 미니맵 그림 자리 (Minimap Place와 같은 모양: 그림 왼쪽 위 · 폭, 틀 여백 · 제목 줄 — 논리 px) */
export interface MinimapPlaceSpec {
  x: number;
  y: number;
  w: number;
  pad: number;
  title: number;
}

/**
 * 크게 본 지도의 자리 (논리 px): 맵 창 가운데, 틀 높이 = 맵 창 높이 × heightFrac. aspect = 맵 가로 / 세로 (그림 높이 = 폭 / aspect).
 * 틀이 맵 창 폭 × maxWidthFrac보다 넓으면 그 폭에 맞춰 줄인다. 그림 폭 · 높이는 정수 논리 px
 */
export function bigMinimapPlace(
  map: PlaceRect,
  pad: number,
  title: number,
  aspect: number,
): MinimapPlaceSpec {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1.5;
  let h = Math.max(1, Math.round(map.h * MINIMAP_BIG.heightFrac - title - pad));
  let w = Math.round(h * a);
  const maxW = map.w * MINIMAP_BIG.maxWidthFrac - pad * 2;
  if (w > maxW) {
    w = Math.max(1, Math.floor(maxW));
    h = Math.max(1, Math.round(w / a));
  }
  const frameW = w + pad * 2;
  const frameH = h + title + pad;
  return {
    x: Math.round(map.x + (map.w - frameW) / 2 + pad),
    y: Math.round(map.y + (map.h - frameH) / 2 + title),
    w,
    pad,
    title,
  };
}
