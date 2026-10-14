// 새 캐릭터 그림 도구 (캐릭터 리디자인). 캐릭터는 "그림 명령 목록"(Drawing)으로 그린다: 명령마다 SVG 경로 문자열 + 채움 ·
// 선. 같은 목록에서 SVG 문자열(로비 · 결과 DOM, 시안 그림)과 Canvas2D 그림(텍스처 아틀라스 굽기)을 만든다.
// 순수 모듈: DOM · Phaser를 import하지 않는다 (Canvas는 최소 인터페이스 CanvasSink로 받는다).
//
// 좌표 단위: 위에서 본 게임 그림은 몸 반지름 1(판정 반지름), 원점 = 몸 중심, +x = 바라보는 방향, +y = 화면 아래.
// 정면 그림은 상자 [−1, 1]² (+y 아래). 외곽선 두께도 같은 단위로 받는다(굽는 쪽이 월드 px → 단위로 바꿔 넘긴다).

/** 색 정지점: [위치 0~1, 색 0xRRGGBB, 알파] */
export type Stop = readonly [number, number, number?];

/** 칠 */
export type Paint =
  | { readonly kind: 'solid'; readonly color: number; readonly alpha?: number }
  | {
      readonly kind: 'linear';
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly stops: readonly Stop[];
    }
  | {
      readonly kind: 'radial';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      /** 초점 (없으면 중심) */
      readonly fx?: number;
      readonly fy?: number;
      readonly stops: readonly Stop[];
    };

/** 그림 명령 하나 */
export interface Op {
  /** SVG path d (단위 좌표) */
  readonly d: string;
  readonly fill?: Paint;
  readonly stroke?: {
    readonly paint: Paint;
    readonly width: number;
    readonly cap?: 'butt' | 'round';
    readonly join?: 'round' | 'miter';
  };
  readonly rule?: 'nonzero' | 'evenodd';
  /** 명령 전체 알파 */
  readonly alpha?: number;
}

/** 그림 = 명령 목록 (앞에서부터 그린다) */
export interface Drawing {
  readonly ops: readonly Op[];
}

export function solid(color: number, alpha?: number): Paint {
  return alpha === undefined ? { kind: 'solid', color } : { kind: 'solid', color, alpha };
}

export function linear(x0: number, y0: number, x1: number, y1: number, stops: readonly Stop[]): Paint {
  return { kind: 'linear', x0, y0, x1, y1, stops };
}

export function radial(
  cx: number,
  cy: number,
  r: number,
  stops: readonly Stop[],
  fx?: number,
  fy?: number,
): Paint {
  return fx === undefined || fy === undefined
    ? { kind: 'radial', cx, cy, r, stops }
    : { kind: 'radial', cx, cy, r, stops, fx, fy };
}

// ───────────────────────── 색 ─────────────────────────

/** 두 색 섞기 (k = 0이면 a, 1이면 b) */
export function mix(a: number, b: number, k: number): number {
  let out = 0;
  for (const s of [16, 8, 0]) {
    const v = Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
    out |= Math.max(0, Math.min(255, v)) << s;
  }
  return out;
}

/** 어둡게 (k = 검정 쪽 비율) */
export const shade = (c: number, k: number): number => mix(c, 0x000000, k);
/** 밝게 (k = 흰색 쪽 비율) */
export const tint = (c: number, k: number): number => mix(c, 0xffffff, k);

export function hex(c: number): string {
  return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
}

function rgba(c: number, a = 1): string {
  return a >= 1 ? hex(c) : `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${round(a, 3)})`;
}

function round(v: number, digits: number): number {
  const m = 10 ** digits;
  const r = Math.round(v * m) / m;
  return Object.is(r, -0) ? 0 : r;
}

// ───────────────────────── 경로 만들기 ─────────────────────────

/** 2D 아핀 변환 [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (SVG matrix 순서) */
export type Mat = readonly [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y];
}

export function rotate(a: number): Mat {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, -s, c, 0, 0];
}

export function scale(sx: number, sy = sx): Mat {
  return [sx, 0, 0, sy, 0, 0];
}

