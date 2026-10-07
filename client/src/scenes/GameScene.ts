// 판 화면: 1/30초 고정 간격 입력 → 예측 → 서버 전송, 그리고 렌더링 · HUD · 배너
import Phaser from 'phaser';
import type { DrawnEntity, GameEvent, InputFrame, Role } from '@decoy/shared';
import type { App } from '../app';
import { STORY_TEXT, UI_TEXT, formatText } from '../data/storyText';
import { InputSampler } from '../input';
import { COLOR } from '../render/colors';
import { WorldRenderer } from '../render/worldRenderer';
import { Banners } from '../ui/banners';
import { Hud } from '../ui/hud';
import { VIEW_H, VIEW_W, fitCamera, screenToTile } from '../ui/layout';
import { Minimap } from '../ui/minimap';
import { Scoreboard, TutorialOverlay } from '../ui/overlays';

/** 안개 (M3부터) */
export const FOG_ENABLED = true;
/** 입력이 밀렸을 때 한 번에 따라잡는 최대 스텝 */
const MAX_CATCHUP_STEPS = 4;
/** 첫 판 조작 안내 표시 시간 (VISUAL_SPEC 6장) */
const TUTORIAL_SECONDS = 5;
const EXIT_NAMES = { N: '북', S: '남' } as const;

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
    this.spottedEdge = this.add.graphics().setDepth(50);
    this.spottedEdge.lineStyle(14, COLOR.monster, 0.75);
    this.spottedEdge.strokeRect(7, 7, VIEW_W - 14, VIEW_H - 14);
    this.spottedEdge.setVisible(false);
    this.warnText = this.add
      .text(VIEW_W / 2, VIEW_H - 112, '', {
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
      for (const ev of e.snap.events) this.onEvent(ev);
      const now = performance.now();
      this.roarPings = this.roarPings.filter((p) => p.until > now);
    });
    // 입력 샘플링은 렌더 프레임과 따로 타이머로 돈다 (그리기가 느려도 조작 주기는 1/30초 유지)
    this.lastInputAt = performance.now();
    this.inputTimer = window.setInterval(() => this.inputTick(), 4);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.inputTimer !== null) window.clearInterval(this.inputTimer);
      this.inputTimer = null;
      this.sampler.detach();
      this.unsubscribe?.();
    });
  }

  /** 서버 이벤트 → 배너 · 메모 · 효과 */
  private onEvent(ev: GameEvent): void {
    const now = performance.now();
    switch (ev.k) {
      case 'text': {
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
    const dtMs = app.dt * 1000;
    this.acc = Math.min(this.acc + deltaMs, dtMs * MAX_CATCHUP_STEPS);
    const frames: InputFrame[] = [];
    while (this.acc >= dtMs) {
      this.acc -= dtMs;
      this.seq += 1;
      const frame = this.sampler.sample(this.seq, this.aimTarget());
      app.predictor.applyLocal(frame, env);
      this.lastStepAt = performance.now();
      frames.push(frame);
      this.lastFrame = frame;
    }
    if (frames.length > 0) app.net.send({ t: 'input', frames });
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

  override update(_time: number, delta: number): void {
    this.renderFrame(delta);
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
      },
      delta,
    );
    this.drawn = this.world.drawn;
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
    const persistent = spotted ? UI_TEXT.spotted : lastChance ? formatText('ALERT_LAST_30') : '';
    this.banners.update(persistent, spotted ? 0xb91c1c : COLOR.warn, now);
    const anyKey = this.sampler.anyKeyPressed;
    this.sampler.anyKeyPressed = false;
    this.tutorial.update(now, anyKey);
    this.scoreboard.update(this.sampler.tabHeld, snap);
  }
}
