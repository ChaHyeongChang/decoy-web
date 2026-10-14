// 캐릭터 리디자인 시안 그림 (브라우저 쪽, 디자인 작업용). scripts/char-art.mjs가 esbuild로 묶어 Chromium에 싣고
// window.CHAR_ART를 부른다. 새 캐릭터 그림(client/src/art/chars)과 지금 그림(client/src/art/atlas.ts bakeAtlas)을
// 같은 캔버스에 그려 PNG(data URL)로 돌려준다. 그리기 도우미는 draw.ts를 같이 쓴다. 게임 코드는 바꾸지 않는다.
import { ROLE } from '../../client/src/art/palette';
import type { CharId } from '../../client/src/art/chars/types';
import {
  BG,
  DEVICES,
  NAMES,
  R_TILES,
  TEXT_COLOR,
  backingRadiusPx,
  canvas,
  deviceRow,
  floor,
  grayscale,
  kindOf,
  newFront,
  newTop,
  oldTop,
  text,
  wUnits,
  zoomCopy,
  type AnyPose,
} from './draw';

const IDS: CharId[] = ['runner', 'guard', 'scout', 'common', 'monster'];

// ───────────────────────── 보드: 디자인 미리보기 (캐릭터 하나) ─────────────────────────

const SURVIVOR_POSES: { label: string; pose: AnyPose }[] = [
  { label: '서기', pose: {} },
  { label: '걷기 ¼', pose: { walk: Math.PI / 2, stride: 1 } },
  { label: '걷기 ¾', pose: { walk: (Math.PI * 3) / 2, stride: 1 } },
  { label: '능력 0.5', pose: { action: 0.5 } },
  { label: '능력 1', pose: { action: 1 } },
  { label: '피격', pose: { hit: 1 } },
  { label: '수감', pose: { mode: 'captive' } },
  { label: '구조 중', pose: { mode: 'reach' } },
  { label: '사망 회색', pose: { tone: 'gray' } },
  { label: '번쩍', pose: { tone: 'flash' } },
];

/** 공통 생존자: 괴물 화면이 받는 값(걷기 · 수감 · 톤)으로 정할 수 있는 자세만 */
const COMMON_POSES = SURVIVOR_POSES.filter(
  (p) => p.pose.action === undefined && p.pose.hit === undefined && p.pose.mode !== 'reach',
);

const MONSTER_POSES: { label: string; pose: AnyPose }[] = [
  { label: '서기', pose: {} },
  { label: '걷기 ¼', pose: { walk: Math.PI / 2, stride: 1, cloak: 1 } },
  { label: '걷기 ¾', pose: { walk: (Math.PI * 3) / 2, stride: 1, cloak: 4 } },
  { label: '준비 0.5', pose: { windup: 0.5 } },
  { label: '준비 1', pose: { windup: 1 } },
  { label: '타격', pose: { strike: 1 } },
  { label: '돌진', pose: { dash: 1 } },
  { label: '포효', pose: { roar: 1 } },
  { label: '기절', pose: { stun: 1, eyes: 'stun' } },
  { label: '번쩍', pose: { tone: 'flash' } },
];

function posesFor(id: CharId): { label: string; pose: AnyPose }[] {
  return id === 'monster' ? MONSTER_POSES : id === 'common' ? COMMON_POSES : SURVIVOR_POSES;
}

const DIRS8 = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4 - Math.PI / 2);