/** 점 (x, y)를 중심으로 a만큼 돌린 변환 */
export function rotateAbout(a: number, x: number, y: number): Mat {
  return mul(translate(x, y), mul(rotate(a), translate(-x, -y)));
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const K_ARC = 0.5522847498;

/**
 * 경로 빌더: 점은 모두 지금 변환(m)으로 옮겨 d 문자열에 쓴다. 원 · 타원 · 호는 3차 베지어로 펴서
 * 비균등 변환에서도 모양이 맞다
 */
export class Path {
  private parts: string[] = [];
  private cx = 0;
  private cy = 0;

  constructor(private m: Mat = IDENTITY) {}

  private p(x: number, y: number): string {
    const [X, Y] = apply(this.m, x, y);
    return `${round(X, 3)} ${round(Y, 3)}`;
  }

  /** 이후 점에 변환을 더 곱한다 (지금 변환 × t) */
  with(t: Mat): this {
    this.m = mul(this.m, t);
    return this;
  }

  setMatrix(m: Mat): this {
    this.m = m;
    return this;
  }

  M(x: number, y: number): this {
    this.parts.push(`M${this.p(x, y)}`);
    this.cx = x;
    this.cy = y;
    return this;
  }

  L(x: number, y: number): this {
    this.parts.push(`L${this.p(x, y)}`);
    this.cx = x;
    this.cy = y;
    return this;
  }

  Q(x1: number, y1: number, x: number, y: number): this {
    // 2차를 3차로 올려 쓴다 (변환 뒤에도 같은 곡선)
    const c1x = this.cx + ((x1 - this.cx) * 2) / 3;
    const c1y = this.cy + ((y1 - this.cy) * 2) / 3;
    const c2x = x + ((x1 - x) * 2) / 3;
    const c2y = y + ((y1 - y) * 2) / 3;
    return this.C(c1x, c1y, c2x, c2y, x, y);
  }

  C(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.parts.push(`C${this.p(x1, y1)} ${this.p(x2, y2)} ${this.p(x, y)}`);
    this.cx = x;
    this.cy = y;
    return this;
  }

  Z(): this {
    this.parts.push('Z');
    return this;
  }

  /** 점 목록 다각형 (닫음) */
  poly(pts: readonly (readonly [number, number])[]): this {
    pts.forEach(([x, y], i) => (i === 0 ? this.M(x, y) : this.L(x, y)));
    return this.Z();
  }

  /** 점들을 지나는 매끄러운 닫힌 곡선 (Catmull-Rom → 베지어, tension 0~1) */
  smooth(pts: readonly (readonly [number, number])[], tension = 1): this {
    const n = pts.length;
    if (n < 3) return this.poly(pts);
    const at = (i: number): readonly [number, number] => pts[((i % n) + n) % n] ?? [0, 0];
    const p0 = at(0);
    this.M(p0[0], p0[1]);
    for (let i = 0; i < n; i += 1) {
      const a = at(i - 1);
      const b = at(i);
      const c = at(i + 1);
      const d = at(i + 2);
      const t = tension / 6;
      this.C(
        b[0] + (c[0] - a[0]) * t,
        b[1] + (c[1] - a[1]) * t,
        c[0] - (d[0] - b[0]) * t,
        c[1] - (d[1] - b[1]) * t,
        c[0],
        c[1],
      );
    }
    return this.Z();
  }

  /** 열린 매끄러운 곡선 (Catmull-Rom, 양 끝은 끝점 반복) */
  curve(pts: readonly (readonly [number, number])[], tension = 1, move = true): this {
    const n = pts.length;
    if (n === 0) return this;
    const at = (i: number): readonly [number, number] => pts[Math.max(0, Math.min(n - 1, i))] ?? [0, 0];
    const p0 = at(0);
    if (move) this.M(p0[0], p0[1]);
    else this.L(p0[0], p0[1]);
    for (let i = 0; i + 1 < n; i += 1) {
      const a = at(i - 1);
      const b = at(i);
      const c = at(i + 1);
      const d = at(i + 2);
      const t = tension / 6;
      this.C(
        b[0] + (c[0] - a[0]) * t,
        b[1] + (c[1] - a[1]) * t,
        c[0] - (d[0] - b[0]) * t,
        c[1] - (d[1] - b[1]) * t,
        c[0],
        c[1],
      );
    }
    return this;
  }

  /** 타원 (닫힌 경로, 시계 방향). rot = 타원 자체 회전 */
  ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0): this {
    const save = this.m;
    this.m = mul(this.m, mul(translate(cx, cy), rotate(rot)));
    const k = K_ARC;
    this.M(rx, 0)
      .C(rx, ry * k, rx * k, ry, 0, ry)
      .C(-rx * k, ry, -rx, ry * k, -rx, 0)
      .C(-rx, -ry * k, -rx * k, -ry, 0, -ry)
      .C(rx * k, -ry, rx, -ry * k, rx, 0)
      .Z();
    this.m = save;
    return this;
  }

  circle(cx: number, cy: number, r: number): this {
    return this.ellipse(cx, cy, r, r);
  }

  /** 원호 (a0 → a1, 라디안). move = false면 지금 점에서 선으로 잇는다 */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, move = true, ry = r): this {
    const span = a1 - a0;
    const n = Math.max(1, Math.ceil(Math.abs(span) / (Math.PI / 2) - 1e-9));
    const step = span / n;
    const k = (4 / 3) * Math.tan(step / 4);
    let a = a0;
    const sx = cx + Math.cos(a) * r;
    const sy = cy + Math.sin(a) * ry;
    if (move) this.M(sx, sy);
    else this.L(sx, sy);
    for (let i = 0; i < n; i += 1) {
      const b = a + step;
      const x0 = cx + Math.cos(a) * r;
      const y0 = cy + Math.sin(a) * ry;
      const x3 = cx + Math.cos(b) * r;
      const y3 = cy + Math.sin(b) * ry;
      this.C(
        x0 - Math.sin(a) * r * k,
        y0 + Math.cos(a) * ry * k,
        x3 + Math.sin(b) * r * k,
        y3 - Math.cos(b) * ry * k,
        x3,
        y3,
      );
      a = b;
    }
    return this;
  }

  /** 둥근 사각형 */
  roundRect(x: number, y: number, w: number, h: number, rad: number): this {
    const r = Math.max(0, Math.min(rad, w / 2, h / 2));
    this.M(x + r, y)
      .L(x + w - r, y)
      .arc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
      .L(x + w, y + h - r)
      .arc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
      .L(x + r, y + h)
      .arc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
      .L(x, y + r)
      .arc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
    return this.Z();
  }

  /** 두께 있는 선 (둥근 끝 캡슐): a → b, 반폭 w/2. 몸통 · 팔다리 · 망원경 */
  capsule(ax: number, ay: number, bx: number, by: number, w: number, w2 = w): this {
    const dx = bx - ax;
    const dy = by - ay;
    const ang = Math.atan2(dy, dx);
    const r0 = w / 2;
    const r1 = w2 / 2;
    this.arc(bx, by, r1, ang - Math.PI / 2, ang + Math.PI / 2);
    this.arc(ax, ay, r0, ang + Math.PI / 2, ang + (Math.PI * 3) / 2, false);
    return this.Z();
  }

  get d(): string {
    return this.parts.join('');
  }
}

