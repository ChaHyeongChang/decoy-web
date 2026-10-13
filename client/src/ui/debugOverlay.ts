// ?debug=1 오버레이 (렌더링 최적화에서 debug.ts에서 옮기고 넓혔다): 한 화면에 FPS · 목표 · 화면 주사율 · 프레임 제한,
// 프레임 간격 · 작업 시간(평균 · p95), 그리기 호출, 핑 · 서버 틱, 예측 오차, 품질 · 자동 조정, DPR · 백버퍼, 렌더러 · 입력 · 밸런스.
// 배포 빌드에서도 ?debug=1만으로 뜬다(실제 휴대폰에서 잰다). 개발자용이라 한국어 이름표를 여기에 바로 쓴다.
//  - 접기 · 펼치기: 칩(▸ 119fps 8.3ms)을 누르면 표가 열리고 닫힌다. 터치 기기는 접은 채, PC는 펼친 채 시작. 저장하지 않는다
//  - 칩(누르는 자리 44px 높이)만 입력을 받고 표는 손가락 · 마우스가 통과한다(pointer-events: none). 칩을 누른 것은
//    판 입력(터치 화면 · Phaser 창 리스너 · 점수판 닫기)으로 가지 않는다
//  - 자리: PC는 왼쪽 아래(CSS), 터치는 anchor()가 주는 자리(debug.ts: 맵 왼쪽 위 — HUD 기둥 · 엄지 버튼과 겹치지 않는다)
//  - 4Hz로 고친다. 바뀐 글자만 textContent 한 번씩 쓴다. 접혀 있으면 표 글자는 만들지 않는다
// 이 파일은 Phaser · App을 import하지 않는다(단위 시험). 값은 debug.ts가 data()로 모아 준다
import type { FrameStatsInfo } from '@decoy/shared';
import type { FrameLimit } from '../gfx/framePacing';
import type { QualityTier } from '../gfx/presets';
import type { QualitySource } from '../gfx/quality';

/** 표시를 고치는 간격 (ms, 4Hz) */
export const DEBUG_OVERLAY_UPDATE_MS = 250;

/** 오버레이 한 번 그릴 값 (debug.ts가 app · gfxState · 프레임 측정에서 모은다) */
export interface DebugOverlayData {
  /** 프레임 측정 요약 (아직 렌더한 프레임이 없으면 null) */
  stats: FrameStatsInfo | null;
  targetHz: number;
  displayHz: number;
  frameLimit: FrameLimit;
  /** 왕복 지연 (ms) */
  ping: number;
  /** ?lag 지연 설정 (ms) */
  lag: number;
  /** 마지막 스냅샷의 서버 틱 (없으면 null) */
  tick: number | null;
  snapCount: number;
  /** 마지막 서버 보정 거리 (타일) */
  correction: number;
  /** 서버 확인을 기다리는 입력 수 */
  pending: number;
  inputMode: 'keyboard' | 'touch';
  renderer: 'webgl' | 'canvas' | 'none';
  quality: QualityTier;
  qualitySource: QualitySource;
  /** 판 중 자동 조정 상태 (on · checking · off …, 모르면 '-') */
  adapt: string;
  dpr: number;
  /** 렌더 배율 (백버퍼 px / 논리 px) */
  zoom: number;
  backingW: number;
  backingH: number;
  balanceHash: string;
}

const QUALITY_LABEL: Record<QualityTier, string> = { high: '높음', medium: '중간', low: '낮음' };
const SOURCE_LABEL: Record<QualitySource, string> = { auto: '자동', saved: '저장', url: '주소' };
const LIMIT_LABEL: Record<FrameLimit, string> = { auto: '자동', '60': '60', '120': '120' };
/** 값이 없을 때 */
const NONE = '-';

const ms = (v: number | undefined): string => (v === undefined ? NONE : `${v.toFixed(2)}ms`);

