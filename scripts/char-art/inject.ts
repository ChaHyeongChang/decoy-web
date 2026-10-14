// 캐릭터 리디자인 1단계 비교 촬영용 (게임 페이지에 주입). 게임 코드는 바꾸지 않는다.
//  - patchAtlas(): 지금 판의 캐릭터 아틀라스 캔버스(Canvas 렌더러는 매 프레임 이 캔버스를 그대로 그린다)의 같은 칸에
//    새 캐릭터 그림을 덮어 그린다. 칸 자리는 같은 굽기 함수(bakeAtlas)를 같은 값으로 다시 돌려 얻는다.
//    몸 칸 = 새 그림(신발 · 팔 포함), 발 · 윤기 · 괴물 발톱 · 눈 칸 = 비움 (새 그림이 몸 칸 하나에 다 들어 있다)
//  - newRoleFigureSvg(role): 로비 역할 카드용 새 정면 그림 SVG (무대 빛 + 정면 캐릭터)
// tests/char-art/compare.spec.ts가 esbuild로 묶어 addScriptTag로 넣는다. 아틀라스 캔버스는 addInitScript로 모아 둔
// window.__charCanvases(만든 canvas의 WeakRef 목록)에서 크기 · 화소로 찾는다.
import { TILE_PX as TILE } from '@decoy/shared';
import { ANIM } from '../../client/src/art/anim';
import { ART, bakeAtlas } from '../../client/src/art/atlas';
import { drawToCanvas, toSvg, type Drawing } from '../../client/src/art/chars/kit';
import { COMMON_ART, MONSTER_ART, SURVIVOR_ART } from '../../client/src/art/chars/index';
import {
  FRONT_REST,
  HIDDEN_REST,
  MONSTER_REST,
  SURVIVOR_REST,
  type Tone,
} from '../../client/src/art/chars/types';
import { ROLE, hexCss } from '../../client/src/art/palette';
import { R_TILES } from './draw';

const R = { s: R_TILES.survivor, m: R_TILES.monster } as const;
const OUTLINE_WORLD = ART.outlineWorldPx;

type Role = 'runner' | 'guard' | 'scout' | 'monster';

declare global {
  interface Window {
    __charCanvases?: WeakRef<HTMLCanvasElement>[];
    __DECOY__?: { gfx: { zoom: number } };
    CHAR_INJECT?: unknown;
  }
}

/** 칸 이름 → 새 그림 (null = 비움, undefined = 그대로 둠) */
function frameArt(name: string): { d: Drawing; unit: 's' | 'm' } | null | undefined {
  const ws = OUTLINE_WORLD / (R.s * TILE);
  const wm = OUTLINE_WORLD / (R.m * TILE);
  const surv = /^survivor-(runner|guard|scout|hidden)(?:-(flash|gray))?$/.exec(name);
  if (surv) {
    const tone: Tone = surv[2] === 'flash' ? 'flash' : surv[2] === 'gray' ? 'gray' : 'normal';
    if (surv[1] === 'hidden') return { d: COMMON_ART.top({ ...HIDDEN_REST, tone }, { w: ws }), unit: 's' };
    const id = surv[1] as 'runner' | 'guard' | 'scout';
    return { d: SURVIVOR_ART[id].top({ ...SURVIVOR_REST, tone }, { w: ws }), unit: 's' };
  }
  if (
    /^foot-/.test(name) ||
    name === 'gloss' ||
    name === 'claw' ||
    /^eyes-/.test(name) ||
    name === 'eye-glow'
  )
    return null;
  const cloak = /^monster-(idle|move)-(\d+)$/.exec(name);
  if (cloak) {
    const i = Number(cloak[2]);
    const move = cloak[1] === 'move';
    const phase = (i / ANIM.cloakFrames) * Math.PI * 2;
    return {
      d: MONSTER_ART.top(
        { ...MONSTER_REST, cloak: phase, walk: move ? phase : 0, stride: move ? 1 : 0 },
        { w: wm },
      ),
      unit: 'm',
    };
  }
  if (name === 'monster-dash')
    return { d: MONSTER_ART.top({ ...MONSTER_REST, dash: 1 }, { w: wm }), unit: 'm' };
  if (name === 'monster-stun')
    return { d: MONSTER_ART.top({ ...MONSTER_REST, stun: 1, eyes: 'stun' }, { w: wm }), unit: 'm' };
  return undefined;
}

