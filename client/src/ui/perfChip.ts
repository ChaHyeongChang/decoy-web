// 판 중 FPS · 핑 칩 (설정 화면 통합, 설정 '화면' 탭 'FPS · 핑 표시'): 판 화면 맵 창 왼쪽 위 안쪽에 작은 글자 한 줄.
// ?debug=1 오버레이(debugOverlay.ts — 개발자용 표 · 칩)와 따로다: 플레이어용 설정이고, 누를 수 없고(pointer-events: none),
// 글자만 보인다. 판 장면(GameScene)이 판 중에만 만들고 설정이 꺼지면 바로 숨긴다.
//  - 글자는 초당 최대 2번(PERF_CHIP.updateMs) 고치고, 바뀐 때만 textContent를 쓴다(프레임마다 DOM을 건드리지 않는다)
//  - 자리는 캔버스 사각형(창 CSS px) + 맵 사각형(논리 px)으로 정하고 창 크기가 바뀔 때 다시 놓는다. ?debug=1 칩 · 터치 시스템
//    버튼(좌우 반전 배치)이 같은 구석에 있으면(터치 기기: 맵 왼쪽 위) 그 아래에 둔다
// Phaser를 import하지 않는다 (단위 시험: 글자 · 자리 계산)
import { HELP_TEXT } from '../data/storyText';
import './perfChip.css';

/** 글자를 고치는 간격 (ms, 초당 2번) · 맵 창 안쪽 여백 · ?debug=1 칩 아래로 띄우는 거리 (CSS px) */
export const PERF_CHIP = { updateMs: 500, insetCss: 6, gapCss: 4 } as const;

/** 칩 글자: '{fps} FPS · 핑 {ping}ms' (모르면 HELP_TEXT.perfChipUnknown). fps · ping은 정수로 */
export function perfChipText(fps: number | null, ping: number | null): string {
  const f = fps === null || !Number.isFinite(fps) ? HELP_TEXT.perfChipUnknown : String(Math.round(fps));
  const p = ping === null || !Number.isFinite(ping) ? HELP_TEXT.perfChipUnknown : String(Math.round(ping));
  return HELP_TEXT.perfChip.replace('{fps}', f).replace('{ping}', p);
}

export interface CssRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 칩 왼쪽 위 (창 CSS px): 맵 사각형(논리 px) 왼쪽 위 안쪽 insetCss. avoid(창 CSS px — ?debug=1 칩, 터치 시스템 버튼: 왼손잡이
 * 좌우 반전이면 설정 · 점수판 · 전체 화면이 왼쪽 위에서 맵에 걸친다)가 그 자리와 가로로 겹치고 위쪽에서 덮으면 그 아래 gapCss로
 * 내린다 (위에 있는 것부터 차례로)
 */
export function perfChipPlace(
  canvas: { left: number; top: number; k: number },
  map: { x: number; y: number },
  avoid: CssRect | readonly CssRect[] | null,
): { left: number; top: number } {
  const left = Math.round(canvas.left + map.x * canvas.k + PERF_CHIP.insetCss);
  let top = Math.round(canvas.top + map.y * canvas.k + PERF_CHIP.insetCss);
  const list = avoid === null ? [] : 'left' in avoid ? [avoid] : [...avoid].sort((a, b) => a.top - b.top);
  for (const r of list) {
    if (!(r.width > 0 && r.height > 0)) continue;
    const across = r.left < left + 160 && r.left + r.width > left;
    if (across && r.top <= top + 1 && r.top + r.height + PERF_CHIP.gapCss > top)
      top = Math.round(r.top + r.height + PERF_CHIP.gapCss);
  }
  return { left, top };
}

/** 칩 DOM (#ui-root 아래, 누를 수 없음) */
export class PerfChip {
  readonly el: HTMLDivElement;
  private text = '';
  private on = false;
  private left = Number.NaN;
  private top = Number.NaN;

  constructor(host: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'perf-chip';
    el.setAttribute('data-testid', 'perf-chip');
    el.setAttribute('aria-hidden', 'true');
    el.hidden = true;
    host.appendChild(el);
    this.el = el;
  }

  /** 글자 (바뀐 때만 쓴다). 바뀌었으면 true */
  setText(t: string): boolean {
    if (t === this.text) return false;
    this.text = t;
    this.el.textContent = t;
    return true;
  }

  get textNow(): string {
    return this.text;
  }

  get shown(): boolean {
    return this.on;
  }

  show(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.el.hidden = !on;
  }

  /** 왼쪽 위 (창 CSS px, 바뀐 때만 쓴다) */
  place(left: number, top: number): void {
    if (left === this.left && top === this.top) return;
    this.left = left;
    this.top = top;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  destroy(): void {
    this.el.remove();
  }
}
