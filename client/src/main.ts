// DECOY 클라이언트 진입점
import Phaser from 'phaser';
import { App, camOverrideAllowed, readParams } from './app';
import { MONSTER_SPAWN, PRISON_CENTER } from '@decoy/shared';
import { PRACTICE_BALANCE } from './localServer';
import { sfx } from './audio';
import { installDebug } from './debug';
import { canOfferFullscreen, device, enterFullscreen, initDevice, onDeviceChange } from './device';
import { initCharStyle, onCharStyleChange } from './gfx/charStyle';
import { Pacer, loadFrameLimit, pacingHooks, patchTimeStep, targetHzFor } from './gfx/framePacing';
import { sessionFrameStats } from './gfx/frameStats';
import type { QualityPreset, QualityTier, RendererKind } from './gfx/presets';
import {
  autoQuality,
  detectQuality,
  forgetPerfMemory,
  fpsWatchFor,
  isSoftwareGl,
  isTouchDevice,
  loadPerfMemory,
  loadSavedQuality,
  perfToRemember,
  qualityHooks,
  rememberPerf,
  savedForSession,
  sessionAutoDowngrade,
  type PerfMode,
  type QualityChoice,
  type QualityEnv,
  type QualitySource,
} from './gfx/quality';
import { currentPreset, gfxState, notifyGfxChange, onGfxChange, probeSlot } from './gfx/state';
import { prebakeAtlas } from './art/atlas';
import { prebakeFogArt } from './render/baseLayer';
import { computeRenderSize, type RenderSize } from './render/resolution';
import { settleSize } from './render/settle';
import { GameScene } from './scenes/GameScene';
import { fontState, loadUiFonts, onUiFontsLate, uiFontsReady } from './ui/fonts';
import { prebakeHud } from './ui/hudKit';
import {
  CAM_ZOOM,
  DEFAULT_CAM_ZOOM,
  RENDER_SCALE,
  VIEW_H,
  VIEW_W,
  configureLayout,
  fitCamera,
  layout,
  setCamZoom,
  setRenderScale,
} from './ui/layout';
import { drawProbeText, relayoutAll, retextAll } from './ui/text';

/** 창 크기 · DPR이 바뀐 뒤 백버퍼를 다시 만들 때까지 기다리는 시간 (끌어서 바꾸는 동안 매번 만들지 않게) */
const RESIZE_DEBOUNCE_MS = 150;

const params = readParams(window.location.search);
// 카메라 확대 수준 (판 내내 고정, 플레이어가 바꿀 수 없다). ?cam은 로컬 주소에서만(시험 · 촬영): 그림 굽기가 읽기 전에 정한다
setCamZoom(
  params.cam !== null && camOverrideAllowed(window.location.hostname) ? params.cam : DEFAULT_CAM_ZOOM,
);
gfxState.camZoom = CAM_ZOOM;
// 터치 모드 · 세로 · 브라우저 안 (M11). 로비가 전체 화면 버튼을 그리기 전에 정한다
initDevice(params.touch);
const uiRoot = document.getElementById('ui-root') ?? document.body;
const gameRoot = document.getElementById('game-root') ?? document.body;
const app = new App(params, uiRoot);
// 캐릭터 스타일: ?chars(시험 · 촬영용)는 이번 접속에만, 아니면 저장값 · 기존 (gfx/charStyle.ts)
initCharStyle(params.chars);

// 프레임 페이싱 상태 (아래 '프레임 페이싱'에서 Phaser 루프에 끼운다). 품질을 정할 때 시작 목표 FPS를 읽으므로 먼저 만든다.
// ?fpsLimit(시험용)는 이번 접속에만, 아니면 로비에서 고른 저장값
const pacer = new Pacer(params.fpsLimit ?? loadFrameLimit() ?? 'auto');
// 판이 없을 때(로비 · 결과)는 30fps로 묶는다 (빈 캔버스를 120Hz로 그리지 않게, 배터리)
pacer.setIdle(true);

// ───────────── 기기 · 품질 ─────────────

