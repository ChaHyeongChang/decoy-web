// VISUAL_SPEC 새 판 (M10c): 문서가 코드 · 테스트와 어긋나지 않는지 본다.
//  - 0장 ①~⑦ 항목마다 지키는 테스트가 있고, 문서 어디든 적은 `tests/…` 경로가 있으며 「제목」이 그 파일의 테스트 제목이다
//  - 표의 마지막 `코드` 열(예: `palette.ROLE.runner`, `style.css --bg`)의 값이 코드 상수와 같다.
//    0.1 고정 값 표(역할색 · 글자용 역할색 · #F8FAFC · 부채꼴 색 · 부채꼴 채움 · 밝기 하한)는 줄이 빠져도 실패한다
//  - 하한 색 rgb(76, 88, 101) = FOG.ambient × FOG.tint, 부채꼴 색 = GAME_DESIGN 3.2, 별칭 표 = 이 테스트의 모듈 표,
//    10장 아이콘 목록 = icons.ts ICONS
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as anim from '../../client/src/art/anim';
import * as charFrames from '../../client/src/art/charFrames';
import * as chars from '../../client/src/art/chars/index';
import * as fx from '../../client/src/art/fx';
import * as icons from '../../client/src/art/icons';
import * as mapArtBadges from '../../client/src/art/mapArtBadges';
import * as mapArtGeom from '../../client/src/art/mapArtGeom';
import * as palette from '../../client/src/art/palette';
import * as shapes from '../../client/src/art/shapes';
import * as presets from '../../client/src/gfx/presets';
import * as quality from '../../client/src/gfx/quality';
import * as colors from '../../client/src/render/colors';
import { ambientRgb } from '../../client/src/render/fogMath';
import * as vision from '../../client/src/render/vision';
import * as fonts from '../../client/src/ui/fonts';
import * as hudArt from '../../client/src/ui/hudArt';
import * as layout from '../../client/src/ui/layout';

const SPEC_PATH = 'docs/VISUAL_SPEC.md';
const CSS_PATH = 'client/src/style.css';
const spec = readFileSync(SPEC_PATH, 'utf8');

/** 문서 `코드` 열의 별칭 → 파일 · 모듈 (문서 머리의 별칭 표와 같아야 한다) */
const MODULES: Readonly<Record<string, { file: string; mod: object }>> = {
  palette: { file: 'client/src/art/palette.ts', mod: palette },
  colors: { file: 'client/src/render/colors.ts', mod: colors },
  mapArtGeom: { file: 'client/src/art/mapArtGeom.ts', mod: mapArtGeom },
  mapArtBadges: { file: 'client/src/art/mapArtBadges.ts', mod: mapArtBadges },
  shapes: { file: 'client/src/art/shapes.ts', mod: shapes },
  charFrames: { file: 'client/src/art/charFrames.ts', mod: charFrames },
  chars: { file: 'client/src/art/chars/index.ts', mod: chars },
  anim: { file: 'client/src/art/anim.ts', mod: anim },
  fx: { file: 'client/src/art/fx.ts', mod: fx },
  icons: { file: 'client/src/art/icons.ts', mod: icons },
  vision: { file: 'client/src/render/vision.ts', mod: vision },
  presets: { file: 'client/src/gfx/presets.ts', mod: presets },
  quality: { file: 'client/src/gfx/quality.ts', mod: quality },
  hudArt: { file: 'client/src/ui/hudArt.ts', mod: hudArt },
  layout: { file: 'client/src/ui/layout.ts', mod: layout },
  fonts: { file: 'client/src/ui/fonts.ts', mod: fonts },
};

/** 0.1 고정 값 표에 반드시 있어야 하는 상수 (0장 ② · ③ · ⑥, 안개 하한) */
const REQUIRED_FIXED = [
  'palette.ROLE.runner',
  'palette.ROLE.guard',
  'palette.ROLE.scout',
  'palette.ROLE.monster',
  'palette.ROLE_TEXT.runner',
  'palette.ROLE_TEXT.guard',
  'palette.ROLE_TEXT.scout',
  'palette.ROLE_TEXT.monster',
  'palette.HIDDEN_SURVIVOR',
  'palette.CONE.idle',
  'palette.CONE.seen',
  'vision.CONE_LOOK.fillIdle',
  'vision.CONE_LOOK.fillSeen',
  'colors.FOG.ambient',
  'colors.FOG.tint',
];

type Val = { kind: 'num'; v: number } | { kind: 'str'; v: string } | { kind: 'bool'; v: boolean };

/** `#RRGGBB` · 숫자 · true/false · '문자열' */
function parseVal(tok: string): Val | null {
  if (/^#[0-9a-fA-F]{6}$/.test(tok)) return { kind: 'num', v: parseInt(tok.slice(1), 16) };
  if (/^-?\d+(\.\d+)?$/.test(tok)) return { kind: 'num', v: Number(tok) };
  if (tok === 'true' || tok === 'false') return { kind: 'bool', v: tok === 'true' };
  const s = /^'([^']*)'$/.exec(tok);
  if (s) return { kind: 'str', v: s[1] ?? '' };
  return null;
}

