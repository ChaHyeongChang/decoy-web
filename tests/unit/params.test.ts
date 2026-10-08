// 주소 매개변수: ?scale 재정의(빈 값 → 0.25배 버그 수정) · ?quality (M10a)
// app.ts가 로비 → 로고 PNG를 import하므로 Vite 자산 타입이 필요하다 (vitest는 Vite로 불러온다)
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { readParams } from '../../client/src/app';
import { parseScale } from '../../client/src/render/resolution';

describe('?scale 해석', () => {
  it('값이 없거나 비었거나 0 · 공백 · 문자 · 음수면 지정 없음(null)', () => {
    for (const raw of [null, '', '0', ' ', '%20', 'abc', '-1', 'NaN', 'Infinity', '-0.5']) {
      expect(parseScale(raw === '%20' ? decodeURIComponent(raw) : raw), String(raw)).toBeNull();
    }
  });

  it('있으면 0.25~1로 자른다', () => {
    expect(parseScale('0.5')).toBe(0.5);
    expect(parseScale('3')).toBe(1);
    expect(parseScale('1')).toBe(1);
    expect(parseScale('0.1')).toBe(0.25);
    expect(parseScale(' 0.75 ')).toBe(0.75);
  });
});

describe('readParams', () => {
  it('?scale=(빈 값) · ?scale=0 · ?scale=%20 은 기본과 같다 (예전에는 0.25배였다)', () => {
    expect(readParams('').scaleOverride).toBeNull();
    expect(readParams('?scale=').scaleOverride).toBeNull();
    expect(readParams('?scale=0').scaleOverride).toBeNull();
    expect(readParams('?scale=%20').scaleOverride).toBeNull();
    expect(readParams('?bots=1&scale').scaleOverride).toBeNull();
  });

  it('옛 &scale=0.5 링크는 계속 가볍게 동작한다', () => {
    expect(readParams('?room=ABCD&scale=0.5').scaleOverride).toBe(0.5);
    expect(readParams('?scale=2').scaleOverride).toBe(1);
  });

  it('?quality=high|medium|low, 그 밖에는 null', () => {
    expect(readParams('?quality=high').quality).toBe('high');
    expect(readParams('?quality=medium').quality).toBe('medium');
    expect(readParams('?quality=low').quality).toBe('low');
    expect(readParams('?quality=ultra').quality).toBeNull();
    expect(readParams('?quality=').quality).toBeNull();
    expect(readParams('').quality).toBeNull();
  });

  it('다른 매개변수는 그대로', () => {
    const p = readParams('?room=abcd&bots=1&debug=hook&renderer=canvas&lag=120&name=x');
    expect(p).toMatchObject({
      room: 'ABCD',
      bots: true,
      debug: 'hook',
      renderer: 'canvas',
      lag: 120,
      name: 'x',
      scaleOverride: null,
      quality: null,
    });
  });
});
