// 로비 · 결과 화면(HTML)의 공용 그림 (M10c, VISUAL_SPEC 9 · 10장): DOM 도우미, 아이콘, 역할 실루엣 · 문양 인라인 SVG,
// 맵 설계도 배경. 모양은 게임과 같은 원본(art/shapes.ts · art/icons.ts)에서 만든다 — 그림이 하나다.
// 외부 이미지 없음(로고만 client/public/logo.svg).
import { CAPTURE_POINTS, EXITS, MAP_H, MAP_ROWS, MAP_W, PRISON_RECT, type Role } from '@decoy/shared';
import { iconSvg, type IconId } from '../art/icons';
import { OUTLINE, ROLE, ROLE_TEXT, hexCss } from '../art/palette';
import {
  CLAW_ANCHOR,
  CLAW_SPREAD,
  CLOAK_REST,
  GLYPHS,
  MONSTER_FACE,
  MONSTER_GLYPH_EYES,
  SURVIVOR_SHAPES,
  circlePoly,
  clawPoly,
  cloakOutline,
  tracePolys,
  type Poly,
} from '../art/shapes';

/** 큰 로고 (DPR과 상관없이 선명한 벡터, M10c). 파비콘 · 작은 크기는 원본 PNG */
export const LOGO_SVG_URL = 'logo.svg';

type Attrs = Record<string, string | undefined>;

/** 요소 만들기: 속성(undefined는 건너뜀) + 자식(문자열은 글자) */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

/** SVG 문자열을 담은 span (장식: 스크린 리더는 건너뜀) */
export function svgSpan(cls: string, svg: string): HTMLSpanElement {
  const s = h('span', { class: cls, 'aria-hidden': 'true' });
  s.innerHTML = svg;
  return s;
}

/** 아이콘 (선 아이콘, 글자색을 따른다) */
export function icon(id: IconId, size = 20, cls = ''): HTMLSpanElement {
  return svgSpan(cls ? `ico ${cls}` : 'ico', iconSvg(id, size));
}

/** 키캡 (Space · Shift · 좌클릭 …) */
export function keycap(label: string): HTMLElement {
  return h('kbd', { class: 'keycap' }, label);
}

export function logoImg(cls: string): HTMLImageElement {
  return h('img', { src: LOGO_SVG_URL, alt: 'DECOY 로고', class: cls, draggable: 'false' });
}

const mix = (a: number, b: number, k: number): string => {
  let out = 0;
  for (const s of [16, 8, 0]) out |= Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k) << s;
  return hexCss(out);
};

/**
 * 역할 CSS 변수: --rc 역할색(테두리 · 그래픽), --rt 글자용 밝은 역할색, --rf 고른 카드 바탕(패널에 역할색 9%),
 * --rg 빛 번짐
 */
export function roleVars(role: Role): string {
  const c = ROLE[role];
  return `--rc:${hexCss(c)};--rt:${hexCss(ROLE_TEXT[role])};--rf:${mix(0x0f1b27, c, 0.09)};--rg:rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},.5)`;
}

// ───────────────────────── 역할 그림 ─────────────────────────

const shade = (c: number, k: number): string => mix(c, 0x000000, k);
const tint = (c: number, k: number): string => mix(c, 0xffffff, k);

/** 다각형 → SVG path d (중심 cx, cy · 배율 k · 회전 rot) */
function pathD(polys: readonly Poly[], k: number, cx = 0, cy = 0, rot = 0): string {
  let d = '';
  const f = (v: number): number => Math.round(v * 10) / 10;
  tracePolys(
    {
      moveTo: (x, y) => (d += `M${f(x)} ${f(y)}`),
      lineTo: (x, y) => (d += `L${f(x)} ${f(y)}`),
      closePath: () => (d += 'Z'),
    },
    polys,
    k,
    cx,
    cy,
    rot,
  );
  return d;
}

