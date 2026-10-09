// 터치 입력 (M11, MOBILE_PLAN M11 5번 조작 규칙). DOM 없는 순수 상태 기계: 손가락별 추적 · 데드존 · 조준 스틱 발사 대기.
// 터치 화면(ui/touchControls.ts)이 손가락 이벤트를 스틱 반지름으로 정규화해 넣고(TouchFeed),
// InputSampler(input.ts)가 입력 프레임마다 읽는다(TouchSource). 보내는 형식은 키보드 · 마우스와 같은 InputFrame이다.
// 시각은 인자로 받는다(performance · window를 쓰지 않는다 — 단위 테스트에서 시간을 정한다).

/** 조작 수치 (판정과 무관한 입력 해석 값이라 balance.json이 아니라 여기 둔다. DECISIONS M11) */
export const TOUCH = {
  /** 스틱 데드존 (스틱 반지름 대비) */
  deadZone: 0.15,
  /** 발사 대기: 예측 face가 고정 각도 θ에서 이만큼 안이면 바로 공격 (라디안, 10°) */
  aimTolerance: (10 * Math.PI) / 180,
  /** 발사 대기 최대 시간 (ms). 지나면 face가 덜 돌았어도 공격 */
  maxFireWaitMs: 350,
  /** 조준 스틱 짧은 탭 (ms): 데드존을 벗어나지 않고 이 안에 떼면 지금 방향으로 공격 */
  shortTapMs: 250,
} as const;

/** 스틱 종류: 왼쪽 이동, 오른쪽 조준(괴물), 돌진 버튼을 끌어 만든 작은 스틱(괴물) */
export type StickKind = 'move' | 'aim' | 'dash';

/** 입력 프레임마다 InputSampler가 넘기는 상황 (예측 상태 · 마지막 스냅샷에서) */
export interface TouchFrameCtx {
  nowMs: number;
  /** 예측한 내 바라보는 방향 (라디안) */
  face: number;
  /** 지금 공격을 시작할 수 있는가 (쿨타임 0, 시작 대기 · 기절 · 돌진 · 준비 중 아님 — actionSlots와 같은 조건) */
  canAttack: boolean;
  /** 지금 돌진할 수 있는가 */
  canDash: boolean;
}

/**
 * InputSampler가 읽는 쪽. 한 입력 프레임에서 **takePressed(ctx)를 먼저**, 그다음 aimAngle(ctx)를 부른다
 * (발사 대기에서 공격을 내보낸 프레임까지 aim = θ가 되게)
 */
export interface TouchSource {
  /** 이동 벡터 (길이 0 또는 1, 방향 360°) */
  moveVector(): { x: number; y: number };
  /** 누르고 있는 버튼 비트 (BTN) */
  heldBits(): number;
  /** 새로 눌린 버튼 비트를 꺼내고 비운다. ctx로 발사 대기를 진행한다 (조건이 차면 ATTACK · DASH를 여기서 낸다) */
  takePressed(ctx: TouchFrameCtx): number;
  /** 보낼 조준 각도 (라디안). null = 터치가 조준을 정하지 않음(마우스 조준을 쓴다, 생존자) */
  aimAngle(ctx: TouchFrameCtx): number | null;
  /** 모든 손가락 · 발사 대기 · 눌림을 비운다 (blur · 숨김 · 회전 · 결과 · 관전 · 세로) */
  reset(): void;
}

/**
 * 터치 화면이 넣는 쪽. 스틱 좌표는 스틱 중심 기준, 스틱 반지름으로 나눈 값(길이 1 = 가장자리, 넘으면 1로 자른다).
 * 화면 y는 아래가 +다(게임 좌표와 같다)
 */
export interface TouchFeed {
  /** 손가락이 스틱에 닿음 (이동 스틱은 누른 자리가 중심, 조준 스틱은 고정 중심, 돌진은 버튼 자리가 중심) */
  stickStart(pointerId: number, kind: StickKind, nowMs: number): void;
  stickMove(pointerId: number, nx: number, ny: number): void;
  /** 손가락을 뗌 (조준 · 돌진은 규칙에 따라 발사 대기로 가거나 취소) */
  stickEnd(pointerId: number, nowMs: number): void;
  /** 손가락이 사라짐 (pointercancel · lostpointercapture): 이 손가락의 효과를 버린다. 발사하지 않는다 */
  stickCancel(pointerId: number): void;
  /** 탭 버튼 (포효 · 시야 모드 · 능력): 다음 프레임 pressed */
  tap(bit: number): void;
  /** 누르고 있는 버튼 (구조 = RESCUE): 누르는 동안 held, 누른 순간 pressed */
  hold(bit: number, down: boolean): void;
}

/** 터치 입력 상태 기계 (구현: M11 갈래 A) */
export class TouchInput implements TouchSource, TouchFeed {
  moveVector(): { x: number; y: number } {
    return { x: 0, y: 0 };
  }

  heldBits(): number {
    return 0;
  }

  takePressed(_ctx: TouchFrameCtx): number {
    return 0;
  }

  aimAngle(_ctx: TouchFrameCtx): number | null {
    return null;
  }

  reset(): void {}

  stickStart(_pointerId: number, _kind: StickKind, _nowMs: number): void {}

  stickMove(_pointerId: number, _nx: number, _ny: number): void {}

  stickEnd(_pointerId: number, _nowMs: number): void {}

  stickCancel(_pointerId: number): void {}

  tap(_bit: number): void {}

  hold(_bit: number, _down: boolean): void {}
}
