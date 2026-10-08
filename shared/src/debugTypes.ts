// 브라우저 디버그 훅(window.__DECOY__)의 타입. 클라이언트와 E2E 테스트가 같이 쓴다.
import type { MoveState } from './movement';
import type { InputFrame, MatchResult, Role, Snapshot, TestCommand } from './types';

/** 이번 프레임에 실제로 그린 엔티티 */
export interface DrawnEntity {
  id: string;
  kind: 'self' | 'survivor' | 'monster' | 'mark';
  x: number;
  y: number;
  face: number;
  /** 화면: 메인 또는 미니맵 */
  layer?: 'main' | 'minimap';
  /** 마커 종류 등 부가 정보 */
  tag?: string;
}

/** 그래픽 상태 (M10: 렌더 해상도 · 품질 · 안개) */
export interface GfxDebugInfo {
  quality: 'high' | 'medium' | 'low';
  /** 품질을 정한 곳: URL(?quality) · 저장된 설정 · 자동 */
  qualitySource: 'url' | 'saved' | 'auto';
  renderer: 'webgl' | 'canvas';
  /** 터치 기기로 판단했는가 */
  touch: boolean;
  dpr: number;
  /** 캔버스 표시 크기 (CSS px) */
  cssW: number;
  cssH: number;
  /** 백버퍼 (캔버스 실제 픽셀) */
  backingW: number;
  backingH: number;
  /** 카메라 zoom = 백버퍼 px / 논리 px (1보다 클 수 있다) */
  zoom: number;
  /** ?scale로 준 배율 (없으면 null) */
  scaleOverride: number | null;
  /** Phaser 글자 텍스처 해상도 (= zoom) */
  textRes: number;
  /** 바닥 합성 캔버스 배율 (논리 px 대비) */
  compositeScale: number;
  /** 미니맵 캔버스 배율 */
  minimapScale: number;
  /** 안개 합성 방식 */
  fogMode: 'gpu' | 'canvas';
  /** 시야 밖 밝기 하한 (0~1) */
  ambient: number;
  /** 실제로 켜진 장식 기능 (bloom · vignette · fogShader · particleCap ...) */
  features: Record<string, boolean | number | string>;
  /** 판 중 자동으로 품질을 내린 횟수 */
  downgrades: number;
  /** 품질 판단에 쓴 최근 FPS */
  measuredFps: number;
}

export interface DecoyDebug {
  /** 그래픽 상태 (M10) */
  readonly gfx: Readonly<GfxDebugInfo>;
  /** 장식 애니메이션 · 입자 시계를 멈춘다(ms) / null이면 다시 흐름. 규칙 · 입력에는 영향 없음 */
  freezeClock(ms: number | null): void;
  /** 품질 자동 하향 판단에 쓸 FPS를 덮어쓴다 / null이면 실제 측정값 */
  injectFps(fps: number | null): void;
  /** 선명도 검사: HUD에 글자를 그린다 (논리 좌표 x, y, 글자 크기 px) */
  probeText(text: string, x: number, y: number, px: number): void;
  readonly role: Role | null;
  readonly you: string | null;
  readonly room: string | null;
  readonly phase: string | null;
  readonly fps: number;
  readonly ping: number;
  readonly serverOffset: number;
  readonly pendingInputs: number;
  readonly correction: number;
  readonly renderer: 'webgl' | 'canvas' | 'none';
  readonly balanceHash: string;
  readonly snapCount: number;
  getLocalState(): MoveState | null;
  getRenderPos(): { x: number; y: number; face: number } | null;
  getLastSnapshot(): Snapshot | null;
  getDrawn(): DrawnEntity[];
  /** 미니맵에 그린 엔티티 */
  getDrawnMinimap(): DrawnEntity[];
  /** 지금 보이는 배너 · 메모 문구 */
  getBanners(): string[];
  /** 지금 보이는 연출 (피격 플래시 · 수감 페이드 · 채도 감소 · 기절 별 · 돌진 잔상 · 공격 범위) */
  getEffects(): Record<string, number | boolean>;
  /** 재생 요청한 효과음 이름 (최근 50개) */
  getSounds(): string[];
  /** 오디오가 열렸는가 (첫 사용자 입력 뒤) */
  readonly audioReady: boolean;
  getResult(): MatchResult | null;
  getLastInput(): InputFrame | null;
  serverNow(): number;
  sendTest(cmd: TestCommand): void;
  /** 타일 좌표 → 브라우저 창 좌표 (E2E에서 마우스를 옮길 때) */
  tileToClient(x: number, y: number): { x: number; y: number } | null;
}