/** 그리기 칸: WebGL은 그리기 호출 수, Canvas 렌더러는 Phaser가 그린 객체 수 (세는 것이 달라 이름도 다르다) */
function drawText(s: FrameStatsInfo | null, renderer: DebugOverlayData['renderer']): string {
  if (s === null || s.drawCalls === null || renderer === 'none') return NONE;
  return renderer === 'webgl' ? `${s.drawCalls}회` : `객체 ${s.drawCalls}개`;
}

/**
 * 펼친 표 (8줄).
 *   FPS 119.8 · 목표 120 · 화면 120Hz · 제한 자동
 *   프레임 8.33ms · p95 8.90ms
 *   작업 4.10ms · p95 6.02ms
 *   그리기 12회 · 건너뜀 0 · 렌더러 webgl        ← Canvas: 그리기 객체 230개
 *   핑 42ms · 지연설정 0ms · 서버 틱 1234 · 스냅샷 567
 *   예측 오차 0.012타일 · 대기 3 · 입력 touch
 *   품질 높음(자동) · 조정 on · 배율 1.25
 *   DPR 2.63 · 2402×1081 · 밸런스 77d34f9f
 */
export function formatDebugPanel(d: DebugOverlayData): string {
  const s = d.stats;
  return [
    `FPS ${s ? s.fps.toFixed(1) : NONE} · 목표 ${Math.round(d.targetHz)} · 화면 ${Math.round(d.displayHz)}Hz · ` +
      `제한 ${LIMIT_LABEL[d.frameLimit]}`,
    `프레임 ${ms(s?.intervalAvg)} · p95 ${ms(s?.intervalP95)}`,
    `작업 ${ms(s?.workAvg)} · p95 ${ms(s?.workP95)}`,
    `그리기 ${drawText(s, d.renderer)} · 건너뜀 ${s ? s.skipped : NONE} · 렌더러 ${d.renderer}`,
    `핑 ${d.ping.toFixed(0)}ms · 지연설정 ${d.lag}ms · 서버 틱 ${d.tick ?? NONE} · 스냅샷 ${d.snapCount}`,
    `예측 오차 ${d.correction.toFixed(3)}타일 · 대기 ${d.pending} · 입력 ${d.inputMode}`,
    `품질 ${QUALITY_LABEL[d.quality]}(${SOURCE_LABEL[d.qualitySource]}) · 조정 ${d.adapt} · 배율 ${d.zoom.toFixed(2)}`,
    `DPR ${d.dpr.toFixed(2)} · ${d.backingW}×${d.backingH} · 밸런스 ${d.balanceHash}`,
  ].join('\n');
}

/** 접은 칩 한 줄: ▸(접힘) · ▾(펼침) + FPS(정수) + 프레임 간격 평균 */
export function formatDebugChip(s: FrameStatsInfo | null, expanded: boolean): string {
  const arrow = expanded ? '▾' : '▸';
  if (s === null) return `${arrow} ${NONE}fps ${NONE}ms`;
  return `${arrow} ${Math.round(s.fps)}fps ${s.intervalAvg.toFixed(1)}ms`;
}

/** 표시를 만들 문서 (단위 시험은 가짜를 넘긴다) */
export interface OverlayHost {
  createElement(tag: 'div'): HTMLDivElement;
  readonly body: { appendChild(el: HTMLElement): unknown };
}

/** 칩 자리 (창 CSS px): 칩 왼쪽 위 모서리 */
export interface OverlayAnchor {
  left: number;
  top: number;
}

export interface DebugOverlayOptions {
  data(): DebugOverlayData;
  /** 처음에 펼친 채로 시작하는가 (PC true, 터치 기기 false) */
  expanded: boolean;
  /** 칩 자리. null이면(또는 없으면) CSS 기본 자리: 왼쪽 아래, 표는 칩 위로 펼친다 */
  anchor?: () => OverlayAnchor | null;
  /** 기본 document */
  host?: OverlayHost;
  /** 주기 실행 (기본 window.setInterval). 멈추는 함수를 돌려준다 */
  every?: (fn: () => void, ms: number) => () => void;
}

