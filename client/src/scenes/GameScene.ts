// 판 화면: 1/30초 고정 간격 입력 → 예측 → 서버 전송, 그리고 렌더링 · HUD · 배너
import Phaser from 'phaser';
import type { DrawnEntity, FxTarget, GameEvent, InfoItem, InputFrame, Role } from '@decoy/shared';
import type { App } from '../app';
import { sfx } from '../audio';
import { STORY_TEXT, UI_TEXT, formatText } from '../data/storyText';
import { qualityHooks, sessionAutoDowngrade } from '../gfx/quality';
import { getFpsOverride, gfxState, probeSlot } from '../gfx/state';
import { InputSampler } from '../input';
import { applyDashStart, applyWindupLock, predictMonsterPress, type LocalWindup } from '../localActions';
import { COLOR } from '../render/colors';
import { ScreenEffects, collectFxTargets } from '../render/effects';
import { WorldRenderer } from '../render/worldRenderer';
import { Banners } from '../ui/banners';
import { Hud } from '../ui/hud';
import { VIEW_H, VIEW_W, fitCamera, screenToTile } from '../ui/layout';
import { Minimap } from '../ui/minimap';
import { Scoreboard, TutorialOverlay } from '../ui/overlays';
import { drawProbeText, makeText } from '../ui/text';

/** 안개 (M3부터) */
export const FOG_ENABLED = true;
/** 입력이 밀렸을 때 한 번에 따라잡는 최대 스텝 */
const MAX_CATCHUP_STEPS = 4;
/** 첫 판 조작 안내 표시 시간 (VISUAL_SPEC 6장) */
const TUTORIAL_SECONDS = 5;
const EXIT_NAMES = { N: '북', S: '남' } as const;
/**
 * 이보다 오래된 스냅샷의 일회성 연출(소리 · 플래시 · 알림 배너 · 핑)은 건너뛴다.
 * 백그라운드 탭이 멈췄다 돌아오면 밀린 스냅샷이 한꺼번에 처리되는데, 지난 일을 뒤늦게 울리지 않게.
 * 거점 메모(비밀번호)는 오래돼도 보여 준다
 */
const STALE_EVENT_MS = 2000;

export class GameScene extends Phaser.Scene {
  private app!: App;
  private sampler = new InputSampler();
  private seq = 0;
  private acc = 0;
  private lastInputAt = 0;
  /** 마지막으로 입력 틱을 처리한 시각 (틱 사이 보간 비율) */
  private lastStepAt = 0;
  private inputTimer: number | null = null;
  private world!: WorldRenderer;
  private hud!: Hud;
  private minimap!: Minimap;
  private banners!: Banners;
  private tutorial!: TutorialOverlay;
  private scoreboard!: Scoreboard;
  /** 발각: 화면 가장자리 빨간 테두리 */
  private spottedEdge!: Phaser.GameObjects.Graphics;
  /** 괴물: 감옥 캠핑 · 거점 지키기 경고 (하단 중앙 위) */
  private warnText!: Phaser.GameObjects.Text;
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
      (o) => world.layerOf(o) ?? (o === this.spottedEdge || this.screenFx?.owns(o) ? 'screen' : null),
    );
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
    this.hud = new Hud(this, info, balance);
    this.minimap = new Minimap(this);
    this.banners = new Banners(this);
    this.tutorial = new TutorialOverlay(this, info);
    this.scoreboard = new Scoreboard(this, info, balance);
    this.screenFx = new ScreenEffects(this, this.world.stunVeil);
    this.localWindup = null;
    this.spottedEdge = this.add.graphics().setDepth(50);
    this.spottedEdge.lineStyle(14, COLOR.monster, 0.75);
    this.spottedEdge.strokeRect(7, 7, VIEW_W - 14, VIEW_H - 14);
    this.spottedEdge.setVisible(false);
    this.warnText = makeText(this, VIEW_W / 2, VIEW_H - 112, '', {
      fontFamily: 'sans-serif',
      fontSize: '24px',
      fontStyle: 'bold',
      color: '#0B1622',
      backgroundColor: '#F59E0B',
      padding: { x: 16, y: 6 },
    })
      .setOrigin(0.5)
      .setDepth(51)
      .setVisible(false);
    // 선명도 검사 글자는 판 동안 이 장면(HUD와 같은 곳)에 그린다. 장면이 끝나면 대기 장면 것으로 돌려놓는다
    const prevProbe = probeSlot.draw;
    probeSlot.draw = (text, x, y, px) => drawProbeText(this, text, x, y, px);
    sessionAutoDowngrade.beginMatch(performance.now());
    this.watchingFps = true;

    // 판 시작 문구 (괴물 대기 5초 동안)
    const intro = info.role === 'monster' ? 'INTRO_MONSTER' : 'INTRO_WALL';
    this.banners.pushNote(formatText(intro), STORY_TEXT[intro].seconds ?? 3);
    if (info.firstMatch) this.tutorial.show(performance.now(), TUTORIAL_SECONDS);

    const host = this.game.canvas.parentElement ?? document.body;
    this.sampler.attach(host);
    this.roarPings = [];
    this.unsubscribe = app.subscribe((e) => {
      if (e.kind !== 'snapshot') return;
      if (this.seq < e.snap.ack) this.seq = e.snap.ack;
      const stale = app.net.synced && app.net.serverNow() - e.snap.st > STALE_EVENT_MS;
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
          const color =
            ev.id === 'ALERT_ROAR'
              ? COLOR.warn
              : ev.id === 'ALERT_CAPTURE_START'
                ? COLOR.warn
                : COLOR.pointRing;
          this.banners.push(text, sec, color, now);
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
    if (this.world.baseRefreshed) this.minimap.refreshBase(this.world.baseCanvas);
    const roster = app.match.roster;
    const roleOf = (id: string): Role | null => roster.find((r) => r.id === id)?.role ?? null;
    this.minimap.update(this.drawn, snap.you.role, roleOf);
    this.hud.update(snap, now);

    // 경고 · 배너
    const warn = mon
      ? mon.camp === 2
        ? UI_TEXT.campSlow
        : mon.camp === 1
          ? UI_TEXT.campWarn
          : mon.blockWarn
            ? UI_TEXT.pointWarn
            : ''
      : '';
    if (this.warnText.text !== warn) this.warnText.setText(warn);
    this.warnText.setVisible(warn !== '');
    const spotted = snap.you.surv?.spotted === true;
    this.spottedEdge.setVisible(spotted);
    const lastChance = snap.world.grace !== null && snap.you.surv?.status === 'free';
    const paused = snap.world.paused;
    const persistent =
      paused !== null
        ? `${UI_TEXT.monsterReconnect} ${Math.ceil(paused)}초`
        : spotted
          ? UI_TEXT.spotted
          : lastChance
            ? formatText('ALERT_LAST_30')
            : '';
    this.banners.update(persistent, spotted && paused === null ? 0xb91c1c : COLOR.warn, now);
    const anyKey = this.sampler.anyKeyPressed;
    this.sampler.anyKeyPressed = false;
    this.tutorial.update(now, anyKey);
    this.scoreboard.update(this.sampler.tabHeld, snap);
  }
}
