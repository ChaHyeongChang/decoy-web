// 캐릭터 리디자인 1단계 산출물 (브라우저 쪽): 캐릭터별 큰 그림 시트 · 다섯 나란히 · 애니메이션 장면(GIF 프레임).
// scripts/char-art.mjs의 sheets · gifs 명령이 esbuild로 묶어 Chromium에서 부른다. 게임 코드는 바꾸지 않는다.
// 애니메이션 시간은 규칙 값(balance.json: 공격 준비 0.4초 · 돌진 0.25초 · 4타일 · 기절 1.5초 · 구조 3초 · 능력 노출 1초 ·
// 생존자 5타일/초 · 괴물 5.5타일/초 · 질주 ×1.45)과 장식 값(VISUAL_SPEC 6장: 숨쉬기 2.6초 · 걸음 1.1타일 · 피격 번쩍 80ms ·
// 찌그러짐 120ms · 흩어짐 · 나타남 300ms · 베기 120ms · 망토 1.9 / 0.75초 · 깜빡임 3.4초 · 보호 깜빡임 150ms)을 따른다.
import type { CharId, MonsterPose, SurvivorPose } from '../../client/src/art/chars/types';
import {
  BG,
  DEVICES,
  NAMES,
  R_TILES,
  TEXT_COLOR,
  attackFan,
  bubble,
  canvas,
  dissolve,
  floor,
  grayscale,
  injury,
  kindOf,
  newFront,
  newTop,
  oldTop,
  prisonCell,
  radiusPx,
  rescueRing,
  revealMark,
  shockwave,
  slashArc,
  sparks,
  speedLines,
  stunStars,
  text,
  trackMark,
  vignette,
  zoomCopy,
  type Ctx,
  type Device,
} from './draw';

const TAU = Math.PI * 2;
const STRIDE_TILES = 1.1;
const SPEED = { survivor: 5, monster: 5.5, sprint: 5 * 1.45 } as const;
const RULE = { windup: 0.4, strike: 0.12, dash: 0.25, dashTiles: 4, stun: 1.5, rescue: 3, reveal: 1, attackRange: 1.2 } as const;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
/** a~b 구간에서 0 → 1 (부드럽게) */
function ramp(t: number, a: number, b: number): number {
  const k = clamp01((t - a) / Math.max(1e-6, b - a));
  return k * k * (3 - 2 * k);
}
function breath(t: number, seed = 0): number {
  return 1 + 0.016 * Math.sin((TAU * t) / 2.6 + seed);
}
function blink(t: number): 'open' | 'blink' {
  const p = (((t + 0.7) % 3.4) + 3.4) % 3.4;
  return p < 0.13 ? 'blink' : 'open';
}
function cloakPhase(t: number, moving: boolean): number {
  return (TAU * t) / (moving ? 0.75 : 1.9);
}

// ───────────────────────── 걷기 길 (경기장 모양 고리) ─────────────────────────

interface Track {
  cx: number;
  cy: number;
  /** 직선 반 길이 · 반원 반지름 (타일) */
  half: number;
  rad: number;
  tile: number;
}

function trackLen(tr: Track): number {
  return 4 * tr.half + TAU * tr.rad;
}

/** 길 위 거리 s(타일)의 자리(px) · 바라보는 방향 */
function onTrack(tr: Track, s0: number): { x: number; y: number; face: number } {
  const L = trackLen(tr);
  let s = ((s0 % L) + L) % L;
  const T = tr.tile;
  const top = 2 * tr.half;
  const arc = Math.PI * tr.rad;
  if (s < top) return { x: tr.cx + (-tr.half + s) * T, y: tr.cy - tr.rad * T, face: 0 };
  s -= top;
  if (s < arc) {
    const a = -Math.PI / 2 + s / tr.rad;
    return { x: tr.cx + (tr.half + Math.cos(a) * tr.rad) * T, y: tr.cy + Math.sin(a) * tr.rad * T, face: a + Math.PI / 2 };
  }
  s -= arc;
  if (s < top) return { x: tr.cx + (tr.half - s) * T, y: tr.cy + tr.rad * T, face: Math.PI };
  s -= top;
  const a = Math.PI / 2 + s / tr.rad;
  return { x: tr.cx + (-tr.half + Math.cos(a) * tr.rad) * T, y: tr.cy + Math.sin(a) * tr.rad * T, face: a + Math.PI / 2 };
}

function drawTrack(ctx: Ctx, tr: Track): void {
  ctx.save();
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = 'rgba(148,163,184,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 80; i += 1) {
    const p = onTrack(tr, (trackLen(tr) * i) / 80);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

// ───────────────────────── 장면 ─────────────────────────

export interface Scene {
  id: string;
  /** 제목 (한국어) */
  label: string;
  /** 한 줄 설명 */
  note: string;
  dur: number;
  w: number;
  h: number;
  draw(ctx: Ctx, t: number): void;
}

type SurvivorRole = 'runner' | 'guard' | 'scout';

function header(ctx: Ctx, w: number, title: string, note: string, color: string): void {
  ctx.fillStyle = 'rgba(11,22,34,0.82)';
  ctx.fillRect(0, 0, w, 50);
  text(ctx, title, 14, 22, 17, color, 700);
  text(ctx, note, 14, 42, 12.5, '#94a3b8', 500);
}

function stage(ctx: Ctx, w: number, h: number, tile: number): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  floor(ctx, 0, 0, w, h, tile, w / 2, h / 2);
  vignette(ctx, w, h);
}

