// 따라가는 카메라 1단계: 확대 수준 후보 비교 수치 (npx tsx scripts/camera-table.ts → artifacts/camera/table.json · 표준 출력 표)
// 카메라 코드(client/src/render/camera.ts)와 수치(config/balance.json)를 그대로 써서, 벽 · 맵 끝을 빼고(넓은 곳 기준) 잰다:
//  - 생존자 시야 원(반지름 6 · 스카우트 7.5)이 내 캐릭터를 가운데 둔 화면에 들어오는 넓이 비율
//  - 괴물 시야(부채꼴 ∪ 근접 원, 탐색 110° · 5타일 / 추적 50° · 9타일)가 앞당긴 화면에 들어오는 넓이 비율과
//    조준 방향으로 화면에 보이는 거리 (가로 · 대각 · 세로 조준)
//  - 기기별 한 타일 · 캐릭터 크기 (CSS px): 보이는 창 = 맵 사각형 (PC 1428 × 952, 휴대폰 가로는 화면 높이 가득 3:2)
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { CAMERA, coneBox, lookAhead, viewTiles } from '../client/src/render/camera';

interface Balance {
  survivor: { radius: number; visionRadius: number };
  roles: { scout: { visionRadius: number } };
  monster: {
    radius: number;
    nearVisionRadius: number;
    visionModes: { search: { angle: number; range: number }; hunt: { angle: number; range: number } };
  };
}
const balance = JSON.parse(readFileSync('config/balance.json', 'utf8')) as Balance;

const ZOOMS = [1, 4, 3, 2];
const LABEL: Record<number, string> = { 1: '지금 (맵 전체)', 4: '① 가깝게', 3: '② 중간', 2: '③ 넓게' };
/** 보이는 창(맵 사각형)의 CSS 폭: 기기 → px */
const DEVICES: { name: string; viewCssW: number }[] = [
  { name: '휴대폰 800×360', viewCssW: 540 },
  { name: '휴대폰 915×412', viewCssW: 618 },
  { name: 'PC 1920×1080', viewCssW: 1428 },
];
const DEG = Math.PI / 180;
const N = 400;

/** 점 (x, y)가 괴물 기준 시야(부채꼴 ∪ 근접 원) 안인가 */
function inMonsterVision(
  x: number,
  y: number,
  aim: number,
  arc: number,
  range: number,
  near: number,
): boolean {
  const d = Math.hypot(x, y);
  if (d <= near) return true;
  if (d > range) return false;
  let a = Math.atan2(y, x) - aim;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.abs(a) <= arc / 2;
}

/** 시야 넓이 중 창 [cx ± w/2, cy ± h/2] 안에 든 비율 (격자 표본) */
function visibleFraction(
  inside: (x: number, y: number) => boolean,
  R: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
): number {
  let all = 0;
  let vis = 0;
  for (let i = 0; i < N; i += 1)
    for (let j = 0; j < N; j += 1) {
      const x = -R + ((i + 0.5) / N) * 2 * R;
      const y = -R + ((j + 0.5) / N) * 2 * R;
      if (!inside(x, y)) continue;
      all += 1;
      if (Math.abs(x - cx) <= w / 2 && Math.abs(y - cy) <= h / 2) vis += 1;
    }
  return all > 0 ? vis / all : 0;
}

/** 조준 방향으로 화면 끝까지 거리 (괴물에서) */
function aheadOnScreen(aim: number, cx: number, cy: number, w: number, h: number): number {
  const dx = Math.cos(aim);
  const dy = Math.sin(aim);
  let t = Infinity;
  if (Math.abs(dx) > 1e-9) t = Math.min(t, ((dx > 0 ? cx + w / 2 : cx - w / 2) - 0) / dx);
  if (Math.abs(dy) > 1e-9) t = Math.min(t, ((dy > 0 ? cy + h / 2 : cy - h / 2) - 0) / dy);
  return t;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const r1 = (v: number): number => Math.round(v * 10) / 10;

const out: Record<string, unknown>[] = [];
const lines: string[] = [];
for (const z of ZOOMS) {
  const { w, h } = viewTiles(z);
  const row: Record<string, unknown> = { zoom: z, label: LABEL[z], viewW: r1(w), viewH: r1(h) };
  // 생존자 시야 원 (내 캐릭터 가운데)
  for (const [key, R] of [
    ['survivor', balance.survivor.visionRadius],
    ['scout', balance.roles.scout.visionRadius],
  ] as const) {
    row[`${key}Circle`] = visibleFraction((x, y) => Math.hypot(x, y) <= R, R, 0, 0, w, h);
  }
  // 괴물 시야 (앞당김 반영)
  const modes = balance.monster.visionModes;
  for (const [mode, m] of Object.entries(modes)) {
    for (const [aimName, aimDeg] of [
      ['side', 0],
      ['diag', -45],
      ['up', -90],
    ] as const) {
      const aim = aimDeg * DEG;
      const arc = m.angle * DEG;
      const near = balance.monster.nearVisionRadius;
      const look =
        z > 1 ? lookAhead(coneBox(aim, arc, m.range, near), w, h, CAMERA.lookMargin) : { x: 0, y: 0 };
      const R = Math.max(m.range, near);
      row[`${mode}-${aimName}`] = visibleFraction(
        (x, y) => inMonsterVision(x, y, aim, arc, m.range, near),
        R,
        look.x,
        look.y,
        w,
        h,
      );
      row[`${mode}-${aimName}-ahead`] =
        z > 1 ? r1(Math.min(m.range, aheadOnScreen(aim, look.x, look.y, w, h))) : m.range;
    }
  }
  // 기기별 크기 (CSS px)
  for (const d of DEVICES) {
    const pxTile = d.viewCssW / w;
    row[`${d.name} 타일`] = r1(pxTile);
    row[`${d.name} 생존자`] = r1(pxTile * balance.survivor.radius * 2);
    row[`${d.name} 괴물`] = r1(pxTile * balance.monster.radius * 2);
  }
  out.push(row);
  lines.push(
    `${String(row.label).padEnd(12)} 창 ${row.viewW}×${row.viewH}타일 | 생존자 시야 ${pct(row.survivorCircle as number)} · 스카우트 ${pct(row.scoutCircle as number)} | ` +
      `탐색 ${pct(row['search-side'] as number)}/${pct(row['search-diag'] as number)}/${pct(row['search-up'] as number)} ` +
      `추적 ${pct(row['hunt-side'] as number)}/${pct(row['hunt-diag'] as number)}/${pct(row['hunt-up'] as number)} (세로 앞 ${String(row['hunt-up-ahead'])}타일) | ` +
      DEVICES.map((d) => `${d.name} 생존자 ${String(row[`${d.name} 생존자`])}px`).join(' · '),
  );
}
mkdirSync('artifacts/camera', { recursive: true });
writeFileSync('artifacts/camera/table.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(lines.join('\n'));