let uid = 0;
/** 그림 배율 (몸 반지름 1 → 40 단위) · 위를 보게 돌림 */
const K = 40;
const UP = -Math.PI / 2;
const OUT = hexCss(OUTLINE);

/**
 * 큰 역할 실루엣 (로비 카드 · 결과 팀 문장): 위에서 본 몸(게임과 같은 모양, 앞이 위) + 바닥 빛 + 돔 음영.
 * 생존자 셋은 몸 원 + 역할 소품(물방울 · 방패 · 렌즈), 괴물은 톱니 망토 + 발톱 + 눈
 */
export function roleFigureSvg(role: Role, stage = true): string {
  const n = ++uid;
  const base = ROLE[role];
  const c = role === 'monster' ? 1.18 : 1;
  const k = K * c;
  const cy = role === 'monster' ? 6 : 12;
  const pad =
    `<radialGradient id="p${n}" cx="0" cy="${cy}" r="72" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${hexCss(base)}" stop-opacity=".42"/><stop offset=".55" stop-color="${hexCss(base)}" stop-opacity=".1"/>` +
    `<stop offset="1" stop-color="${hexCss(base)}" stop-opacity="0"/></radialGradient>`;
  const dome =
    `<radialGradient id="d${n}" cx="0" cy="${cy}" r="${k * 1.15}" fx="${-0.4 * k}" fy="${cy - 0.45 * k}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${tint(base, 0.4)}"/><stop offset=".42" stop-color="${hexCss(base)}"/>` +
    `<stop offset=".86" stop-color="${shade(base, 0.32)}"/><stop offset="1" stop-color="${shade(base, 0.5)}"/></radialGradient>`;
  let body: string;
  if (role === 'monster') {
    const cloak = pathD([cloakOutline(CLOAK_REST)], k, 0, cy, UP);
    const claws = [1, -1]
      .map((side) => {
        const a = side * CLAW_SPREAD;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const poly = clawPoly().map((p) => {
          const y = p.y * side;
          return { x: CLAW_ANCHOR.x + p.x * ca - y * sa, y: CLAW_ANCHOR.y * side + p.x * sa + y * ca };
        });
        return `<path d="${pathD([poly], k, 0, cy, UP)}"/>`;
      })
      .join('');
    const f = MONSTER_FACE;
    const eyes = [1, -1]
      .map((s) => {
        const x = s * f.eyeY * k;
        const y = cy - f.eyeX * k;
        return `<circle cx="${x}" cy="${y}" r="${f.eyeR * k * 2.6}" fill="#fb7185" opacity=".45"/><circle cx="${x}" cy="${y}" r="${f.eyeR * k}" fill="#fff1f2"/>`;
      })
      .join('');
    body =
      `<path d="${cloak}" fill="url(#d${n})" stroke="${OUT}" stroke-width="4" stroke-linejoin="round"/>` +
      `<g fill="#f1e6e8" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round">${claws}</g>` +
      `<ellipse cx="0" cy="${cy - f.cx * k}" rx="${f.ry * k}" ry="${f.rx * k}" fill="#1a0b0e"/>${eyes}`;
  } else {
    const s = SURVIVOR_SHAPES[role];
    const bodyPolys = role === 'runner' ? s.outline : [circlePoly(0, 0, 1, 64)];
    const prop =
      role === 'runner'
        ? ''
        : `<path d="${pathD(s.outline.slice(1), k, 0, cy, UP)}" fill="${tint(base, 0.18)}"/>`;
    body =
      `<path d="${pathD(s.outline, k, 0, cy, UP)}" fill="${OUT}" stroke="${OUT}" stroke-width="5" stroke-linejoin="round"/>` +
      prop +
      `<path d="${pathD(bodyPolys, k, 0, cy, UP)}" fill="url(#d${n})"/>` +
      `<circle cx="0" cy="${cy}" r="${0.86 * k}" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>` +
      `<path d="${pathD(s.marks, k, 0, cy, UP)}" fill="${shade(base, 0.8)}" fill-rule="evenodd"/>`;
  }
  return (
    `<svg viewBox="-80 -80 160 160" aria-hidden="true"><defs>${pad}${dome}</defs>` +
    // 무대(stage): 바닥 빛 + 판정 원 느낌의 점선 고리. 결과 화면 팀 문장처럼 여럿을 겹칠 때는 뺀다
    (stage
      ? `<ellipse cx="0" cy="${cy + 6}" rx="74" ry="64" fill="url(#p${n})"/>` +
        `<circle cx="0" cy="${cy}" r="${1.75 * k}" fill="none" stroke="${hexCss(base)}" stroke-opacity=".45" stroke-width="1.5" stroke-dasharray="3 5"/>`
      : '') +
    `<ellipse cx="3" cy="${cy + 7}" rx="${1.12 * k}" ry="${1.05 * k}" fill="#000" opacity=".45"/>` +
    `${body}</svg>`
  );
}

