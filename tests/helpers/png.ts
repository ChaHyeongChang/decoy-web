// PNG 읽기 도우미 (M14 아이콘 · M15 스토어 이미지 규격 시험): 머리(크기 · 비트 깊이 · 색 형식)와 8비트 RGB/RGBA 화소.
// 새 의존성 없이 node:zlib로 IDAT를 풀고 줄마다 필터를 되돌린다 (비월 · 팔레트 · 16비트는 다루지 않는다 — 우리가 만드는 PNG가 아니다)
import { inflateSync } from 'node:zlib';

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
