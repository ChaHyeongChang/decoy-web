import { describe, expect, it } from 'vitest';
import {
  DEG,
  inCircleVision,
  lineOfSight,
  monsterConePolygon,
  monsterConeShape,
  monsterSees,
  pointInPolygon,
  survivorVisionPolygon,
  survivorVisionRadius,
} from '@decoy/shared';
import { loadTestBalance } from '../helpers/fixtures';

const b = loadTestBalance();

describe('시야 판정 (shared/visibility.ts)', () => {
  it('벽 뒤 대상은 보이지 않는다', () => {
    // 타일 19–20 × 8–11 벽을 사이에 둔 두 점
    const a = { x: 17.5, y: 9.5 };
    const c = { x: 22.5, y: 9.5 };
    expect(lineOfSight(a, c)).toBe(false);
    expect(inCircleVision(a, 6, c)).toBe(false);
    // 벽 아래로 돌아가면 보인다
    expect(inCircleVision({ x: 17.5, y: 12.5 }, 6, { x: 22.5, y: 12.5 })).toBe(true);
  });

  it('철창과 감옥 문은 시야를 막지 않는다 (수감 중에도 주변을 본다)', () => {
    const inside = { x: 24, y: 16 };
    expect(inCircleVision(inside, 6, { x: 24, y: 20 })).toBe(true);
    expect(inCircleVision(inside, 6, { x: 20, y: 16 })).toBe(true);
  });

  it('원형 시야 반경은 하드 컷 (6타일, 스카우트 7.5타일)', () => {
    const eye = { x: 20.5, y: 18.5 };
    expect(inCircleVision(eye, survivorVisionRadius(b, 'runner'), { x: 26.49, y: 18.5 })).toBe(true);
    expect(inCircleVision(eye, survivorVisionRadius(b, 'runner'), { x: 26.51, y: 18.5 })).toBe(false);
    expect(inCircleVision(eye, survivorVisionRadius(b, 'scout'), { x: 27.9, y: 18.5 })).toBe(true);
  });

  it('부채꼴 경계: 탐색 110° · 5타일 / 추적 50° · 9타일', () => {
    const eye = { x: 20.5, y: 18.5 };
    const at = (deg: number, r: number) => ({
      x: eye.x + Math.cos(deg * DEG) * r,
      y: eye.y + Math.sin(deg * DEG) * r,
    });
    // 탐색: 반각 55°
    expect(monsterSees(b, eye, 0, 0, at(54, 4))).toBe(true);
    expect(monsterSees(b, eye, 0, 0, at(56, 4))).toBe(false);
    expect(monsterSees(b, eye, 0, 0, at(0, 4.99))).toBe(true);
    expect(monsterSees(b, eye, 0, 0, at(0, 5.01))).toBe(false);
    // 추적: 반각 25°, 9타일 (거점 B 방 안쪽, 막힘 없는 곳)
    const eye2 = { x: 34.5, y: 12 };
    const at2 = (deg: number, r: number) => ({
      x: eye2.x + Math.cos(deg * DEG) * r,
      y: eye2.y + Math.sin(deg * DEG) * r,
    });
    expect(monsterSees(b, eye2, 0, 1, at2(24, 8.9))).toBe(true);
    expect(monsterSees(b, eye2, 0, 1, at2(26, 8.9))).toBe(false);
    expect(monsterSees(b, eye2, 0, 1, at2(0, 8.99))).toBe(true);
    expect(monsterSees(b, eye2, 0, 1, at2(0, 9.01))).toBe(false);
  });

  it('근접 원(1.5타일)은 등 뒤도 본다', () => {
    const eye = { x: 20.5, y: 18.5 };
    expect(monsterSees(b, eye, 0, 0, { x: 19.1, y: 18.5 })).toBe(true);
    expect(monsterSees(b, eye, 0, 0, { x: 18.9, y: 18.5 })).toBe(false);
  });

  it('모드 전환 중에는 보간된 각도 · 거리로 판정한다 (0.2초 = 절반: 80°, 7타일)', () => {
    const half = monsterConeShape(b, 0.5);
    expect(half.arc / DEG).toBeCloseTo(80);
    expect(half.range).toBeCloseTo(7);
    const eye = { x: 20.5, y: 18.5 };
    expect(monsterSees(b, eye, 0, 0.5, { x: eye.x + 6.9, y: eye.y })).toBe(true);
    expect(monsterSees(b, eye, 0, 0.5, { x: eye.x + 7.1, y: eye.y })).toBe(false);
  });

  it('시야 다각형은 판정과 일치한다 (무작위 점 검사)', () => {
    let seed = 17;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const eye = { x: 24, y: 20.5 };
    const poly = survivorVisionPolygon(eye, 6);
    const cone = monsterConePolygon(b, eye, -Math.PI / 2, 1);
    let mismatch = 0;
    let checked = 0;
    for (let i = 0; i < 2000; i += 1) {
      const p = { x: eye.x + (rnd() * 2 - 1) * 9, y: eye.y + (rnd() * 2 - 1) * 9 };
      // 경계 근처(다각형 근사 오차)는 제외
      const d = Math.hypot(p.x - eye.x, p.y - eye.y);
      if (Math.abs(d - 6) < 0.1 || Math.abs(d - 9) < 0.1) continue;
      checked += 1;
      if (pointInPolygon(p, poly) !== inCircleVision(eye, 6, p)) mismatch += 1;
      if (
        pointInPolygon(p, cone) !== monsterSees(b, eye, -Math.PI / 2, 1, p) &&
        d > b.monster.nearVisionRadius + 0.1
      )
        mismatch += 1;
    }
    expect(checked).toBeGreaterThan(1500);
    expect(mismatch / checked).toBeLessThan(0.01);
  });

  it('시야 다각형 계산은 빠르다 (1ms 미만)', () => {
    const t0 = performance.now();
    for (let i = 0; i < 100; i += 1) survivorVisionPolygon({ x: 10 + (i % 20), y: 18.5 }, 7.5);
    expect((performance.now() - t0) / 100).toBeLessThan(1);
  });
});