/** 서기 (생존자 · 괴물): 위에서 본 그림 숨쉬기 + 정면 숨쉬기 */
function idleScene(id: CharId): Scene {
  const isM = id === 'monster';
  const dur = isM ? 3.8 : 2.6;
  return {
    id: `${id}-idle`,
    label: `${NAMES[id]} · 대기`,
    note: isM ? '망토 자락 물결 1.9초 · 눈 깜빡임 3.4초 · 숨쉬기' : '숨쉬기 2.6초 (위 그림 · 정면 그림 같은 주기)',
    dur,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 300, 340, 160);
      ctx.fillStyle = '#0f1b27';
      ctx.fillRect(300, 0, 260, 340);
      const r = isM ? 62 : 58;
      const s = breath(t, 0) * (isM ? 1 + 0.012 * Math.sin(2.4 * t) - 0.016 * Math.sin((TAU * t) / 2.6) : 1);
      const pose = isM ? { cloak: cloakPhase(t, false), eyes: blink(t) } : {};
      newTop(ctx, id, pose, 150, 200, r, -Math.PI / 2, { sx: s, sy: s });
      newFront(ctx, id, { t }, 430, 196, 250, 3.2);
      header(ctx, 560, this.label, this.note, TEXT_COLOR[id]);
    },
  };
}

/** 걷기: 고리 길을 실제 빠르기로 돌며 모든 방향을 보인다 (걸음 위상 = 간 거리 / 1.1타일) */
function walkScene(id: CharId): Scene {
  const isM = id === 'monster';
  const tile = 100;
  const tr: Track = { cx: 280, cy: 205, half: 0.85, rad: 1.0, tile };
  const v = isM ? SPEED.monster : SPEED.survivor;
  const dur = trackLen(tr) / v;
  return {
    id: `${id}-walk`,
    label: `${NAMES[id]} · 걷기 (모든 방향)`,
    note: `실제 빠르기 ${v}타일/초 · 걸음 한 주기 ${STRIDE_TILES}타일 · 바라보는 방향으로 몸이 돈다`,
    dur,
    w: 560,
    h: 360,
    draw(ctx, t) {
      stage(ctx, 560, 360, tile);
      drawTrack(ctx, tr);
      const d = t * v;
      const p = onTrack(tr, d);
      const walk = (TAU * d) / STRIDE_TILES;
      const r = R_TILES[kindOf(id)] * tile;
      const pose = isM ? { walk, stride: 1, cloak: cloakPhase(t, true), eyes: blink(t) } : { walk, stride: 1 };
      // 게임과 같이 생존자는 걸음에 맞춰 몸을 ±4° 기울인다 (괴물은 기울이지 않음)
      newTop(ctx, id, pose, p.x, p.y, r, p.face + (isM ? 0 : ((4 * Math.PI) / 180) * Math.sin(walk)));
      header(ctx, 560, this.label, this.note, TEXT_COLOR[id]);
    },
  };
}

/** 러너 질주: 고리 길을 걷다가 질주(×1.45, 앞으로 숙임 + 속도선) */
function sprintScene(): Scene {
  const tile = 100;
  const tr: Track = { cx: 280, cy: 205, half: 0.85, rad: 1.0, tile };
  const L = trackLen(tr);
  const tWalk = L / SPEED.survivor;
  const tSprint = L / SPEED.sprint;
  return {
    id: 'runner-ability',
    label: '러너 · 질주 (능력)',
    note: '3초 동안 ×1.45 빠르게: 앞으로 숙이고 팔을 접고 후드 끝이 뒤로 날린다 (속도선은 생존자 화면만)',
    dur: tWalk + tSprint,
    w: 560,
    h: 360,
    draw(ctx, t) {
      stage(ctx, 560, 360, tile);
      drawTrack(ctx, tr);
      const sprinting = t >= tWalk;
      const d = sprinting ? L + (t - tWalk) * SPEED.sprint : t * SPEED.survivor;
      const p = onTrack(tr, d);
      const walk = (TAU * d) / STRIDE_TILES;
      const action = sprinting ? ramp(t, tWalk, tWalk + 0.15) * (1 - ramp(t, tWalk + tSprint - 0.12, tWalk + tSprint)) : 0;
      const r = R_TILES.survivor * tile;
      if (sprinting) speedLines(ctx, p.x, p.y, p.face, r, t);
      newTop(ctx, 'runner', { walk, stride: 1, action }, p.x, p.y, r, p.face);
      text(ctx, sprinting ? '질주 중' : '걷기', 280, 340, 15, sprinting ? '#60a5fa' : '#94a3b8', 700, 'center');
      header(ctx, 560, this.label, this.note, TEXT_COLOR.runner);
    },
  };
}

/** 가드 밀치기: 방패를 당겼다가 내지르기 → 괴물 기절 1.5초 */
function shoveScene(): Scene {
  const tile = 150;
  const gx = 190;
  const gy = 210;
  const mx = gx + 1.55 * tile;
  return {
    id: 'guard-ability',
    label: '가드 · 밀치기 (능력)',
    note: '방패를 당겨 힘을 모았다가 앞으로 내지른다 → 2타일 안 괴물 기절 1.5초',
    dur: 2.8,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const action = t < 0.4 ? 0 : t < 0.55 ? 0.5 * ramp(t, 0.4, 0.55) : t < 0.66 ? 0.5 + 0.5 * ramp(t, 0.55, 0.66) : 1 - ramp(t, 0.95, 1.3);
      const hit = 0.66;
      const stunK = t >= hit && t < hit + RULE.stun ? ramp(t, hit, hit + 0.12) * (1 - ramp(t, hit + RULE.stun - 0.25, hit + RULE.stun)) : 0;
      const mPose: Partial<MonsterPose> = { stun: stunK, eyes: stunK > 0.5 ? 'stun' : blink(t), cloak: cloakPhase(t, false) };
      newTop(ctx, 'monster', mPose, mx, gy, R_TILES.monster * tile, Math.PI);
      if (t >= hit && t < hit + RULE.stun) stunStars(ctx, mx, gy, R_TILES.monster * tile, t);
      shockwave(ctx, gx + 0.55 * tile, gy, 8, 0.9 * tile, (t - hit + 0.02) / 0.35, 0xe9d5ff, 0.75);
      shockwave(ctx, mx, gy, 6, 0.6 * tile, (t - hit) / 0.3, 0xfde68a, 0.7);
      newTop(ctx, 'guard', { action }, gx, gy, R_TILES.survivor * tile, 0);
      header(ctx, 560, this.label, this.note, TEXT_COLOR.guard);
    },
  };
}

