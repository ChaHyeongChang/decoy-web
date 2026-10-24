// 조작 배치 편집 (터치 기기, 로비에서만 — 설정 화면 조작 탭의 '조작 배치 편집'): 이동 스틱 · 조준 스틱 · 모든 터치 버튼을
// 끌어 옮기고 크기를 바꾼다. 생존자 · 괴물 배치를 따로 저장한다('decoy:controlLayout'). 계약 단계의 자리표시 — 갈래 L이 채운다
export interface LayoutEditorOptions {
  /** 붙일 곳 (#ui-root) */
  host: HTMLElement;
  /** 처음 보일 역할 배치 */
  role: 'survivor' | 'monster';
  /** 닫힌 뒤 (saved = 저장하고 닫았다) */
  onClose: (saved: boolean) => void;
}

export interface LayoutEditorHandle {
  close(): void;
}

/** 편집 화면을 연다 (전체 화면 덮개). 닫히면 onClose */
export function openLayoutEditor(opts: LayoutEditorOptions): LayoutEditorHandle {
  queueMicrotask(() => opts.onClose(false));
  return { close: () => undefined };
}
