// 터치 화면 (M11, MOBILE_PLAN M11 4번): #ui-root 안 DOM. 왼쪽 떠 있는 이동 스틱, 오른쪽 역할별 버튼(괴물: 조준 스틱 ·
// 돌진 · 포효 · 시야 모드 · 점수판 / 생존자: 능력 · 구조 · 점수판), 버튼마다 쿨타임 게이지(HUD와 같은 actionSlots 결과).
// 터치 모드(device.touch)에서만 만든다. 손가락 이벤트를 정규화해 TouchFeed로 넣는다.
// 터치 대상 요소에는 data-touch-target="<id>" · data-touch-kind="zone|stick|button"을 단다 (__DECOY__.getTouchTargets).
import type { Role } from '@decoy/shared';
import type { TouchFeed } from '../touchInput';
import type { ActionSlot } from './hudArt';

/** 프레임마다 GameScene이 넘기는 값. 바뀐 것만 DOM에 반영한다 */
export interface TouchView {
  /** 행동 칸 (actionSlots 결과 그대로: 생존자 능력 · 구조, 괴물 공격 · 돌진 · 포효 · 시야 모드) */
  slots: ActionSlot[];
}

export interface TouchControlsOptions {
  role: Role;
  feed: TouchFeed;
}

/** 터치 화면 (구현: M11 갈래 B) */
export class TouchControls {
  /** 점수판 버튼으로 켠 상태 (GameScene이 Tab 대신 읽는다) */
  scoreboard = false;

  constructor(
    readonly root: HTMLElement,
    readonly opts: TouchControlsOptions,
  ) {}

  /** 프레임마다: 쿨타임 게이지 · 버튼 상태 */
  update(_view: TouchView): void {}

  /** 끄면(결과 · 관전 · 세로 · 대화상자) 즉시 손가락 상태를 비우고(feed.stickCancel) 입력을 받지 않는다 */
  setActive(_on: boolean): void {}

  destroy(): void {}
}
