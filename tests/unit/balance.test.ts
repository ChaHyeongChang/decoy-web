import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BalanceError, validateBalance } from '@decoy/shared';

const raw = JSON.parse(readFileSync('config/balance.json', 'utf8')) as Record<string, unknown>;

describe('balance.json', () => {
  it('현재 파일이 검증을 통과한다', () => {
    const b = validateBalance(raw);
    expect(b.survivor.moveSpeed).toBe(5);
    expect(b.monster.visionModes.hunt.range).toBe(9);
  });

  it('필수 키가 빠지면 이유와 함께 실패한다', () => {
    const broken = structuredClone(raw);
    delete (broken.survivor as Record<string, unknown>).moveSpeed;
    expect(() => validateBalance(broken)).toThrow(BalanceError);
    expect(() => validateBalance(broken)).toThrow(/survivor\.moveSpeed/);
  });

  it('빠른 매칭 대기 시간(matchmaking.quickMatchWait, M13c)이 없거나 0이면 실패한다', () => {
    expect(validateBalance(raw).matchmaking.quickMatchWait).toBe(20);
    const missing = structuredClone(raw);
    delete (missing.matchmaking as Record<string, unknown>).quickMatchWait;
    expect(() => validateBalance(missing)).toThrow(/matchmaking\.quickMatchWait/);
    const zero = structuredClone(raw);
    (zero.matchmaking as Record<string, unknown>).quickMatchWait = 0;
    expect(() => validateBalance(zero)).toThrow(/matchmaking\.quickMatchWait/);
    const noBlock = structuredClone(raw);
    delete noBlock.matchmaking;
    expect(() => validateBalance(noBlock)).toThrow(/matchmaking/);
  });

  it('구조에 묶인 값(거점 수)을 바꾸면 실패한다', () => {
    const broken = structuredClone(raw);
    (broken.capturePoint as Record<string, unknown>).count = 3;
    expect(() => validateBalance(broken)).toThrow(/capturePoint\.count/);
  });
});