/** 새 경로 (변환 m) */
export function path(m: Mat = IDENTITY): Path {
  return new Path(m);
}

// ───────────────────────── 그림 쌓기 ─────────────────────────

/**
 * 그림 쌓개. 층(layer) 하나 = 바깥 외곽선 패스(그 층 모든 부품의 두 배 굵기 외곽선) + 칠 패스(부품 칠 · 안쪽 가는 선 ·
 * 무늬). 그래서 바깥 실루엣에만 두께 w의 외곽선이 생기고, 같은 층 부품끼리는 가는 안쪽 선(inner × w)으로만 갈린다 —
 * 작은 몸(반지름 9.6 월드 px)에서 부품마다 굵은 외곽선이 서로를 덮지 않게. layer()로 층을 나누면 다음 층의 외곽선이
 * 앞 층 칠 위에 굵게 그어진다 (방패처럼 몸 앞에 떠 있는 소품)
 */
export class Sketch {
  private done: Op[] = [];
  private outline: Op[] = [];
  private body: Op[] = [];

  /** w = 바깥 외곽선 두께 (단위 좌표) */
  constructor(readonly w: number) {}

  /** 칠만 (칠 패스) */
  fill(d: string, paint: Paint, alpha?: number, rule?: 'nonzero' | 'evenodd'): this {
    this.body.push({ d, fill: paint, ...(alpha === undefined ? {} : { alpha }), ...(rule ? { rule } : {}) });
    return this;
  }

  /**
   * 부품: 외곽선 패스에 두 배 굵기 선(바깥쪽 w만 보인다), 칠 패스에 칠 + 안쪽 가는 선(inner × w, 0이면 없음).
   * outline = 외곽선 색 (보통 캐릭터 외곽선 #05080C, 번쩍 톤에서는 흰색)
   */
  part(d: string, paint: Paint, outline: number, alpha?: number, inner = 0.45): this {
    const a = alpha === undefined ? {} : { alpha };
    this.outline.push({ d, stroke: { paint: solid(outline), width: this.w * 2, join: 'round' }, ...a });
    this.body.push({ d, fill: paint, ...a });
    if (inner > 0)
      this.body.push({
        d,
        stroke: { paint: solid(outline, 0.6), width: this.w * inner, join: 'round' },
        ...a,
      });
    return this;
  }