/** 스카우트 탐지: 망원경을 들어 늘인다 → 셔터 + 괴물 자리 초록 표시 */
function trackScene(): Scene {
  const tile = 150;
  const sx = 170;
  const sy = 210;
  return {
    id: 'scout-ability',
    label: '스카우트 · 탐지 (능력)',
    note: '망원경을 눈에 대고 늘인다 → 4초 동안 괴물 위치를 팀 전원 화면에 (초록 표시)',
    dur: 3.2,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const action = ramp(t, 0.3, 0.7) * (1 - ramp(t, 2.4, 2.8));
      shockwave(ctx, sx + 0.9 * tile, sy, 0.9 * tile, 10, (t - 0.7) / 0.3, 0xdcfce7, 0.8);
      if (t >= 0.7) trackMark(ctx, 470, 150, 16, t - 0.7);
      newTop(ctx, 'scout', { action }, sx, sy, R_TILES.survivor * tile, -0.25);
      header(ctx, 560, this.label, this.note, TEXT_COLOR.scout);
    },
  };
}

/** 피격: 괴물 공격 준비 → 베기 → 흰 번쩍 80ms · 찌그러짐 120ms · 젖힘 · 불꽃 → 부상 표시 */
function hitScene(role: SurvivorRole): Scene {
  const tile = 150;
  const sx = 200;
  const sy = 205;
  const mx = sx + 1.05 * tile;
  const tHit = 0.2 + RULE.windup;
  return {
    id: `${role}-hit`,
    label: `${NAMES[role]} · 피격`,
    note: '흰 번쩍 80ms · 찌그러짐 120ms · 뒤로 젖힘 · 불꽃 0.2초 → 부상(체력 1)은 몸 뒤 붉은 긁힘',
    dur: 2.0,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const windup = ramp(t, 0.2, tHit) * (1 - ramp(t, tHit, tHit + 0.05));
      const strike = t >= tHit && t < tHit + 0.35 ? clamp01((t - tHit) / RULE.strike) * (1 - ramp(t, tHit + 0.15, tHit + 0.35)) : 0;
      if (t >= 0.2 && t < tHit) attackFan(ctx, mx, sy, Math.PI, RULE.attackRange * tile, (t - 0.2) / RULE.windup);
      const dt = t - tHit;
      const hit = dt >= 0 ? Math.max(0, 1 - dt / 0.3) : 0;
      const squash = dt >= 0 && dt < 0.12 ? Math.sin((Math.PI * dt) / 0.12) : 0;
      const flash = dt >= 0 && dt < 0.08 ? 1 - dt / 0.08 : 0;
      const r = R_TILES.survivor * tile;
      if (dt >= 0) injury(ctx, sx, sy, 0, r);
      newTop(ctx, role, { hit }, sx, sy, r, 0, { sx: 1 + squash * 0.16, sy: 1 - squash * 0.16 });
      if (flash > 0)
        newTop(ctx, role, { hit, tone: 'flash' }, sx, sy, r, 0, { shadow: false, alpha: 0.9 * flash, sx: 1 + squash * 0.16, sy: 1 - squash * 0.16 });
      sparks(ctx, sx, sy, r, dt, 3);
      newTop(ctx, 'monster', { windup, strike, cloak: cloakPhase(t, false), eyes: 'open' }, mx, sy, R_TILES.monster * tile, Math.PI);
      if (dt >= 0) slashArc(ctx, mx, sy, Math.PI, RULE.attackRange * tile, dt / RULE.strike);
      header(ctx, 560, this.label, this.note, TEXT_COLOR[role]);
    },
  };
}

/** 수감: 두 번째 피격 → 흩어짐 0.3초 → 감옥에서 나타남 0.3초 (움츠린 자세) */
function imprisonScene(role: SurvivorRole): Scene {
  const tile = 130;
  const sx = 150;
  const sy = 215;
  const mx = sx + 1.05 * tile;
  const cell = { x: 380, y: 112, w: 160, h: 160 };
  const tHit = 0.2 + RULE.windup;
  return {
    id: `${role}-imprison`,
    label: `${NAMES[role]} · 수감`,
    note: '두 번째 피격: 붉게 흩어짐 0.3초 → 감옥 안에서 0.3초 나타남, 움츠린 수감 자세',
    dur: 3.0,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      prisonCell(ctx, cell.x, cell.y, cell.w, cell.h, tile);
      const windup = ramp(t, 0.2, tHit) * (1 - ramp(t, tHit, tHit + 0.05));
      const strike = t >= tHit && t < tHit + 0.35 ? clamp01((t - tHit) / RULE.strike) * (1 - ramp(t, tHit + 0.15, tHit + 0.35)) : 0;
      if (t >= 0.2 && t < tHit) attackFan(ctx, mx, sy, Math.PI, RULE.attackRange * tile, (t - 0.2) / RULE.windup);
      const r = R_TILES.survivor * tile;
      const dt = t - tHit;
      if (dt < 0) {
        injury(ctx, sx, sy, 0, r);
        newTop(ctx, role, {}, sx, sy, r, 0);
      } else if (dt < 0.08) newTop(ctx, role, { hit: 1, tone: 'flash' }, sx, sy, r, 0);
      dissolve(ctx, sx, sy, r, dt - 0.06);
      const appear = ramp(t, tHit + 0.36, tHit + 0.66);
      if (appear > 0) {
        const cx = cell.x + cell.w / 2;
        const cy = cell.y + cell.h / 2;
        newTop(ctx, role, { mode: 'captive' }, cx, cy, r, Math.PI / 2, { alpha: appear, sx: breath(t), sy: breath(t) });
      }
      newTop(ctx, 'monster', { windup, strike, cloak: cloakPhase(t, false) }, mx, sy, R_TILES.monster * tile, Math.PI);
      if (dt >= 0) slashArc(ctx, mx, sy, Math.PI, RULE.attackRange * tile, dt / RULE.strike);
      header(ctx, 560, this.label, this.note, TEXT_COLOR[role]);
    },
  };
}

