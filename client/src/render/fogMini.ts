// 미니맵용 작은 바닥 합성 (맵 전체, 빛 지도와 같은 해상도): 정적 맵 → 바닥 명령(시야 채움 · 거점 · 탈출구) → 빛 곱하기 →
// 테두리 리프트. 따라가는 카메라에서는 화면 합성이 보이는 창 근처만 다루므로, 미니맵은 두 안개 경로(Canvas · GPU)
// 모두 이 합성을 줄여 쓴다. 메인 화면과 같은 기록 · 같은 빛 지도라 미니맵이 메인 화면(맵 전체에 그린 것)보다 많은 것을
// 보여 줄 수 없다. 처음 읽을 때 만들고(미니맵이 없는 배치는 만들지 않는다), 기록이 바뀐 뒤 처음 읽을 때만 다시 합성한다
import { MAP_W, TILE_PX } from '@decoy/shared';
import { StaticMapBake, getStaticMap } from '../art/mapArt';
import { WORLD_LINE, WORLD_SCALE } from '../ui/layout';
import type { PenRecord } from './fogPaint';
import { CanvasPen, addRimLift, makeCanvas, rimLiftPath, type LightMap } from './fogPaint';

export class MiniComposite {
  private mini: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; pen: CanvasPen } | null = null;
  private readonly lift: Path2D;
  /** 마지막으로 바뀐 주기의 명령 (null = 아직 없음) */
  private last: PenRecord | null = null;
  private dirty = true;

  constructor(
    /** px / 타일 (빛 지도와 같다 — 크게 본 지도는 그보다 크고 정수가 아닐 수 있다) */
    private readonly lpt: number,
    private readonly light: LightMap | null,
    /** 이 해상도로 미리 구운 정적 맵 (크게 본 지도 — 맵 그림 캐시 밖). 없으면 캐시에서 빛 지도 해상도로 */
    staticMap: HTMLCanvasElement | null = null,
  ) {
    this.lift = rimLiftPath(lpt);
    this.st = staticMap;
  }

  /** 정적 맵 (빛 지도 해상도, 발광 포함). 처음 읽을 때 캐시에서 가져와 붙잡는다 */
  private st: HTMLCanvasElement | null = null;

  get staticMap(): HTMLCanvasElement {
    this.st ??= getStaticMap(this.lpt / TILE_PX, true);
    return this.st;
  }

  /** 합성 캔버스를 놓는다 (크게 본 지도를 닫을 때 — 이 합성은 다시 쓰지 않는다). 정적 맵은 주인이 놓는다 */
  release(): void {
    if (this.mini) {
      this.mini.canvas.width = 0;
      this.mini.canvas.height = 0;
    }
    this.mini = null;
    this.last = null;
  }

  /** 이번 주기의 기록을 넘긴다 (바뀌었을 때만: 다음에 읽을 때 다시 합성). 넘긴 기록은 다음 넘김까지 붙잡는다 */
  take(rec: PenRecord): void {
    this.last = rec;
    this.dirty = true;
  }

  /** 빛만 바뀌었다 */
  touch(): void {
    this.dirty = true;
  }

  get canvas(): HTMLCanvasElement {
    const st = this.staticMap;
    if (!this.mini) {
      const m = makeCanvas(st.width, st.height);
      // 선 굵기는 메인 화면(논리 px × 확대 선 배율)을 같은 비율로 줄인 것
      this.mini = {
        ...m,
        pen: new CanvasPen(m.ctx, this.lpt, (this.lpt / (TILE_PX * WORLD_SCALE)) * WORLD_LINE),
      };
    }
    const { canvas, ctx: c, pen } = this.mini;
    if (this.dirty) {
      this.dirty = false;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.drawImage(st, 0, 0);
      this.last?.replay(pen);
      if (this.light) {
        c.save();
        c.globalCompositeOperation = 'multiply';
        c.drawImage(this.light.canvas, 0, 0, canvas.width, canvas.height);
        c.restore();
      }
      addRimLift(c, this.lift);
    }
    return canvas;
  }
}

/**
 * 지도 크게 보기의 바닥: 작은 미니맵과 **같은 기록 · 같은 빛 지도**로 맵 전체를 폭 width 텍셀에 합성한다. 크게 본 그림이 화면에서
 * 차지하는 기기 px에 맞춘 해상도다(작은 지도 합성을 늘려 그리면 품질 낮음 · 높은 기기 배율에서 흐렸다). 정적 맵은 그 해상도로 직접
 * 굽는다 — 작은 미니맵 · 본 화면과 같은 그림체(작은 크기에서 굵게 남는 선 · 네온)다. 큰 그림을 줄여 쓰면 선이 실제 비율대로
 * 가늘어져 흐릿해 보였다. 판 중이라 한 번에 굽지 않고 step(budgetMs)으로 프레임마다 나눠 굽는다(맵 그림 캐시와 따로 — 판 배율 ·
 * 미니맵 그림을 밀어내지 않는다). 다 구울 때까지 canvas는 null이고, 부르는 쪽은 작은 지도 합성을 늘려 그린다(예전과 같다).
 * 지도가 열려 있는 동안만 들고(setWidth), 닫으면 놓는다(setWidth(null)). 기록은 닫혀 있어도 마지막 것을 붙잡는다(참조만)
 */
export class BigMiniComposite {
  private comp: MiniComposite | null = null;
  private bake: StaticMapBake | null = null;
  private last: PenRecord | null = null;
  /** 지금 폭 (텍셀, 놓았으면 0) */
  width = 0;

  constructor(private readonly light: LightMap | null) {}

  /** 폭을 정한다 (같으면 그대로). null · 0 = 놓는다. 폭이 바뀌면 정적 맵을 새로 굽기 시작한다 */
  setWidth(width: number | null): void {
    const w = width === null ? 0 : Math.max(0, Math.round(width));
    if (w === this.width) return;
    this.release();
    if (w === 0) return;
    this.width = w;
    this.bake = new StaticMapBake(w / (MAP_W * TILE_PX), true);
  }

  /** 정적 맵을 budgetMs 안에서 굽는다. 이번에 다 구워 합성을 쓸 수 있게 됐으면 true (그 프레임에 크게 본 지도를 다시 그린다) */
  step(budgetMs: number): boolean {
    const b = this.bake;
    if (!b || this.comp) return false;
    if (!b.step(budgetMs)) return false;
    this.comp = new MiniComposite(b.canvas.width / MAP_W, this.light, b.canvas);
    if (this.last) this.comp.take(this.last);
    return true;
  }

  /** 다 구워 합성을 쓸 수 있는가 */
  get ready(): boolean {
    return this.comp !== null;
  }

  /** 이번 주기의 기록 (작은 미니맵 합성과 같은 때 · 같은 기록) */
  take(rec: PenRecord): void {
    this.last = rec;
    this.comp?.take(rec);
  }

  /** 합성 캔버스 (읽을 때 바뀌었으면 합성한다). 놓았거나 아직 굽는 중이면 null */
  get canvas(): HTMLCanvasElement | null {
    return this.comp ? this.comp.canvas : null;
  }

  /** 합성 · 정적 맵 캔버스를 놓는다 */
  release(): void {
    this.comp?.release();
    this.comp = null;
    this.bake?.release();
    this.bake = null;
    this.width = 0;
  }
}
