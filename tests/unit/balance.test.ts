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

  it('구조에 묶인 값(거점 수)을 바꾸면 실패한다', () => {
    const broken = structuredClone(raw);
    (broken.capturePoint as Record<string, unknown>).count = 3;
    expect(() => validateBalance(broken)).toThrow(/capturePoint\.count/);
  });
});