const RESCUED: Record<SurvivorRole, SurvivorRole> = { runner: 'guard', guard: 'scout', scout: 'runner' };

/** 구조: 문 앞에서 두 손을 뻗어 3초 → 갇힌 팀원이 풀려나 보호(반투명 + 거품 깜빡임) */
function rescueScene(role: SurvivorRole): Scene {
  const tile = 120;
  const cell = { x: 200, y: 62, w: 160, h: 150 };
  const doorX = cell.x + cell.w / 2;
  const doorY = cell.y + cell.h;
  const rx = doorX;
  const ry = doorY + 0.75 * tile;
  const mate = RESCUED[role];
  const t0 = 0.3;
  const t1 = t0 + RULE.rescue;
  return {
    id: `${role}-rescue`,
    label: `${NAMES[role]} · 구조`,
    note: `문 앞에서 두 손으로 자물쇠를 3초 → 갇힌 팀원(${NAMES[mate]})이 풀려나 4초 보호 (반투명 + 거품 깜빡임)`,
    dur: t1 + 1.6,
    w: 560,
    h: 360,
    draw(ctx, t) {
      stage(ctx, 560, 360, tile);
      prisonCell(ctx, cell.x, cell.y, cell.w, cell.h, tile, ramp(t, t1, t1 + 0.2));
      const r = R_TILES.survivor * tile;
      const working = t >= t0 && t < t1;
      if (working) rescueRing(ctx, rx, ry, tile, (t - t0) / RULE.rescue);
      if (t < t1) newTop(ctx, mate, { mode: 'captive' }, doorX, cell.y + cell.h * 0.45, r, Math.PI / 2, { sx: breath(t), sy: breath(t) });
      else {
        const k = ramp(t, t1, t1 + 0.15);
        const px = rx + 0.75 * tile;
        const py = ry - 0.1 * tile;
        const blinkOn = Math.floor(((t - t1) * 1000) / 150) % 2 === 0;
        newTop(ctx, mate, {}, px, py, r, -Math.PI / 2 + 0.4, { alpha: 0.5 * k });
        bubble(ctx, px, py, r, blinkOn);
      }
      newTop(ctx, role, { mode: working ? 'reach' : 'free' }, rx, ry, r, -Math.PI / 2);
      header(ctx, 560, this.label, this.note, TEXT_COLOR[role]);
    },
  };
}

// ───────────────────────── 공통 생존자 (괴물 화면) ─────────────────────────

function commonWalkScene(): Scene {
  const tile = 100;
  const tr: Track = { cx: 280, cy: 205, half: 0.85, rad: 1.0, tile };
  const L = trackLen(tr);
  return {
    id: 'common-walk',
    label: '공통 생존자 · 괴물 화면의 세 생존자',
    note: '러너 · 가드 · 스카우트 누구든 같은 그림 · 같은 크기 · 같은 걸음 · 같은 숨쉬기 (역할 단서 없음)',
    dur: L / SPEED.survivor,
    w: 560,
    h: 360,
    draw(ctx, t) {
      stage(ctx, 560, 360, tile);
      drawTrack(ctx, tr);
      for (let i = 0; i < 3; i += 1) {
        const d = t * SPEED.survivor + (L * i) / 3;
        const p = onTrack(tr, d);
        newTop(ctx, 'common', { walk: (TAU * d) / STRIDE_TILES, stride: 1 }, p.x, p.y, R_TILES.survivor * tile, p.face);
      }
      header(ctx, 560, this.label, this.note, TEXT_COLOR.common);
    },
  };
}

function commonStatusScene(): Scene {
  const tile = 130;
  const r = R_TILES.survivor * tile;
  return {
    id: 'common-status',
    label: '공통 생존자 · 보호 · 능력 노출',
    note: '보호(구조 직후 4초): 흰색 50% + 거품 깜빡임 150ms · 능력 노출 1초: 역할색 테두리 + 머리 위 역할 아이콘',
    dur: 2.6,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const s = breath(t, 0);
      newTop(ctx, 'common', {}, 110, 220, r, -Math.PI / 2, { sx: s, sy: s });
      text(ctx, '보통', 110, 318, 13, '#94a3b8', 700, 'center');
      const blinkOn = Math.floor((t * 1000) / 150) % 2 === 0;
      newTop(ctx, 'common', {}, 280, 220, r, -Math.PI / 2, { alpha: 0.5, sx: s, sy: s });
      bubble(ctx, 280, 220, r, blinkOn);
      text(ctx, '보호 중', 280, 318, 13, '#94a3b8', 700, 'center');
      const rev = t >= 0.5 && t < 0.5 + RULE.reveal;
      if (rev) revealMark(ctx, 450, 220, r, 'guard');
      newTop(ctx, 'common', {}, 450, 220, r, -Math.PI / 2, { sx: s, sy: s });
      text(ctx, rev ? '능력 노출 (예: 가드)' : '능력 노출 전', 450, 318, 13, rev ? '#c084fc' : '#94a3b8', 700, 'center');
      header(ctx, 560, this.label, this.note, TEXT_COLOR.common);
    },
  };
}

