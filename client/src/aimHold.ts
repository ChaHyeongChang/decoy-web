// 괴물 마우스 조준 붙잡기 (따라가는 카메라, 순수). 마우스 조준 = 화면에 그려진 괴물에서 커서 쪽 방향.
// 카메라가 움직이면(앞당김 · 흔들림) 커서는 화면에 가만히 있어도 그 아래 월드 자리가 바뀐다 → 커서 아래 월드 자리로 조준을
// 다시 재면 앞당김이 조준을 끌고 조준이 다시 앞당김을 끄는 되먹임으로 마우스를 놓아 둬도 조준이 흘러간다.
// 그래서 커서가 실제로 움직였을 때 커서의 월드 자리를 재고, 그 사이에는 그 자리를 '기준 카메라'를 따라 옮긴 자리를 겨눈다.
// 기준 카메라 = 앞당김 · 따라가기 지연 · 흔들림 없이 괴물을 가운데 두고 맵 안으로만 자른 창 (anchor = 그 가운데):
//  - 맵 가운데를 걸으면 기준이 괴물과 같이 움직여 커서 자리도 같이 옮겨진다 → 같은 방향을 계속 본다(화면의 커서와 맞다)
//  - 맵 끝에 막힌 축에서는 기준이 멈춰 커서 자리가 고정된다 → 화면 속 괴물이 커서를 지나쳐 걸으면 조준이 커서 쪽으로 돈다
//    (검토 반영: 예전에는 방향만 붙잡아 맵 끝에서 마우스를 두고 걸으면 커서와 최대 59° 어긋났다)
//  - 앞당김은 기준에 들어가지 않으므로 되먹임이 없다
// 커서가 괴물 몸 위(minDist 안)면 지난 방향(없으면 지금 바라보는 방향)
import type { Vec2 } from '@decoy/shared';

export class AimHold {
  private px = Number.NaN;
  private py = Number.NaN;
  private angle: number | null = null;
  /** 커서를 잰 때의 커서 월드 자리 − 기준 카메라 가운데 */
  private offX = 0;
  private offY = 0;
  /** 지난 조준 벡터 (같으면 각도를 다시 계산하지 않는다 — 맵 가운데를 걸을 때 반올림으로 각도가 1e-15씩 흔들리지 않게) */
  private lastDx = Number.NaN;
  private lastDy = Number.NaN;
  /** 지난 재기 뒤 커서가 움직이지 않은 입력 틱 수 (디버그 · 시험) */
  held = 0;

  /**
   * 이번 입력 틱의 조준. pointer = 커서 자리(기기 px — 움직였는지 가린다), cursor · body · anchor = 같은 월드 좌표계(논리 px)의
   * 커서 아래 자리 · 그려진 괴물 자리 · 기준 카메라 가운데, minDist = 이보다 가까우면 방향을 새로 정하지 않는다(같은 좌표계),
   * face = 지금 바라보는 방향
   */
  update(pointer: Vec2, cursor: Vec2, body: Vec2, anchor: Vec2, minDist: number, face: number): number {
    let tx: number;
    let ty: number;
    if (this.angle !== null && pointer.x === this.px && pointer.y === this.py) {
      this.held += 1;
      tx = anchor.x + this.offX;
      ty = anchor.y + this.offY;
    } else {
      this.px = pointer.x;
      this.py = pointer.y;
      this.held = 0;
      this.offX = cursor.x - anchor.x;
      this.offY = cursor.y - anchor.y;
      tx = cursor.x;
      ty = cursor.y;
    }
    const dx = tx - body.x;
    const dy = ty - body.y;
    if (Math.hypot(dx, dy) < minDist) return this.angle ?? face;
    if (this.angle !== null && Math.abs(dx - this.lastDx) < 1e-6 && Math.abs(dy - this.lastDy) < 1e-6)
      return this.angle;
    this.lastDx = dx;
    this.lastDy = dy;
    this.angle = Math.atan2(dy, dx);
    return this.angle;
  }

  /** 판 시작 · 조준 준비 전: 지난 판 값을 버린다 */
  reset(): void {
    this.px = Number.NaN;
    this.py = Number.NaN;
    this.angle = null;
    this.offX = 0;
    this.offY = 0;
    this.lastDx = Number.NaN;
    this.lastDy = Number.NaN;
    this.held = 0;
  }
}

/**
 * 기준 카메라 가운데 (타일): 괴물을 가운데 두고 맵 안으로만 자른 창의 가운데. 창이 맵보다 크면 맵 가운데.
 * w · h = 보이는 창 크기(타일), mapW · mapH = 맵 크기(타일)
 */
export function aimAnchor(
  x: number,
  y: number,
  w: number,
  h: number,
  mapW: number,
  mapH: number,
  out: Vec2,
): Vec2 {
  out.x = w >= mapW ? mapW / 2 : Math.max(w / 2, Math.min(mapW - w / 2, x));
  out.y = h >= mapH ? mapH / 2 : Math.max(h / 2, Math.min(mapH - h / 2, y));
  return out;
}
