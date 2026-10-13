// 렌더링 최적화 2 (HUD · UI): 바꾼 순수 함수가 옛 함수와 같은 결과를 내는지 옛 함수를 사본으로 두고 견준다.
//  - 프레임 이름(FR): 표 · 기억으로 바꾼 눈금 · 링 · 아이콘 · 실루엣 · 미니맵 이름 = 옛 템플릿 문자열
//  - 배너 알림 거르기(dropEnded · dropStale) = 옛 filter
//  - 글자 자연 크기(textBoxSize) = Phaser 3.90 GetTextSize 원본(node_modules) + 여백
//  - HudGate: 스냅샷 · 짧은 안내 · 글꼴 세대 · 아틀라스 · 해상도 중 하나라도 바뀐 프레임에만 다시 계산
//  - BaseRefreshPacer: 안개 그림이 바뀐 프레임에는 미루고 다음 프레임에 그린다(앞 프레임도 바뀌었으면 바로). 바뀐 그림을 놓치지 않는다
//  - 위치 표시가 사라지는 시간(HINT_FADE_MS) = style.css 전환 시간
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ICONS, type IconId } from '../../client/src/art/icons';
import type { SurvivorShapeId } from '../../client/src/art/shapes';
import { ACCENTS, FR, TICKS, type Accent } from '../../client/src/ui/hudArt';
import { BaseRefreshPacer, HudGate, dropEnded, dropStale } from '../../client/src/ui/hudGate';
import { textBoxSize, type TextBoxStyle } from '../../client/src/ui/textSize';
import { HINT_FADE_MS } from '../../client/src/ui/touchControls';

/** 옛 FR (렌더링 최적화 2 전 hudArt.ts 그대로) */
const OLD_FR = {
  icon: (id: IconId, color: number, size: number): string => `i:${id}:${color.toString(16)}:${size}`,
  tick: (a: Accent, i: number): string => `t:${a}:${i}`,
  ring: (a: Accent | 'off'): string => `r:${a}`,
  sil: (s: SurvivorShapeId, on: boolean): string => `s:${s}:${on ? 1 : 0}`,
  glyph: (g: string, size: number): string => `g:${g}:${size}`,
  mm: (k: string): string => `m:${k}`,
};