// ───────────────────────── 괴물 ─────────────────────────

function attackScene(slow: number): Scene {
  const tile = 150;
  const mx = 200;
  const my = 205;
  const t0 = 0.25;
  const span = (RULE.windup + RULE.strike + 0.45) * slow;
  return {
    id: slow > 1 ? 'monster-attack-slow' : 'monster-attack',
    label: slow > 1 ? `괴물 · 공격 준비 → 공격 (${slow}배 느리게)` : '괴물 · 공격 준비 → 공격',
    note: '준비 0.4초: 발톱을 뒤로 젖혀 들고 범위가 0 → 100% 차오름 → 타격 0.12초: 두 발톱을 앞으로 휘두름 (전방 90° · 1.2타일)',
    dur: t0 + span + 0.35,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const u = (t - t0) / slow;
      const windup = u < 0 ? 0 : u < RULE.windup ? ramp(u, 0, RULE.windup) : 1 - ramp(u, RULE.windup, RULE.windup + 0.06);
      const su = u - RULE.windup;
      const strike = su >= 0 && su < 0.5 ? clamp01(su / RULE.strike) * (1 - ramp(su, 0.2, 0.45)) : 0;
      if (u >= 0 && u < RULE.windup) attackFan(ctx, mx, my, 0, RULE.attackRange * tile, u / RULE.windup);
      newTop(ctx, 'monster', { windup, strike, cloak: cloakPhase(t / slow, false), eyes: 'open' }, mx, my, R_TILES.monster * tile, 0);
      if (su >= 0) slashArc(ctx, mx, my, 0, RULE.attackRange * tile, su / RULE.strike);
      text(ctx, u < 0 ? '대기' : u < RULE.windup ? '공격 준비' : su < 0.25 ? '타격' : '회복', mx, 320, 15, '#f87171', 700, 'center');
      header(ctx, 560, this.label, this.note, TEXT_COLOR.monster);
    },
  };
}

function windupScene(): Scene {
  const tile = 150;
  return {
    id: 'monster-windup',
    label: '괴물 · 공격 준비',
    note: '0.4초 동안 팔을 뒤로 젖혀 발톱을 높이 들고 망토가 부푼다 (범위 표시는 판정값 그대로, 이동 가능)',
    dur: 1.3,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const windup = ramp(t, 0.2, 0.6) * (1 - ramp(t, 1.0, 1.15));
      if (t >= 0.2 && t < 1.0) attackFan(ctx, 220, 205, 0, RULE.attackRange * tile, Math.min(1, (t - 0.2) / RULE.windup));
      newTop(ctx, 'monster', { windup, cloak: cloakPhase(t, false) }, 220, 205, R_TILES.monster * tile, 0);
      header(ctx, 560, this.label, this.note, TEXT_COLOR.monster);
    },
  };
}

function dashScene(slow: number): Scene {
  const tile = 64;
  const y = 210;
  const x0 = 80;
  const t0 = 0.45;
  const dashS = RULE.dash * slow;
  return {
    id: slow > 1 ? 'monster-dash-slow' : 'monster-dash',
    label: slow > 1 ? `괴물 · 돌진 (${slow}배 느리게)` : '괴물 · 돌진',
    note: '0.25초에 4타일: 몸을 낮추고 앞으로 늘어나며 망토가 뒤로 흐름 + 잔상(33ms마다) + 붉은 줄',
    dur: t0 + dashS + 0.9,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const r = R_TILES.monster * tile;
      const k = clamp01((t - t0) / dashS);
      const x = x0 + RULE.dashTiles * tile * k;
      const dashing = t >= t0 && t < t0 + dashS;
      const dash = dashing ? 1 - 0.35 * k : 1 - ramp(t, t0 + dashS, t0 + dashS + 0.2 * slow);
      const dashPose = t >= t0 ? dash : ramp(t, t0 - 0.06, t0);
      // 잔상: 돌진 시작부터 33ms 격자마다 하나, 수명 0.25초
      if (t >= t0) {
        const ghosts: { gx: number; a: number }[] = [];
        for (let g = 0; g * (1 / 30) * slow < Math.min(t - t0, dashS); g += 1) {
          const tg = t0 + g * (1 / 30) * slow;
          const age = (t - tg) / (RULE.dash * slow);
          if (age > 1) continue;
          ghosts.push({ gx: x0 + RULE.dashTiles * tile * clamp01((tg - t0) / dashS), a: 0.35 * (1 - age) });
        }
        for (let i = 1; i < ghosts.length; i += 1) {
          const p = ghosts[i - 1];
          const q = ghosts[i];
          if (!p || !q) continue;
          ctx.strokeStyle = `rgba(239,68,68,${0.35 * q.a * 2})`;
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(p.gx, y);
          ctx.lineTo(q.gx, y);
          ctx.stroke();
        }
        for (const gh of ghosts) newTop(ctx, 'monster', { dash: 1 }, gh.gx, y, r, 0, { shadow: false, alpha: gh.a });
      }
      newTop(ctx, 'monster', { dash: dashPose, cloak: cloakPhase(t / slow, true) }, x, y, r, 0);
      header(ctx, 560, this.label, this.note, TEXT_COLOR.monster);
    },
  };
}

