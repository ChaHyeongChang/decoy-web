// 미니맵용 작은 바닥 합성 (맵 전체, 빛 지도와 같은 해상도): 정적 맵 → 바닥 명령(시야 채움 · 거점 · 탈출구) → 빛 곱하기 →
// 테두리 리프트. 따라가는 카메라에서는 화면 합성이 보이는 창 근처만 다루므로, 미니맵은 두 안개 경로(Canvas · GPU)
// 모두 이 합성을 줄여 쓴다. 메인 화면과 같은 기록 · 같은 빛 지도라 미니맵이 메인 화면(맵 전체에 그린 것)보다 많은 것을
// 보여 줄 수 없다. 처음 읽을 때 만들고(미니맵이 없는 배치는 만들지 않는다), 기록이 바뀐 뒤 처음 읽을 때만 다시 합성한다
import { TILE_PX } from '@decoy/shared';
import { getStaticMap } from '../art/mapArt';
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
    /** px / 타일 (빛 지도와 같다) */
    private readonly lpt: number,
    private readonly light: LightMap | null,
  ) {
    this.lift = rimLiftPath(lpt);
  }

  /** 정적 맵 (빛 지도 해상도, 발광 포함). 처음 읽을 때 캐시에서 가져와 붙잡는다 */
  private st: HTMLCanvasElement | null = null;

  get staticMap(): HTMLCanvasElement {
    this.st ??= getStaticMap(this.lpt / TILE_PX, true);
    return this.st;
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
