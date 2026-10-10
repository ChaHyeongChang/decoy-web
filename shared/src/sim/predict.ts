// 봇의 내 위치 예측 (DECISIONS 2절 네트워크 '봇의 내 위치 예측'). WebSocket 봇(server/src/bots.ts)과 기기 안 봇이 같이 쓴다
import {
  cloneMoveState,
  stepMovement,
  type Balance,
  type InputFrame,
  type MoveEnv,
  type Snapshot,
} from '../index';
import { moverOf } from './botBrains';

/**
 * 봇의 내 위치 예측: 마지막 스냅샷(서버가 처리한 입력까지)에 아직 처리 안 된 입력을 같은 이동 코드로 다시 적용한다.
 * 사람 클라이언트의 예측과 같은 방식이라 지연(lag)이 있어도 목표를 지나쳐 흔들리지 않는다. 다른 몸은 무시한다
 */
export function predictSelf(snap: Snapshot, pending: readonly InputFrame[], balance: Balance): Snapshot {
  const later = pending.filter((f) => f.seq > snap.ack);
  if (later.length === 0) return snap;
  const move = cloneMoveState(snap.you.move);
  const env: MoveEnv = {
    kind: snap.you.role === 'monster' ? 'monster' : 'survivor',
    role: snap.you.role === 'monster' ? null : snap.you.role,
    mover: moverOf(snap),
    campActive: snap.world.imprisoned > 0,
    obstacles: [],
  };
  const dt = 1 / balance.network.serverTickHz;
  for (const f of later) stepMovement(move, f, env, balance, dt);
  return { ...snap, you: { ...snap.you, move } };
}