  /** 외곽선 패스에만 (실루엣을 넓히는 그림자 · 테) */
  silhouette(d: string, outline: number, width = this.w * 2): this {
    this.outline.push({ d, fill: solid(outline), stroke: { paint: solid(outline), width, join: 'round' } });
    return this;
  }

  /** 선만 (칠 패스) */
  line(d: string, paint: Paint, width: number, cap: 'butt' | 'round' = 'round', alpha?: number): this {
    this.body.push({
      d,
      stroke: { paint, width, cap, join: 'round' },
      ...(alpha === undefined ? {} : { alpha }),
    });
    return this;
  }

  /** 층 나누기: 지금까지의 외곽선 · 칠을 확정하고 새 층을 시작한다 */
  layer(): this {
    this.done.push(...this.outline, ...this.body);
    this.outline = [];
    this.body = [];
    return this;
  }

  drawing(): Drawing {
    return { ops: [...this.done, ...this.outline, ...this.body] };
  }
}

/**
 * 그림 전체를 배율 k · 이동 (tx, ty)로 옮긴다 (정면 상반신 아이콘처럼 상자를 채우게 키울 때). 경로 숫자를 x, y 짝으로 바꾸므로
 * 이 파일의 Path가 내는 M · L · C · Z 경로만 받는다(A · H · V는 짝이 맞지 않아 멈춘다). 칠 좌표 · 선 두께도 같이 옮긴다
 */
export function transformDrawing(dr: Drawing, k: number, tx: number, ty: number): Drawing {
  const pt = (x: number, y: number): [number, number] => [x * k + tx, y * k + ty];
  const mapD = (d: string): string => {
    if (/[^MLCZ0-9.\s-]/.test(d)) throw new Error('transformDrawing: M · L · C · Z 경로만 옮길 수 있다');
    let i = 0;
    return d.replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (v) => {
      const n = Number(v);
      const out = i % 2 === 0 ? n * k + tx : n * k + ty;
      i += 1;
      return String(round(out, 3));
    });
  };
  const mapPaint = (pa: Paint): Paint => {
    if (pa.kind === 'solid') return pa;
    if (pa.kind === 'linear') {
      const [x0, y0] = pt(pa.x0, pa.y0);
      const [x1, y1] = pt(pa.x1, pa.y1);
      return { ...pa, x0, y0, x1, y1 };
    }
    const [cx, cy] = pt(pa.cx, pa.cy);
    const f =
      pa.fx === undefined || pa.fy === undefined ? {} : (([fx, fy]) => ({ fx, fy }))(pt(pa.fx, pa.fy));
    return { ...pa, cx, cy, r: pa.r * k, ...f };
  };
  return {
    ops: dr.ops.map((op) => ({
      ...op,
      d: mapD(op.d),
      ...(op.fill ? { fill: mapPaint(op.fill) } : {}),
      ...(op.stroke
        ? { stroke: { ...op.stroke, paint: mapPaint(op.stroke.paint), width: op.stroke.width * k } }
        : {}),
    })),
  };
}

// ───────────────────────── SVG ─────────────────────────

export interface SvgOptions {
  /** 보기 상자 [x, y, w, h] (단위 좌표) */
  viewBox: readonly [number, number, number, number];
  /** 화면 크기 (px, 없으면 viewBox 비율 100%) */
  width?: number;
  height?: number;
  /** 그라디언트 id 앞붙이 (한 문서에 여러 그림이 있어도 겹치지 않게) */
  idPrefix?: string;
  /** 바깥 변환 (예: 회전) */
  transform?: Mat;
  /** 접근성 제목 (없으면 aria-hidden) */
  title?: string;
}

function svgPaint(p: Paint, defs: string[], idBase: string, n: { v: number }): string {
  if (p.kind === 'solid') return rgba(p.color, p.alpha ?? 1);
  const id = `${idBase}${(n.v += 1)}`;
  const stops = p.stops
    .map(
      ([o, c, a]) =>
        `<stop offset="${round(o, 4)}" stop-color="${hex(c)}"${a === undefined || a >= 1 ? '' : ` stop-opacity="${round(a, 3)}"`}/>`,
    )
    .join('');
  if (p.kind === 'linear')
    defs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${round(p.x0, 4)}" y1="${round(p.y0, 4)}" x2="${round(p.x1, 4)}" y2="${round(p.y1, 4)}">${stops}</linearGradient>`,
    );
  else
    defs.push(
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${round(p.cx, 4)}" cy="${round(p.cy, 4)}" r="${round(p.r, 4)}"${p.fx === undefined ? '' : ` fx="${round(p.fx, 4)}" fy="${round(p.fy ?? p.cy, 4)}"`}>${stops}</radialGradient>`,
    );
  return `url(#${id})`;
}