export async function previewBoard(id: CharId): Promise<string> {
  const W = 1900;
  const H = 1500;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  text(ctx, `${NAMES[id]} — 디자인 미리보기`, 24, 40, 26, TEXT_COLOR[id], 700);
  // A. 큰 위에서 본 그림
  text(ctx, '위에서 본 게임 그림 (크게, 오른쪽 = 바라보는 방향)', 24, 82, 16, '#94a3b8');
  const cell = 180;
  posesFor(id).forEach((p, i) => {
    const x = 24 + i * (cell + 6);
    const y = 96;
    floor(ctx, x, y, cell, cell, 60);
    newTop(ctx, id, p.pose, x + cell / 2, y + cell / 2, id === 'monster' ? 50 : 52, 0);
    text(ctx, p.label, x + 6, y + cell - 8, 13, '#e2e8f0', 500);
  });
  // A2. 여러 방향
  text(ctx, '여러 방향 (서기 · 걷기 ¼ 번갈아)', 24, 316, 16, '#94a3b8');
  DIRS8.forEach((rot, i) => {
    const x = 24 + i * 120;
    floor(ctx, x, 326, 114, 114, 40);
    newTop(ctx, id, i % 2 ? { walk: Math.PI / 2, stride: 1 } : {}, x + 57, 383, 30, rot);
  });
  // B. 정면
  text(ctx, '정면 그림 (로비 카드 · 결과 · 아이콘)', 1000, 316, 16, '#94a3b8');
  ctx.fillStyle = '#0f1b27';
  ctx.fillRect(1000, 326, 880, 330);
  newFront(ctx, id, {}, 1150, 486, 290, 4);
  newFront(ctx, id, { bust: true }, 1400, 486, 160, 3);
  newFront(ctx, id, { bust: true }, 1545, 486, 64, 2);
  newFront(ctx, id, { bust: true }, 1610, 486, 32, 1.4);
  newFront(ctx, id, { t: 0.65 }, 1770, 486, 150, 2.5);
  text(ctx, '전신 290', 1120, 648, 12, '#94a3b8');
  text(ctx, '상반신 160 · 64 · 32', 1360, 648, 12, '#94a3b8');
  text(ctx, '숨쉬기 0.65초', 1730, 648, 12, '#94a3b8');
  // C. 게임 화면 조건 — 지금 vs 새 (8방향)
  text(
    ctx,
    "게임 화면 조건 (휴대폰은 품질 '높음' 배율 2로 그려 늘림) — 위 줄 지금 그림, 아래 줄 새 그림. 오른쪽은 기기 화소 4배 최근접 확대",
    24,
    690,
    16,
    '#94a3b8',
  );
  let y = 704;
  for (const dev of [DEVICES.phone3, DEVICES.phone2, DEVICES.pc768]) {
    const r = backingRadiusPx(kindOf(id), dev);
    text(ctx, `${dev.name} (그리는 반지름 ${r.toFixed(1)}px)`, 24, y + 14, 13, '#cbd5e1');
    const a = deviceRow(
      ctx,
      24,
      y + 22,
      dev,
      DIRS8.map((rot) => ({ id, rot, old: true })),
    );
    const b = deviceRow(
      ctx,
      24,
      y + 22 + a.h + 4,
      dev,
      DIRS8.map((rot) => ({ id, rot })),
    );
    const z = 4;
    zoomCopy(ctx, c, a.x, a.y, a.w, a.h + b.h + 4, 24 + Math.max(a.w, 380) + 20, y + 22, z);
    y += 22 + (a.h + b.h + 4) * z + 22;
  }
  return c.toDataURL('image/png');
}

/**
 * 작은 크기 판단 보드 (디자인 작업용): 다섯 캐릭터를 지금 · 새 그림으로 8방향, 휴대폰 '높음' 조건 두 기기.
 * 왼쪽 = 기기 화소 그대로(지금 · 새 줄이 번갈아), 오른쪽 = 2.5배 최근접, 그 아래 흑백. 바라보는 방향이 읽히는지 본다
 */
