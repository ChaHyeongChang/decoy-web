import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BalanceError, CAPTURE_POINTS, POINT_IDS, validateBalance } from '@decoy/shared';

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
    for (const n of [2, 4]) {
      const broken = structuredClone(raw);
      (broken.capturePoint as Record<string, unknown>).count = n;
      expect(() => validateBalance(broken)).toThrow(/capturePoint\.count/);
    }
  });

  it('capturePoint.required(탈출구를 켜는 점령 수)는 있어야 하고 2(비밀번호 두 조각)여야 한다 (플레이테스트 반영 b)', () => {
    const missing = structuredClone(raw);
    delete (missing.capturePoint as Record<string, unknown>).required;
    expect(() => validateBalance(missing)).toThrow(/capturePoint\.required/);
    for (const n of [1, 3]) {
      const broken = structuredClone(raw);
      (broken.capturePoint as Record<string, unknown>).required = n;
      expect(() => validateBalance(broken)).toThrow(/capturePoint\.required/);
    }
  });

  it('거점 수(count)가 맵의 거점 목록과 같고, 필요한 수(required)는 그보다 적다', () => {
    const b = validateBalance(raw);
    expect(POINT_IDS).toHaveLength(b.capturePoint.count);
    expect(Object.keys(CAPTURE_POINTS).sort()).toEqual([...POINT_IDS].sort());
    expect(b.capturePoint.required).toBeLessThan(b.capturePoint.count);
  });
});
