// 판 화면: 1/30초 고정 간격 입력 → 예측 → 서버 전송, 그리고 렌더링 · HUD · 배너
import Phaser from 'phaser';
import type { DrawnEntity, FxTarget, GameEvent, InfoItem, InputFrame, Role } from '@decoy/shared';
import type { App } from '../app';
import { sfx } from '../audio';
import { STORY_TEXT, UI_TEXT, formatText } from '../data/storyText';
import { qualityHooks, sessionAutoDowngrade } from '../gfx/quality';
import { getFpsOverride, gfxNow, gfxState, probeSlot } from '../gfx/state';
import { InputSampler } from '../input';
import { applyDashStart, applyWindupLock, predictMonsterPress, type LocalWindup } from '../localActions';
import { COLOR } from '../render/colors';
import { ScreenEffects, collectFxTargets } from '../render/effects';
import { WorldRenderer } from '../render/worldRenderer';
import type { IconId } from '../art/icons';
import { Banners, type BannerLine } from '../ui/banners';
import { Hud } from '../ui/hud';
import type { Tone } from '../ui/hudArt';
import { HudKit, type Slice } from '../ui/hudKit';
import { VIEW_H, VIEW_W, fitCamera, screenToTile } from '../ui/layout';
import { Minimap } from '../ui/minimap';
import { Scoreboard, TutorialOverlay } from '../ui/overlays';
import { drawProbeText } from '../ui/text';
import { staleEventLimitMs, trackFrameMs } from './staleEvents';

/** 안개 (M3부터) */
export const FOG_ENABLED = true;
/** 입력이 밀렸을 때 한 번에 따라잡는 최대 스텝 */
const MAX_CATCHUP_STEPS = 4;
/** 첫 판 조작 안내 표시 시간 (VISUAL_SPEC 8.3) */
const TUTORIAL_SECONDS = 5;
const EXIT_NAMES = { N: '북', S: '남' } as const;
/** 알림 배너의 톤 · 아이콘 (색만으로 구분하지 않기: 아이콘이 같이 바뀐다) */
const ALERT_LOOK: Partial<Record<string, { tone: Tone; icon: IconId }>> = {
  ALERT_CAPTURE_START: { tone: 'warn', icon: 'point' },
  ALERT_ROAR: { tone: 'warn', icon: 'roar' },
  ALERT_CAPTURE_DONE: { tone: 'info', icon: 'check' },
  ALERT_EXITS_ON: { tone: 'info', icon: 'exit' },
  ALERT_EXIT_OPEN: { tone: 'info', icon: 'exit' },
  ALERT_RESCUED: { tone: 'info', icon: 'rescue' },
};
/** 발각 테두리 맥동 (Hz) */
const SPOTTED_PULSE_HZ = 1.2;

export class GameScene extends Phaser.Scene {
  private app!: App;
  private sampler = new InputSampler();
  private seq = 0;
  /** 최근 프레임 간격 (ms, 느려지면 바로 · 빨라지면 천천히): 느린 기기에서 오래된 이벤트 한도를 늘린다 */
  private frameMs = 0;
  private acc = 0;
  private lastInputAt = 0;
  /** 마지막으로 입력 틱을 처리한 시각 (틱 사이 보간 비율) */
  private lastStepAt = 0;
  private inputTimer: number | null = null;
  private world!: WorldRenderer;
  /** HUD 아틀라스와 부품 (배율이 바뀔 때만 다시 굽는다) */
  private kit!: HudKit;
  private hud!: Hud;
  private minimap!: Minimap;
  private banners!: Banners;
  /** 첫 판에만 만든다 (두 번째 판부터는 보이지 않으므로 글자 · 이미지를 만들지 않는다) */
  private tutorial: TutorialOverlay | null = null;
  private scoreboard!: Scoreboard;
  /** 발각: 화면 가장자리 안쪽 빨간 빛 (얇은 테두리 + 안으로 옅어지는 띠, HUD 아래) */
  private spottedEdge!: Slice;
  /** 괴물 화면: 내 부채꼴 모양 보간 (스냅샷 사이에도 0.4초 전환이 부드럽게) */
  private myBlend = 0;
  drawn: DrawnEntity[] = [];
  /** 마지막으로 보낸 입력 (디버그) */
  lastFrame: InputFrame | null = null;
  private unsubscribe: (() => void) | null = null;
  /** 포효 핑 (괴물 화면) */
  private roarPings: { x: number; y: number; until: number; start: number }[] = [];
  /** 마지막으로 그린 내 위치 (예측) */
  localPos = { x: 0, y: 0, face: 0 };
  /** 피격 플래시 · 수감 페이드 · 기절 채도 감소 */
  private screenFx!: ScreenEffects;
  /** 괴물: 서버 확인 전에 먼저 보여 주는 공격 준비 */
  private localWindup: LocalWindup | null = null;
  /** 판 중 FPS 감시를 하는가 (세션 상태는 sessionAutoDowngrade: 느리면 한 단계 내리고 효과를 확인한다) */
  private watchingFps = false;