function mediaMatches(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

const touch = isTouchDevice(mediaMatches('(pointer: coarse)'), mediaMatches('(any-pointer: fine)'));
const cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;
// deviceMemory는 크롬 계열에만 있다 (DOM 타입에 없음)
const deviceMemory = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory;
const memory = typeof deviceMemory === 'number' ? deviceMemory : null;
/** ?quality. 로비에서 직접 고르면 이번 세션에서는 그 값이 우선한다 */
let urlQuality: QualityTier | null = params.quality;
/**
 * 이번 세션에서 로비로 고른 값. 저장소가 막히거나(사생활 보호 · 쿠키 차단 · iframe) 가득 차서 저장에 실패해도
 * 이 값이 적용된다 (저장소를 다시 읽으면 고른 값 대신 예전 저장값이나 자동이 되던 문제)
 */
let sessionChoice: QualityChoice | null = null;
let softwareGl = false;

function rendererType(): number {
  if (params.renderer === 'canvas') return Phaser.CANVAS;
  if (params.renderer === 'webgl') return Phaser.WEBGL;
  return Phaser.AUTO;
}

/**
 * 판 중 측정을 기억 · 적용하는 모드: 온라인(서버 판) · 연습(기기 안 판). 판 장면을 만들기 직전에 이번 판의 모드로 바꾸고
 * (enterPerfMode), 판 장면은 sessionAutoDowngrade.beginMatch에 같은 모드를 넘긴다 (검토 반영 F11)
 */
let perfMode: PerfMode = 'online';

/** 품질을 정하는 환경. 판 중 측정 기억은 터치 기기에서만 쓴다 (PC는 M10 그대로 세션 단위) */
function qualityEnv(): QualityEnv {
  return {
    url: urlQuality,
    saved: savedForSession(sessionChoice, loadSavedQuality()),
    renderer: gfxState.renderer,
    softwareGl,
    touch,
    cores,
    memory,
    perf: touch ? (loadPerfMemory()[perfMode] ?? null) : null,
    targetHz: startTargetHz(),
  };
}

/**
 * 판 시작 목표 FPS (적응형 품질이 낮추기 전): 프레임 제한과 잰 화면 주사율. 판 중 측정 기억(decoy:perf)은 같은 목표에서 잰 것만
 * 쓴다 — 120Hz에서 내린 품질로 60 제한 판을 시작하지 않게. pacer는 아래에서 만든다(함수는 부팅 뒤에만 불린다)
 */
function startTargetHz(): number {
  return targetHzFor(pacer.limit, pacer.displayHz, null);
}
/** 마지막으로 품질을 정할 때의 시작 목표 FPS (터치 기기 측정 기억을 맞춰 볼 기준) */
let decidedAtHz = 60;
/** 이번 판의 시작 목표 FPS (판 장면을 만들 때 잡는다). 측정 기억은 이 값으로 남긴다 — 판 중 잰 값이 아니라 */
let matchStartHz = 60;

/**
 * 판 시작 직전: 이번 판의 측정 모드로 바꾼다. 터치 기기에서 모드가 바뀌면 그 모드의 기억으로 품질을 다시 정한다
 * (PC는 기억을 쓰지 않으므로 다시 정하지 않는다 — 세션 하향이 풀리지 않게). 품질 단계가 바뀌었으면 true
 */
function enterPerfMode(mode: PerfMode): boolean {
  // 부팅 때는 화면 주사율을 아직 못 재 60으로 정했다: 판 시작 목표가 달라졌으면(120Hz 화면 등) 그 목표의 기억으로 다시 정한다
  const hzChanged = touch && startTargetHz() !== decidedAtHz;
  if (mode === perfMode && !hzChanged) return false;
  perfMode = mode;
  if (!touch) return false;
  const before = gfxState.quality;
  setQuality(decideQuality());
  return gfxState.quality !== before;
}

function decideQuality(): { tier: QualityTier; source: QualitySource } {
  const env = qualityEnv();
  decidedAtHz = env.targetHz ?? 60;
  const q = detectQuality(env);
  // 기억한 단계로 시작했는가 (디버그 · E2E: 'none'이면 기기 자동 그대로)
  gfxState.features.perfTier = q.source === 'auto' && q.tier !== autoQuality(env) ? q.tier : 'none';
  return q;
}

/** 품질 단계가 켜는 장식 기능 (디버그 훅 · E2E용. 실제로 켠 결과는 각 렌더 모듈이 덧쓴다) */
function presetFeatures(p: QualityPreset): Record<string, boolean | number | string> {
  return {
    dprCap: p.dprCap,
    maxPixels: p.maxPixels,
    minBackingH: p.minBackingH,
    floorDprCap: p.floorDprCap,
    compositeCap: p.compositeCap,
    lightPxPerTile: p.lightPxPerTile,
    fog: p.fog,
    fogShader: p.fogShader,
    bloom: p.bloom,
    vignette: p.vignette,
    colorGrade: p.colorGrade,
    glow: p.glow,
    particleCap: p.particleCap,
    halfFrameAnims: p.halfFrameAnims,
  };
}

function setQuality(q: { tier: QualityTier; source: QualitySource }): void {
  gfxState.quality = q.tier;
  gfxState.qualitySource = q.source;
  gfxState.features = { ...gfxState.features, ...presetFeatures(currentPreset()) };
  syncAutoStatus();
}

/** 판 중 자동 하향 상태 (on · checking · off)와 기준 FPS 표시 */
function syncAutoStatus(): void {
  gfxState.features.autoDowngrade = sessionAutoDowngrade.status;
  // 지금 목표에서의 하향 기준 (60Hz에서 PC 40 · 터치 50, 목표 120이면 80 · 100)
  gfxState.features.autoMinFps = sessionAutoDowngrade.minFps;
}

gfxState.touch = touch;
// 판 중 하향 기준: 터치 기기는 목표(중간 50fps)에 맞춘 값 (gfx/quality.ts TOUCH_FPS_WATCH)
sessionAutoDowngrade.setWatchConfig(fpsWatchFor(touch));
gfxState.scaleOverride = params.scaleOverride;
// 렌더러는 Phaser가 정한다. 그 전에는 요청대로(AUTO면 WebGL로) 가정하고, 부팅 직후 실제 렌더러로 다시 정한다
gfxState.renderer = params.renderer === 'canvas' ? 'canvas' : 'webgl';
setQuality(decideQuality());

// ───────────── 해상도 ─────────────

function measure(): RenderSize {
  const r = gameRoot.getBoundingClientRect();
  return computeRenderSize({
    cssW: r.width,
    cssH: r.height,
    dpr: window.devicePixelRatio || 1,
    logicalW: VIEW_W,
    logicalH: VIEW_H,
    preset: currentPreset(),
    scaleOverride: params.scaleOverride,
    originX: r.left,
    originY: r.top,
  });
}

const initial = measure();
setRenderScale(initial.zoom);

// ───────────── 프레임 페이싱 (렌더링 최적화) ─────────────
// 화면 주사율을 따라 그린다(자동). 60 · 120 제한은 Phaser의 fps.limit 대신 우리 제한기로: Phaser 것은 생성 때 고정이고
// 오차 허용이 없어 120Hz 흔들림에서 40fps로 떨어진다. TimeStep.start가 this.step을 rAF에 묶기 전에 끼워야 한다
// 프레임 측정(gfx/frameStats.ts): 그리는 걸음만 잰다 — 측정을 안쪽에, 제한기를 바깥에 끼워 건너뛴 rAF는 세기만 한다.
// 작업 시간 = Phaser 한 걸음(장면 갱신 + 그리기 명령)의 메인 스레드 시간, 간격 = 그린 프레임 사이 rAF 시각 차이
const timeStep = Phaser.Core.TimeStep.prototype;
const rawStep = timeStep.step;
timeStep.step = function measuredStep(this: Phaser.Core.TimeStep, time: number): void {
  sessionFrameStats.begin(time, performance.now());
  rawStep.call(this, time);
  sessionFrameStats.end(performance.now());
};
patchTimeStep(timeStep, pacer);
pacer.onSkip = () => sessionFrameStats.noteSkipped();

/** 디버그 훅 · 오버레이 · 적응형 품질이 읽는 페이싱 상태 */
function syncPacing(): void {
  gfxState.frameLimit = pacer.limit;
  gfxState.displayHz = pacer.displayHz;
  gfxState.targetHz = pacer.targetHz;
}
syncPacing();
// 주사율은 재는 데 시간이 걸리고(30프레임 뒤부터) 바뀔 수 있다(가변 주사율 화면) — 0.5초마다 옮겨 적는다
window.setInterval(syncPacing, 500);
pacingHooks.setLimit = (limit) => {
  pacer.setLimit(limit);
  // 사용자가 정한 제한: 적응형 품질이 낮춰 둔 목표는 잊고 새 목표에서 다시 잰다
  pacer.setFallback(null);
  sessionAutoDowngrade.resetRate();
  syncPacing();
  syncAutoStatus();
};
/** 이 zoom(백버퍼 px / 논리 px) 이상으로 시작하면 WebGL MSAA를 켜지 않는다 (1920×1080 @1.25 = 1.25부터) */
const MSAA_MAX_ZOOM = 1.25;

class IdleScene extends Phaser.Scene {
  constructor() {
    super('idle');
  }
  create(): void {
    fitCamera(this.cameras.main);
    // 선명도 검사 글자: 판 장면이 없을 때는 여기에 (GameScene이 떠 있는 동안은 GameScene이 가져간다)
    probeSlot.draw = (text, x, y, px) => drawProbeText(this, text, x, y, px);
  }
}

const game = new Phaser.Game({
  type: rendererType(),
  parent: 'game-root',
  backgroundColor: '#0B1622',
  banner: false,
  disableContextMenu: true,
  // 크기는 직접 정한다: 백버퍼 = 표시 크기 × 기기 픽셀 배율, 캔버스는 기기 픽셀 격자에 맞춰 놓는다.
  // Scale.FIT은 devicePixelRatio를 보지 않고 캔버스를 CSS로 늘려서 흐렸다 (DECISIONS)
  scale: {
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.NO_CENTER,
    width: initial.backingW,
    height: initial.backingH,
    zoom: 1 / initial.k,
  },
  // 60fps로 묶지 않는다: target은 상한이 아니라 Phaser 내부 기준값(actualFps 시작 값)이고 limit은 쓰지 않는다(위 페이싱).
  // smoothStep을 끈다 — 켜 두면 delta가 최근 10프레임 평균인 데다 시작 · 포커스 뒤 120프레임 동안 16.7ms로 잘려
  // 120Hz와 60Hz에서 시간 적분이 달라진다. 게임 코드는 실제 프레임 간격(rawDelta)으로 적분한다
  fps: { target: 60, smoothStep: false },
  // 카메라 배경색이 매 프레임 화면 전체를 칠하므로 따로 지우지 않는다. 정수 좌표로 그려 비트맵 복사를 싸게.
  // pixelArt · antialias를 꼭 적는다: Phaser는 scale.zoom이 1이 아니면(기기 픽셀 배율 ≠ 1) pixelArt를 켜서
  // 모든 텍스처가 NEAREST(회전 스프라이트 계단, 확대한 빛 지도 블록)가 되고 WebGL 안티에일리어싱이 꺼진다
  render: {
    clearBeforeRender: false,
    pixelArt: false,
    antialias: true,
    // WebGL 다중 샘플(MSAA)은 백버퍼가 작을 때만: 기본 프레임버퍼 4× MSAA는 픽셀당 약 32바이트라 배율 2 4K 백버퍼면
    // 약 250MiB다. 이미 고해상도이면 Graphics 가장자리 계단이 덜 보인다. WebGL 컨텍스트를 만들 때 한 번만 정해진다
    antialiasGL: initial.zoom < MSAA_MAX_ZOOM,
  },
  scene: [IdleScene, GameScene],
});
app.game = game;

/** 캔버스를 부모 안 기기 픽셀 격자 위치에 놓는다. 옮긴 뒤 refresh를 빠뜨리면 입력 좌표가 어긋난다(조준 18° 실측) */
function placeCanvas(r: Pick<RenderSize, 'dispW' | 'dispH' | 'left' | 'top'>): void {
  const st = game.canvas.style;
  st.position = 'absolute';
  st.margin = '0';
  st.left = `${r.left}px`;
  st.top = `${r.top}px`;
  st.width = `${r.dispW}px`;
  st.height = `${r.dispH}px`;
  // 백버퍼가 기기 픽셀과 1:1이면 최근접: 배치 단위(1/64px) 반올림으로 남는 아주 작은 크기 차이를 브라우저가 부드럽게
  // 다시 샘플링하면 글자가 흐려진다(1536×730 @1.25). 1:1이 아니면(품질 해상도 상한 · ?scale · 창 크기를 바꾸는 중)
  // 최근접은 1.25 · 1.33배에서 4~5칸마다 줄을 복제해 획 두께가 들쭉날쭉해지므로 부드럽게 늘린다
  const dpr = window.devicePixelRatio || 1;
  const oneToOne =
    Math.abs(r.dispW * dpr - game.canvas.width) < 0.5 && Math.abs(r.dispH * dpr - game.canvas.height) < 0.5;
  st.imageRendering = oneToOne ? 'pixelated' : 'auto';
  game.scale.refresh();
}

function writeSizeState(r: RenderSize): void {
  gfxState.dpr = window.devicePixelRatio || 1;
  gfxState.cssW = r.dispW;
  gfxState.cssH = r.dispH;
  gfxState.backingW = r.backingW;
  gfxState.backingH = r.backingH;
  gfxState.zoom = r.zoom;
  gfxState.scaleOverride = params.scaleOverride;
  gfxState.textRes = RENDER_SCALE;
  gfxState.features.msaaBytes = msaaBytes();
}

/** 기본 프레임버퍼 다중 샘플 메모리 어림 (샘플 × 픽셀 × 색 4 + 깊이 · 스텐실 4바이트). 텍스처 예산과 따로 기록한다 */
function msaaBytes(): number {
  const r = game.renderer;
  if (!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return 0;
  const samples = Number(r.gl.getParameter(r.gl.SAMPLES)) || 0;
  return samples > 1 ? samples * gfxState.backingW * gfxState.backingH * 8 : 0;
}

/**
 * Phaser는 포인터 위치를 백버퍼 px로 기억한다. 백버퍼 크기가 바뀌면 마우스가 움직이기 전까지 옛 px가 새 zoom으로 해석되어
 * 조준이 엉뚱한 곳을 향한다 → 같은 게임 좌표를 가리키도록 배율만큼 옮긴다 (이전 Scale.FIT은 백버퍼가 고정이라 생기지 않던 문제)
 */
function rescalePointers(sx: number, sy: number): void {
  for (const p of game.input.pointers) {
    p.position.set(p.position.x * sx, p.position.y * sy);
    p.prevPosition.set(p.prevPosition.x * sx, p.prevPosition.y * sy);
  }
}

/**
 * 지금 화면 · 품질에 맞춰 백버퍼 · 카메라 · 글자를 다시 맞춘다 (장면 재시작 · 재연결 없음).
 * 크기가 바뀌었거나 force(품질 변경)면 notifyGfxChange로 바닥 합성 · 미니맵 등에 알린다
 */
function applyResolution(force = false): void {
  const next = measure();
  const prevW = game.scale.width;
  const prevH = game.scale.height;
  const changed = next.backingW !== prevW || next.backingH !== prevH || next.zoom !== RENDER_SCALE;
  if (changed) {
    rescalePointers(next.backingW / prevW, next.backingH / prevH);
    setRenderScale(next.zoom);
    game.scale.zoom = 1 / next.k;
    game.scale.resize(next.backingW, next.backingH);
    for (const scene of game.scene.getScenes(true)) {
      const cam = scene.cameras.main;
      cam.setSize(next.backingW, next.backingH);
      fitCamera(cam);
      retextAll(scene);
    }
  }
  placeCanvas(next);
  writeSizeState(next);
  if (changed || force) notifyGfxChange();
}

let resizeTimer: number | null = null;

/** 창 크기 · DPR 변경: 위치 · 표시 크기는 바로(지금 백버퍼 그대로 늘려서), 백버퍼는 잠시 뒤에 */
function onViewportChange(): void {
  placeCanvas(measure());
  if (resizeTimer !== null) window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = null;
    applyResolution();
  }, RESIZE_DEBOUNCE_MS);
}

