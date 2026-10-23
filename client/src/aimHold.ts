// 괴물 마우스 조준 붙잡기 (따라가는 카메라, 순수). 마우스 조준 = 화면에 그려진 괴물에서 커서 쪽 방향.
// 카메라가 움직이면(앞당김 · 따라가기 · 흔들림) 커서는 화면에 가만히 있어도 그 아래 월드 자리가 바뀐다 → 커서 아래 월드 자리로
// 조준을 다시 재면 마우스를 놓아 둬도 조준이 흘러간다. 그래서 커서가 실제로 움직였을 때만 다시 재고, 그 사이에는 마지막 방향을
// 그대로 둔다(화면이 움직여도 조준은 안정). 따라가는 카메라에서는 괴물이 화면 가운데 근처에 머물러, 마우스를 가만히 둔 채 걸으면
// 같은 방향을 계속 보는 것이 화면에 보이는 커서와 맞는다. 커서가 괴물 몸 위(minDist 안)면 지난 방향(없으면 지금 바라보는 방향)
import type { Vec2 } from '@decoy/shared';

export class AimHold {
  private px = Number.NaN;
  private py = Number.NaN;
  private angle: number | null = null;
  /** 지난 재기 뒤 커서가 움직이지 않은 입력 틱 수 (디버그 · 시험) */
  held = 0;

  /**
   * 이번 입력 틱의 조준. pointer = 커서 자리(기기 px — 움직였는지 가린다), cursor · body = 같은 화면 좌표계(논리 px)의 커서와
   * 그려진 괴물 자리, minDist = 이보다 가까우면 방향을 새로 정하지 않는다(같은 좌표계), face = 지금 바라보는 방향
   */
  update(pointer: Vec2, cursor: Vec2, body: Vec2, minDist: number, face: number): number {
    if (this.angle !== null && pointer.x === this.px && pointer.y === this.py) {
      this.held += 1;
      return this.angle;
    }
    this.px = pointer.x;
    this.py = pointer.y;
    this.held = 0;
    const dx = cursor.x - body.x;
    const dy = cursor.y - body.y;
    if (Math.hypot(dx, dy) < minDist) return this.angle ?? face;
    this.angle = Math.atan2(dy, dx);
    return this.angle;
  }

  /** 판 시작 · 조준 준비 전: 지난 판 값을 버린다 */
  reset(): void {
    this.px = Number.NaN;
    this.py = Number.NaN;
    this.angle = null;
    this.held = 0;
  }
}
