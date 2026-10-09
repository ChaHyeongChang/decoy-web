// 장식 입자 · 이벤트 효과 · 후처리 수식 (M10b, VISUAL_SPEC 7장 · 정보 우선 R4 · R5 · R9 · 상대 잔여 효과)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateBalance } from '../../shared/src/balance';
import { survivorVisionPolygon } from '../../shared/src/visibility';
import { circleIntersectsSector, pointInPolygon } from '../../shared/src/geometry';
import {
  DUST,
  FX_LIMITS,
  FX_PRESETS,
  FxSystem,
  POST,
  dustMotes,
  pickDissolveTarget,
  vignetteAt,
  type FxPen,
} from '../../client/src/art/fx';
import { PRESETS, QUALITY_TIERS } from '../../client/src/gfx/presets';

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));

/** 그리기 기록 펜 (경로마다 꼭짓점 수를 센다) */
function recorder(): FxPen & { alphas: number[]; widths: number[]; paths: number[] } {
  const alphas: number[] = [];
  const widths: number[] = [];
  const paths: number[] = [];
  return {
    alphas,
    widths,
    paths,
    fillStyle: (_c: number, a = 1) => alphas.push(a),
    lineStyle: (w: number, _c: number, a = 1) => {
      widths.push(w);
      alphas.push(a);
    },
    beginPath: () => paths.push(0),
    moveTo: () => {
      paths[paths.length - 1] = (paths[paths.length - 1] ?? 0) + 1;
    },
    lineTo: () => {
      paths[paths.length - 1] = (paths[paths.length - 1] ?? 0) + 1;
    },
    strokePath: () => undefined,
    fillPath: () => undefined,
    closePath: () => undefined,
  };
}

describe('효과 한도 (FX_LIMITS)', () => {
  it('장식 입자는 알파 0.2 이하 · 크기 2px 이하, 이벤트 효과는 0.4초 이하', () => {
    expect(FX_LIMITS.decorAlphaMax).toBeLessThanOrEqual(0.2);
    expect(FX_LIMITS.eventLifeMaxS).toBeLessThanOrEqual(0.4);
    expect(DUST.alpha).toBeLessThanOrEqual(FX_LIMITS.decorAlphaMax);
    expect(DUST.sizePx).toBeLessThanOrEqual(FX_LIMITS.decorSizeMaxPx);
    for (const [kind, p] of Object.entries(FX_PRESETS)) {
      expect(p.life, kind).toBeLessThanOrEqual(FX_LIMITS.eventLifeMaxS);
      if (p.decor) expect(p.alpha, kind).toBeLessThanOrEqual(FX_LIMITS.decorAlphaMax);
    }
    expect(FX_PRESETS.spark.count).toBeLessThanOrEqual(6);
    expect(FX_PRESETS.spark.life).toBeLessThanOrEqual(0.2);
  });

  it('품질별 개수: 먼지 높음 40 · 중간 15 · 낮음 0, 모두 particleCap 이하. 발먼지는 높음 · 중간만', () => {
    expect(FX_LIMITS.dust).toEqual({ high: 40, medium: 15, low: 0 });
    for (const t of QUALITY_TIERS) expect(FX_LIMITS.dust[t]).toBeLessThanOrEqual(PRESETS[t].particleCap);
    expect(FX_LIMITS.footDust).toEqual({ high: true, medium: true, low: false });
  });

  it('입자 시스템은 상한을 넘지 않고, 그린 장식 입자 알파도 0.2 이하', () => {
    for (const t of QUALITY_TIERS) {
      const cap = PRESETS[t].particleCap;
      const fx = new FxSystem(1, cap);
      for (let i = 0; i < 200; i += 1) fx.sparks(1, 1, 0.3, 0, null, false);
      expect(fx.count).toBeLessThanOrEqual(cap);
    }
    const fx = new FxSystem(2, 400);
    for (let i = 0; i < 20; i += 1) fx.footDust(3, 3, 0, null, false);
    const pen = recorder();
    fx.draw(pen, 0.01, 32);
    expect(pen.alphas.length).toBeGreaterThan(0);
    for (const a of pen.alphas) expect(a).toBeLessThanOrEqual(FX_LIMITS.decorAlphaMax);
  });

  it('수명이 끝나면 사라지고, 출처가 스냅샷에서 사라진 상대 효과는 그 프레임에 0', () => {
    const fx = new FxSystem(3, 400);
    fx.footDust(5, 5, 0, 'monster', true);
    fx.ring('impact', 5, 5, 1, 0, 'monster', true);
    fx.sparks(2, 2, 0.3, 0, null, false);
    expect(fx.oppCount).toBeGreaterThan(0);
    fx.pruneSources(new Set());
    expect(fx.oppCount).toBe(0);
    expect(fx.count).toBe(FX_PRESETS.spark.count);
    fx.update(FX_PRESETS.spark.life + 0.001, new Set());
    expect(fx.count).toBe(0);
  });

  it('같은 시드 · 같은 순서면 같은 입자 (Math.random을 쓰지 않는다)', () => {
    const draw = (): number[] => {
      const fx = new FxSystem(7, 400);
      fx.sparks(4, 4, 0.3, 0, null, false);
      fx.dissolve(4, 4, 0.3, 0, null, false);
      const xs: number[] = [];
      const pen = {
        ...recorder(),
        moveTo: (x: number, y: number) => xs.push(x, y),
      };
      fx.draw(pen, 0.05, 32);
      return xs;
    };
    expect(draw()).toEqual(draw());
  });
});

