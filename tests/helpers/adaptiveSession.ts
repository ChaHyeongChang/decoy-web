// 적응형 품질 단위 테스트용 세션 (렌더링 최적화): 판을 이어서 돌리며 자동 조정을 적용한다.
// main.ts qualityHooks.auto · 프레임 페이싱(framePacing Pacer.setFallback · targetHzFor)과 같은 규칙으로 품질 · 목표 FPS를 바꾼다
import { ladderSize, targetHzFor, type FrameLimit } from '../../client/src/gfx/framePacing';
import type { QualityTier } from '../../client/src/gfx/presets';
import type {
  AdaptContext,
  AutoDowngrade,
  AutoQualityAction,
  FrameSample,
  PerfMode,
} from '../../client/src/gfx/quality';

export type Limit = FrameLimit;

/** 한 프레임의 측정: 지금 품질 · 목표 FPS · 판 안 경과 ms로 정한다 */
export type FrameFn = (tier: QualityTier, targetHz: number, elapsed: number) => FrameSample;

/** injectFps(f)와 같은 측정: 작업 시간 = 프레임 간격 (GameScene이 덮어쓴 FPS를 그렇게 넣는다) */
export function injected(fps: number): FrameSample {
  return { fps, workP95: 1000 / fps };
}

/** 목표를 채우고 작업 시간이 짧은(여유 있는) 프레임 */
export function roomy(workP95 = 3): FrameFn {
  return (_tier, targetHz) => ({ fps: targetHz, workP95 });
}

/** 결정 하나와 그때 판 안 경과 ms */
export interface Logged {
  action: AutoQualityAction;
  at: number;
}

export class AdaptiveSession {
  /** 자동 목표 낮춤 (null이면 없음, Pacer.setFallback과 같다) */
  fallback: number | null = null;
  readonly log: Logged[] = [];
  /** 세션 시계 (ms) */
  t = 0;

  constructor(
    public tier: QualityTier,
    readonly auto: AutoDowngrade,
    public limit: Limit = 'auto',
    public displayHz = 60,
  ) {}

  /** 목표 FPS = 화면 주사율의 약수 (framePacing targetHzFor — 자동이면 낮춤에 가장 가까운 약수, 고정 제한은 그 값에 가장 가까운 약수) */
  get targetHz(): number {
    return targetHzFor(this.limit, this.displayHz, this.fallback);
  }

  ctx(): AdaptContext {
    return {
      targetHz: this.targetHz,
      displayHz: this.displayHz,
      canRateFallback: this.limit === 'auto' && ladderSize(this.displayHz) > 1,
    };
  }

  /** main.ts가 하는 적용: 품질은 지금 단계가 from일 때만, 목표 FPS는 pacer.setFallback */
  apply(a: AutoQualityAction): void {
    switch (a.kind) {
      case 'downgrade':
      case 'revert':
      case 'upgrade':
        if (this.tier === a.from) this.tier = a.to;
        break;
      case 'upRevert':
        if (a.step === 'rate') this.fallback = a.to;
        else if (this.tier === a.from) this.tier = a.to;
        break;
      case 'rateDown':
        this.fallback = a.to;
        break;
      case 'rateUp':
        // 사다리 한 칸 위로 (맨 위 = 화면 주사율이면 낮춤을 지운다 — main.ts와 같다)
        this.fallback = a.to >= this.displayHz - 1e-6 ? null : a.to;
        break;
      default:
        break;
    }
  }

  /**
   * 판 하나를 ms 동안 돈다 (샘플 간격 = 1000 / 지금 목표). 판 장면을 만들기 직전에 main.ts처럼 미룬 품질 올리기를 받아 적용한다.
   * 판 뒤에는 20초 쉰다(결과 화면 · 로비). 이 판의 결정을 돌려준다
   */
  play(ms: number, frame: FrameFn, mode: PerfMode = 'online'): Logged[] {
    const out: Logged[] = [];
    const taken = this.auto.takePendingUpgrade(mode, this.tier);
    if (taken) {
      out.push({ action: taken, at: -1 });
      this.apply(taken);
    }
    const start = this.t;
    this.auto.beginMatch(start, mode);
    while (this.t < start + ms) {
      const a = this.auto.sample(
        this.t,
        frame(this.tier, this.targetHz, this.t - start),
        this.tier,
        this.ctx(),
      );
      if (a) {
        out.push({ action: a, at: this.t - start });
        this.apply(a);
      }
      this.t += 1000 / this.targetHz;
    }
    this.auto.endMatch();
    this.t += 20_000;
    this.log.push(...out);
    return out;
  }
}

/** 결정 종류만 */
export function kinds(list: readonly Logged[]): AutoQualityAction['kind'][] {
  return list.map((l) => l.action.kind);
}