export async function smallBoard(): Promise<string> {
  const W = 1900;
  const H = 2900;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  text(
    ctx,
    "작은 크기 — 휴대폰 품질 '높음' 조건, 8방향 (캐릭터마다 위 지금 · 아래 새)",
    24,
    36,
    20,
    '#e2e8f0',
    700,
  );
  let y = 56;
  for (const dev of [DEVICES.phone3, DEVICES.phone2]) {
    text(
      ctx,
      `${dev.name} · 생존자 그리는 반지름 ${backingRadiusPx('survivor', dev).toFixed(2)}px (화면에서 ${dev.dpr / dev.backing}배로 늘림)`,
      24,
      y + 16,
      14,
      '#cbd5e1',
    );
    y += 26;
    const y0 = y;
    let bw = 0;
    for (const id of IDS) {
      const a = deviceRow(
        ctx,
        24,
        y,
        dev,
        DIRS8.map((rot) => ({ id, rot, old: true })),
      );
      deviceRow(
        ctx,
        24,
        y + a.h,
        dev,
        DIRS8.map((rot) => ({ id, rot })),
      );
      text(ctx, NAMES[id], 24 + a.w + 6, y + a.h + 4, 12, TEXT_COLOR[id]);
      bw = a.w;
      y += a.h * 2 + 4;
    }
    const bh = y - y0;
    const zx = 24 + bw + 90;
    zoomCopy(ctx, c, 24, y0, bw, bh, zx, y0, 2.5);
    const gy = y0 + bh + 10;
    zoomCopy(ctx, c, 24, y0, bw, bh, 24, gy, 1);
    grayscale(ctx, 24, gy, bw, bh);
    text(ctx, '흑백 (기기 화소 그대로)', 24, gy + bh + 16, 12, '#94a3b8');
    y = Math.max(y0 + bh * 2.5, gy + bh + 20) + 30;
  }
  return c.toDataURL('image/png');
}

/** 다섯 캐릭터 정면 + 위 (한 장) */
export async function lineupBoard(): Promise<string> {
  const W = 1900;
  const H = 820;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  IDS.forEach((id, i) => {
    const x = 40 + i * 370;
    ctx.fillStyle = '#0f1b27';
    ctx.fillRect(x, 30, 340, 760);
    text(ctx, NAMES[id], x + 170, 70, 24, TEXT_COLOR[id], 700, 'center');
    newFront(ctx, id, {}, x + 170, 260, 300, 4);
    floor(ctx, x + 20, 430, 300, 300, 100);
    newTop(ctx, id, {}, x + 170, 580, 84, -Math.PI / 2);
  });
  return c.toDataURL('image/png');
}

// ───────────────────────── 측정 (디자인 규칙 자체 확인) ─────────────────────────

function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

function deltaE(a: [number, number, number], c: number): number {
  const b = lab((c >> 16) & 255, (c >> 8) & 255, c & 255);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const ROLE_COLOR: Record<CharId, number> = {
  runner: ROLE.runner,
  guard: ROLE.guard,
  scout: ROLE.scout,
  common: 0xf8fafc,
  monster: ROLE.monster,
};

/** 한 자세를 투명 캔버스에 그린 화소 (그림자 없음, 정사각형 한 변 size, 가운데 = 몸 중심) */
function renderPose(id: CharId, pose: AnyPose, rPx: number, size: number, rot = 0, old = false): ImageData {
  const { ctx } = canvas(size, size);
  if (old) oldTop(ctx, id, size / 2, size / 2, rPx, rot, { shadow: false });
  else newTop(ctx, id, pose, size / 2, size / 2, rPx, rot, { shadow: false });
  return ctx.getImageData(0, 0, size, size);
}

function masks(img: ImageData): { sil: Uint8Array; fill: Uint8Array } {
  const n = img.width * img.height;
  const sil = new Uint8Array(n);
  const fill = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = img.data[i * 4 + 3] ?? 0;
    if (a < 128) continue;
    sil[i] = 1;
    const r = img.data[i * 4] ?? 0;
    const g = img.data[i * 4 + 1] ?? 0;
    const b = img.data[i * 4 + 2] ?? 0;
    if (Math.max(r, g, b) > 70) fill[i] = 1;
  }
  return { sil, fill };
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let i = 0;
  let u = 0;
  for (let k = 0; k < a.length; k += 1) {
    if (a[k] && b[k]) i += 1;
    if (a[k] || b[k]) u += 1;
  }
  return u ? Math.round((i / u) * 1000) / 1000 : 1;
}

interface Extent {
  front: number;
  back: number;
  side: number;
  /** 몸 중심에서 가장 먼 점 (방향 무관) */
  radial: number;
}

