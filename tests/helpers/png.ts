// PNG 읽기 · 쓰기 도우미 (M14 아이콘 · M15 스토어 이미지 규격 시험 · 스토어 촬영): 머리(크기 · 비트 깊이 · 색 형식)와
// 8비트 RGB/RGBA 화소. 새 의존성 없이 node:zlib로 IDAT를 풀고 줄마다 필터를 되돌린다 (비월 · 팔레트 · 16비트는 다루지 않는다 —
// 우리가 만드는 PNG가 아니다). 쓰기는 8비트 RGB(색 형식 2, 24비트 — 플레이 그래픽 이미지 · 스크린샷 조건) · RGBA(색 형식 6)
import { deflateSync, inflateSync } from 'node:zlib';

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  /** 2 = RGB, 6 = RGBA (그 밖은 decodePng가 거절) */
  colorType: number;
  interlace: number;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function readPngInfo(buf: Buffer): PngInfo {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('PNG가 아니다');
  if (buf.toString('latin1', 12, 16) !== 'IHDR') throw new Error('IHDR가 첫 덩어리가 아니다');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24] ?? 0,
    colorType: buf[25] ?? 0,
    interlace: buf[28] ?? 0,
  };
}

/** 화소를 RGBA 8비트로 (RGB면 알파 255) */
export function decodePng(buf: Buffer): PngInfo & { rgba: Uint8Array } {
  const info = readPngInfo(buf);
  if (info.bitDepth !== 8 || (info.colorType !== 2 && info.colorType !== 6) || info.interlace !== 0)
    throw new Error(
      `다루지 않는 PNG 형식 (깊이 ${info.bitDepth}, 색 ${info.colorType}, 비월 ${info.interlace})`,
    );
  const idat: Buffer[] = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = info.colorType === 6 ? 4 : 3;
  const stride = info.width * bpp;
  const out = new Uint8Array(info.width * info.height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < info.height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? (cur[x - bpp] ?? 0) : 0;
      const b = prev[x] ?? 0;
      const c = x >= bpp ? (prev[x - bpp] ?? 0) : 0;
      const v = line[x] ?? 0;
      let p: number;
      if (filter === 0) p = v;
      else if (filter === 1) p = v + a;
      else if (filter === 2) p = v + b;
      else if (filter === 3) p = v + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = p & 255;
    }
    for (let x = 0; x < info.width; x += 1) {
      const o = (y * info.width + x) * 4;
      out[o] = cur[x * bpp] ?? 0;
      out[o + 1] = cur[x * bpp + 1] ?? 0;
      out[o + 2] = cur[x * bpp + 2] ?? 0;
      out[o + 3] = bpp === 4 ? (cur[x * bpp + 3] ?? 0) : 255;
    }
    prev = cur;
  }
  return { ...info, rgba: out };
}

// ───────────── 쓰기: 8비트 RGB (색 형식 2) · RGBA (색 형식 6) ─────────────

const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 255] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const pa = Math.abs(b - c);
  const pb = Math.abs(a - c);
  const pc = Math.abs(a + b - 2 * c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * RGBA 화소를 8비트 PNG(비월 없음)로. colorType 2 = RGB(알파는 버린다), 6 = RGBA. 줄마다 필터 0~4 중 바이트 절댓값 합이
 * 가장 작은 것을 고르고(흔한 PNG 인코더 방식) zlib 9로 줄인다
 */
export function encodePng(width: number, height: number, rgba: Uint8Array, colorType: 2 | 6 = 2): Buffer {
  if (rgba.length !== width * height * 4) throw new Error('화소 수가 크기와 맞지 않는다');
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  let prev = new Uint8Array(stride);
  const tries = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  for (let y = 0; y < height; y += 1) {
    const cur = new Uint8Array(stride);
    for (let x = 0; x < width; x += 1)
      for (let k = 0; k < bpp; k += 1) cur[x * bpp + k] = rgba[(y * width + x) * 4 + k] ?? 0;
    let best = 0;
    let bestCost = Infinity;
    for (let f = 0; f < 5; f += 1) {
      const out = tries[f]!;
      let cost = 0;
      for (let x = 0; x < stride; x += 1) {
        const v = cur[x] ?? 0;
        const a = x >= bpp ? (cur[x - bpp] ?? 0) : 0;
        const b = prev[x] ?? 0;
        const c = x >= bpp ? (prev[x - bpp] ?? 0) : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const d = (v - pred) & 255;
        out[x] = d;
        cost += d < 128 ? d : 256 - d;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = f;
      }
    }
    const at = y * (stride + 1);
    raw[at] = best;
    raw.set(tries[best]!, at + 1);
    prev = cur;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = colorType;
  ihdr[10] = 0; // 압축
  ihdr[11] = 0; // 필터 방식
  ihdr[12] = 0; // 비월 없음
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 알파 없는 RGB PNG로 (플레이 그래픽 이미지 · 스크린샷은 24비트 PNG · 알파 없음). 이미 RGB면 그대로 돌려준다.
 * 투명한 화소가 하나라도 있으면 알파를 버릴 때 그림이 바뀌므로 거절한다
 */
export function toRgbPng(buf: Buffer): Buffer {
  const png = decodePng(buf);
  if (png.colorType === 2) return buf;
  for (let i = 3; i < png.rgba.length; i += 4)
    if (png.rgba[i] !== 255) throw new Error('투명한 화소가 있어 알파를 버릴 수 없다');
  return encodePng(png.width, png.height, png.rgba, 2);
}
