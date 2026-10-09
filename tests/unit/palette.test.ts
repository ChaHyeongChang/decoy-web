// 팔레트 대비 (M10 VISUAL_SPEC 2장): 글자 4.5:1, 캐릭터 몸과 외곽선 3:1, 역할 원값 고정
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateBalance } from '../../shared/src/balance';
import {
  GRAPHIC_PAIRS,
  HIDDEN_SURVIVOR,
  ROLE,
  TEXT_PAIRS,
  WARN,
  WARN_TEXT,
  blendOver,
  contrastRatio,
  multiplyRgb,
  relativeLuminance,
} from '../../client/src/art/palette';

describe('팔레트', () => {
  it('글자 쌍은 모두 4.5:1 이상', () => {
    for (const p of TEXT_PAIRS) expect(contrastRatio(p.fg, p.bg), p.name).toBeGreaterThanOrEqual(p.min);
  });

  it('캐릭터 몸과 외곽선은 3:1 이상', () => {
    for (const p of GRAPHIC_PAIRS) expect(contrastRatio(p.fg, p.bg), p.name).toBeGreaterThanOrEqual(p.min);
  });

  it('경고 배너 글자는 #0B1622 / #F59E0B = 8.49:1', () => {
    expect(contrastRatio(WARN_TEXT, WARN)).toBeCloseTo(8.49, 2);
  });

  it('역할색은 규칙 색(balance.json roles.color)과 같고, 괴물 화면 생존자는 #F8FAFC', () => {
    const b = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));
    for (const id of ['runner', 'guard', 'scout'] as const)
      expect(ROLE[id]).toBe(parseInt(b.roles[id].color.slice(1), 16));
    expect(ROLE.monster).toBe(0xef4444);
    expect(HIDDEN_SURVIVOR).toBe(0xf8fafc);
  });

  it('대비 계산 기준값 (WCAG)', () => {
    expect(contrastRatio(0xffffff, 0x000000)).toBeCloseTo(21, 5);
    expect(relativeLuminance(0xffffff)).toBeCloseTo(1, 6);
    expect(blendOver(0xffffff, 0x000000, 0.5)).toBe(0x808080);
    expect(multiplyRgb(0xff8040, 0x808080)).toBe(0x804020);
  });
});
