// 괴물 조작 규칙: 시야 모드 전환 (우클릭, 0.4초 보간)
import { BTN, type InputFrame } from '@decoy/shared';
import type { Game } from '../game';
import type { MonsterState } from '../state';

/** 입력 한 개의 눌림 처리 (시야 모드). 기절 중에는 새 전환을 받지 않는다 */
export function monsterModeInput(game: Game, m: MonsterState, input: InputFrame): void {
  if ((input.pressed & BTN.MODE) === 0) return;
  if (m.move.stun > 0) return;
  m.mode = m.mode === 'search' ? 'hunt' : 'search';
  game.emitTo(m, { k: 'modeSwitch', mode: m.mode });
}

/** 틱마다: 부채꼴 모양을 목표 모드 쪽으로 visionModeSwitchTime에 걸쳐 바꾼다 (기절 중에도 진행) */
export function monsterBlendTick(game: Game, m: MonsterState): void {
  const target = m.mode === 'hunt' ? 1 : 0;
  const time = game.balance.monster.visionModeSwitchTime;
  if (time <= 0) {
    m.blend = target;
    return;
  }
  const step = game.dt / time;
  if (m.blend < target) m.blend = Math.min(target, m.blend + step);
  else if (m.blend > target) m.blend = Math.max(target, m.blend - step);
}