describe('매 프레임 그리는 점 · 고리는 반지름에 맞춘 다각형 (Phaser 원호 100분할을 쓰지 않는다)', () => {
  it('발먼지 · 흩어짐 점은 12각, 충격파 고리도 96각 이하', () => {
    const fx = new FxSystem(5, 400);
    fx.footDust(3, 3, 0, null, false);
    fx.dissolve(4, 4, 0.3, 0, null, false);
    const dots = recorder();
    fx.draw(dots, 0.05, 32);
    expect(dots.paths.length).toBeGreaterThan(0);
    // 온원 = 시작점 + 12분할 → 꼭짓점 13개
    for (const n of dots.paths) expect(n).toBe(13);
    const rings = new FxSystem(6, 400);
    rings.ring('shockwave', 5, 5, 2, 0, null, false);
    const pen = recorder();
    rings.draw(pen, 0.2, 32);
    for (const n of pen.paths) {
      expect(n).toBeGreaterThanOrEqual(13);
      expect(n).toBeLessThanOrEqual(97);
    }
  });
});

describe('괴물 화면 수감 흩어짐 자리 (타격 부채꼴 안의 후보만)', () => {
  const atk = { range: balance.monster.attack.range, arc: (balance.monster.attack.arc * Math.PI) / 180 };
  const r = balance.survivor.radius;
  const hit = { x: 42, y: 12, dir: Math.PI, hits: 1 };

  it('같은 순간 시야를 벗어난 다른 생존자(공격 부채꼴 밖)는 고르지 않는다 (검토 장면: 괴물 옆 0.75타일 가드)', () => {
    const runner = { id: 'r', x: 41, y: 12 };
    const guard = { id: 'g', x: 42, y: 12.75 };
    expect(pickDissolveTarget([guard, runner], hit, atk, r)?.id).toBe('r');
    expect(pickDissolveTarget([runner, guard], hit, atk, r)?.id).toBe('r');
    // 맞은 사람이 후보에 없으면 (가드만 사라짐) 연출 생략
    expect(pickDissolveTarget([guard], hit, atk, r)).toBeNull();
  });

  it('타격이 없거나 빗나갔으면(hits = 0) 생략, 고른 후보는 늘 서버 타격 모양(+여유) 안', () => {
    const runner = { id: 'r', x: 41, y: 12 };
    expect(pickDissolveTarget([runner], null, atk, r)).toBeNull();
    expect(pickDissolveTarget([runner], { ...hit, hits: 0 }, atk, r)).toBeNull();
    // 격자 위 후보들: 고른 것은 늘 부채꼴(범위 + 몸 반지름 + 여유)과 겹친다. 부채꼴 안 후보가 있으면 반드시 고른다
    const sector = { dir: hit.dir, arc: atk.arc, range: atk.range };
    for (let y = 10; y <= 14; y += 0.25)
      for (let x = 39.5; x <= 44.5; x += 0.25) {
        const c = { id: `${x},${y}`, x, y };
        const pick = pickDissolveTarget([c], hit, atk, r);
        const inside = circleIntersectsSector(hit, sector, c, r);
        if (inside) expect(pick, c.id).not.toBeNull();
        if (pick) expect(circleIntersectsSector(hit, sector, c, r + 0.1), c.id).toBe(true);
        // 뒤쪽 (조준 반대편 1타일 넘게)은 절대 고르지 않는다
        if (x > 43) expect(pick, c.id).toBeNull();
      }
  });

  it('여럿이면 조준 방향에 가까운 것', () => {
    const a = { id: 'a', x: 41.2, y: 12.5 };
    const b = { id: 'b', x: 41.1, y: 12.02 };
    expect(pickDissolveTarget([a, b], hit, atk, r)?.id).toBe('b');
  });
});