/** 역할 문양 배지 (게임 머리 위 · HUD와 같은 모양): 어두운 원판 + 역할색 테두리 + 역할색 문양 */
export function glyphSvg(role: Role): string {
  const col = hexCss(ROLE[role]);
  const g = GLYPHS[role];
  const eyes =
    role === 'monster'
      ? MONSTER_GLYPH_EYES.map(
          (e) => `<circle cx="${e.x * 12.4}" cy="${e.y * 12.4}" r="1.6" fill="#fff1f2"/>`,
        ).join('')
      : '';
  return (
    `<svg viewBox="-22 -22 44 44" aria-hidden="true"><circle r="20" fill="#0b1622" stroke="${col}" stroke-width="2.4"/>` +
    `<path d="${pathD(g.outline, 12.4)}" fill="${col}" fill-rule="evenodd"/>` +
    `<path d="${pathD(g.marks, 12.4)}" fill="#0b1622" fill-rule="evenodd"/>${eyes}</svg>`
  );
}

// ───────────────────────── 맵 설계도 (로비 배경) ─────────────────────────

let blueprint: string | null = null;

/** 실제 맵(MAP_ROWS)을 청록 선으로 그린 설계도 SVG. 한 번 만들어 둔다 */
export function blueprintSvg(): string {
  if (blueprint) return blueprint;
  const ch = (i: number, j: number): string => MAP_ROWS[j]?.[i] ?? ' ';
  const wall = (i: number, j: number): boolean => ch(i, j) === '#';
  let walls = '';
  // 벽과 벽 아닌 칸 사이 경계를 같은 줄끼리 이어 그린다
  for (let j = 0; j <= MAP_H; j += 1) {
    let run = -1;
    for (let i = 0; i <= MAP_W; i += 1) {
      const edge = i < MAP_W && wall(i, j - 1) !== wall(i, j);
      if (edge && run < 0) run = i;
      if (!edge && run >= 0) {
        walls += `M${run} ${j}H${i}`;
        run = -1;
      }
    }
  }
  for (let i = 0; i <= MAP_W; i += 1) {
    let run = -1;
    for (let j = 0; j <= MAP_H; j += 1) {
      const edge = j < MAP_H && wall(i - 1, j) !== wall(i, j);
      if (edge && run < 0) run = j;
      if (!edge && run >= 0) {
        walls += `M${i} ${run}V${j}`;
        run = -1;
      }
    }
  }
  // 기둥: 이어진 'o' 덩어리를 깎은 8각으로
  let pillars = '';
  const seen = new Set<number>();
  for (let j = 0; j < MAP_H; j += 1)
    for (let i = 0; i < MAP_W; i += 1) {
      if (ch(i, j) !== 'o' || seen.has(j * MAP_W + i)) continue;
      let w = 0;
      while (ch(i + w, j) === 'o') w += 1;
      let hgt = 0;
      while (ch(i, j + hgt) === 'o') hgt += 1;
      for (let y = 0; y < hgt; y += 1) for (let x = 0; x < w; x += 1) seen.add((j + y) * MAP_W + i + x);
      const c = 0.45;
      pillars += `M${i + c} ${j}H${i + w - c}L${i + w} ${j + c}V${j + hgt - c}L${i + w - c} ${j + hgt}H${i + c}L${i} ${j + hgt - c}V${j + c}Z`;
    }
  // 감옥: 철창 격자
  const p = PRISON_RECT;
  let prison = `M${p.x0} ${p.y0}H${p.x1}V${p.y1}H${p.x0}Z`;
  for (let x = p.x0 + 0.5; x < p.x1; x += 0.5) prison += `M${x} ${p.y0}V${p.y1}`;
  // 거점: 고리 + 마름모 + 십자 눈금
  let points = '';
  for (const c of Object.values(CAPTURE_POINTS)) {
    points += `M${c.x} ${c.y - 0.6}L${c.x + 0.6} ${c.y}L${c.x} ${c.y + 0.6}L${c.x - 0.6} ${c.y}Z`;
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const)
      points += `M${c.x + dx * 2.1} ${c.y + dy * 2.1}l${dx * 0.7} ${dy * 0.7}`;
  }
  const rings = Object.values(CAPTURE_POINTS)
    .map(
      (c) =>
        `<circle cx="${c.x}" cy="${c.y}" r="1.7"/><circle cx="${c.x}" cy="${c.y}" r="2.4" class="dash"/>`,
    )
    .join('');
  // 탈출구: 바깥을 가리키는 셰브론 두 개
  let exits = '';
  for (const e of Object.values(EXITS)) {
    const out = e.center.y < MAP_H / 2 ? -1 : 1;
    const y0 = out < 0 ? e.door.y0 - 0.6 : e.door.y1 + 0.6;
    for (const s of [0, 0.7]) {
      const y = y0 + out * s;
      exits += `M${e.center.x - 0.8} ${y - out * 0.5}L${e.center.x} ${y}L${e.center.x + 0.8} ${y - out * 0.5}`;
    }
  }
  // 바깥 틀 · 눈금 (설계도 종이)
  let ticks = '';
  for (let x = 0; x <= MAP_W; x += 4)
    ticks += `M${x} -1.4v${x % 8 === 0 ? 0.9 : 0.5}M${x} ${MAP_H + 1.4}v${x % 8 === 0 ? -0.9 : -0.5}`;
  for (let y = 0; y <= MAP_H; y += 4)
    ticks += `M-1.4 ${y}h${y % 8 === 0 ? 0.9 : 0.5}M${MAP_W + 1.4} ${y}h${y % 8 === 0 ? -0.9 : -0.5}`;
  const corner = (x: number, y: number, dx: number, dy: number): string =>
    `M${x + dx * 2} ${y}H${x}V${y + dy * 2}`;
  const frame =
    corner(-2, -2, 1, 1) +
    corner(MAP_W + 2, -2, -1, 1) +
    corner(-2, MAP_H + 2, 1, -1) +
    corner(MAP_W + 2, MAP_H + 2, -1, -1);
  let grid = '';
  for (let x = 1; x < MAP_W; x += 1) grid += `M${x} 0V${MAP_H}`;
  for (let y = 1; y < MAP_H; y += 1) grid += `M0 ${y}H${MAP_W}`;
  blueprint =
    `<svg class="bp-map" viewBox="-3 -3 ${MAP_W + 6} ${MAP_H + 6}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
    `<path class="grid" d="${grid}"/><path class="frame" d="${frame}${ticks}"/>` +
    `<path class="detail" d="${prison}${points}${exits}"/><g class="detail">${rings}</g>` +
    `<path class="wall" d="${walls}${pillars}"/></svg>`;
  return blueprint;
}