function fromCode(v: unknown): Val | null {
  if (typeof v === 'number') return { kind: 'num', v };
  if (typeof v === 'boolean') return { kind: 'bool', v };
  if (typeof v === 'string') return { kind: 'str', v };
  return null;
}

/** 실패 메시지용: 색처럼 보이는 정수는 #RRGGBB로도 */
function show(a: Val): string {
  if (a.kind === 'num' && Number.isInteger(a.v) && a.v > 0xffff)
    return `${a.v} (#${a.v.toString(16).toUpperCase().padStart(6, '0')})`;
  return JSON.stringify(a.v);
}

function sameVal(a: Val, b: Val): boolean {
  if (a.kind === 'num' && b.kind === 'num') return Math.abs(a.v - b.v) <= 1e-9 * Math.max(1, Math.abs(b.v));
  return a.kind === b.kind && a.v === b.v;
}

const TS_REF = /^([A-Za-z]+)\.([A-Za-z0-9_.]+)$/;
const CSS_REF = /^style\.css (--[A-Za-z0-9-]+)$/;
const FILE_EXT = /\.(ts|css|md|json|mjs|html)$/;

/** `코드` 열 참조인가 (모르는 별칭 · 파일 이름은 아니다) */
function isRef(tok: string): boolean {
  if (CSS_REF.test(tok)) return true;
  const m = TS_REF.exec(tok);
  return m !== null && (m[1] ?? '') in MODULES && !FILE_EXT.test(tok);
}

const cssRoot = /:root\s*\{([^}]*)\}/.exec(readFileSync(CSS_PATH, 'utf8'))?.[1] ?? '';

/** 참조 → 코드 값 (없으면 null) */
function resolveRef(ref: string): Val | null {
  const css = CSS_REF.exec(ref);
  if (css) {
    const name = css[1] ?? '';
    const raw = new RegExp(`${name}:\\s*([^;]+);`).exec(cssRoot)?.[1]?.trim();
    if (raw === undefined) return null;
    return parseVal(raw) ?? { kind: 'str', v: raw };
  }
  const m = TS_REF.exec(ref);
  const entry = MODULES[m?.[1] ?? ''];
  if (!m || !entry) return null;
  let cur: unknown = entry.mod;
  for (const key of (m[2] ?? '').split('.')) {
    if (cur === null || typeof cur !== 'object' || !(key in cur)) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return fromCode(cur);
}

/** 표의 줄 → 칸 목록 (칸 안의 \| 는 나누지 않는다) */
function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
}

function backticks(s: string): string[] {
  return [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
}

/** 장 하나 ("## n." 머리부터 다음 "## " 머리 전까지) */
function chapter(n: string): string {
  const lines = spec.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${n}.`));
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

interface RefRow {
  line: string;
  refs: string[];
  values: Val[];
}

/** 머리 줄의 마지막 칸이 '코드'인 표의 줄 (2칸 표의 마지막 칸은 값이라 대조하지 않는다) */
function refRows(md: string): RefRow[] {
  const out: RefRow[] = [];
  let prevTable = false;
  let codeTable = false;
  for (const line of md.split('\n')) {
    const isRow = line.trimStart().startsWith('|');
    if (isRow && !prevTable) codeTable = cellsOf(line).at(-1) === '코드';
    prevTable = isRow;
    if (!isRow || !codeTable) continue;
    const cells = cellsOf(line);
    const refs = backticks(cells[cells.length - 1] ?? '').filter(isRef);
    if (refs.length === 0) continue;
    const values = cells
      .slice(0, -1)
      .flatMap(backticks)
      .map(parseVal)
      .filter((v): v is Val => v !== null);
    out.push({ line, refs, values });
  }
  return out;
}

/** 줄마다 `tests/…` 경로와 그 뒤 「제목」들 */
function testRefs(md: string): { path: string; titles: string[]; line: string }[] {
  const out: { path: string; titles: string[]; line: string }[] = [];
  for (const line of md.split('\n')) {
    let cur: { path: string; titles: string[]; line: string } | null = null;
    for (const m of line.matchAll(/`(tests\/[^`\s]+)`|「([^」]+)」/g)) {
      if (m[1] !== undefined) {
        cur = { path: m[1], titles: [], line };
        out.push(cur);
      } else if (m[2] !== undefined) {
        if (!cur) throw new Error(`제목 앞에 테스트 파일 경로가 없다: ${line}`);
        cur.titles.push(m[2]);
      }
    }
  }
  return out;
}

/** 파일 안에 테스트 제목으로 있는가 (따옴표 · 작은따옴표 · 백틱으로 감싼 문자열) */
function hasTitle(src: string, title: string): boolean {
  return [`'${title}'`, `"${title}"`, `\`${title}\``].some((q) => src.includes(q));
}

