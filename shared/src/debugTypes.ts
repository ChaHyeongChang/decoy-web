// 브라우저 디버그 훅(window.__DECOY__)의 타입. 클라이언트와 E2E 테스트가 같이 쓴다.
import type { MoveState } from './movement';
import type { TruthFrame } from './sim/truth';
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
  /**
   * 캐릭터를 그린 그림(텍스처) 키 (M10b). 괴물 화면의 생존자는 역할과 상관없이 모두 같은 키('survivor-hidden')여야 한다.
   * 마커처럼 텍스처 없이 그린 것은 없음
   */
  sprite?: string;
}

/**
 * 화면 레이어 이름 (M10b, VISUAL_SPEC 정보 우선 규칙 R1 순서).
 * map = 구조(바닥 · 벽 · 기둥 · 시설)와 시야 빛, glow = 시설 발광, floorInfo = 바닥 문양 · 배지,
 * particles = 장식 입자, cone = 부채꼴, entities = 캐릭터와 부착 표시 · 범위, markers = 안개 위 정보 마커,
 * screen = 화면 효과(피격 · 발각 테두리 · 페이드), hud = HUD · 배너 · 글자
 */
export type LayerName =
  'map' | 'glow' | 'floorInfo' | 'particles' | 'cone' | 'entities' | 'markers' | 'screen' | 'hud';

/** 후처리가 걸린 레이어 (M10b). 비네트 · 색보정 · 블룸은 map · glow에만 걸려야 한다 */
export interface FxTarget {
  layer: LayerName;
  /** 걸린 효과 이름 (예: 'vignette', 'colorGrade', 'bloom', 'fogEdge', 'vignetteOverlay') */
  effects: string[];
}

/**
 * 정보 레이어 항목 (M10b): 플레이어가 판단에 쓰는 화면 정보. **품질 단계와 상관없이 완전히 같아야 한다**(장식 값을 넣지 않는다).
 * 좌표 · 반지름은 타일, 각도는 라디안, 색은 0xRRGGBB
 */
export interface InfoItem {
  /**
   * badge = 거점 · 탈출구 · 감옥 배지, progress = 진행 게이지(거점 점령 · 탈출구 개방 · 구조),
   * cone = 괴물 부채꼴, range = 범위 표시(공격 준비 · 밀치기 · 포효 · 캠핑 · 근접 원), marker = 안개 위 마커(탐지 · 포효),
   * reveal = 괴물 화면 능력 노출(역할색 테두리 + 문양)
   */
  kind: 'badge' | 'progress' | 'cone' | 'range' | 'marker' | 'reveal';
  /** 세부 이름 (예: 'point-A', 'exit-N', 'prison', 'attack', 'shove', 'roar', 'camp', 'near', 'track', 'roarSelf', 'roarPing', 'rescue', 'runner') */
  tag: string;
  x: number;
  y: number;
  /** 반지름 (판정값, 없으면 null) */
  r: number | null;
  /** 방향 (부채꼴 · 공격 범위, 없으면 null) */
  dir: number | null;
  /** 전체 각도 (부채꼴 · 공격 범위, 없으면 null) */
  arc: number | null;
  /** 진행 0~1 또는 상태 이름 (없으면 null) */
  value: number | string | null;
  color: number;
  alpha: number;
}

/** 그래픽 상태 (M10: 렌더 해상도 · 품질 · 안개) */
export interface GfxDebugInfo {
  quality: 'high' | 'medium' | 'low';
  /** 품질을 정한 곳: URL(?quality) · 저장된 설정 · 자동 */
  qualitySource: 'url' | 'saved' | 'auto';
  renderer: 'webgl' | 'canvas';
  /** 터치 기기로 판단했는가 */
  touch: boolean;
  /** 판 배치 (M12): PC 1920×1080 · 터치 넓은 화면(2:1 이상) · 터치 16:9 */
  layout: 'pc' | 'touchWide' | 'touchNarrow';
  /** 논리 해상도 (M12, PC 1920×1080) */
  viewW: number;
  viewH: number;
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
  /** 새로 만드는 Phaser 글자의 텍스처 해상도 (= zoom). 이미 있는 글자의 실제 값은 textAudit()로 본다 */
  textRes: number;
  /** 바닥 합성 캔버스 배율 (논리 px 대비) */
  compositeScale: number;
  /** 미니맵 캔버스 배율 */
  minimapScale: number;
  /** 안개 합성 방식 */
  fogMode: 'gpu' | 'canvas';
  /** 시야 밖 밝기 하한 (0~1) */
  ambient: number;
  /** 실제로 켜진 장식 기능 (bloom · vignette · fogShader · particleCap ...)과 autoDowngrade(on · checking · off) */
  features: Record<string, boolean | number | string>;
  /** 판 중 자동으로 품질을 내린 횟수 (효과가 없어 되돌려도 줄지 않는다) */
  downgrades: number;
  /** 품질 판단에 쓴 최근 FPS */
  measuredFps: number;
  /** 프레임 제한 설정 (렌더링 최적화): 자동(화면 주사율을 따른다) · 60 · 120 */
  frameLimit: 'auto' | '60' | '120';
  /** 잰 화면 주사율 (Hz, 60 아래로는 보지 않는다) */
  displayHz: number;
  /** 지금 목표 FPS = min(제한, 화면). 자동 제한에서 버티지 못하면 60으로 내려갈 수 있다 */
  targetHz: number;
  /** 판 중 자동으로 되돌려 올린 횟수 (품질 단계 · 목표 FPS) */
  upgrades: number;
  /** 캐릭터 스타일 (캐릭터 리디자인 2단계): 기존 도형 · 새 캐릭터. 그림만 바꾼다 */
  charStyle: 'classic' | 'new';
}