function roarScene(): Scene {
  const tile = 150;
  const mx = 280;
  const my = 210;
  return {
    id: 'monster-roar',
    label: '괴물 · 포효',
    note: '고개를 젖히고 빛나는 이빨을 드러내며 팔을 벌린다 · 충격파 0.6초 (반경 10타일 생존자 위치를 괴물에게 1.5초)',
    dur: 2.3,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const roar = ramp(t, 0.3, 0.45) * (1 - ramp(t, 1.05, 1.35));
      const k = (t - 0.4) / 0.6;
      if (k >= 0 && k <= 1) {
        const e = 1 - (1 - k) ** 2;
        const rr = 20 + 300 * e;
        ctx.save();
        ctx.lineWidth = 10;
        ctx.strokeStyle = `rgba(245,158,11,${0.22 * (1 - k) * 0.5})`;
        ctx.beginPath();
        ctx.arc(mx, my, Math.max(1, rr - 6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(245,158,11,${0.22 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(mx, my, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      newTop(ctx, 'monster', { roar, cloak: cloakPhase(t, false) }, mx, my, R_TILES.monster * tile, -Math.PI / 2);
      header(ctx, 560, this.label, this.note, TEXT_COLOR.monster);
    },
  };
}

function stunScene(): Scene {
  const tile = 150;
  const mx = 280;
  const my = 215;
  const t0 = 0.25;
  return {
    id: 'monster-stun',
    label: '괴물 · 기절',
    note: '가드 밀치기에 맞으면 1.5초: 축 처지고 팔이 늘어지며 눈이 × · 머리 위 별 셋',
    dur: t0 + RULE.stun + 0.55,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const on = t >= t0 && t < t0 + RULE.stun;
      const stun = ramp(t, t0, t0 + 0.12) * (1 - ramp(t, t0 + RULE.stun - 0.2, t0 + RULE.stun + 0.1));
      shockwave(ctx, mx, my, 6, 0.6 * tile, (t - t0) / 0.3, 0xfde68a, 0.7);
      newTop(ctx, 'monster', { stun, eyes: on ? 'stun' : blink(t), cloak: cloakPhase(t, false) }, mx, my, R_TILES.monster * tile, 0.35);
      if (on) stunStars(ctx, mx, my, R_TILES.monster * tile, t);
      header(ctx, 560, this.label, this.note, TEXT_COLOR.monster);
    },
  };
}

/** 실제 크기 걷기: 다섯 캐릭터가 휴대폰 실제 화소 크기(배율 3)로 걷는 것을 최근접 2배 확대 */
function actualWalkScene(dev: Device, zoom: number): Scene {
  const ids: CharId[] = ['runner', 'guard', 'scout', 'common', 'monster'];
  const rS = radiusPx('survivor', dev);
  const tile = rS / R_TILES.survivor;
  const cellW = Math.ceil(tile * 3.6);
  const cellH = Math.ceil(tile * 2.6);
  // 괴물 길은 빠르기 비율(5.5 / 5)만큼 크게: 다섯이 같은 시간에 한 바퀴를 돈다
  const tr = (i: number): Track => {
    const k = ids[i] === 'monster' ? SPEED.monster / SPEED.survivor : 1;
    return { cx: cellW * (i + 0.5), cy: cellH / 2, half: 0.75 * k, rad: 0.8 * k, tile };
  };
  const L = trackLen(tr(0));
  const W = cellW * 5;
  return {
    id: 'actual-size-walk',
    label: `다섯 캐릭터 실제 크기로 걷기 — ${dev.name} (기기 화소 ${zoom}배 최근접 확대)`,
    note: '생존자 5타일/초 · 괴물 5.5타일/초 · 왼쪽부터 러너 · 가드 · 스카우트 · 공통 생존자(괴물 화면) · 괴물',
    dur: L / SPEED.survivor,
    w: W * zoom,
    h: cellH * zoom + 56,
    draw(ctx, t) {
      const small = canvas(W, cellH);
      floor(small.ctx, 0, 0, W, cellH, tile);
      ids.forEach((id, i) => {
        const v = id === 'monster' ? SPEED.monster : SPEED.survivor;
        const d = t * v;
        const p = onTrack(tr(i), d);
        const walk = (TAU * d) / STRIDE_TILES;
        const r = radiusPx(kindOf(id), dev);
        const pose = id === 'monster' ? { walk, stride: 1, cloak: cloakPhase(t, true) } : { walk, stride: 1 };
        newTop(small.ctx, id, pose, p.x, p.y, r, p.face);
      });
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, this.w, this.h);
      zoomCopy(ctx, small.c, 0, 0, W, cellH, 0, 56, zoom);
      text(ctx, this.label, 12, 22, 16, '#e2e8f0', 700);
      text(ctx, this.note, 12, 44, 12.5, '#94a3b8', 500);
    },
  };
}

export function scenes(): Scene[] {
  const out: Scene[] = [];
  for (const role of ['runner', 'guard', 'scout'] as const) {
    out.push(idleScene(role), walkScene(role));
    out.push(role === 'runner' ? sprintScene() : role === 'guard' ? shoveScene() : trackScene());
    out.push(hitScene(role), imprisonScene(role), rescueScene(role));
  }
  out.push(idleScene('common'), commonWalkScene(), commonStatusScene());
  out.push(idleScene('monster'), walkScene('monster'), windupScene(), attackScene(1), attackScene(4));
  out.push(dashScene(1), dashScene(4), roarScene(), stunScene());
  out.push(actualWalkScene(DEVICES.phone3, 2));
  return out;
}

export function sceneList(): { id: string; label: string; dur: number; w: number; h: number }[] {
  return scenes().map((s) => ({ id: s.id, label: s.label, dur: s.dur, w: s.w, h: s.h }));
}

/** 장면 프레임들 (PNG data URL). t = from + i / fps */
export function sceneFrames(id: string, fps: number, from = 0, count?: number): string[] {
  const s = scenes().find((x) => x.id === id);
  if (!s) throw new Error(`장면 없음: ${id}`);
  const n = count ?? Math.round(s.dur * fps);
  const { c, ctx } = canvas(s.w, s.h);
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = from + i / fps;
    ctx.save();
    s.draw(ctx, ((t % s.dur) + s.dur) % s.dur);
    ctx.restore();
    out.push(c.toDataURL('image/png'));
  }
  return out;
}

/** 모아 보기: 한 캐릭터의 장면 여럿을 격자로 (각 칸은 제 길이로 되풀이) */
export function overviewFrames(prefix: string, fps: number, from: number, count: number, cols = 3): { w: number; h: number; frames: string[] } {
  const list = scenes().filter((s) => s.id.startsWith(`${prefix}-`) && !s.id.endsWith('-slow'));
  const cw = 420;
  const ch = 255;
  const rows = Math.ceil(list.length / cols);
  const W = cw * cols;
  const H = ch * rows;
  const { c, ctx } = canvas(W, H);
  const cells = list.map((s) => ({ s, ...canvas(s.w, s.h) }));
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = from + i / fps;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    cells.forEach((cell, k) => {
      cell.ctx.save();
      cell.s.draw(cell.ctx, ((t % cell.s.dur) + cell.s.dur) % cell.s.dur);
      cell.ctx.restore();
      const x = (k % cols) * cw;
      const y = Math.floor(k / cols) * ch;
      const sc = Math.min((cw - 6) / cell.s.w, (ch - 6) / cell.s.h);
      ctx.drawImage(cell.c, x + (cw - cell.s.w * sc) / 2, y + (ch - cell.s.h * sc) / 2, cell.s.w * sc, cell.s.h * sc);
    });
    out.push(c.toDataURL('image/png'));
  }
  return { w: W, h: H, frames: out };
}

// ───────────────────────── 큰 그림 시트 ─────────────────────────

const SURVIVOR_POSES: { label: string; pose: Partial<SurvivorPose> }[] = [
  { label: '서기', pose: {} },
  { label: '걷기', pose: { walk: Math.PI / 2, stride: 1 } },
  { label: '능력', pose: { action: 1 } },
  { label: '피격', pose: { hit: 1 } },
  { label: '수감', pose: { mode: 'captive' } },
  { label: '구조 중', pose: { mode: 'reach' } },
  { label: '사망', pose: { tone: 'gray' } },
];
const COMMON_POSES = SURVIVOR_POSES.filter((p) => p.label === '서기' || p.label === '걷기' || p.label === '수감' || p.label === '구조 중');
const MONSTER_POSES: { label: string; pose: Partial<MonsterPose> }[] = [
  { label: '서기', pose: {} },
  { label: '걷기', pose: { walk: Math.PI / 2, stride: 1, cloak: 1.2 } },
  { label: '공격 준비', pose: { windup: 1 } },
  { label: '타격', pose: { strike: 1 } },
  { label: '돌진', pose: { dash: 1 } },
  { label: '포효', pose: { roar: 1 } },
  { label: '기절', pose: { stun: 1, eyes: 'stun' } },
];

const CONCEPT: Record<CharId, string> = {
  runner: '후드와 운동화 — 가볍고 빠른 인상. 뒤로 흐르는 후드 끝이 옛 물방울 모티프를 잇는다',
  guard: '큰 방패를 든 단단한 체격 — 몸 앞의 두꺼운 방패 호가 실루엣의 핵심 (옛 방패 모티프)',
  scout: '렌즈 고글 · 망원경 — 한쪽으로 뻗은 망원경이 비대칭 실루엣을 만든다 (옛 렌즈 모티프)',
  common: '괴물 화면에서 셋을 대신하는 하나의 그림 — 흰 방호복 · 둥근 두건 · 가리개, 역할 단서 없음',
  monster: '위협적이고 기억에 남는 붉은 사냥꾼 — 뾰족한 형태로 둥근 생존자와 확연히 다르다',
};

export function sheet(id: CharId): string {
  const W = 1800;
  const H = 1240;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  text(ctx, NAMES[id], 36, 64, 44, TEXT_COLOR[id], 800);
  text(ctx, CONCEPT[id], 36, 104, 19, '#cbd5e1', 500);
  // 정면 큰 그림 (로비 카드 · 결과 화면용)
  ctx.fillStyle = '#0f1b27';
  ctx.fillRect(36, 130, 600, 640);
  text(ctx, '정면 (로비 카드 · 결과 · 아이콘)', 56, 166, 17, '#94a3b8', 700);
  const glow = ctx.createRadialGradient(336, 700, 0, 336, 700, 260);
  const col = TEXT_COLOR[id];
  glow.addColorStop(0, `${col}55`);
  glow.addColorStop(1, `${col}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(36, 430, 600, 340);
  newFront(ctx, id, {}, 336, 470, 560, 5);
  // 상반신 아이콘 크기들 + 회색(남이 고른 카드)
  ctx.fillStyle = '#0f1b27';
  ctx.fillRect(36, 790, 600, 350);
  text(ctx, '상반신 아이콘 (160 · 64 · 40 · 24px) · 회색', 56, 826, 17, '#94a3b8', 700);
  newFront(ctx, id, { bust: true }, 146, 960, 160, 3);
  newFront(ctx, id, { bust: true }, 290, 960, 64, 2);
  newFront(ctx, id, { bust: true }, 366, 960, 40, 1.5);
  newFront(ctx, id, { bust: true }, 420, 960, 24, 1.1);
  newFront(ctx, id, { bust: true, tone: 'gray' }, 540, 950, 110, 2.5);
  text(ctx, '회색 (남이 고른 카드)', 540, 1080, 13, '#94a3b8', 500, 'center');
  // 위에서 본 큰 그림
  const tile = 300;
  floor(ctx, 660, 130, 560, 640, tile / 2);
  text(ctx, '위에서 본 게임 그림 (위쪽 = 바라보는 방향)', 680, 166, 17, '#e2e8f0', 700);
  const rBig = R_TILES[kindOf(id)] * 600;
  newTop(ctx, id, {}, 940, 470, rBig, -Math.PI / 2);
  ctx.save();
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = 'rgba(148,163,184,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(940, 470, rBig, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  text(ctx, '점선 = 판정 원', 940, 750, 13, '#94a3b8', 500, 'center');
  // 자세 모음
  const poses = id === 'monster' ? MONSTER_POSES : id === 'common' ? COMMON_POSES : SURVIVOR_POSES;
  text(ctx, '자세', 1250, 166, 17, '#94a3b8', 700);
  poses.forEach((p, i) => {
    const x = 1250 + (i % 3) * 172;
    const y = 180 + Math.floor(i / 3) * 196;
    floor(ctx, x, y, 164, 188, 80);
    newTop(ctx, id, p.pose, x + 82, y + 90, id === 'monster' ? 44 : 42, -Math.PI / 2);
    text(ctx, p.label, x + 82, y + 180, 14, '#e2e8f0', 700, 'center');
  });
  // 실제 크기: 지금 vs 새 (세 방향씩, 오른쪽에 최근접 확대)
  text(ctx, '게임 속 실제 크기 (기기 화소 그대로) · 왼쪽 셋 = 지금 그림, 오른쪽 셋 = 새 그림 → 오른쪽은 최근접 확대', 660, 826, 15, '#94a3b8', 700);
  let y = 846;
  const devs = [DEVICES.phone3, DEVICES.phone2, DEVICES.pc768];
  const dirs = [-Math.PI / 2, 0.35, Math.PI * 0.8];
  for (const dev of devs) {
    const r = radiusPx(kindOf(id), dev);
    const cell = Math.ceil(r * 4.4);
    const stripW = cell * 6;
    const z = Math.min(3, (W - 36 - 660 - stripW - 24) / stripW);
    text(ctx, `${dev.name} · 반지름 ${r.toFixed(1)}px`, 660, y + 12, 12.5, '#cbd5e1', 500);
    const yy = y + 20;
    floor(ctx, 660, yy, stripW, cell, r / R_TILES[kindOf(id)]);
    dirs.forEach((a, i) => oldTop(ctx, id, 660 + cell * (i + 0.5), yy + cell / 2, r, a));
    dirs.forEach((a, i) => newTop(ctx, id, {}, 660 + cell * (i + 3.5), yy + cell / 2, r, a));
    zoomCopy(ctx, c, 660, yy, stripW, cell, 660 + stripW + 24, yy, z);
    y = yy + Math.max(cell, cell * z) + 10;
  }
  return c.toDataURL('image/png');
}

export function lineup(): string {
  const ids: CharId[] = ['runner', 'guard', 'scout', 'common', 'monster'];
  const W = 1900;
  const H = 1250;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  text(ctx, 'DECOY 새 캐릭터 — 다섯 나란히', 36, 58, 36, '#e2e8f0', 800);
  ids.forEach((id, i) => {
    const x = 36 + i * 370;
    ctx.fillStyle = '#0f1b27';
    ctx.fillRect(x, 84, 350, 760);
    text(ctx, NAMES[id], x + 175, 124, 26, TEXT_COLOR[id], 800, 'center');
    newFront(ctx, id, {}, x + 175, 330, 330, 4);
    floor(ctx, x + 25, 520, 300, 300, 120);
    newTop(ctx, id, {}, x + 175, 670, R_TILES[kindOf(id)] * 380, -Math.PI / 2);
  });
  // 실제 크기 한 줄 + 흑백
  const dev = DEVICES.phone3;
  const rS = radiusPx('survivor', dev);
  const tile = rS / R_TILES.survivor;
  const lw = 5 * 64;
  const y0 = 880;
  text(ctx, '휴대폰 실제 크기 (배율 3, 기기 화소 그대로 → 3배 확대 · 흑백)', 36, y0 - 10, 17, '#94a3b8', 700);
  floor(ctx, 36, y0, lw, 64, tile);
  ids.forEach((id, i) => newTop(ctx, id, {}, 36 + 32 + i * 64, y0 + 32, radiusPx(kindOf(id), dev), -Math.PI / 2 + i * 0.6));
  zoomCopy(ctx, c, 36, y0, lw, 64, 36 + lw + 24, y0, 3);
  zoomCopy(ctx, c, 36, y0, lw, 64, 36 + lw + 24 + lw * 3 + 24, y0, 1.6);
  grayscale(ctx, 36 + lw + 24 + lw * 3 + 24, y0, Math.ceil(lw * 1.6), Math.ceil(64 * 1.6));
  return c.toDataURL('image/png');
}

export async function loadFont(dataUrl: string): Promise<void> {
  for (const weight of ['400', '500', '700', '800']) {
    const f = new FontFace('Noto Sans KR', `url(${dataUrl})`, { weight });
    await f.load();
    document.fonts.add(f);
  }
}

declare global {
  interface Window {
    CHAR_FINAL: unknown;
  }
}

window.CHAR_FINAL = { sceneList, sceneFrames, overviewFrames, sheet, lineup, loadFont };