  constructor() {
    super('game');
  }

  init(data: { app: App }): void {
    this.app = data.app;
    this.seq = 0;
    this.acc = 0;
  }

  get minimapDrawn(): DrawnEntity[] {
    return this.minimap?.drawn ?? [];
  }

  get bannerTexts(): string[] {
    return this.banners?.visible ?? [];
  }

  /** 디버그 · 테스트: 이번 프레임의 정보 레이어 (품질과 상관없이 같아야 함) */
  get infoLayer(): InfoItem[] {
    return this.world?.info ?? [];
  }

  /**
   * 디버그 · 테스트: 후처리가 걸린 레이어. 장면 표시 목록 · 카메라에서 직접 모은다(자기 신고 아님):
   * 월드 렌더러가 아는 객체는 그 레이어, 화면 효과 · 발각 테두리는 screen, 나머지는 hud
   */
  get fxTargets(): FxTarget[] {
    const world = this.world;
    if (!world) return [];
    return collectFxTargets(
      this,
      (o) => world.layerOf(o) ?? (this.spottedEdge?.owns(o) || this.screenFx?.owns(o) ? 'screen' : null),
    );
  }

  /**
   * 디버그 · 테스트: HUD 상태 (M10c). 다시 굽기 횟수(`bakes`) · 거점 게이지 상태 · 점수판 · 조작 안내 표시 등.
   * 키와 값은 HUD가 정한다(VISUAL_SPEC 8장)
   */
  get hudDebug(): Record<string, number | boolean | string> {
    if (!this.hud) return {};
    const hudGraphics = this.children.list.filter(
      (o) => o instanceof Phaser.GameObjects.Graphics && o.depth >= 38 && !this.screenFx.owns(o),
    ).length;
    // 늘 떠 있는 HUD(미니맵 39~41 · HUD 40~42)에 실제로 그려진 그림 · 글자의 자리 (논리 px). 부품이 스스로 신고한
    // 배치 값이 아니라 표시 목록에서 직접 잰다 (E2E: 맵 사각형과 겹치지 않음)
    const r1 = (v: number): number => Math.round(v * 10) / 10;
    const drawn: [number, number, number, number][] = [];
    for (const o of this.children.list) {
      if (!(o instanceof Phaser.GameObjects.Image || o instanceof Phaser.GameObjects.Text)) continue;
      if (!o.visible || o.alpha === 0 || o.depth < 39 || o.depth >= 43 || this.screenFx.owns(o)) continue;
      const b = o.getBounds();
      if (b.width > 0 && b.height > 0) drawn.push([r1(b.x), r1(b.y), r1(b.width), r1(b.height)]);
    }
    return {
      bakes: this.kit.bakes,
      ...this.hud.debug(),
      scoreboard: this.scoreboard.visible,
      scoreText: this.scoreboard.text,
      help: this.tutorial?.visible ?? false,
      spotted: this.spottedEdge.shown,
      hudGraphics,
      panels: JSON.stringify(drawn),
      missingFrames: [...this.kit.missing].sort().join(','),
    };
  }

