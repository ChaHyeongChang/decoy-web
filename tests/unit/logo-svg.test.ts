// 로고 SVG (M10): 원본 PNG를 보고 다시 그린 벡터 로고가 안전하고(외부 참조 · 스크립트 없음) 두 위치에 같은 내용으로 있는지
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SVG_PATH = 'docs/images/logo_decoy.svg';
const PUBLIC_SVG_PATH = 'client/public/logo.svg';
const PNG_PATH = 'docs/images/logo_decoy.png';
/** 파일 크기 상한 (계획: 되도록 30KB 이하) */
const MAX_SVG_BYTES = 30 * 1024;
/** 원본 PNG(213×213)의 SHA-256 — 원본은 지우지도 바꾸지도 않는다 */
const ORIGINAL_PNG_SHA256 = '94347266c395b9404970bb954b06bf1779c09fe35ddce0c25f6f3005d192b66d';

const svg = readFileSync(SVG_PATH, 'utf8');

describe('로고 SVG 파일', () => {
  it('docs/images/logo_decoy.svg와 client/public/logo.svg는 같은 내용이다', () => {
    expect(readFileSync(PUBLIC_SVG_PATH, 'utf8')).toBe(svg);
  });

  it('루트 svg 요소에 viewBox 0 0 512 512가 있고 정사각형이다', () => {
    const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
    expect(root).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(root).toMatch(/viewBox="0 0 512 512"/);
    expect(root).toMatch(/width="512"/);
    expect(root).toMatch(/height="512"/);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('스크립트 · 외부 참조 · 이미지 삽입 · 외부 글꼴이 없다', () => {
    const lower = svg.toLowerCase();
    expect(lower).not.toContain('<script');
    expect(lower).not.toContain('<image');
    expect(lower).not.toContain('foreignobject');
    expect(lower).not.toContain('@import');
    expect(lower).not.toContain('@font-face');
    expect(lower).not.toContain('<style');
    expect(lower).not.toContain('javascript:');
    expect(lower).not.toContain('data:');
    // href 자체가 없다 (내부 참조도 url(#id)만 쓴다)
    expect(lower).not.toMatch(/\bhref\s*=/);
    // 이벤트 처리기 속성 없음 (onload= 등)
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
    // url(...)은 문서 안 id만 가리킨다
    const urls = [...svg.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(/^#[A-Za-z][\w-]*$/);
    // 가리키는 id가 실제로 정의되어 있다
    for (const u of urls) expect(svg).toContain(`id="${u!.slice(1)}"`);
  });

  it('도형만 쓴다: path · circle · clipPath · filter(feGaussianBlur)', () => {
    const tags = new Set([...svg.matchAll(/<([a-zA-Z][\w:-]*)/g)].map((m) => m[1]));
    const allowed = new Set([
      'svg',
      'title',
      'defs',
      'clipPath',
      'filter',
      'feGaussianBlur',
      'circle',
      'path',
      'g',
    ]);
    for (const t of tags) expect(allowed.has(t!), `허용하지 않은 요소 <${t}>`).toBe(true);
  });

  it('크기 상한 30KB 이하', () => {
    expect(statSync(SVG_PATH).size).toBeLessThanOrEqual(MAX_SVG_BYTES);
  });
});

describe('원본 로고 PNG 보관', () => {
  it('logo_decoy.png는 바뀌지 않았다 (213×213, 같은 해시)', () => {
    const png = readFileSync(PNG_PATH);
    // PNG 서명 + IHDR의 너비 · 높이
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(213);
    expect(png.readUInt32BE(20)).toBe(213);
    expect(createHash('sha256').update(png).digest('hex')).toBe(ORIGINAL_PNG_SHA256);
  });
});