export interface DebugOverlay {
  /** #debug-overlay */
  readonly el: HTMLDivElement;
  /** 누르는 자리 (보이는 칩을 감싼 44px 높이 상자) */
  readonly toggleEl: HTMLDivElement;
  /** 보이는 칩 */
  readonly chipEl: HTMLDivElement;
  /** 펼친 표 */
  readonly panelEl: HTMLDivElement;
  readonly expanded: boolean;
  setExpanded(v: boolean): void;
  /** 지금 값으로 다시 쓴다 (바뀐 것만) */
  update(): void;
  dispose(): void;
}

function browserEvery(fn: () => void, msInterval: number): () => void {
  const id = window.setInterval(fn, msInterval);
  return () => window.clearInterval(id);
}

/** 칩에서 시작한 누르기는 판 입력 · 문서 리스너로 보내지 않는다: 기본 동작(포커스 · 호환 마우스 · 클릭 · 메뉴)도 막는다 */
const SWALLOW = [
  'touchstart',
  'touchend',
  'touchcancel',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
];

/** ?debug=1 오버레이를 붙인다 (debug.ts). 한 번만 부른다 */
export function installDebugOverlay(opts: DebugOverlayOptions): DebugOverlay {
  const host: OverlayHost = opts.host ?? document;
  const el = host.createElement('div');
  el.id = 'debug-overlay';
  el.setAttribute('data-testid', 'debug-overlay');
  const toggleEl = host.createElement('div');
  toggleEl.className = 'dbg-toggle';
  toggleEl.setAttribute('role', 'button');
  toggleEl.setAttribute('data-testid', 'debug-overlay-toggle');
  const chipEl = host.createElement('div');
  chipEl.className = 'dbg-chip';
  chipEl.setAttribute('data-testid', 'debug-overlay-chip');
  toggleEl.appendChild(chipEl);
  const panelEl = host.createElement('div');
  panelEl.className = 'dbg-panel';
  panelEl.setAttribute('data-testid', 'debug-overlay-panel');
  el.appendChild(toggleEl);
  el.appendChild(panelEl);

  let expanded = opts.expanded;
  let chipText = '';
  let panelText = '';
  let anchorKey = '';

  const write = (node: HTMLDivElement, prev: string, next: string): string => {
    if (next !== prev) node.textContent = next;
    return next;
  };
  /** 칩 자리: anchor가 있으면 그 자리(위에서 아래로 펼침), 없으면 CSS 기본(왼쪽 아래, 위로 펼침) */
  const place = (): void => {
    const a = opts.anchor?.() ?? null;
    const key = `${a ? `${Math.round(a.left)},${Math.round(a.top)}` : '-'} ${expanded}`;
    if (key === anchorKey) return;
    anchorKey = key;
    el.style.left = a ? `${Math.round(a.left)}px` : '';
    el.style.top = a ? `${Math.round(a.top)}px` : '';
    el.className = `${a ? 'dbg-top' : 'dbg-bottom'} ${expanded ? 'dbg-expanded' : 'dbg-collapsed'}`;
  };
  const update = (): void => {
    const d = opts.data();
    chipText = write(chipEl, chipText, formatDebugChip(d.stats, expanded));
    if (expanded) panelText = write(panelEl, panelText, formatDebugPanel(d));
    place();
  };
  const setExpanded = (v: boolean): void => {
    expanded = v;
    panelEl.hidden = !v;
    toggleEl.setAttribute('aria-expanded', String(v));
    toggleEl.setAttribute('aria-label', v ? '디버그 정보 접기' : '디버그 정보 펼치기');
    update();
  };

  toggleEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 주 버튼(손가락 · 왼쪽 클릭)만
    if (e.button !== 0) return;
    setExpanded(!expanded);
  });
  for (const type of SWALLOW)
    toggleEl.addEventListener(
      type,
      (e) => {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      },
      { passive: false },
    );

  host.body.appendChild(el);
  setExpanded(expanded);
  const stop = (opts.every ?? browserEvery)(update, DEBUG_OVERLAY_UPDATE_MS);
  return {
    el,
    toggleEl,
    chipEl,
    panelEl,
    get expanded() {
      return expanded;
    },
    setExpanded,
    update,
    dispose() {
      stop();
      el.remove();
    },
  };
}