  /** 디버그 · 테스트: 지금 보이는 연출 */
  get effects(): Record<string, number | boolean> {
    if (!this.screenFx || !this.world) return {};
    return { ...this.screenFx.state, ...this.world.fx };
  }

  create(): void {
    const app = this.app;
    const info = app.match;
    const balance = app.balance;
    if (!info || !balance) return;
    this.cameras.main.setBackgroundColor(COLOR.background);
    fitCamera(this.cameras.main);
    this.world = new WorldRenderer(this, FOG_ENABLED);
    this.myBlend = 0;
    this.kit = new HudKit(this);
    this.hud = new Hud(this.kit, info, balance);
    this.minimap = new Minimap(this, this.kit);
    this.banners = new Banners(this.kit);
    this.tutorial = info.firstMatch ? new TutorialOverlay(this.kit, info) : null;
    this.scoreboard = new Scoreboard(this.kit, info, balance);
    this.screenFx = new ScreenEffects(this, this.world.stunVeil);
    this.localWindup = null;
    this.spottedEdge = this.kit.slice(38);
    this.spottedEdge.hollow = true;
    this.spottedEdge.set('spot', 0, 0, VIEW_W, VIEW_H).show(false);
    // 선명도 검사 글자는 판 동안 이 장면(HUD와 같은 곳)에 그린다. 장면이 끝나면 대기 장면 것으로 돌려놓는다
    const prevProbe = probeSlot.draw;
    probeSlot.draw = (text, x, y, px) => drawProbeText(this, text, x, y, px);
    sessionAutoDowngrade.beginMatch(performance.now());
    this.watchingFps = true;

    // 판 시작 문구 (괴물 대기 5초 동안)
    const intro = info.role === 'monster' ? 'INTRO_MONSTER' : 'INTRO_WALL';
    this.banners.pushNote(formatText(intro), STORY_TEXT[intro].seconds ?? 3);
    this.tutorial?.show(performance.now(), TUTORIAL_SECONDS);

    const host = this.game.canvas.parentElement ?? document.body;
    this.sampler.attach(host);
    this.roarPings = [];
    this.unsubscribe = app.subscribe((e) => {
      if (e.kind !== 'snapshot') return;
      if (this.seq < e.snap.ack) this.seq = e.snap.ack;
      // 오래된 스냅샷의 일회성 연출(소리 · 플래시 · 알림 배너 · 핑)은 건너뛴다(staleEvents.ts). 거점 메모(비밀번호)는 오래돼도 보여 준다
      const stale = app.net.synced && app.net.serverNow() - e.snap.st > staleEventLimitMs(this.frameMs);
      for (const ev of e.snap.events) {
        const note = ev.k === 'text' && (ev.id === 'NOTE_FIRST' || ev.id === 'NOTE_SECOND');
        if (!stale || note) this.onEvent(ev);
      }
      const now = performance.now();
      this.roarPings = this.roarPings.filter((p) => p.until > now);
    });
    // 입력 샘플링은 렌더 프레임과 따로 타이머로 돈다 (그리기가 느려도 조작 주기는 1/30초 유지)
    this.lastInputAt = performance.now();
    this.inputTimer = window.setInterval(() => this.inputTick(), 4);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      probeSlot.draw = prevProbe;
      this.watchingFps = false;
      sessionAutoDowngrade.endMatch();
      if (this.inputTimer !== null) window.clearInterval(this.inputTimer);
      this.inputTimer = null;
      this.sampler.detach();
      this.unsubscribe?.();
    });
  }

  /** 서버 이벤트 → 배너 · 메모 · 효과 · 소리 */
  private onEvent(ev: GameEvent): void {
    const now = performance.now();
    const isMonster = this.app.match?.role === 'monster';
    // 월드 연출(불꽃 · 충격파 · 베기 호 등)은 받은 이벤트 좌표에서만 생긴다 (상대 잔여 효과 규칙)
    this.world.onEvent(ev, now);
    switch (ev.k) {
      case 'attackStart': {
        // 괴물 본인은 누른 순간 이미 들었다 (즉시 피드백). 예측하지 못한 경우만 여기서
        const lw = this.localWindup;
        const predicted = isMonster && lw !== null && now - lw.until < 1000;
        if (!predicted) sfx.play('windup', isMonster ? 1 : 0.8);
        return;
      }
      case 'attackHit':
        if (isMonster && ev.hits > 0) sfx.play('hit', 0.7);
        return;
      case 'hit':
        if (ev.you) {
          this.screenFx.hit(now);
          sfx.play('hit', 1);
        } else {
          sfx.play('hit', 0.4);
        }
        return;
      case 'imprisoned':
        if (ev.you) this.screenFx.imprison(now);
        return;
      case 'text': {
        if (ev.id === 'ALERT_CAPTURE_START') sfx.play('captureStart');
        else if (ev.id === 'ALERT_CAPTURE_DONE') sfx.play('captureDone');
        else if (ev.id === 'ALERT_EXIT_OPEN') sfx.play('doorOpen');
        else if (ev.id === 'ALERT_ROAR') sfx.play('roar', 0.9);
        if (ev.id === 'ALERT_LAST_30') return; // 지속형 배너로 따로 그린다
        const params = { point: ev.point, exit: ev.exit ? EXIT_NAMES[ev.exit] : undefined, code: ev.code };
        const text = formatText(ev.id, params);
        const sec = STORY_TEXT[ev.id].seconds ?? 2;
        if (ev.id === 'NOTE_FIRST' || ev.id === 'NOTE_SECOND' || ev.id.startsWith('INTRO')) {
          this.banners.pushNote(text, sec);
        } else {
          const look = ALERT_LOOK[ev.id] ?? { tone: 'info', icon: 'point' };
          this.banners.push(text, sec, look.tone, look.icon, now);
        }
        return;
      }
      case 'roarPings': {
        sfx.play('roar');
        const dur = (this.app.balance?.monster.roar.revealDuration ?? 1.5) * 1000;
        for (const p of ev.pts) this.roarPings.push({ x: p.x, y: p.y, start: now, until: now + dur });
        return;
      }
      case 'shoveMiss':
        this.hud.flash(UI_TEXT.outOfRange, 1000, now);
        return;
      default:
        return;
    }
  }

  /** 지금 내 조준 목표 각도 (괴물: 커서 방향) */
  private aimTarget(): number {
    if (this.app.match?.role !== 'monster') return Number.NaN;
    const p = this.input.activePointer;
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    const t = screenToTile(w.x, w.y);
    const me = this.app.predictor?.state;
    if (!me) return Number.NaN;
    if (Math.hypot(t.x - me.x, t.y - me.y) < 0.05) return me.face;
    return Math.atan2(t.y - me.y, t.x - me.x);
  }

  private stepInput(deltaMs: number): void {
    const app = this.app;
    const env = app.moveEnv();
    if (!env || !app.predictor?.state) return;
    // 사망 · 탈출 뒤에는 관전: 입력을 보내지 않는다
    const status = app.lastSnap?.you.surv?.status;
    if (status === 'dead' || status === 'escaped') {
      this.acc = 0;
      return;
    }
    // 괴물 재접속 대기(판 전체 일시정지): 서버가 입력을 처리하지 않으므로 보내지도 예측하지도 않는다
    if ((app.lastSnap?.world.paused ?? null) !== null) {
      this.acc = 0;
      this.sampler.clearPressed();
      return;
    }
    const dtMs = app.dt * 1000;
    this.acc = Math.min(this.acc + deltaMs, dtMs * MAX_CATCHUP_STEPS);
    const frames: InputFrame[] = [];
    while (this.acc >= dtMs) {
      this.acc -= dtMs;
      this.seq += 1;
      const frame = this.sampler.sample(this.seq, this.aimTarget());
      if (frame.pressed !== 0 && app.match?.role === 'monster') this.predictMonster(frame);
      app.predictor.applyLocal(frame, env);
      this.lastStepAt = performance.now();
      frames.push(frame);
      this.lastFrame = frame;
    }
    if (frames.length > 0) app.net.send({ t: 'input', frames });
  }

  /** 괴물: 공격 준비 · 돌진을 서버 확인 전에 먼저 보여 준다 (판정은 서버, 어긋나면 보정) */
  private predictMonster(frame: InputFrame): void {
    const app = this.app;
    const mon = app.lastSnap?.you.mon;
    const st = app.predictor?.state;
    const balance = app.balance;
    if (!mon || !st || !balance || !app.predictor) return;
    const now = performance.now();
    const res = predictMonsterPress({
      pressed: frame.pressed,
      move: st,
      mon,
      balance,
      ageSec: (now - app.lastSnapAt) / 1000 + app.net.rtt / 2000,
      localWindupActive: this.localWindup !== null && now < this.localWindup.until,
    });
    if (res.attack) {
      app.predictor.predictAction(frame.seq, applyWindupLock(balance));
      this.localWindup = { seq: frame.seq, until: now + balance.monster.attack.windup * 1000, dir: st.face };
      sfx.play('windup');
    }
    if (res.dash) app.predictor.predictAction(frame.seq, applyDashStart(balance));
  }

  private inputTick(): void {
    const now = performance.now();
    const delta = now - this.lastInputAt;
    this.lastInputAt = now;
    if (document.hidden) {
      // 백그라운드 탭: 입력을 보내지 않는다 (서버는 입력이 끊기면 제자리에 세운다)
      this.acc = 0;
      return;
    }
    this.stepInput(delta);
  }

  /**
   * 공격 준비 표시: 누른 순간부터 내 시계로 0.4초 (예측). 서버가 그 입력을 처리한 뒤 도착하는 같은 준비(서버 값)는
   * 이미 보여 줬으므로 다시 그리지 않는다. 예측하지 못한 준비(서버가 받아들인 경우)는 서버 값을 그린다
   */
  private windupView(ack: number, now: number): { dir: number | null; hideServer: boolean } {
    const lw = this.localWindup;
    if (!lw) return { dir: null, hideServer: false };
    if (ack < lw.seq) return { dir: now < lw.until ? lw.dir : null, hideServer: false };
    return { dir: null, hideServer: now < lw.until + this.app.net.rtt + 150 };
  }

  override update(_time: number, delta: number): void {
    // Phaser의 delta는 200ms(최소 5fps)를 넘으면 이전 값으로 바꿔 넣으므로 느린 기기의 실제 간격은 rawDelta로 잰다
    this.frameMs = trackFrameMs(this.frameMs, this.game.loop.rawDelta);
    this.renderFrame(delta);
    this.watchFps();
  }

  /**
   * 판 중(결과 전) 보이는 탭에서만 잰다. 느린 상태가 이어지면 품질을 한 단계 내리고(재연결 · 장면 재시작 없음),
   * 같은 판에서 효과를 확인해 효과가 없으면 되돌린다 (gfx/quality.ts AutoDowngrade)
   */
  private watchFps(): void {
    if (!this.watchingFps || document.hidden) return;
    if (!this.app.lastSnap || this.app.result) return;
    const fps = getFpsOverride() ?? this.game.loop.actualFps;
    const action = sessionAutoDowngrade.sample(performance.now(), fps, gfxState.quality);
    gfxState.measuredFps = sessionAutoDowngrade.average;
    if (action) qualityHooks.auto?.(action);
  }

  private renderFrame(delta: number): void {
    const app = this.app;
    const snap = app.lastSnap;
    if (!snap || !app.balance || !app.match) {
      this.drawn = [];
      return;
    }
    const now = performance.now();
    const renderTime = app.renderTime();
    const alpha = (now - this.lastStepAt) / (app.dt * 1000);
    const windup = this.windupView(snap.ack, now);
    const me = app.predictor?.renderPos(delta, alpha) ?? null;
    if (me) this.localPos = me;
    const mon = snap.you.mon;
    if (mon) {
      const target = mon.mode === 'hunt' ? 1 : 0;
      const step = delta / 1000 / Math.max(0.001, app.balance.monster.visionModeSwitchTime);
      this.myBlend =
        this.myBlend < target ? Math.min(target, this.myBlend + step) : Math.max(target, this.myBlend - step);
      if (Math.abs(this.myBlend - mon.blend) > 0.35) this.myBlend = mon.blend;
    }
    this.world.draw(
      {
        balance: app.balance,
        snap,
        role: snap.you.role,
        selfId: snap.you.id,
        me,
        survivors: app.survivorsInterp.sample(renderTime),
        monster:
          snap.you.role === 'monster' ? null : (app.monsterInterp.sample(renderTime).get('monster') ?? null),
        myBlend: this.myBlend,
        nowMs: now,
        roarPings: this.roarPings,
        localWindupDir: windup.dir,
        hideServerWindup: windup.hideServer,
        myStunned: snap.you.role === 'monster' && (app.predictor?.state?.stun ?? 0) > 0,
        myDashing: snap.you.role === 'monster' && (app.predictor?.state?.dash ?? 0) > 0,
      },
      delta,
    );
    this.drawn = this.world.drawn;
    this.screenFx.update(now, snap.you.role === 'monster' && (app.predictor?.state?.stun ?? 0) > 0);
    this.kit.sync();
    if (this.world.baseRefreshed) this.minimap.refreshBase(this.world.baseCanvas);
    const roster = app.match.roster;
    const roleOf = (id: string): Role | null => roster.find((r) => r.id === id)?.role ?? null;
    this.minimap.update(this.drawn, snap.you.role, roleOf);
    this.hud.update(snap, now);

    // 괴물 경고 줄 (감옥 캠핑 · 거점 지키기): 지속 배너 자리에 주황 리본 + 아이콘
    const warn: BannerLine | null = !mon
      ? null
      : mon.camp > 0
        ? { text: mon.camp === 2 ? UI_TEXT.campSlow : UI_TEXT.campWarn, tone: 'warn', icon: 'prison' }
        : mon.blockWarn
          ? { text: UI_TEXT.pointWarn, tone: 'warn', icon: 'point' }
          : null;
    const spotted = snap.you.surv?.spotted === true;
    this.spottedEdge.show(spotted);
    if (spotted)
      this.spottedEdge.setAlpha(0.8 + 0.2 * Math.cos((gfxNow() / 1000) * Math.PI * 2 * SPOTTED_PULSE_HZ));
    const lastChance = snap.world.grace !== null && snap.you.surv?.status === 'free';
    const paused = snap.world.paused;
    const persistent: BannerLine | null =
      paused !== null
        ? { text: `${UI_TEXT.monsterReconnect} ${Math.ceil(paused)}초`, tone: 'warn', icon: 'disconnected' }
        : spotted
          ? { text: UI_TEXT.spotted, tone: 'danger', icon: 'eye' }
          : lastChance
            ? { text: formatText('ALERT_LAST_30'), tone: 'warn', icon: 'exit' }
            : null;
    this.banners.update(persistent, warn, now);
    const anyKey = this.sampler.anyKeyPressed;
    this.sampler.anyKeyPressed = false;
    // Tab 점수판이 열리면 조작 안내를 닫는다 (두 패널이 겹치지 않게)
    const tab = this.sampler.tabHeld;
    this.tutorial?.update(now, anyKey || tab);
    this.scoreboard.update(tab, snap);
  }
}
