// 판 화면: 1/30초 고정 간격 입력 → 예측 → 서버 전송, 그리고 렌더링
import Phaser from 'phaser';
import { type DrawnEntity, type InputFrame } from '@decoy/shared';
import type { App } from '../app';
import { InputSampler } from '../input';
import { COLOR } from '../render/colors';
import { WorldRenderer } from '../render/worldRenderer';
import { screenToTile } from '../ui/layout';

/** M3부터 안개를 켠다 */
export const FOG_ENABLED = false;

/** 입력이 밀렸을 때 한 프레임에 따라잡는 최대 스텝 */
const MAX_CATCHUP_STEPS = 4;

export class GameScene extends Phaser.Scene {
  private app!: App;
  private sampler = new InputSampler();
  private seq = 0;
  private acc = 0;
  private lastInputAt = 0;
  private inputTimer: number | null = null;
  private world!: WorldRenderer;
  private hud!: Phaser.GameObjects.Text;
  /** 괴물 화면: 내 부채꼴 모양 보간 (스냅샷 사이에도 0.4초 전환이 부드럽게) */
  private myBlend = 0;
  drawn: DrawnEntity[] = [];
  /** 마지막으로 보낸 입력 (디버그) */
  lastFrame: InputFrame | null = null;
  private unsubscribe: (() => void) | null = null;
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

  create(): void {
    this.cameras.main.setBackgroundColor(COLOR.background);
    this.world = new WorldRenderer(this, FOG_ENABLED);
    this.myBlend = 0;
    this.hud = this.add.text(24, 18, '', { fontFamily: 'sans-serif', fontSize: '22px', color: '#E2E8F0' });

    const host = this.game.canvas.parentElement ?? document.body;
    this.sampler.attach(host);
    this.unsubscribe = this.app.subscribe((e) => {
      if (e.kind === 'snapshot' && this.seq < e.snap.ack) this.seq = e.snap.ack;
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

  /** 지금 내 조준 목표 각도 (괴물: 커서 방향) */
  private aimTarget(): number {
    if (this.app.match?.role !== 'monster') return Number.NaN;
    const p = this.input.activePointer;
    const t = screenToTile(p.x, p.y);
    const me = this.app.predictor?.state;
    if (!me) return Number.NaN;
    if (Math.hypot(t.x - me.x, t.y - me.y) < 0.05) return me.face;
    return Math.atan2(t.y - me.y, t.x - me.x);
  }

  private stepInput(deltaMs: number): void {
    const app = this.app;
    const env = app.moveEnv();
    if (!env || !app.predictor?.state) return;
    const dtMs = app.dt * 1000;
    this.acc = Math.min(this.acc + deltaMs, dtMs * MAX_CATCHUP_STEPS);
    const frames: InputFrame[] = [];
    while (this.acc >= dtMs) {
      this.acc -= dtMs;
      this.seq += 1;
      const frame = this.sampler.sample(this.seq, this.aimTarget());
      app.predictor.applyLocal(frame, env);
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
    if (!snap || !app.balance) {
      this.drawn = [];
      return;
    }
    const renderTime = app.net.serverNow() - app.balance.network.interpolationDelayMs;
    const me = app.predictor?.renderPos(delta) ?? null;
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
        nowMs: performance.now(),
      },
      delta,
    );
    this.drawn = this.world.drawn;

    const t = Math.max(0, Math.ceil(snap.world.timeLeft));
    const mm = Math.floor(t / 60);
    const ss = String(t % 60).padStart(2, '0');
    this.hud.setText(`${mm}:${ss}`);
  }
}
