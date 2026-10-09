// UI 아이콘 (M10c, VISUAL_SPEC 10장): 24 격자 · 선 2px · 둥근 끝과 이음의 SVG 경로.
// 같은 경로를 HTML에서는 인라인 SVG(iconSvg)로, Phaser HUD에서는 Canvas2D로 구워(drawIcon) 쓴다 — 그림이 하나다.
// 역할 문양(러너 » · 가드 방패 · 스카우트 렌즈 · 괴물 후드)은 art/shapes.ts GLYPHS를 쓴다(월드 · HUD · 로비가 같은 모양).
// 색만으로 구분하지 않기: 상태 · 행동은 아이콘 모양으로도 구분되게 서로 다른 실루엣을 쓴다.

/** 경로 한 조각: 선(stroke)으로 그리거나 채운다(fill) */
export interface IconPart {
  readonly d: string;
  readonly fill?: boolean;
}

export const ICONS = {
  // ── 괴물 행동 ──
  /** 공격: 발톱 세 줄 */
  attack: [{ d: 'M4.5 18.5C7.5 14 9.5 9 10.5 3.5M9.5 21c3-5 5-10.5 6-16.5M15 21c2.5-4 4-8.5 5-13.5' }],
  /** 돌진: 화살표 + 속도선 */
  dash: [{ d: 'M9 12h11M16 7l5 5-5 5M3 8h5M3 16h5M5 12h2' }],
  /** 포효: 소리 나는 입 + 음파 */
  roar: [{ d: 'M4 10v4h3l5 4V6L7 10H4z', fill: true }, { d: 'M15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12' }],
  /** 시야 탐색: 넓은 부채꼴 */
  visionSearch: [{ d: 'M12 20L3.5 8a12 12 0 0 1 17 0z' }],
  /** 시야 추적: 좁고 긴 부채꼴 */
  visionHunt: [{ d: 'M12 21L8.5 3.5a14 14 0 0 1 7 0z' }],
  // ── 생존자 능력 ──
  /** 질주 (러너) */
  sprint: [{ d: 'M5 6l6 6-6 6M12 6l6 6-6 6' }],
  /** 밀치기 (가드): 방패 + 미는 화살 */
  shove: [
    { d: 'M10 3l6 2.5v5c0 4.5-3 7.5-6 9-3-1.5-6-4.5-6-9v-5z' },
    { d: 'M17 12h5M20 9.5l2.5 2.5-2.5 2.5' },
  ],
  /** 탐지 (스카우트): 조준경 */
  track: [
    { d: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 1.5V6M12 18v4.5M1.5 12H6M18 12h4.5' },
    { d: 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', fill: true },
  ],
  /** 구조: 열린 자물쇠 */
  rescue: [{ d: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2M12 15v2' }],
  // ── 목표 · 장소 ──
  /** 감옥 · 수감: 잠긴 자물쇠 */
  prison: [{ d: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2' }],
  /** 거점: 마름모 */
  point: [{ d: 'M12 2.5l9.5 9.5-9.5 9.5L2.5 12z' }],
  /** 탈출구: 문 + 나가는 화살 */
  exit: [{ d: 'M14 4H5v17h9M10 12.5h11M18 9.5l3 3-3 3' }],
  /** 남은 시간 */
  timer: [{ d: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4.5l3 2M9.5 2h5' }],
  /** 지도 (미니맵 제목): 접힌 지도 */
  map: [{ d: 'M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5zM9 4v13.5M15 6.5V20' }],
  /** 메모 · 벽 글씨: 연필 */
  note: [{ d: 'M4 20l1.2-4.6L15.6 5a2.1 2.1 0 0 1 3 3L8.2 18.4zM13.6 7l3 3' }],
  // ── 상태 ──
  /** 체력 (채움) */
  heart: [{ d: 'M12 20.5S4 15.5 4 9.5A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 8 2.3c0 6-8 11-8 11z', fill: true }],
  /** 부상: 금 간 마음 */
  injured: [
    {
      d: 'M12 20.5S4 15.5 4 9.5A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 8 2.3c0 6-8 11-8 11zM12 7.5l-2 4 3.5 2.5-2 4',
    },
  ],
  /** 사망 */
  dead: [{ d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 8.5l7 7M15.5 8.5l-7 7' }],
  /** 탈출함: 열린 문 + 나간 사람 방향 */
  escaped: [{ d: 'M4 21h7M6 21V4h8v4M14 16v5M12 12h9M18 9l3 3-3 3' }],
  /** 연결 끊김 */
  disconnected: [
    { d: 'M3 3l18 18M8.5 8.5A6 6 0 0 0 6 13M12 6.5a8 8 0 0 1 8.5 3.5M3.5 9.5A11 11 0 0 1 6.5 7M12 18.5v.5' },
  ],
  /** 경고 */
  warn: [{ d: 'M12 3L2 20.5h20zM12 9.5v5M12 17.5v.5' }],
  /** 발각 (눈) */
  eye: [
    { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z' },
    { d: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', fill: true },
  ],
  /** 완료 */
  check: [{ d: 'M4 12.5l5 5L20 6.5' }],
  /** 정지 */
  pause: [{ d: 'M9 5v14M15 5v14' }],
  /** 진행 중 */
  play: [{ d: 'M7 4.5l12.5 7.5L7 19.5z', fill: true }],
  // ── 로비 · 결과 ──
  /** 준비 완료 */
  ready: [{ d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l3 3 5-6' }],
  /** 기다리는 중 */
  waiting: [{ d: 'M7 3h10M7 21h10M8 3v3.5l4 5.5-4 5.5V21M16 3v3.5L12 12l4 5.5V21' }],
  /** 방장 */
  crown: [{ d: 'M3.5 18.5h17M4.5 16L3 7l5 4 4-6.5 4 6.5 5-4-1.5 9z' }],
  /** 봇 */
  bot: [{ d: 'M5 9h14v10H5zM12 5v4M9.5 13.5v1.5M14.5 13.5v1.5M2.5 12.5v3.5M21.5 12.5v3.5' }],
  /** 링크 복사 */
  link: [
    {
      d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2',
    },
  ],
  /** 설정 (품질 등) */
  sliders: [{ d: 'M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1M15 4.5v4M9 10v4M17 15.5v4' }],
  /** 전체 화면 */
  fullscreen: [{ d: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5' }],
  /** 뒤로 · 나가기 */
  back: [{ d: 'M20 12H5M11 6l-6 6 6 6' }],
  /** 다시 하기 */
  replay: [{ d: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5' }],
} as const satisfies Record<string, readonly IconPart[]>;

export type IconId = keyof typeof ICONS;

export const ICON_GRID = 24;
export const ICON_STROKE = 2;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * HTML 인라인 SVG 문자열. 색은 기본 currentColor(글자색을 따른다). label이 있으면 스크린 리더용 이름,
 * 없으면 장식(aria-hidden)
 */
export function iconSvg(id: IconId, size = 24, label?: string): string {
  const parts = ICONS[id]
    .map((p: IconPart) =>
      p.fill === true
        ? `<path d="${p.d}" fill="currentColor" stroke="none"/>`
        : `<path d="${p.d}" fill="none" stroke="currentColor" stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('');
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg class="icon icon-${id}" width="${size}" height="${size}" viewBox="0 0 ${ICON_GRID} ${ICON_GRID}" ${a11y}>${parts}</svg>`;
}

/** Canvas2D에 아이콘을 그린다 (왼쪽 위 x, y, 한 변 size px). Phaser HUD 텍스처를 구울 때 쓴다 */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  id: IconId,
  x: number,
  y: number,
  size: number,
  color: string,
  strokeScale = 1,
): void {
  const k = size / ICON_GRID;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = ICON_STROKE * strokeScale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of ICONS[id] as readonly IconPart[]) {
    const path = new Path2D(p.d);
    if (p.fill === true) ctx.fill(path);
    else ctx.stroke(path);
  }
  ctx.restore();
}