/** 그림 → SVG 문자열 (외부 참조 · 스크립트 없음) */
export function toSvg(drawing: Drawing, o: SvgOptions): string {
  const defs: string[] = [];
  const body: string[] = [];
  const idBase = o.idPrefix ?? 'g';
  const n = { v: 0 };
  for (const op of drawing.ops) {
    const attrs: string[] = [`d="${op.d}"`];
    attrs.push(`fill="${op.fill ? svgPaint(op.fill, defs, idBase, n) : 'none'}"`);
    if (op.rule === 'evenodd') attrs.push('fill-rule="evenodd"');
    if (op.stroke) {
      attrs.push(`stroke="${svgPaint(op.stroke.paint, defs, idBase, n)}"`);
      attrs.push(`stroke-width="${round(op.stroke.width, 4)}"`);
      attrs.push(`stroke-linejoin="${op.stroke.join ?? 'round'}"`);
      attrs.push(`stroke-linecap="${op.stroke.cap ?? 'round'}"`);
    }
    if (op.alpha !== undefined && op.alpha < 1) attrs.push(`opacity="${round(op.alpha, 3)}"`);
    body.push(`<path ${attrs.join(' ')}/>`);
  }
  const [vx, vy, vw, vh] = o.viewBox;
  const size =
    (o.width !== undefined ? ` width="${o.width}"` : '') +
    (o.height !== undefined ? ` height="${o.height}"` : '');
  const a11y = o.title ? ` role="img" aria-label="${o.title}"` : ' aria-hidden="true"';
  const g = o.transform ? `<g transform="matrix(${o.transform.map((v) => round(v, 5)).join(' ')})">` : '<g>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(vx, 4)} ${round(vy, 4)} ${round(vw, 4)} ${round(vh, 4)}"${size}${a11y}><defs>${defs.join('')}</defs>${g}${body.join('')}</g></svg>`;
}

// ───────────────────────── Canvas2D ─────────────────────────

/** Canvas2D 중 쓰는 부분 (DOM 타입에 묶이지 않게) */
export interface CanvasGradientSink {
  addColorStop(offset: number, color: string): void;
}

export interface CanvasSink {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(a: number): void;
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientSink;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradientSink;
  fill(path: Path2D, rule?: CanvasFillRule): void;
  stroke(path: Path2D): void;
}

/** Path2D 만들기 (브라우저: new Path2D(d)). 같은 d는 다시 해석하지 않게 캐시 */
const path2dCache = new Map<string, Path2D>();

function path2d(d: string): Path2D {
  let p = path2dCache.get(d);
  if (!p) {
    p = new Path2D(d);
    if (path2dCache.size > 4000) path2dCache.clear();
    path2dCache.set(d, p);
  }
  return p;
}

function canvasPaint(ctx: CanvasSink, p: Paint): unknown {
  if (p.kind === 'solid') return rgba(p.color, p.alpha ?? 1);
  const g =
    p.kind === 'linear'
      ? ctx.createLinearGradient(p.x0, p.y0, p.x1, p.y1)
      : ctx.createRadialGradient(p.fx ?? p.cx, p.fy ?? p.cy, 0, p.cx, p.cy, p.r);
  for (const [o, c, a] of p.stops) g.addColorStop(Math.max(0, Math.min(1, o)), rgba(c, a ?? 1));
  return g;
}

/**
 * 그림을 Canvas에 그린다: 지금 원점에 단위 1 = k px. 부르는 쪽이 translate · rotate를 먼저 걸어 둔다.
 * 굽기(아틀라스) · 시안 그림이 쓴다. 매 프레임 그리기에는 쓰지 않는다 (구운 텍스처만 찍는다)
 */
export function drawToCanvas(ctx: CanvasSink, drawing: Drawing, k: number): void {
  ctx.save();
  ctx.scale(k, k);
  for (const op of drawing.ops) {
    const p = path2d(op.d);
    ctx.globalAlpha = op.alpha ?? 1;
    if (op.stroke) {
      ctx.lineWidth = op.stroke.width;
      ctx.lineJoin = op.stroke.join ?? 'round';
      ctx.lineCap = op.stroke.cap ?? 'round';
      ctx.strokeStyle = canvasPaint(ctx, op.stroke.paint);
      ctx.stroke(p);
    }
    if (op.fill) {
      ctx.fillStyle = canvasPaint(ctx, op.fill);
      ctx.fill(p, op.rule ?? 'nonzero');
    }
  }
  ctx.restore();
}