/** 실루엣 범위 (몸 반지름 배수, 외곽선 두께 뺌): 앞 · 뒤 · 옆 · 가장 먼 점 */
function extents(img: ImageData, rPx: number, wPx: number): Extent {
  const c = img.width / 2;
  let front = 0;
  let back = 0;
  let side = 0;
  let radial = 0;
  for (let y = 0; y < img.height; y += 1)
    for (let x = 0; x < img.width; x += 1) {
      if ((img.data[(y * img.width + x) * 4 + 3] ?? 0) < 128) continue;
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      front = Math.max(front, dx);
      back = Math.max(back, -dx);
      side = Math.max(side, Math.abs(dy));
      radial = Math.max(radial, Math.hypot(dx, dy));
    }
  const k = (v: number): number => Math.round(((v - wPx) / rPx) * 100) / 100;
  return { front: k(front), back: k(back), side: k(side), radial: k(radial) };
}

/** 범위를 잴 자세: 미리보기 자세 + 괴물은 걸으며 공격 준비 · 포효 (준비 중에도 제 속도로 걷는다, windupMoveMultiplier 1) */
function metricPoses(id: CharId): { label: string; pose: AnyPose }[] {
  const base = posesFor(id).filter((p) => p.pose.tone !== 'flash');
  if (id !== 'monster') return base;
  return [
    ...base,
    { label: '걸으며 준비', pose: { windup: 0.9, walk: Math.PI / 2, stride: 1, cloak: 2 } },
    { label: '걸으며 포효', pose: { roar: 1, walk: Math.PI / 2, stride: 1, cloak: 2 } },
  ];
}