/** DPR 변경(다른 모니터로 옮김 · 브라우저 확대)은 resize 없이 올 수 있어 matchMedia로도 듣는다 */
function watchDpr(): void {
  let mq: MediaQueryList;
  try {
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  } catch {
    return;
  }
  // 오래된 사파리(13 이하)에는 addEventListener가 없다. 그때는 resize 이벤트만으로 따라간다
  if (typeof mq.addEventListener !== 'function') return;
  mq.addEventListener(
    'change',
    () => {
      onViewportChange();
      watchDpr();
    },
    { once: true },
  );
}

/** WebGL 렌더러 이름. 크롬 · 사파리는 RENDERER가 일반 문자열('WebKit WebGL')이라 확장으로 실제 이름을 본다.
 *  파이어폭스는 RENDERER가 이미 실제 이름이고 확장은 지원 중단 경고를 내므로 부르지 않는다. 새 컨텍스트는 만들지 않는다 */
function glRendererName(): string | null {
  const r = game.renderer;
  if (!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return null;
  const gl = r.gl;
  try {
    const basic: unknown = gl.getParameter(gl.RENDERER);
    const name = typeof basic === 'string' ? basic : null;
    if (name !== null && !/^webkit webgl$/i.test(name.trim())) return name;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return name;
    const unmasked: unknown = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    return typeof unmasked === 'string' ? unmasked : name;
  } catch {
    return null;
  }
}

function onBooted(): void {
  const actual: RendererKind = game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas';
  gfxState.renderer = actual;
  softwareGl = actual === 'webgl' && isSoftwareGl(glRendererName());
  setQuality(decideQuality());
  applyResolution(true);
  window.addEventListener('resize', onViewportChange);
  // 가로 180° 뒤집기: 창 크기는 그대로라 resize가 없고 안전 영역(#game-root 자리)만 바뀐다
  screen.orientation?.addEventListener('change', onViewportChange);
  watchDpr();
}
// 문서가 이미 준비되어 있으면(모듈 스크립트는 늘 그렇다) Phaser는 생성자 안에서 바로 부팅한다.
// 아니면 크기 관리자까지 준비된 뒤(READY)에 맞춘다
if (game.isBooted) onBooted();
else game.events.once(Phaser.Core.Events.READY, onBooted);

// 로비에서 고른 품질(저장은 로비가 먼저 했다. 실패해도 이번 세션에는 적용): 바로 적용 (재연결 · 장면 재시작 없음).
// 이번 세션에서는 주소의 ?quality보다 방금 고른 값이 우선한다
qualityHooks.choose = (choice) => {
  sessionChoice = choice;
  urlQuality = null;
  // 사용자가 정한 단계: 확인 중이던 자동 하향을 되돌릴 대상이 사라지고, 판 중 측정 기억(온라인 · 연습)도 지운다
  // ('자동'을 고르면 기기 자동 단계부터 다시 잰다)
  sessionAutoDowngrade.cancelPending();
  forgetPerfMemory();
  setQuality(decideQuality());
  applyResolution(true);
};
// 판 중 적응형 품질 (gfx/quality.ts AutoDowngrade): 느리면 자동 제한에서는 목표 FPS부터 60으로, 그다음 품질을 한 단계 내린다.
// 내렸는데 FPS가 오르지 않았으면(화면 갱신 상한 등) 되돌린다. 여유가 생기면 내린 것을 최근 것부터 되돌린다 — 목표 FPS는 판 중에,
// 품질은 다음 판 시작 전에(판 중에 다시 굽는 끊김을 피한다). 시작 단계(사용자가 고른 것 · 주소 · 자동)보다 올리는 일은 없다.
// downgrades = 실제로 내린 횟수(품질 · 목표 FPS, 되돌려도 그대로), upgrades = 되돌려 올린 횟수
qualityHooks.auto = (a) => {
  switch (a.kind) {
    case 'downgrade':
      if (gfxState.quality === a.from) {
        gfxState.measuredFps = a.fpsBefore;
        gfxState.downgrades += 1;
        setQuality({ tier: a.to, source: gfxState.qualitySource });
        applyResolution(true);
      } else {
        // 그사이 단계가 바뀌었다(이론상): 내리지 않았으니 확인할 것도 없다
        sessionAutoDowngrade.cancelPending();
      }
      break;
    case 'revert':
      if (gfxState.quality === a.from) {
        gfxState.measuredFps = a.fpsAfter;
        setQuality({ tier: a.to, source: gfxState.qualitySource });
        applyResolution(true);
      }
      break;
    case 'rateDown':
      gfxState.downgrades += 1;
      pacer.setFallback(a.to);
      break;
    case 'rateUp':
      gfxState.upgrades += 1;
      pacer.setFallback(null);
      break;
    case 'upgrade':
      // 판 시작 전에만 온다 (takePendingUpgrade). 백버퍼 · 그림은 판 배치(applyMatchLayout)가 바로 뒤에 맞춘다
      if (gfxState.quality === a.from) {
        gfxState.upgrades += 1;
        setQuality({ tier: a.to, source: gfxState.qualitySource });
      }
      break;
    case 'upRevert':
      gfxState.downgrades += 1;
      if (a.step === 'rate') pacer.setFallback(a.to);
      else if (gfxState.quality === a.from) {
        setQuality({ tier: a.to, source: gfxState.qualitySource });
        applyResolution(true);
      }
      break;
    case 'keep':
    case 'upKeep':
      break;
  }
  syncPacing();
  // 터치 기기 · 자동: 효과를 확인한 하향(과 확인을 통과한 올림)은 다음 접속에도 그 단계로 시작한다 (같은 모드 · 같은 기기 자동 단계 ·
  // 같은 시작 목표 FPS일 때만)
  const remember = perfToRemember(a, touch, gfxState.qualitySource, autoQuality(qualityEnv()), matchStartHz);
  if (remember && rememberPerf(remember.mode, remember.rec)) gfxState.features.perfSaved = remember.rec.tier;
  syncAutoStatus();
};

// 효과음: 첫 클릭 · 키 입력 · 탭에서 오디오를 연다 (브라우저 자동 재생 규칙, 터치는 손을 뗄 때)
sfx.attachUnlock(document);

// 세로 안내(index.html 정적 마크업)의 "전체 화면" 버튼: 터치 모드이고 브라우저 안일 때만. 누르면 전체 화면 + 가로 고정
const rotateFs = document.getElementById('rotate-fullscreen');
if (rotateFs && canOfferFullscreen()) {
  rotateFs.hidden = false;
  rotateFs.addEventListener('click', enterFullscreen);
}

/** 판 중(판 시작 ~ 로비로 돌아감)에는 문서 전체에서 길게 누르기 메뉴를 막는다 (M11) */
let inMatch = false;
document.addEventListener('contextmenu', (e) => {
  if (!inMatch) return;
  // 로비(판 중에는 숨겨져 있다 — 보이면 판이 끝났거나 방이 사라진 것) · 입력칸은 막지 않는다
  const t = e.target;
  if (t instanceof Element && t.closest('.lobby, input, textarea')) return;
  e.preventDefault();
});
app.subscribe((e) => {
  if (e.kind === 'match') inMatch = true;
  else if (e.kind === 'lobby' && e.lobby.phase === 'lobby') inMatch = false;
  // 판 중에만 제한 설정대로 그린다. 결과 · 로비는 30fps
  if (e.kind === 'match') pacer.setIdle(false);
  else if (e.kind === 'result' || (e.kind === 'lobby' && e.lobby.phase === 'lobby')) pacer.setIdle(true);
});

/**
 * 판 그림(정적 맵 · 발광 · 캐릭터 그림)을 로비 대기 중에 미리 굽는다. 판 시작 때 굽으면 배율 2에서 50~80ms 끊긴다.
 * 같은 품질 · 배율이면 캐시를 쓰므로 여러 번 불러도 싸다. 판 중에는 굽지 않는다(품질이 바뀌면 판 장면이 직접 다시 굽는다)
 */
let prebakeTimer: number | null = null;
function schedulePrebake(): void {
  if (prebakeTimer !== null) return;
  const run = (): void => {
    prebakeTimer = null;
    if (!game.isBooted || game.scene.isActive('game')) return;
    // 터치: 판 배치(논리 크기 → 배율 · HUD 서명)로 굽는다. 아니면 첫 판 시작 때 맵 · 캐릭터 · HUD를 모두 다시 굽는다
    if (device.touch) applyMatchLayout();
    // 따라가는 카메라: 내가 고른 역할의 시작 자리 둘레 맵 조각까지 미리 굽는다 (모르면 감옥 = 생존자 시작)
    const mine = app.lobby?.players.find((p) => p.id === app.you)?.role ?? null;
    prebakeFogArt(gfxState.renderer, mine === 'monster' ? MONSTER_SPAWN : PRISON_CENTER);
    // welcome 전(첫 화면 · 봇과 연습 고르기)에는 빌드에 넣은 수치의 반지름으로 굽는다: 연습은 고르자마자 판이 시작돼
    // 로비 대기가 없다. 온라인 서버 수치가 다르면 로비에서 다시 굽는다
    const b = app.balance ?? PRACTICE_BALANCE;
    prebakeAtlas(game.scene.getScene('idle'), b.survivor.radius, b.monster.radius);
    // HUD 아틀라스도 (배율 2 Canvas에서 약 28ms, 같은 배율이면 아무것도 하지 않는다)
    prebakeHud(game.textures);
  };
  prebakeTimer = window.setTimeout(() => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1000 });
    else run();
  }, 50);
}
onGfxChange(schedulePrebake);
// 캐릭터 스타일을 바꾸면 그 스타일 그림을 로비에서 미리 굽는다 (판 중이면 판 장면이 다음 프레임에 굽는다)
onCharStyleChange(schedulePrebake);
// 부팅 직후(첫 화면 · 봇과 연습 고르기)에도 한 번 굽는다: Phaser가 생성자 안에서 바로 부팅하면 부팅 때의 그래픽 변경 알림이
// 위 구독보다 먼저 지나간다. 연습은 고르자마자 판이 시작돼 로비 대기가 없다 (새 캐릭터 아틀라스는 약 90ms)
schedulePrebake();
// 로비에서 역할을 바꾸면 그 역할 시작 자리 둘레 맵 조각을 미리 굽는다 (괴물 시작 자리와 감옥은 멀다)
let prebakeRole: string | null = null;
app.subscribe((e) => {
  if (e.kind !== 'lobby' || e.lobby.phase !== 'lobby') return;
  const role = e.lobby.players.find((p) => p.id === app.you)?.role ?? null;
  if (role === prebakeRole) return;
  prebakeRole = role;
  schedulePrebake();
});

