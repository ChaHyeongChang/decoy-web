// 문구 동기화 (MOBILE_PLAN M12 12번): client/src/data/storyText.ts · accountText.ts의 모든 문구가 docs/STORY_TEXT.md(표 셀 · 목록)에 나온다.
// 규칙
//  - 문서는 표의 칸(머리 줄 제외)과 목록 줄, 그 안의 따옴표 "…"만 본다 (설명 문단 · 제목은 보지 않는다)
//  - 비교 전에 `코드 표시`를 벗기고 공백을 하나로, 문장 끝 마침표를 뺀다 (표에서는 마침표를 생략할 수 있다)
//  - {point} · {exit} · {code} · {n} 같은 자리는 문서에서 어떤 글자로 적어도 된다 ({A/B} · `□□` 등)
//  - 8자 이상 문구는 칸 안 어디에 있어도 되고, 그보다 짧은 문구(나 · 봇 · 대기 …)는 칸 전체이거나 칸을 ' · ' · ' / ' · ' + '로
//    나눈 한 조각과 같아야 한다 (짧은 낱말이 우연히 긴 문장 속에 있어서 통과하지 않게)
//  - 색 값(#RRGGBB)은 문구가 아니다
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ACCOUNT from '../../client/src/data/accountText';
import * as STORY from '../../client/src/data/storyText';

/** 게임 문구: storyText.ts와 나눠 받는 조각용 계정 문구(accountText.ts — 첫 묶음을 작게) */
const TEXT = { ...STORY, ...ACCOUNT };

const md = readFileSync('docs/STORY_TEXT.md', 'utf8');

const norm = (s: string): string =>
  s
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.。]$/, '');

/** 문서의 칸: 표 칸(머리 줄 · 구분 줄 제외) · 목록 줄 · 그 안의 "따옴표" */
function docCells(text: string): string[] {
  const lines = text.split('\n');
  const cells: string[] = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('|')) {
      if (/^\|[\s|:-]+\|$/.test(t)) return;
      // 다음 줄이 구분 줄이면 머리 줄
      if (/^\|[\s|:-]+\|$/.test(lines[i + 1]?.trim() ?? '')) return;
      cells.push(...t.slice(1, -1).split('|'));
    } else if (/^(-|\d+\.)\s/.test(t)) cells.push(t.replace(/^(-|\d+\.)\s+/, ''));
  });
  const quoted = cells.flatMap((c) => [...c.matchAll(/"([^"]+)"/g)].map((m) => m[1]!));
  return [...cells, ...quoted].map(norm).filter((c) => c.length > 0);
}

/** 칸을 조각으로 (짧은 문구 비교용) */
function pieces(cell: string): string[] {
  return [cell, ...cell.split(/ · | \/ | \+ /)].map(norm);
}

/** storyText.ts의 모든 문구 (경로 → 글자). 함수 · 색 값은 뺀다 */
function allTexts(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'string') {
      if (!/^#[0-9A-F]{6}$/i.test(v)) out.push({ path, text: v });
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  for (const [k, v] of Object.entries(TEXT)) if (typeof v !== 'function') walk(v, k);
  return out;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function found(text: string, cells: string[], parts: Set<string>): boolean {
  const t = norm(text);
  if (/\{\w+\}/.test(t)) {
    const re = new RegExp(
      t
        .split(/\{\w+\}/)
        .map(escape)
        .join('.+?'),
    );
    return cells.some((c) => re.test(c));
  }
  if (t.length >= 8) return cells.some((c) => c.includes(t));
  return parts.has(t);
}

describe('storyText.ts ↔ STORY_TEXT.md', () => {
  const cells = docCells(md);
  const parts = new Set(cells.flatMap(pieces));

  it('모든 문구가 문서의 표 · 목록에 있다', () => {
    const missing = allTexts()
      .filter((e) => !found(e.text, cells, parts))
      .map((e) => `${e.path}: ${e.text}`);
    expect(missing, 'docs/STORY_TEXT.md에 같은 문구를 적는다').toEqual([]);
  });

  it('비교 규칙이 헛돌지 않는다', () => {
    const c = docCells(
      '| 자리 | 문구 |\n|---|---|\n| 방 | 나 · 봇 |\n| 판 | 거점 {A/B}에서 무언가 움직인다. |\n- 목록 "따옴표 안 문장."',
    );
    const p = new Set(c.flatMap(pieces));
    expect(found('나', c, p)).toBe(true);
    // 머리 줄은 보지 않는다
    expect(found('문구', c, p)).toBe(false);
    // 짧은 낱말이 긴 칸 속에 있을 뿐이면 아니다
    expect(found('거점', c, p)).toBe(false);
    expect(found('거점 {point}에서 무언가 움직인다.', c, p)).toBe(true);
    expect(found('따옴표 안 문장', c, p)).toBe(true);
  });
});