describe('VISUAL_SPEC 0장: 바꾸면 안 되는 것과 지키는 테스트', () => {
  const ch0 = chapter('0');

  it('①~⑦ 일곱 항목이 있고, 항목마다 지키는 테스트(파일 + 제목)가 하나 이상', () => {
    const marks = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];
    const sections = ch0.split(/\n(?=### )/).filter((s) => marks.some((k) => s.startsWith(`### ${k}`)));
    expect(sections.map((s) => s.slice(4, 5))).toEqual(marks);
    for (const s of sections) {
      const refs = testRefs(s).filter((r) => r.titles.length > 0);
      expect(refs.length, s.split('\n')[0]).toBeGreaterThan(0);
    }
  });

  it('문서에 적은 테스트 파일이 모두 있고, 「제목」은 그 파일의 테스트 제목이다', () => {
    const refs = testRefs(spec);
    expect(refs.length).toBeGreaterThan(40);
    const problems: string[] = [];
    for (const r of refs) {
      if (!existsSync(r.path)) {
        problems.push(`없는 파일: ${r.path}`);
        continue;
      }
      const src = readFileSync(r.path, 'utf8');
      for (const t of r.titles) if (!hasTitle(src, t)) problems.push(`${r.path}에 없는 제목: ${t}`);
    }
    expect(problems).toEqual([]);
  });

  it('0.1 고정 값 표에 역할색 · 글자용 역할색 · #F8FAFC · 부채꼴 색 · 채움 · 밝기 하한이 모두 있다', () => {
    const refs = new Set(refRows(chapter('0')).flatMap((r) => r.refs));
    expect(REQUIRED_FIXED.filter((r) => !refs.has(r))).toEqual([]);
  });

  it('0장 하한 색 rgb(76, 88, 101)이 FOG.ambient × FOG.tint와 같다', () => {
    const [r, g, b] = ambientRgb(colors.FOG.ambient, colors.FOG.tint);
    expect(ch0).toContain(`rgb(${r}, ${g}, ${b})`);
    expect([r, g, b]).toEqual([76, 88, 101]);
  });

  it('부채꼴 색은 GAME_DESIGN 3.2 규칙 색과 같다', () => {
    const gd = readFileSync('docs/GAME_DESIGN.md', 'utf8');
    const line = gd.split('\n').find((l) => l.includes('**부채꼴 색 2단계**')) ?? '';
    const hex = [...line.matchAll(/#([0-9A-Fa-f]{6})/g)].map((m) => parseInt(m[1] ?? '', 16));
    expect(hex).toEqual([palette.CONE.idle, palette.CONE.seen]);
    expect(palette.CONE).toEqual({ idle: 0xeab308, seen: 0xef4444 });
  });
});

describe('VISUAL_SPEC 표 ↔ 코드', () => {
  it('표의 코드 열 값이 코드 상수와 같다', () => {
    const rows = refRows(spec);
    expect(rows.length).toBeGreaterThan(60);
    const problems: string[] = [];
    for (const row of rows) {
      if (row.values.length < row.refs.length) {
        problems.push(`값이 참조보다 적다 (값 ${row.values.length}, 참조 ${row.refs.length}): ${row.line}`);
        continue;
      }
      row.refs.forEach((ref, i) => {
        const code = resolveRef(ref);
        const doc = row.values[i];
        if (!code) problems.push(`코드에 없는 참조: ${ref}`);
        else if (doc && !sameVal(doc, code)) problems.push(`${ref}: 문서 ${show(doc)} ≠ 코드 ${show(code)}`);
      });
    }
    expect(problems).toEqual([]);
  });

  it('별칭 표가 가리키는 파일이 테스트가 읽는 모듈과 같다', () => {
    const head = spec.slice(0, spec.indexOf('\n## 0.'));
    const table: Record<string, string> = {};
    for (const line of head.split('\n')) {
      if (!line.startsWith('|')) continue;
      const [a, f] = cellsOf(line).map((c) => backticks(c)[0] ?? '');
      if (a && f && a in MODULES) table[a] = f;
    }
    const expected = Object.fromEntries(Object.entries(MODULES).map(([k, v]) => [k, v.file]));
    expect(table).toEqual(expected);
    for (const f of Object.values(expected)) expect(existsSync(f), f).toBe(true);
  });

  it('10장 아이콘 목록이 icons.ts ICONS와 같다 (아이콘을 더하면 문서에도 적는다)', () => {
    const sec = chapter('10');
    const start = sec.indexOf('아이콘 목록(');
    const end = sec.indexOf('### 10.2');
    expect(start).toBeGreaterThan(0);
    const part = sec.slice(start, end);
    const listed = part
      .split('\n')
      .filter((l) => l.startsWith('|'))
      .flatMap((l) => backticks(cellsOf(l)[1] ?? ''));
    const ids = Object.keys(icons.ICONS);
    expect([...listed].sort()).toEqual([...ids].sort());
    expect(part).toContain(`아이콘 목록(${ids.length}개`);
  });
});