/** 아틀라스 캔버스를 찾아 새 그림으로 덮는다. 돌려준 값: 바꾼 칸 수 · 찾은 캔버스 크기 */
export function patchAtlas(): { patched: number; cleared: number; size: string } {
  const zoom = window.__DECOY__?.gfx.zoom ?? 1;
  const build = bakeAtlas({ zoom, survivorR: R.s, monsterR: R.m });
  const refFrame = build.frames.get('survivor-runner');
  if (!refFrame) throw new Error('기준 칸 없음');
  // 화소 비교는 '자주 읽기'로 만든 작은 작업 캔버스에 옮겨 그려서 읽는다 (게임 · 굽기 캔버스를 직접 읽지 않아 읽기 경고가 없다)
  const probe = document.createElement('canvas');
  probe.width = refFrame.w;
  probe.height = refFrame.h;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  if (!pctx) throw new Error('2d');
  const grab = (src: HTMLCanvasElement): Uint8ClampedArray => {
    pctx.clearRect(0, 0, refFrame.w, refFrame.h);
    pctx.drawImage(src, refFrame.x, refFrame.y, refFrame.w, refFrame.h, 0, 0, refFrame.w, refFrame.h);
    return pctx.getImageData(0, 0, refFrame.w, refFrame.h).data;
  };
  const ref = grab(build.canvas);
  const cands = (window.__charCanvases ?? [])
    .map((r) => r.deref())
    .filter(
      (c): c is HTMLCanvasElement =>
        !!c && c !== build.canvas && c.width === build.canvas.width && c.height === build.canvas.height,
    );
  // 같은 크기 캔버스 중 기준 칸 화소가 가장 비슷한 것
  let target: HTMLCanvasElement | null = null;
  let best = Infinity;
  for (const c of cands) {
    const px = grab(c);
    let diff = 0;
    for (let i = 0; i < px.length; i += 16) diff += Math.abs((px[i] ?? 0) - (ref[i] ?? 0));
    if (diff < best) {
      best = diff;
      target = c;
    }
  }
  if (!target) throw new Error(`캐릭터 아틀라스 캔버스를 찾지 못함 (후보 ${cands.length})`);
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('2d');
  const tpw = build.texPerWorld;
  const unitPx = { s: R.s * TILE * tpw, m: R.m * TILE * tpw };
  let patched = 0;
  let cleared = 0;
  for (const [name, f] of build.frames) {
    const art = frameArt(name);
    if (art === undefined) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x, f.y, f.w, f.h);
    ctx.clip();
    ctx.clearRect(f.x, f.y, f.w, f.h);
    if (art) {
      ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
      drawToCanvas(ctx, art.d, unitPx[art.unit]);
      patched += 1;
    } else cleared += 1;
    ctx.restore();
  }
  return { patched, cleared, size: `${target.width}x${target.height}` };
}

let uid = 0;
/**
 * 로비 역할 카드 새 그림: viewBox −80..80, 발밑 무대 빛 + 정면 캐릭터 (옛 roleFigureSvg와 같은 상자).
 * 위 · 오른쪽 위('내 역할' 배지)에 여백을 두게 상자의 약 80%로 그리고 조금 내린다 (휴대폰 카드에서 뿔 · 후드 끝이 잘리지 않게)
 */
const FIGURE: Record<Role, { size: number; dx: number; dy: number }> = {
  runner: { size: 120, dx: -8, dy: 8 },
  guard: { size: 120, dx: 0, dy: 8 },
  scout: { size: 120, dx: 0, dy: 8 },
  monster: { size: 128, dx: 0, dy: 6 },
};

export function newRoleFigureSvg(role: Role): string {
  uid += 1;
  const base = ROLE[role];
  const { size, dx, dy } = FIGURE[role];
  const k = size / 2;
  const d =
    role === 'monster'
      ? MONSTER_ART.front(FRONT_REST, { w: 2.6 / k })
      : SURVIVOR_ART[role].front(FRONT_REST, { w: 2.6 / k });
  const inner = toSvg(d, { viewBox: [-1, -1, 2, 2], idPrefix: `nf${uid}x` })
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '');
  const c = hexCss(base);
  return (
    `<svg viewBox="-80 -80 160 160" aria-hidden="true"><defs><radialGradient id="np${uid}" cx="0" cy="62" r="70" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${c}" stop-opacity=".5"/><stop offset=".5" stop-color="${c}" stop-opacity=".12"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient></defs>` +
    `<ellipse cx="0" cy="62" rx="76" ry="22" fill="url(#np${uid})"/>` +
    `<ellipse cx="0" cy="66" rx="${k * 0.62}" ry="${k * 0.12}" fill="#000" opacity=".45"/>` +
    `<g transform="translate(${dx} ${dy}) scale(${k})">${inner}</g></svg>`
  );
}

window.CHAR_INJECT = { patchAtlas, newRoleFigureSvg };