// UI 폰트를 부팅 때부터 받는다. Phaser 글자는 만들 때의 글꼴로 굳으므로, 다 받으면 이미 있는 글자를 다시 그린다
const relayoutScenes = (): void => {
  if (!game.isBooted) return;
  for (const scene of game.scene.getScenes(true)) relayoutAll(scene);
};
void loadUiFonts().then((ok) => {
  if (ok) relayoutScenes();
});
// 시간 제한(3초)을 넘겨 늦게 받았으면 그때 다시 그린다 (그 사이 판이 대체 글꼴로 시작했을 수 있다)
onUiFontsLate(relayoutScenes);

/** 판 시작 전 크기 대기를 멈춘다 (로비 복귀 · 결과 · 새 판: 그 판 장면은 시작하지 않는다) */
let stopSettle = (): void => undefined;

/**
 * 터치 모드에서 판을 시작하기 전에 화면 크기가 자리 잡기를 기다린다 (가로 고정 · 전체 화면 전환, 세로로 열었다 돌린 경우).
 * 세로 안내가 덮고 있으면 가로가 될 때까지 기다린다 (render/settle.ts). PC는 기다리지 않는다
 */
function settleViewport(): Promise<void> {
  stopSettle();
  if (!device.touch) return Promise.resolve();
  return new Promise((resolve) => {
    stopSettle = settleSize(
      {
        size: () => gameRoot.getBoundingClientRect(),
        portrait: () => device.portrait,
        onTurn: onDeviceChange,
        now: () => performance.now(),
        later: (fn, ms) => {
          const t = window.setTimeout(fn, ms);
          return () => window.clearTimeout(t);
        },
      },
      resolve,
    );
  });
}

