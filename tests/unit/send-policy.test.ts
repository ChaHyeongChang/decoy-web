// 연결별 송신 정책 (M12): 밀린 연결에는 오래된 스냅샷을 건너뛰고, 다른 메시지는 늘 보내며, 아주 크게 쌓일 때만 끊는다.
// 거점 메모(비밀번호)가 든 스냅샷은 건너뛰지 않는다 (실제 송신 경로는 send-path.test.ts)
import { describe, expect, it } from 'vitest';
import { isKeptNote, type GameEvent, type ServerMessage } from '@decoy/shared';
import { AliasBook, buildSnapshot, computeVisibility } from '@decoy/shared/sim';
import {
  SKIP_SNAPSHOTS_ABOVE,
  TERMINATE_ABOVE,
  isSkippableSnapshot,
  sendAction,
} from '../../server/src/sendPolicy';
import { newGame } from '../helpers/fixtures';

/** 실제 생존자 스냅샷에 이벤트만 바꿔 넣는다 */
function snapWith(events: GameEvent[]): ServerMessage {
  const game = newGame();
  const s = buildSnapshot(game, 'p2', 0, computeVisibility(game), new AliasBook());
  if (!s) throw new Error('snapshot failed');
  return { t: 'snap', s: { ...s, events } };
}

describe('송신 정책', () => {
  it('버퍼가 비었거나 조금 쌓였으면 무엇이든 보낸다', () => {
    expect(sendAction(0, true)).toBe('send');
    expect(sendAction(SKIP_SNAPSHOTS_ABOVE, true)).toBe('send');
    expect(sendAction(SKIP_SNAPSHOTS_ABOVE, false)).toBe('send');
  });

  it('밀리면 스냅샷만 건너뛰고, 결과 · 로비 · 오류 같은 메시지는 보낸다', () => {
    expect(sendAction(SKIP_SNAPSHOTS_ABOVE + 1, true)).toBe('skip');
    expect(sendAction(SKIP_SNAPSHOTS_ABOVE + 1, false)).toBe('send');
    expect(sendAction(TERMINATE_ABOVE, false)).toBe('send');
  });

  it('스냅샷을 건너뛰는데도 아주 크게 쌓이면 끊는다 (M11 전의 1MB보다 훨씬 늦게)', () => {
    expect(sendAction(TERMINATE_ABOVE + 1, true)).toBe('terminate');
    expect(sendAction(TERMINATE_ABOVE + 1, false)).toBe('terminate');
    expect(TERMINATE_ABOVE).toBeGreaterThan(1024 * 1024);
    expect(SKIP_SNAPSHOTS_ABOVE).toBeLessThan(1024 * 1024);
  });
});

describe('건너뛰어도 되는 메시지 (거점 메모 보존)', () => {
  it('거점 메모 판별: NOTE_FIRST · NOTE_SECOND만 남길 메모다', () => {
    expect(isKeptNote({ k: 'text', id: 'NOTE_FIRST', code: '12' })).toBe(true);
    expect(isKeptNote({ k: 'text', id: 'NOTE_SECOND', code: '34' })).toBe(true);
    expect(isKeptNote({ k: 'text', id: 'ALERT_EXITS_ON' })).toBe(false);
    expect(isKeptNote({ k: 'text', id: 'ALERT_CAPTURE_DONE', point: 'A' })).toBe(false);
    expect(isKeptNote({ k: 'hit', you: true, x: 1, y: 1 })).toBe(false);
  });

  it('거점 메모가 든 스냅샷은 건너뛰지 않으므로 밀려도 보낸다', () => {
    for (const id of ['NOTE_FIRST', 'NOTE_SECOND'] as const) {
      const msg = snapWith([
        { k: 'text', id: 'ALERT_CAPTURE_DONE', point: 'B' },
        { k: 'text', id, code: '56' },
      ]);
      expect(isSkippableSnapshot(msg)).toBe(false);
      expect(sendAction(SKIP_SNAPSHOTS_ABOVE + 1, isSkippableSnapshot(msg))).toBe('send');
      // 끊는 문턱은 그대로
      expect(sendAction(TERMINATE_ABOVE + 1, isSkippableSnapshot(msg))).toBe('terminate');
    }
  });

  it('이벤트가 없거나 다른 일회성 이벤트만 든 스냅샷은 건너뛴다', () => {
    for (const events of [
      [],
      [{ k: 'text', id: 'ALERT_EXITS_ON' }],
      [{ k: 'imprisoned', you: true }],
    ] as GameEvent[][]) {
      const msg = snapWith(events);
      expect(isSkippableSnapshot(msg)).toBe(true);
      expect(sendAction(SKIP_SNAPSHOTS_ABOVE + 1, isSkippableSnapshot(msg))).toBe('skip');
    }
  });

  it('스냅샷이 아닌 메시지는 건너뛰지 않는다', () => {
    const others: ServerMessage[] = [
      { t: 'pong', c: 1, s: 2 },
      { t: 'error', code: 'replaced', message: 'x' },
    ];
    for (const msg of others) expect(isSkippableSnapshot(msg)).toBe(false);
  });
});
