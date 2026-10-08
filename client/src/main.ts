// DECOY 클라이언트 진입점
import Phaser from 'phaser';
import { App, readParams } from './app';
import { sfx } from './audio';
import { installDebug } from './debug';
import type { QualityPreset, QualityTier, RendererKind } from './gfx/presets';
import {
  detectQuality,
  isSoftwareGl,
  isTouchDevice,
  loadSavedQuality,
  qualityHooks,
  savedForSession,
  sessionAutoDowngrade,
  type QualityChoice,
  type QualitySource,
} from './gfx/quality';
import { currentPreset, gfxState, notifyGfxChange, probeSlot } from './gfx/state';
import { computeRenderSize, type RenderSize } from './render/resolution';
import { GameScene } from './scenes/GameScene';
import { RENDER_SCALE, VIEW_H, VIEW_W, fitCamera, setRenderScale } from './ui/layout';
import { drawProbeText, retextAll } from './ui/text';

/** 창 크기 · DPR이 바뀐 뒤 백버퍼를 다시 만들 때까지 기다리는 시간 (끌어서 바꾸는 동안 매번 만들지 않게) */
const RESIZE_DEBOUNCE_MS = 150;

const params = readParams(window.location.search);
const uiRoot = document.getElementById('ui-root') ?? document.body;
const gameRoot = document.getElementById('game-root') ?? document.body;
const app = new App(params, uiRoot);

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

function decideQuality(): { tier: QualityTier; source: QualitySource } {
  return detectQuality({
    url: urlQuality,
    saved: savedForSession(sessionChoice, loadSavedQuality()),
    renderer: gfxState.renderer,
    softwareGl,
    touch,
    cores,
    memory,
  });
}

/** 품질 단계가 켜는 장식 기능 (디버그 훅 · E2E용. 실제로 켠 결과는 각 렌더 모듈이 덧쓴다) */
function presetFeatures(p: QualityPreset): Record<string, boolean | number | string> {
  return {
    dprCap: p.dprCap,
    maxPixels: p.maxPixels,
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

/** 판 중 자동 하향 상태 (on · checking · off) 표시 */
function syncAutoStatus(): void {
  gfxState.features.autoDowngrade = sessionAutoDowngrade.status;
}

gfxState.touch = touch;
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
  fps: { target: 60 },
  // 카메라 배경색이 매 프레임 화면 전체를 칠하므로 따로 지우지 않는다. 정수 좌표로 그려 비트맵 복사를 싸게
  render: { clearBeforeRender: false },
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
  // 사용자가 정한 단계: 확인 중이던 자동 하향을 되돌릴 대상이 사라진다
  sessionAutoDowngrade.cancelPending();
  setQuality(decideQuality());
  applyResolution(true);
};
// 판 중 자동 조정: 한 단계 내리거나, 내렸는데 FPS가 오르지 않았으면(화면 갱신 상한 등) 원래 단계로 되돌린다.
// 사용자가 고른 것보다 올리는 일은 없다. downgrades는 실제로 내린 횟수(되돌려도 그대로)
qualityHooks.auto = (a) => {
  if (a.kind === 'downgrade') {
    if (gfxState.quality === a.from) {
      gfxState.measuredFps = a.fpsBefore;
      gfxState.downgrades += 1;
      setQuality({ tier: a.to, source: gfxState.qualitySource });
      applyResolution(true);
    } else {
      // 그사이 단계가 바뀌었다(이론상): 내리지 않았으니 확인할 것도 없다
      sessionAutoDowngrade.cancelPending();
    }
  } else if (a.kind === 'revert' && gfxState.quality === a.from) {
    gfxState.measuredFps = a.fpsAfter;
    setQuality({ tier: a.to, source: gfxState.qualitySource });
    applyResolution(true);
  }
  syncAutoStatus();
};

// 효과음: 첫 클릭 · 키 입력에서 오디오를 연다 (브라우저 자동 재생 규칙)
sfx.attachUnlock(document);

app.subscribe((e) => {
  if (e.kind === 'match') {
    game.scene.stop('game');
    game.scene.start('game', { app });
  } else if (e.kind === 'lobby' && e.lobby.phase === 'lobby') {
    if (game.scene.isActive('game')) game.scene.stop('game');
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