/** 작은 결정적 난수 (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('프레임 이름 표 · 기억 = 옛 템플릿', () => {
  const ids = Object.keys(ICONS) as IconId[];
  const accents: Accent[] = [...ACCENTS, 'warn'];

  it('아이콘: 모든 아이콘 × 색 × 크기 (정수 · 소수 · 큰 크기 · 두 번째 호출)', () => {
    const r = rng(1);
    const colors = [
      0,
      1,
      0xffffff,
      0x22d3ee,
      0x3b4b5c,
      0x0e7490,
      ...Array.from({ length: 30 }, () => Math.floor(r() * 0x1000000)),
    ];
    const sizes = [0, 1, 16, 18, 20, 24, 26, 32, 1023, 1024, 4096, 16.5, 0.25];
    let n = 0;
    for (let pass = 0; pass < 2; pass += 1)
      for (const id of ids)
        for (const c of colors)
          for (const s of sizes) {
            expect(FR.icon(id, c, s)).toBe(OLD_FR.icon(id, c, s));
            n += 1;
          }
    // 소수 · 음수 색도 (기억하지 않고 옛 식 그대로)
    for (const id of ids) {
      expect(FR.icon(id, 12.5, 20)).toBe(OLD_FR.icon(id, 12.5, 20));
      expect(FR.icon(id, -1, 20)).toBe(OLD_FR.icon(id, -1, 20));
    }
    expect(n).toBeGreaterThan(1000);
  });

  it('눈금 · 링: 모든 강조색 × 눈금 (범위 밖 포함)', () => {
    for (const a of accents) {
      for (let i = -3; i < TICKS + 5; i += 1) expect(FR.tick(a, i)).toBe(OLD_FR.tick(a, i));
      expect(FR.tick(a, 1.5)).toBe(OLD_FR.tick(a, 1.5));
      expect(FR.ring(a)).toBe(OLD_FR.ring(a));
    }
    expect(FR.ring('off')).toBe(OLD_FR.ring('off'));
  });

  it('실루엣 · 미니맵 · 문양', () => {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const s of ['runner', 'guard', 'scout', 'hidden'] as const)
        for (const on of [true, false]) expect(FR.sil(s, on)).toBe(OLD_FR.sil(s, on));
      for (const k of [
        'point',
        'prison',
        'exit',
        'track',
        'roarSelf',
        'roarPing',
        'monster',
        'self',
        'hidden',
        'runner',
        'guard',
        'scout',
        '',
      ])
        expect(FR.mm(k)).toBe(OLD_FR.mm(k));
      for (const g of ['runner', 'monster', 'hidden'] as const)
        expect(FR.glyph(g, 22)).toBe(OLD_FR.glyph(g, 22));
    }
  });
});

describe('배너 알림 거르기 = 옛 filter', () => {
  it('끝난 알림 · 오래 기다린 알림 (무작위 목록 2000개, 같은 객체 · 같은 순서)', () => {
    const r = rng(7);
    for (let k = 0; k < 2000; k += 1) {
      const n = Math.floor(r() * 7);
      const now = 1000 + Math.floor(r() * 50) * 100;
      const list = Array.from({ length: n }, (_, i) => ({
        i,
        until: now + Math.floor((r() - 0.5) * 20) * 100,
        created: now - Math.floor(r() * 90) * 100,
      }));
      const a = list.slice();
      dropEnded(a, now);
      expect(a).toEqual(list.filter((b) => b.until > now));
      a.forEach((v, j) => expect(v).toBe(list.filter((b) => b.until > now)[j]));
      const q = list.slice();
      dropStale(q, now, 6000);
      expect(q).toEqual(list.filter((b) => now - b.created <= 6000));
    }
  });
});

describe('글자 자연 크기 = Phaser GetTextSize + 여백', () => {
  // Phaser 원본 (CommonJS, 의존성 없음)
  const require = createRequire(import.meta.url);
  type PhaserText = {
    canvas: object;
    context: { measureText(s: string): { width: number } };
    style: { maxLines: number; strokeThickness: number; wordWrap?: boolean; syncFont(): void };
    letterSpacing: number;
    lineSpacing: number;
  };
  const GetTextSize = require('../../node_modules/phaser/src/gameobjects/text/GetTextSize.js') as (
    t: PhaserText,
    size: { fontSize: number },
    lines: string[],
  ) => { width: number; height: number };

  it('무작위 글 · 글꼴 크기 · 획 · 글자 간격 · 줄 간격 · 줄 수 제한 · 여백 3000가지', () => {
    const r = rng(11);
    // 글자마다 다른 소수 폭 (measureText 흉내: 같은 글이면 같은 폭)
    const glyphW = new Map<string, number>();
    const measure = (s: string): number => {
      let w = 0;
      for (const ch of s) {
        let g = glyphW.get(ch);
        if (g === undefined) {
          g = 3 + r() * 14;
          glyphW.set(ch, g);
        }
        w += g;
      }
      return w;
    };
    const alphabet = ['0', '1', '9', ':', 'A', 'm', ' ', '…', '생', '존', '자', '괴', '물', '%', '·', '\n'];
    for (let k = 0; k < 3000; k += 1) {
      const len = Math.floor(r() * 16);
      let text = '';
      for (let i = 0; i < len; i += 1) text += alphabet[Math.floor(r() * alphabet.length)];
      const lines = text.split(/(?:\r\n|\r|\n)/);
      const st: TextBoxStyle = {
        fontSize: [12, 15, 18, 22.5, 40][Math.floor(r() * 5)] ?? 15,
        strokeThickness: r() < 0.2 ? Math.floor(r() * 4) : 0,
        maxLines: r() < 0.2 ? Math.floor(r() * 3) : 0,
        wordWrap: r() < 0.1,
        letterSpacing: r() < 0.2 ? r() * 3 - 1 : 0,
        lineSpacing: r() < 0.3 ? Math.floor(r() * 8) : 0,
        padding: { left: Math.floor(r() * 3), right: r() < 0.5 ? 0 : 2, top: r() < 0.5 ? 0 : 1.5, bottom: 0 },
      };
      const fake: PhaserText = {
        canvas: {},
        context: { measureText: (s) => ({ width: measure(s) }) },
        style: {
          maxLines: st.maxLines,
          strokeThickness: st.strokeThickness,
          wordWrap: st.wordWrap,
          syncFont() {},
        },
        letterSpacing: st.letterSpacing,
        lineSpacing: st.lineSpacing,
      };
      const ref = GetTextSize(fake, { fontSize: st.fontSize }, lines.slice());
      const p = st.padding;
      const got = textBoxSize(lines, measure, st);
      // Phaser updateText: width = textSize.width + padding.left + padding.right (같은 덧셈 순서)
      expect(got.width).toBe(ref.width + (p.left ?? 0) + (p.right ?? 0));
      expect(got.height).toBe(ref.height + (p.top ?? 0) + (p.bottom ?? 0));
    }
  });
});

describe('HudGate', () => {
  it('처음은 다시 계산, 같은 입력이면 건너뛰고, 다섯 입력 중 하나라도 바뀌면 다시 계산', () => {
    const g = new HudGate();
    const a = {};
    const b = {};
    expect(g.fresh(a, '', 1, 'hud1', 1)).toBe(true);
    expect(g.fresh(a, '', 1, 'hud1', 1)).toBe(false);
    expect(g.fresh(a, '', 1, 'hud1', 1)).toBe(false);
    expect(g.fresh(b, '', 1, 'hud1', 1)).toBe(true);
    expect(g.fresh(b, '범위 밖', 1, 'hud1', 1)).toBe(true);
    expect(g.fresh(b, '범위 밖', 1, 'hud1', 1)).toBe(false);
    expect(g.fresh(b, '', 1, 'hud1', 1)).toBe(true);
    expect(g.fresh(b, '', 2, 'hud1', 1)).toBe(true);
    expect(g.fresh(b, '', 2, 'hud2', 1)).toBe(true);
    expect(g.fresh(b, '', 2, 'hud2', 1.5)).toBe(true);
    expect(g.fresh(b, '', 2, 'hud2', 1.5)).toBe(false);
    g.reset();
    expect(g.fresh(b, '', 2, 'hud2', 1.5)).toBe(true);
    // 내용이 같아도 다른 스냅샷 객체면 다시 계산한다 (서버 · 연습 서버는 스냅샷마다 새 객체)
    expect(g.fresh({}, '', 2, 'hud2', 1.5)).toBe(true);
  });
});

describe('BaseRefreshPacer (미니맵 바닥)', () => {
  /** 옛 규칙: 바뀐 프레임 · 다시 보인 프레임에 바로 그린다 */
  const oldDraw = (changed: boolean, now: boolean): boolean => changed || now;

  it('60fps · 안개 20Hz: 바뀐 다음 프레임에 그리고, 바뀐 프레임에는 그리지 않는다', () => {
    const p = new BaseRefreshPacer();
    const frames = [true, false, false, true, false, false, true, false, false];
    const draws = frames.map((c) => p.frame(c, false));
    expect(draws).toEqual([false, true, false, false, true, false, false, true, false]);
    expect(p.waiting).toBe(false);
  });

  it('120fps · 안개 20Hz: 바뀐 다음 프레임 한 번', () => {
    const p = new BaseRefreshPacer();
    const draws: boolean[] = [];
    for (let i = 0; i < 24; i += 1) draws.push(p.frame(i % 6 === 0, false));
    expect(draws.map((d, i) => (d ? i : -1)).filter((i) => i >= 0)).toEqual([1, 7, 13, 19]);
  });

  it('프레임이 안개 주기보다 느리면(매 프레임 바뀜) 둘째 프레임부터 매 프레임 그린다 (예전과 같은 빈도)', () => {
    const p = new BaseRefreshPacer();
    const draws = Array.from({ length: 8 }, () => p.frame(true, false));
    expect(draws).toEqual([false, true, true, true, true, true, true, true]);
  });

  it('숨겼다 다시 보이면(now) 바로 그리고 미룬 것도 지운다', () => {
    const p = new BaseRefreshPacer();
    expect(p.frame(true, false)).toBe(false);
    expect(p.waiting).toBe(true);
    expect(p.frame(false, true)).toBe(true);
    expect(p.waiting).toBe(false);
    expect(p.frame(false, false)).toBe(false);
    expect(p.frame(true, true)).toBe(true);
  });

  it('무작위 순서 5000프레임: 바뀐 그림을 놓치지 않고(늦어도 다음 프레임), 바뀐 프레임에 그리는 것은 앞 프레임도 바뀌었을 때뿐, 그리는 횟수는 옛 규칙 이하', () => {
    const r = rng(23);
    const p = new BaseRefreshPacer();
    let oldCount = 0;
    let newCount = 0;
    /** 아직 그리지 않은 바뀐 그림이 생긴 프레임 */
    let owedSince: number | null = null;
    let prev = false;
    for (let i = 0; i < 5000; i += 1) {
      const changed = r() < 0.35;
      const now = r() < 0.01;
      const draw = p.frame(changed, now);
      if (oldDraw(changed, now)) oldCount += 1;
      if (draw) newCount += 1;
      if (changed && draw && !now) expect(prev, `프레임 ${i}`).toBe(true);
      if (changed && owedSince === null && !draw) owedSince = i;
      if (draw) owedSince = null;
      // 바뀐 그림은 늦어도 다음 프레임에 그린다
      if (owedSince !== null) expect(i - owedSince, `프레임 ${i}`).toBeLessThanOrEqual(1);
      expect(p.waiting).toBe(owedSince !== null);
      prev = changed;
    }
    expect(newCount).toBeLessThanOrEqual(oldCount);
    expect(newCount).toBeGreaterThan(0);
  });
});

describe('터치 위치 표시가 사라지는 시간', () => {
  it('HINT_FADE_MS = style.css .tc-hints.gone 전환 시간 (그 뒤 display: none)', () => {
    const css = readFileSync('client/src/style.css', 'utf8');
    const gone = /\.tc-hints\.gone\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const sec = Number(/opacity\s+([\d.]+)s/.exec(gone)?.[1]);
    expect(sec * 1000).toBe(HINT_FADE_MS);
    expect(/visibility\s+0s\s+([\d.]+)s/.exec(gone)?.[1]).toBe(String(sec));
    expect(/\.tc-hints\.idle\s*\{[^}]*display:\s*none/.test(css)).toBe(true);
  });
});
