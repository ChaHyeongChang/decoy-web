// 판 중 설정 열기 (설정 화면 통합): 판 화면의 메뉴 버튼(PC: 위 띠 왼쪽 DOM 버튼 · Esc, 터치: 오른쪽 위 시스템 버튼 '메뉴')이
// 부르는 연결점. 실제 설정 화면은 진입점(main.ts)이 채운다 — 판 장면 · 터치 화면은 설정 화면 모듈을 모른다.
// 온라인 판이라 판은 멈추지 않는다: 설정 화면이 열려 있는 동안 판 장면은 키 · 터치 입력을 받지 않는다(isOpen을 매 프레임 본다).
// 판 중에는 그래픽 · 화면 · 소리 탭만 보인다(조작 탭 · 배치 편집은 로비에서만)
export const matchMenu: {
  /** 판 중 설정 화면을 연다 (이미 열려 있으면 그대로) */
  open: (() => void) | null;
  /** 닫는다 */
  close: (() => void) | null;
  /** 열려 있는가 (판 장면이 입력을 멈춘다) */
  isOpen: () => boolean;
} = { open: null, close: null, isOpen: () => false };

/** 열려 있으면 닫고, 닫혀 있으면 연다 (Esc · 메뉴 버튼) */
export function toggleMatchMenu(): void {
  if (matchMenu.isOpen()) matchMenu.close?.();
  else matchMenu.open?.();
}
