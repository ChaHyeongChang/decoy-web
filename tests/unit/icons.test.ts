// UI 아이콘 (M10c, VISUAL_SPEC 10장): id 유일, 경로가 24 격자 안, iconSvg 결과에 스크립트 · 외부 참조 없음,
// HUD 아틀라스가 쓰는 아이콘은 모두 있다
import { describe, expect, it } from 'vitest';
import { ICONS, ICON_GRID, iconSvg, type IconId } from '../../client/src/art/icons';
import { hudSpecs } from '../../client/src/ui/hudArt';

type Pt = [number, number];

/** SVG 경로의 모든 점(끝점 · 조절점, 호는 실제 원호 위 점)을 절대 좌표로 (M L H V C S Q T A Z, 대소문자) */
function pathPoints(d: string): Pt[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const out: Pt[] = [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const num = (): number => {
    const t = tokens[i++];
    if (t === undefined || /[a-zA-Z]/.test(t)) throw new Error(`숫자가 아님: ${d}`);
    return Number(t);
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (t && /[a-zA-Z]/.test(t)) {
      cmd = t;
      i += 1;
      if (cmd === 'z' || cmd === 'Z') {
        x = sx;
        y = sy;
        continue;
      }
    }
    const rel = cmd === cmd.toLowerCase();
    const bx = rel ? x : 0;
    const by = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
      case 'L':
      case 'T': {
        x = bx + num();
        y = by + num();
        if (cmd.toUpperCase() === 'M') {
          sx = x;
          sy = y;
          cmd = rel ? 'l' : 'L';
        }
        out.push([x, y]);
        break;
      }
      case 'H':
        x = bx + num();
        out.push([x, y]);
        break;
      case 'V':
        y = by + num();
        out.push([x, y]);
        break;
      case 'C':
      case 'S':
      case 'Q': {
        const n = cmd.toUpperCase() === 'C' ? 3 : 2;
        for (let k = 0; k < n; k += 1) {
          const px = bx + num();
          const py = by + num();
          out.push([px, py]);
          if (k === n - 1) {
            x = px;
            y = py;
          }
        }
        break;
      }
      case 'A': {
        const rx = Math.abs(num());
        const ry = Math.abs(num());
        num();
        const large = num();
        const sweep = num();
        const ex = bx + num();
        const ey = by + num();
        out.push(...arcPoints(x, y, rx, ry, large !== 0, sweep !== 0, ex, ey));
        x = ex;
        y = ey;
        break;
      }
      default:
        throw new Error(`모르는 명령 ${cmd}: ${d}`);
    }
  }
  return out;
}

/** 축 정렬 타원호 (회전 없음)의 점들 (SVG 끝점 → 중심 변환) */
function arcPoints(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): Pt[] {
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const lam = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx;
  const den = rx * rx * dy * dy + ry * ry * dx * dx;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx = k * ((rx * dy) / ry) + (x1 + x2) / 2;
  const cy = k * (-(ry * dx) / rx) + (y1 + y2) / 2;
  const a1 = Math.atan2((y1 - cy) / ry, (x1 - cx) / rx);
  let da = Math.atan2((y2 - cy) / ry, (x2 - cx) / rx) - a1;
  if (sweep && da < 0) da += Math.PI * 2;
  if (!sweep && da > 0) da -= Math.PI * 2;
  const pts: Pt[] = [];
  for (let i = 1; i <= 24; i += 1) {
    const a = a1 + (da * i) / 24;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

const ids = Object.keys(ICONS) as IconId[];

describe('UI 아이콘', () => {
  it('id가 겹치지 않고 모든 아이콘에 경로가 있다', () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(33);
    for (const id of ids) expect(ICONS[id].length, id).toBeGreaterThan(0);
  });

  it('모든 경로가 24 격자 안 (선 두께를 빼고 0~24)', () => {
    for (const id of ids)
      for (const part of ICONS[id]) {
        const pts = pathPoints(part.d);
        expect(pts.length, id).toBeGreaterThan(0);
        for (const [x, y] of pts) {
          expect(x, `${id} x`).toBeGreaterThanOrEqual(-1e-6);
          expect(x, `${id} x`).toBeLessThanOrEqual(ICON_GRID + 1e-6);
          expect(y, `${id} y`).toBeGreaterThanOrEqual(-1e-6);
          expect(y, `${id} y`).toBeLessThanOrEqual(ICON_GRID + 1e-6);
        }
      }
  });

  it('iconSvg: svg · path만, 스크립트 · 외부 참조 · 이벤트 속성 없음, 이름은 이스케이프', () => {
    for (const id of ids) {
      const svg = iconSvg(id, 24, `"<${id}>"`);
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg.match(/<(\w+)/g)?.every((t) => t === '<svg' || t === '<path')).toBe(true);
      expect(svg).not.toMatch(/script|href|url\(|\bon\w+=|<foreignObject|<image|<use/i);
      expect(svg).toContain('aria-label="&quot;&lt;');
    }
    expect(iconSvg('eye')).toContain('aria-hidden="true"');
  });

  it('HUD 아틀라스가 쓰는 아이콘은 모두 있다', () => {
    const used = hudSpecs()
      .map((s) => /^i:([^:]+):/.exec(s.name)?.[1])
      .filter((x): x is string => x !== undefined);
    expect(used.length).toBeGreaterThan(20);
    for (const id of used) expect(ids, id).toContain(id);
  });
});