/** 프레임 측정 (렌더링 최적화, ?debug=1 오버레이 · 적응형 품질 · E2E). 최근 렌더 프레임들의 요약 */
export interface FrameStatsInfo {
  /** 요약에 쓴 프레임 수 */
  frames: number;
  /** 렌더한 프레임 수 / 초 (최근 1초) */
  fps: number;
  /** 렌더 프레임 사이 간격 (ms) */
  intervalAvg: number;
  intervalP95: number;
  /** 한 프레임에 메인 스레드가 쓴 시간 (Phaser 한 걸음: 갱신 + 그리기 명령, ms) */
  workAvg: number;
  workP95: number;
  /** 지난 프레임의 그리기 호출 수 (WebGL drawArrays · drawElements, Canvas 렌더러는 그린 객체 수). 재지 않으면 null */
  drawCalls: number | null;
  /** 프레임 제한 때문에 건너뛴 rAF 수 (누계) */
  skipped: number;
}

/** 프레임 독립성 시험 (렌더링 최적화)용 연출 상태: 같은 시각이면 60fps · 120fps에서 같아야 하는 값들 */
export interface AnimDebug {
  /** 내 괴물 시야 모드 보간 (0 탐색 ~ 1 추적, 괴물이 아니면 null) */
  myBlend: number | null;
  /** 엔티티별 걷기 위상(라디안) · 걷기 자세 섞기(0 멈춤 ~ 1 걷는 중) (id → 값, 이번 프레임에 그린 것만) */
  gait: Record<string, { phase: number; stepping: number }>;
  /** 마지막 안개 · 시야 갱신 시각 (ms, performance.now 기준. 아직 없으면 null) */
  fogAt: number | null;
  /** 생존자 화면 괴물 부채꼴 빨강 정도 0~1 */
  coneRed: number;
  /** 돌진 잔상 수 */
  dashGhosts: number;
  /** 돌진 잔상마다 남긴 격자 시각(ms, performance.now 기준) · 알파 (오래된 것부터) */
  ghosts: { at: number; alpha: number }[];
  /** 살아 있는 입자 수 */
  particles: number;
  /** 판 장면을 만든 뒤 그린 프레임 수 (프레임 제한기가 건너뛴 rAF는 세지 않는다) */
  frames: number;
}

/** 활성 장면의 Phaser 글자 점검 (M10a 선명도: 글자 해상도 = zoom, 격자 맞춤) */
export interface TextAudit {
  /** 글자 수 (Container · Layer 안, 숨긴 글자 · 선명도 탐침 포함) */
  count: number;
  /** 글자 스타일 해상도 최솟값 · 최댓값 */
  styleResMin: number;
  styleResMax: number;
  /** 텍스처 소스 해상도(Canvas 렌더러가 크기를 나누는 값) 최솟값 · 최댓값 */
  sourceResMin: number;
  sourceResMax: number;
  /** 왼쪽 위 위치 × zoom이 정수(백버퍼 픽셀)에서 벗어난 최댓값 */
  gridErrMax: number;
  /** 선명도 탐침 글자의 해상도 (만든 적이 없으면 null) */
  probeRes: number | null;
  /** 페이지를 연 뒤 글자 텍스처를 다시 그린 누적 횟수 */
  redraws: number;
  /** 그중 글자 · 글꼴 · 해상도처럼 배치가 바뀐 횟수 (같은 색 · 같은 글자로 다시 그리면 redraws만 는다) */
  relayouts: number;
}

/** 최근 입력 프레임 하나 (M11): pressed는 한 프레임만 살아 getLastInput()으로는 놓친다 */
export interface InputLogEntry extends InputFrame {
  /** 만든 시각 (performance.now, ms) */
  t: number;
  /** 이 프레임을 만들 때의 입력 방식 */
  mode: 'keyboard' | 'touch';
}

