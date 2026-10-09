// 기기 저장 키 (M12 계약): 접근 함수는 막힌 · 가득 찬 저장소에서 예외 없이 실패를 돌려준다
import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS, readKey, removeKey, writeKey, type StorageLike } from '../../client/src/storageKeys';

function mem(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const broken: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('저장 키 접근', () => {
  it('키 · 접두사 키를 그대로 쓴다', () => {
    const s = mem();
    expect(writeKey('quality', 'low', '', s)).toBe(true);
    expect(s.data.get('decoy:quality')).toBe('low');
    expect(writeKey('seat', 'tok', 'ABCD', s)).toBe(true);
    expect(s.data.get('decoy:seat:ABCD')).toBe('tok');
    expect(readKey('seat', 'ABCD', s)).toBe('tok');
    expect(removeKey('seat', 'ABCD', s)).toBe(true);
    expect(readKey('seat', 'ABCD', s)).toBeNull();
  });

  it('막힌 저장소 · 저장소 없음에서는 예외 없이 실패', () => {
    expect(readKey('name', '', broken)).toBeNull();
    expect(writeKey('name', 'x', '', broken)).toBe(false);
    expect(removeKey('name', '', broken)).toBe(false);
    expect(readKey('name', '', null)).toBeNull();
    expect(writeKey('name', 'x', '', null)).toBe(false);
  });

  it('모든 키에 설명 · 보관 기간이 있고 decoy: 로 시작한다', () => {
    for (const info of Object.values(STORAGE_KEYS)) {
      expect(info.key.startsWith('decoy:')).toBe(true);
      expect(info.what.length).toBeGreaterThan(4);
      expect(info.keep.length).toBeGreaterThan(2);
    }
  });
});