/** 디자인 규칙 측정: 실루엣 겹침(IoU), 자세별 범위, 몸 가운데 0.45r 원판 색, 판정 원 덩어리 */
export function metrics(): unknown {
  const out: Record<string, unknown> = {};
  // 1) IoU (서 있는 자세) — 생존자 몸 지름 12.7 · 18 · 36px, 방향 0 · 0.6rad (옛 shapes.test.ts와 같은 조건).
  //    sil = 실루엣 전체, fill = 밝은 몸(최대 채널 > 70: 어두운 무늬 · 외곽선 뺌)
  const iouTable: Record<string, Record<string, { sil: number; fill: number }>> = {};
  for (const d of [12.7, 18, 36])
    for (const rot of [0, 0.6]) {
      const size = Math.ceil(d * 2.6);
      const m: Partial<Record<CharId, { sil: Uint8Array; fill: Uint8Array }>> = {};
      for (const id of IDS) {
        const r = (d / 2) * (id === 'monster' ? R_TILES.monster / R_TILES.survivor : 1);
        m[id] = masks(renderPose(id, {}, r, size, rot));
      }
      const row: Record<string, { sil: number; fill: number }> = {};
      for (let i = 0; i < IDS.length; i += 1)
        for (let j = i + 1; j < IDS.length; j += 1) {
          const a = m[IDS[i] as CharId];
          const b = m[IDS[j] as CharId];
          if (a && b) row[`${IDS[i]}-${IDS[j]}`] = { sil: iou(a.sil, b.sil), fill: iou(a.fill, b.fill) };
        }
      iouTable[`${d}px · ${rot}rad`] = row;
    }
  out.iou = iouTable;
  // 2) 자세별 범위 (반지름 100px로 그려 잼) + 지금 그림 서 있는 자세 (비교용)
  const ext: Record<string, Record<string, Extent>> = {};
  for (const id of IDS) {
    const r = 100;
    const wPx = wUnits(id) * r;
    const row: Record<string, Extent> = {};
    for (const p of metricPoses(id)) row[p.label] = extents(renderPose(id, p.pose, r, 440), r, wPx);
    row['지금 그림 서기'] = extents(renderPose(id, {}, r, 440, 0, true), r, wPx);
    ext[id] = row;
  }
  out.extents = ext;
  // 3) 몸 가운데 0.45r 원판: 역할색과의 ΔE (평균 · ΔE 15 이하 비율). 공통 생존자는 무채색 · 밝음 비율과 역할 4색 최소 ΔE
  const disc: Record<string, unknown> = {};
  for (const id of IDS) {
    const r = 60;
    const size = 200;
    const img = renderPose(id, {}, r, size);
    const c = size / 2;
    let n = 0;
    let near = 0;
    let sumL = [0, 0, 0];
    let achroBright = 0;
    let minRoleDE = Infinity;
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) {
        if (Math.hypot(x + 0.5 - c, y + 0.5 - c) > 0.45 * r) continue;
        const k = (y * size + x) * 4;
        const L = lab(img.data[k] ?? 0, img.data[k + 1] ?? 0, img.data[k + 2] ?? 0);
        n += 1;
        sumL = [sumL[0]! + L[0], sumL[1]! + L[1], sumL[2]! + L[2]];
        if (id === 'common') {
          if (Math.hypot(L[1], L[2]) < 8 && L[0] > 70) achroBright += 1;
          for (const rc of [ROLE.runner, ROLE.guard, ROLE.scout, ROLE.monster])
            minRoleDE = Math.min(minRoleDE, deltaE(L, rc));
        } else if (deltaE(L, ROLE_COLOR[id]) <= 15) near += 1;
      }
    const mean: [number, number, number] = [sumL[0]! / n, sumL[1]! / n, sumL[2]! / n];
    disc[id] =
      id === 'common'
        ? {
            achromaticBright: Math.round((achroBright / n) * 1000) / 1000,
            minDeltaEToRoles: Math.round(minRoleDE * 10) / 10,
          }
        : {
            meanDeltaE: Math.round(deltaE(mean, ROLE_COLOR[id]) * 10) / 10,
            within15: Math.round((near / n) * 1000) / 1000,
          };
  }
  out.centerDisc = disc;
  // 4) 덩어리: 판정 원 안을 밝은 몸(최대 채널 > 70)이 덮는 비율 — 지금 그림 vs 새 그림 (반지름 6.7 · 11 · 30px, 서 있는 자세)
  const cover: Record<string, Record<string, { old: number; new: number }>> = {};
  for (const r of [6.7, 11, 30]) {
    const row: Record<string, { old: number; new: number }> = {};
    for (const id of IDS) {
      const rr = r * (id === 'monster' ? R_TILES.monster / R_TILES.survivor : 1);
      const size = Math.ceil(rr * 5);
      const measure = (old: boolean): number => {
        const img = renderPose(id, {}, rr, size, 0, old);
        let inC = 0;
        let hit = 0;
        for (let y = 0; y < size; y += 1)
          for (let x = 0; x < size; x += 1) {
            if (Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) > rr) continue;
            inC += 1;
            const k = (y * size + x) * 4;
            if (
              (img.data[k + 3] ?? 0) >= 128 &&
              Math.max(img.data[k] ?? 0, img.data[k + 1] ?? 0, img.data[k + 2] ?? 0) > 70
            )
              hit += 1;
          }
        return Math.round((hit / inC) * 1000) / 1000;
      };
      row[id] = { old: measure(true), new: measure(false) };
    }
    cover[`r${r}`] = row;
  }
  out.cover = cover;
  out.rules = {
    iou: '역할끼리(러너 · 가드 · 스카우트) ≤ 0.8, 공통과 각 역할 ≤ 0.85 — sil · fill 모두, 세 크기 · 두 방향',
    extents:
      '생존자 앞 ≤ 1.55 (모든 자세), 옆 ≤ 1.12. 괴물: 서기 · 걷기 ≤ 1.2, 준비 · 타격 ≤ 1.45, 돌진 ≤ 1.4 (가장 먼 점은 참고값)',
    centerDisc: '역할: meanDeltaE ≤ 15, within15 ≥ 0.85. 공통: achromaticBright ≥ 0.9, minDeltaEToRoles ≥ 40',
    cover: '사람 판단 항목 (기준 없음): 휴대폰 크기에서 지금 그림보다 크게 작아 보이지 않는가',
  };
  return out;
}

/** 폰트 준비 (Noto Sans KR, data URL로 넘겨받음) */
export async function loadFont(dataUrl: string): Promise<void> {
  for (const weight of ['400', '500', '700']) {
    const f = new FontFace('Noto Sans KR', `url(${dataUrl})`, { weight });
    await f.load();
    document.fonts.add(f);
  }
}

declare global {
  interface Window {
    CHAR_ART: unknown;
  }
}

window.CHAR_ART = { previewBoard, smallBoard, lineupBoard, loadFont, metrics };
