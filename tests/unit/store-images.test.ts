// M15 스토어 그림 규격 (MOBILE_PLAN M15 자동 검증, 구글 플레이 조건 — 2026년 10월 기준)
//  - 휴대전화 스크린샷 4장 이상 · 각 변 320~3840 · 긴 변 ≤ 짧은 변 × 2 · 알파 없음(완전 불투명) · 8MB 이하
//  - 그래픽 이미지 정확히 1024×500 · 알파 없음 · 15MB 이하, 앱 아이콘 512×512 · 1MB 이하 · 완전 불투명
//  - 모두 git에 들어 있다(artifacts/store/는 .gitignore 예외), 장면이 서로 다르다(화소가 다름), 촬영 순간 터치 UI가 보였다(manifest.json)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng, readPngInfo } from '../helpers/png';

const DIR = 'artifacts/store';
const files = readdirSync(DIR).filter((f) => f.endsWith('.png'));
const phones = files.filter((f) => f.startsWith('phone-')).sort();
const read = (f: string): Buffer => readFileSync(join(DIR, f));

interface Shot {
  file: string;
  scene: string;
  touchTargets: string[];
  renderer: string | null;
  quality: string | null;
}
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as {
  shots: Shot[];
  problems: string[];
};

/** 모든 화소가 불투명인가 (색 형식 2 = RGB면 그 자체로 불투명) */
function opaque(buf: Buffer): boolean {
  const png = decodePng(buf);
  if (png.colorType === 2) return true;
  for (let i = 3; i < png.rgba.length; i += 4) if (png.rgba[i] !== 255) return false;
  return true;
}

describe('스토어 그림 (artifacts/store)', () => {
  it('휴대전화 스크린샷 5장: 각 변 320~3840, 긴 변 ≤ 짧은 변 × 2, 16:9 1920×1080, 8MB 이하, 완전 불투명', () => {
    expect(phones).toEqual([
      'phone-1-lobby.png',
      'phone-2-monster.png',
      'phone-3-survivor.png',
      'phone-4-rescue.png',
      'phone-5-result.png',
    ]);
    for (const f of phones) {
      const buf = read(f);
      const { width, height } = readPngInfo(buf);
      expect(Math.min(width, height), f).toBeGreaterThanOrEqual(320);
      expect(Math.max(width, height), f).toBeLessThanOrEqual(3840);
      expect(Math.max(width, height), f).toBeLessThanOrEqual(Math.min(width, height) * 2);
      expect([width, height], f).toEqual([1920, 1080]);
      expect(buf.length, f).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(opaque(buf), `${f} 불투명`).toBe(true);
    }
  });

  it('그래픽 이미지: 정확히 1024×500, 15MB 이하, 완전 불투명', () => {
    const buf = read('feature-graphic.png');
    const { width, height } = readPngInfo(buf);
    expect([width, height]).toEqual([1024, 500]);
    expect(buf.length).toBeLessThanOrEqual(15 * 1024 * 1024);
    expect(opaque(buf)).toBe(true);
  });

  it('앱 아이콘: 512×512, 1MB 이하, 완전 불투명', () => {
    const buf = read('app-icon-512.png');
    const { width, height } = readPngInfo(buf);
    expect([width, height]).toEqual([512, 512]);
    expect(buf.length).toBeLessThanOrEqual(1024 * 1024);
    expect(opaque(buf)).toBe(true);
  });

  it('장면이 서로 다르다 (파일 내용 · 화소 차이)', () => {
    const shots = [...phones, 'feature-graphic.png'];
    const hashes = shots.map((f) => createHash('sha256').update(read(f)).digest('hex'));
    expect(new Set(hashes).size).toBe(shots.length);
    // 같은 크기의 휴대폰 스크린샷끼리 화소가 10% 넘게 다르다 (같은 화면을 두 번 찍지 않았다)
    const decoded = phones.map((f) => decodePng(read(f)).rgba);
    for (let i = 0; i < decoded.length; i += 1)
      for (let j = i + 1; j < decoded.length; j += 1) {
        const a = decoded[i]!;
        const b = decoded[j]!;
        let diff = 0;
        let n = 0;
        for (let k = 0; k < a.length; k += 4 * 97) {
          n += 1;
          if (
            Math.abs(a[k]! - b[k]!) + Math.abs(a[k + 1]! - b[k + 1]!) + Math.abs(a[k + 2]! - b[k + 2]!) >
            24
          )
            diff += 1;
        }
        expect(diff / n, `${phones[i]} ↔ ${phones[j]}`).toBeGreaterThan(0.1);
      }
  });

  it('촬영 기록: 판 장면은 터치 UI가 보였고 WebGL · 품질 높음, 콘솔 문제 없음', () => {
    expect(manifest.problems).toEqual([]);
    const by = new Map(manifest.shots.map((s) => [s.file, s]));
    for (const f of ['phone-2-monster.png', 'phone-3-survivor.png', 'phone-4-rescue.png']) {
      const s = by.get(f);
      expect(s, f).toBeDefined();
      expect(s?.touchTargets, `${f} 터치 대상`).toContain('move-zone');
      expect(s?.renderer, f).toBe('webgl');
      expect(s?.quality, f).toBe('high');
    }
    expect(by.get('phone-2-monster.png')?.touchTargets).toEqual(
      expect.arrayContaining(['aim-stick', 'dash', 'roar']),
    );
    expect(by.get('phone-4-rescue.png')?.touchTargets).toContain('rescue');
    // 기록과 파일이 맞다 (다시 찍고 기록만 옛것이 아니게)
    for (const s of manifest.shots) expect(files, s.file).toContain(s.file);
  });

  it('모두 git에 들어 있다 (artifacts/store/는 .gitignore 예외)', () => {
    const tracked = execFileSync('git', ['ls-files', DIR], { encoding: 'utf8' }).split('\n');
    for (const f of [...files, 'manifest.json']) expect(tracked, f).toContain(`${DIR}/${f}`);
    for (const f of files) expect(statSync(join(DIR, f)).size).toBeGreaterThan(1000);
  });
});