/** 화면에 보이는 터치 대상 하나 (M11, CSS px · 창 기준). data-touch-target · data-touch-kind 요소에서 */
export interface TouchTarget {
  id: string;
  kind: 'zone' | 'stick' | 'button';
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 판 화면의 HUD 부품 하나 (M12, CSS px · 창 기준). 표시 목록에서 직접 모은다(자기 신고 아님) */
export interface HudLayoutItem {
  /** 부품 이름 (Phaser 객체 name, 없으면 종류 + 순번) */
  id: string;
  kind: 'text' | 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** 글자: 화면에 그려지는 글자 크기 (CSS px = 글꼴 px × 배율 × 논리 → CSS) */
  fontPx?: number;
  /** 글자 내용 */
  text?: string;
}

/** 판 화면 HUD 배치 (M12): 터치 글자 크기 · HUD와 터치 컨트롤 겹침 검사용 */
export interface HudLayout {
  layout: 'pc' | 'touchWide' | 'touchNarrow';
  /** 논리 해상도 */
  viewW: number;
  viewH: number;
  /** 논리 1px이 몇 CSS px인가 */
  cssPerLogical: number;
  /** 맵 사각형 (CSS px · 창 기준) */
  map: { x: number; y: number; w: number; h: number };
  /** 보이는 HUD 글자 · 그림 (월드 · 화면 효과 제외) */
  items: HudLayoutItem[];
}

export interface DecoyDebug {
  /** 그래픽 상태 (M10) */
  readonly gfx: Readonly<GfxDebugInfo>;
  /** 장식 애니메이션 · 입자 시계를 멈춘다(ms) / null이면 다시 흐름. 규칙 · 입력에는 영향 없음 */
  freezeClock(ms: number | null): void;
  /** 품질 자동 하향 판단에 쓸 FPS를 덮어쓴다 / null이면 실제 측정값. 렌더링 최적화부터는 프레임 시간(작업 시간 포함)도 1000/fps로 본다 */
  injectFps(fps: number | null): void;
  /** 프레임 측정 요약 (렌더링 최적화). 판 장면 · 게임이 없으면 null */
  getFrameStats(): FrameStatsInfo | null;
  /** 프레임 독립성 시험용 연출 상태 (판 장면이 없으면 null) */
  getAnimState(): AnimDebug | null;
  /** 프레임 제한을 바꾼다 (로비 선택과 같은 경로, 저장하지 않음) */
  setFrameLimit(limit: 'auto' | '60' | '120'): void;
  /** 캐릭터 스타일을 바꾼다 (설정과 같은 경로, 저장하지 않음). 판 중이면 다음 프레임에 그림을 다시 굽는다 */
  setCharStyle(style: 'classic' | 'new'): void;
  /** 선명도 검사: HUD에 글자를 그린다 (논리 좌표 x, y, 글자 크기 px) */
  probeText(text: string, x: number, y: number, px: number): void;
  /** 활성 장면의 모든 Phaser 글자 해상도 · 격자 어긋남 · 다시 그린 횟수 */
  textAudit(): TextAudit;
  /** 이번 프레임의 정보 레이어 (M10b, 품질과 상관없이 같아야 함) */
  getInfoLayer(): InfoItem[];
  /** 후처리가 걸린 레이어와 효과 (M10b) */
  getFxTargets(): FxTarget[];
  /** UI 폰트(Noto Sans KR 서브셋)를 받았는가, 판 장면을 시작할 때 준비되어 있었는가 (M10c, 시작 전이면 null) */
  readonly fonts: { ready: boolean; atSceneStart: boolean | null };
  /** HUD 상태: 다시 굽기 횟수(bakes) · 거점 게이지 상태 · 점수판 · 조작 안내 표시 등 (M10c) */
  getHud(): Record<string, number | boolean | string>;
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
  /** 최근 입력 프레임 120개, 오래된 것부터 (M11) */
  getInputLog(): InputLogEntry[];
  /** 지금 입력 방식: 터치 화면이 있으면 'touch' (M11) */
  readonly inputMode: 'keyboard' | 'touch';
  /** 보이는 터치 대상 (M11) */
  getTouchTargets(): TouchTarget[];
  /** 판 화면 HUD 배치 (M12, 판 장면이 없으면 null) */
  getHudLayout(): HudLayout | null;
  serverNow(): number;
  /** 테스트 명령: 지금 전송으로 보낸다 (연습 중이면 기기 안 서버, M13b) */
  sendTest(cmd: TestCommand): void;
  /** 지금 전송 (M13b): net = 서버 WebSocket, local = 기기 안 봇과 연습 */
  readonly transport: 'net' | 'local';
  /** 연습 방 코드 (`P-` 접두, 연습 중이 아니면 null) */
  readonly practiceRoom: string | null;
  /** 기기 안 정답 상태 (연습 중에만, 아니면 null). 서버의 /test/state와 같은 모양 */
  getTruth(): TruthFrame | null;
  /** 타일 좌표 → 브라우저 창 좌표 (E2E에서 마우스를 옮길 때) */
  tileToClient(x: number, y: number): { x: number; y: number } | null;
}