/**
 * 판 배치를 정하고(PC는 언제나 1920×1080) 논리 크기가 바뀌었으면 백버퍼 · 카메라를 다시 맞춘다.
 * 판 장면을 만들기 직전과 터치 로비의 미리 굽기 앞에서만 부른다(판 중 크기 변화는 논리 크기를 두고 zoom만 다시 맞춘다)
 */
function applyMatchLayout(force = false): void {
  const r = gameRoot.getBoundingClientRect();
  const before = layout();
  const next = configureLayout(r.width, r.height, device.touch);
  gfxState.layout = next.kind;
  gfxState.viewW = next.viewW;
  gfxState.viewH = next.viewH;
  // 논리 크기가 그대로여도 지금 크기로 맞춘다: 디바운스를 기다리는 크기 변화(회전 · 전체 화면)가 있으면 판 장면이 낡은 배율로
  // 굽고 곧바로 다시 굽는다. 바뀐 것이 없으면 캔버스 자리만 다시 놓는다
  if (resizeTimer !== null) window.clearTimeout(resizeTimer);
  resizeTimer = null;
  applyResolution(force || next.viewW !== before.viewW || next.viewH !== before.viewH);
}

/** 판 장면 시작 요청 번호 (폰트를 기다리는 동안 로비로 돌아가면 시작하지 않는다) */
let sceneRequest = 0;
/** 이번 판 전에 로비(대기)를 거쳤는가. 아니면 진행 중인 판에 다시 들어온 것이다 */
let fromLobby = false;
app.subscribe((e) => {
  if (e.kind === 'match') {
    const req = ++sceneRequest;
    // 로비에서 시작한 판은 폰트를 받은 뒤(보통 로비에서 이미 끝남, 최대 loadUiFonts 시간 제한) 판 장면을 만든다.
    // 진행 중인 판에 다시 들어왔으면 기다리지 않는다(판은 계속 흐른다). 늦게 받은 폰트는 onUiFontsLate가 다시 그린다
    const fonts = fromLobby ? loadUiFonts() : Promise.resolve(uiFontsReady());
    fromLobby = false;
    void Promise.all([fonts, settleViewport()]).then(([ok]) => {
      if (req !== sceneRequest) return;
      // 첫 받기가 시간 초과로 끝난 뒤 늦게 받았으면 loadUiFonts()는 계속 false다. 지금 준비됐는지로 기록한다
      fontState.atSceneStart = ok || uiFontsReady();
      game.scene.stop('game');
      // 연습 · 온라인 판 사이를 오가면 그 모드의 측정 기억으로 시작 품질을 다시 정한다 (바뀌면 백버퍼도 다시 맞춘다).
      // 지난 판에서 여유를 확인한 품질 올리기는 여기서(판 장면을 만들기 전) 한다
      const mode: PerfMode = app.practicing ? 'practice' : 'online';
      let changed = enterPerfMode(mode);
      matchStartHz = startTargetHz();
      const up = sessionAutoDowngrade.takePendingUpgrade(mode, gfxState.quality);
      if (up) {
        qualityHooks.auto?.(up);
        changed = true;
      }
      applyMatchLayout(changed);
      game.scene.start('game', { app });
    });
  } else if (e.kind === 'result') stopSettle();
  else if (e.kind === 'lobby' && e.lobby.phase === 'lobby') {
    stopSettle();
    sceneRequest++;
    fromLobby = true;
    if (game.scene.isActive('game')) game.scene.stop('game');
    schedulePrebake();
  }
});

if (params.debug !== 'off' || import.meta.env.DEV) installDebug(app, params.debug === 'overlay');
app.start();

// 잠든 서버(무료 호스팅)가 깨어나는 동안 보여 줄 화면을 미리 받아 둔다 (client/public/sw.js · wake.html).
// 서비스 워커는 HTTPS(또는 localhost)에서만 동작한다. 개발 서버(Vite)에서는 쓰지 않는다
function registerWakeWorker(): void {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // 등록에 실패해도 게임은 그대로 된다 (깨우는 동안 호스팅 서비스의 기본 화면이 보일 뿐)
  });
}
if ('serviceWorker' in navigator && window.isSecureContext && !import.meta.env.DEV) {
  if (document.readyState === 'complete') registerWakeWorker();
  else window.addEventListener('load', registerWakeWorker, { once: true });
}