describe('빛 속 먼지', () => {
  const eye = { x: 10.5, y: 10.5 };
  const poly = survivorVisionPolygon(eye, 6);
  const eyes = [{ poly, center: eye, radius: 4.8 }];

  it('자기 팀 시야(판정 다각형) 안에만, 품질 개수 이하', () => {
    for (let t = 0; t < 20; t += 1.7) {
      const m = dustMotes(t, eyes, 40);
      expect(m.length).toBeLessThanOrEqual(40);
      for (const d of m) {
        expect(pointInPolygon(d, poly)).toBe(true);
        expect(d.alpha).toBeLessThanOrEqual(FX_LIMITS.decorAlphaMax);
        expect(d.size).toBeLessThanOrEqual(FX_LIMITS.decorSizeMaxPx);
      }
    }
    expect(dustMotes(3, eyes, 0)).toEqual([]);
    expect(dustMotes(3, [], 40)).toEqual([]);
  });

  it('시계만의 함수: 같은 시각이면 같은 자리 (시계를 멈추면 멈춘다)', () => {
    expect(dustMotes(12.5, eyes, 40)).toEqual(dustMotes(12.5, eyes, 40));
    expect(dustMotes(12.5, eyes, 15)).toEqual(dustMotes(12.5, eyes, 40).slice(0, 15));
  });
});

describe('후처리 수식', () => {
  it('비네트는 맵 모서리에서만 (최대 0.3), 맵 가운데 · 가장자리 중간 · 안개 탐침 자리는 0', () => {
    expect(vignetteAt(0, 0)).toBe(0);
    expect(vignetteAt(1, 0)).toBeLessThan(0.01);
    expect(vignetteAt(0, 1)).toBeLessThan(0.01);
    expect(vignetteAt(1, 1)).toBeCloseTo(POST.vignetteMax, 6);
    expect(POST.vignetteMax).toBeLessThanOrEqual(0.3);
    // m10-fog 탐침 (21.5, 27.5) · (17.5, 27.5): 맵 48 × 32 정규화
    for (const [x, y] of [
      [21.5, 27.5],
      [17.5, 27.5],
    ] as const)
      expect(vignetteAt((x / 48) * 2 - 1, (y / 32) * 2 - 1)).toBe(0);
  });

  it('색보정 그늘 기울기는 밝기(Rec.709 가중 합)를 바꾸지 않는다', () => {
    const [r, g, b] = POST.shadowTone;
    expect(Math.abs(0.2126 * r + 0.7152 * g + 0.0722 * b)).toBeLessThan(1e-4);
  });
});
