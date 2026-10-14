// 캐릭터 리디자인 1단계 산출물 (브라우저 쪽): 캐릭터별 큰 그림 시트 · 다섯 나란히 · 애니메이션 장면(GIF 프레임).
// scripts/char-art.mjs의 sheets · gifs 명령이 esbuild로 묶어 Chromium에서 부른다. 게임 코드는 바꾸지 않는다.
// 애니메이션 시간은 규칙 값(config/balance.json: 공격 준비 · 돌진 시간 · 거리 · 기절 · 구조 · 능력 노출 · 이동 빠르기 · 질주 배율)과
// 장식 값(client/src/art/anim.ts ANIM: 숨쉬기 · 걸음 · 피격 번쩍 · 찌그러짐 · 흩어짐 · 나타남 · 베기 · 망토 · 깜빡임 · 보호 깜빡임)을
// 원본에서 그대로 읽는다 — 수치가 바뀌면 다시 만든 GIF도 따라간다.
import { ANIM } from '../../client/src/art/anim';
import type { CharId, MonsterPose, SurvivorPose } from '../../client/src/art/chars/types';
import {
  BALANCE,
  BG,
  DEVICES,
  FONT,
  NAMES,
  R_TILES,
  TEXT_COLOR,
  attackFan,
  backingRadiusPx,
  deviceRow,
  onDevice,
  oldRevealMark,
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
const STRIDE_TILES = ANIM.strideTiles;
const B = BALANCE;
const SPEED = {
  survivor: B.survivor.moveSpeed,
  monster: B.monster.moveSpeed,
  sprint: B.survivor.moveSpeed * B.roles.runner.sprintMultiplier,
} as const;
const RULE = {
  windup: B.monster.attack.windup,
  strike: ANIM.slashMs / 1000,
  dash: B.monster.dash.duration,
  dashTiles: B.monster.dash.distance,
  stun: B.roles.guard.stunDuration,
  rescue: B.prison.rescueTime,
  protect: B.survivor.rescueProtection,
  reveal: B.survivor.abilityRevealDuration,
  attackRange: B.monster.attack.range,
  attackArc: B.monster.attack.arc,
  sprintMul: B.roles.runner.sprintMultiplier,
  sprintS: B.roles.runner.sprintDuration,
  shoveRange: B.roles.guard.shoveRange,
  trackS: B.roles.scout.trackDuration,
  roarRadius: B.monster.roar.radius,
  roarReveal: B.monster.roar.revealDuration,
} as const;
const MS = (v: number): string => `${Math.round(v)}ms`;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
/** a~b 구간에서 0 → 1 (부드럽게) */
function ramp(t: number, a: number, b: number): number {
  const k = clamp01((t - a) / Math.max(1e-6, b - a));
  return k * k * (3 - 2 * k);
}
function breath(t: number, seed = 0): number {
  return 1 + ANIM.breathAmp * Math.sin((TAU * t) / ANIM.breathPeriodS + seed);
}
function blink(t: number): 'open' | 'blink' {
  const P = ANIM.blinkPeriodS;
  const p = (((t + 0.7) % P) + P) % P;
  return p < ANIM.blinkMs / 1000 ? 'blink' : 'open';
}
function cloakPhase(t: number, moving: boolean): number {
  return (TAU * t) / (moving ? ANIM.cloakWalkPeriodS : ANIM.cloakIdlePeriodS);
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
    return {
      x: tr.cx + (tr.half + Math.cos(a) * tr.rad) * T,
      y: tr.cy + Math.sin(a) * tr.rad * T,
      face: a + Math.PI / 2,
    };
  }
  s -= arc;
  if (s < top) return { x: tr.cx + (tr.half - s) * T, y: tr.cy + tr.rad * T, face: Math.PI };
  s -= top;
  const a = Math.PI / 2 + s / tr.rad;
  return {
    x: tr.cx + (-tr.half + Math.cos(a) * tr.rad) * T,
    y: tr.cy + Math.sin(a) * tr.rad * T,
    face: a + Math.PI / 2,
  };
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

/** 설명 줄을 폭 maxW에 맞춰 나눈다 (' · '와 빈칸에서 끊는다) */
function wrapNote(ctx: Ctx, note: string, maxW: number, size: number): string[] {
  ctx.save();
  ctx.font = `500 ${size}px ${FONT}`;
  const words = note.split(/(?<= )/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && ctx.measureText(cur + w).width > maxW) {
      lines.push(cur.trimEnd());
      cur = w.trimStart();
    } else cur += w;
  }
  if (cur) lines.push(cur.trimEnd());
  ctx.restore();
  return lines;
}

/** 장면 머리글: 제목 + 설명 (넘치면 두 줄 이상). 돌려준 값 = 머리글 높이 */
function header(ctx: Ctx, w: number, title: string, note: string, color: string): number {
  const lines = wrapNote(ctx, note, w - 28, 12.5);
  const h = 32 + lines.length * 17;
  ctx.fillStyle = 'rgba(11,22,34,0.82)';
  ctx.fillRect(0, 0, w, h);
  text(ctx, title, 14, 22, 17, color, 700);
  lines.forEach((ln, i) => text(ctx, ln, 14, 42 + i * 17, 12.5, '#94a3b8', 500));
  return h;
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
  const dur = isM ? ANIM.cloakIdlePeriodS * 2 : ANIM.breathPeriodS;
  return {
    id: `${id}-idle`,
    label: `${NAMES[id]} · 대기`,
    note: isM
      ? `망토 자락 물결 ${ANIM.cloakIdlePeriodS}초 · 눈 깜빡임 ${ANIM.blinkPeriodS}초 · 숨쉬기`
      : `숨쉬기 ${ANIM.breathPeriodS}초 (위 그림 · 정면 그림 같은 주기)`,
    dur,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 300, 340, 160);
      ctx.fillStyle = '#0f1b27';
      ctx.fillRect(300, 0, 260, 340);
      const r = isM ? 62 : 58;
      // 괴물은 망토 물결 두 주기 안에서 숨쉬기도 이음매 없이 돌게 (주기 = 장면 길이)
      const s = isM ? 1 + 0.012 * Math.sin((TAU * t) / dur) : breath(t, 0);
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
    note: `실제 빠르기 ${v}타일/초 · 걸음 한 주기 ${STRIDE_TILES}타일 · 바라보는 방향으로 몸이 돈다${isM ? '' : ` · 걸음에 몸이 ±${ANIM.leanDeg}° 기운다`}`,
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
      const pose = isM
        ? { walk, stride: 1, cloak: cloakPhase(t, true), eyes: blink(t) }
        : { walk, stride: 1 };
      // 게임과 같이 생존자는 걸음에 맞춰 몸을 기울인다 (괴물은 기울이지 않음)
      newTop(
        ctx,
        id,
        pose,
        p.x,
        p.y,
        r,
        p.face + (isM ? 0 : ((ANIM.leanDeg * Math.PI) / 180) * Math.sin(walk)),
      );
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
    note: `${RULE.sprintS}초 동안 ×${RULE.sprintMul} 빠르게: 앞으로 숙이고 팔을 접고 후드 끝이 곧은 줄기로 뒤로 날린다 (속도선은 생존자 화면만)`,
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
      const action = sprinting
        ? ramp(t, tWalk, tWalk + 0.15) * (1 - ramp(t, tWalk + tSprint - 0.12, tWalk + tSprint))
        : 0;
      const r = R_TILES.survivor * tile;
      if (sprinting) speedLines(ctx, p.x, p.y, p.face, r, t);
      newTop(ctx, 'runner', { walk, stride: 1, action }, p.x, p.y, r, p.face);
      const hh = header(ctx, 560, this.label, this.note, TEXT_COLOR.runner);
      // 상태 이름표: 걷는 길 안쪽 가운데 (캐릭터가 지나가지 않는 자리)
      text(
        ctx,
        sprinting ? '질주 중' : '걷기',
        280,
        Math.max(hh + 20, 212),
        15,
        sprinting ? '#60a5fa' : '#94a3b8',
        700,
        'center',
      );
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
    note: `방패를 당겨 힘을 모았다가 앞으로 내지른다 → ${RULE.shoveRange}타일 안 괴물 기절 ${RULE.stun}초`,
    dur: 2.8,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const action =
        t < 0.4
          ? 0
          : t < 0.55
            ? 0.5 * ramp(t, 0.4, 0.55)
            : t < 0.66
              ? 0.5 + 0.5 * ramp(t, 0.55, 0.66)
              : 1 - ramp(t, 0.95, 1.3);
      const hit = 0.66;
      const stunK =
        t >= hit && t < hit + RULE.stun
          ? ramp(t, hit, hit + 0.12) * (1 - ramp(t, hit + RULE.stun - 0.25, hit + RULE.stun))
          : 0;
      const mPose: Partial<MonsterPose> = {
        stun: stunK,
        eyes: stunK > 0.5 ? 'stun' : blink(t),
        cloak: cloakPhase(t, false),
      };
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
    note: `망원경을 눈에 대고 늘인다 → ${RULE.trackS}초 동안 괴물 위치를 팀 전원 화면에 (초록 표시)`,
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
    note: `흰 번쩍 ${MS(ANIM.hitFlashMs)} · 찌그러짐 ${MS(ANIM.squashMs)} · 뒤로 젖힘 · 불꽃 0.2초 → 부상(체력 1)은 몸 뒤쪽 위에 붉은 긁힘 세 줄`,
    dur: 2.0,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const windup = ramp(t, 0.2, tHit) * (1 - ramp(t, tHit, tHit + 0.05));
      const strike =
        t >= tHit && t < tHit + 0.35
          ? clamp01((t - tHit) / RULE.strike) * (1 - ramp(t, tHit + 0.15, tHit + 0.35))
          : 0;
      if (t >= 0.2 && t < tHit)
        attackFan(ctx, mx, sy, Math.PI, RULE.attackRange * tile, (t - 0.2) / RULE.windup);
      const dt = t - tHit;
      const hit = dt >= 0 ? Math.max(0, 1 - dt / 0.3) : 0;
      const sq = ANIM.squashMs / 1000;
      const fl = ANIM.hitFlashMs / 1000;
      const squash = dt >= 0 && dt < sq ? Math.sin((Math.PI * dt) / sq) : 0;
      const flash = dt >= 0 && dt < fl ? 1 - dt / fl : 0;
      const r = R_TILES.survivor * tile;
      const k = ANIM.squashAmt;
      newTop(ctx, role, { hit }, sx, sy, r, 0, { sx: 1 + squash * k, sy: 1 - squash * k });
      // 부상 표시는 몸 다음에 그리는 부착 표시 (VISUAL_SPEC 4.2: 몸 뒤쪽 붉은 긁힘 세 줄)
      if (dt >= 0) injury(ctx, sx, sy, 0, r);
      if (flash > 0)
        newTop(ctx, role, { hit, tone: 'flash' }, sx, sy, r, 0, {
          shadow: false,
          alpha: 0.9 * flash,
          sx: 1 + squash * k,
          sy: 1 - squash * k,
        });
      sparks(ctx, sx, sy, r, dt, 3);
      newTop(
        ctx,
        'monster',
        { windup, strike, cloak: cloakPhase(t, false), eyes: 'open' },
        mx,
        sy,
        R_TILES.monster * tile,
        Math.PI,
      );
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
    note: `두 번째 피격: 붉게 흩어짐 ${ANIM.imprisonDissolveMs / 1000}초 → 감옥 안에서 ${ANIM.imprisonAppearMs / 1000}초 나타남, 움츠린 수감 자세`,
    dur: 3.0,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      prisonCell(ctx, cell.x, cell.y, cell.w, cell.h, tile);
      const windup = ramp(t, 0.2, tHit) * (1 - ramp(t, tHit, tHit + 0.05));
      const strike =
        t >= tHit && t < tHit + 0.35
          ? clamp01((t - tHit) / RULE.strike) * (1 - ramp(t, tHit + 0.15, tHit + 0.35))
          : 0;
      if (t >= 0.2 && t < tHit)
        attackFan(ctx, mx, sy, Math.PI, RULE.attackRange * tile, (t - 0.2) / RULE.windup);
      const r = R_TILES.survivor * tile;
      const dt = t - tHit;
      if (dt < 0) {
        newTop(ctx, role, {}, sx, sy, r, 0);
        injury(ctx, sx, sy, 0, r);
      } else if (dt < ANIM.hitFlashMs / 1000) newTop(ctx, role, { hit: 1, tone: 'flash' }, sx, sy, r, 0);
      dissolve(ctx, sx, sy, r, dt - 0.06);
      const appear = ramp(t, tHit + 0.36, tHit + 0.36 + ANIM.imprisonAppearMs / 1000);
      if (appear > 0) {
        const cx = cell.x + cell.w / 2;
        const cy = cell.y + cell.h / 2;
        newTop(ctx, role, { mode: 'captive' }, cx, cy, r, Math.PI / 2, {
          alpha: appear,
          sx: breath(t),
          sy: breath(t),
        });
      }
      newTop(
        ctx,
        'monster',
        { windup, strike, cloak: cloakPhase(t, false) },
        mx,
        sy,
        R_TILES.monster * tile,
        Math.PI,
      );
      if (dt >= 0) slashArc(ctx, mx, sy, Math.PI, RULE.attackRange * tile, dt / RULE.strike);
      header(ctx, 560, this.label, this.note, TEXT_COLOR[role]);
    },
  };
}

const RESCUED: Record<SurvivorRole, SurvivorRole> = { runner: 'guard', guard: 'scout', scout: 'runner' };

/** 구조 자세 설명 (역할마다 손이 다르다) */
const RESCUE_HANDS: Record<SurvivorRole, string> = {
  runner: '후드 앞으로 두 손을 뻗어 자물쇠를',
  guard: '방패를 왼쪽으로 비키고 오른손만 뻗어 자물쇠를',
  scout: '망원경을 배낭 옆에 꽂고 고글 양옆으로 두 손을 뻗어 자물쇠를',
};

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
    note: `문 앞에서 ${RESCUE_HANDS[role]} ${RULE.rescue}초 → 갇힌 팀원(${NAMES[mate]})이 풀려나 ${RULE.protect}초 보호 (반투명 + 거품 깜빡임)`,
    dur: t1 + 1.6,
    w: 560,
    h: 360,
    draw(ctx, t) {
      stage(ctx, 560, 360, tile);
      prisonCell(ctx, cell.x, cell.y, cell.w, cell.h, tile, ramp(t, t1, t1 + 0.2));
      const r = R_TILES.survivor * tile;
      const working = t >= t0 && t < t1;
      if (working) rescueRing(ctx, rx, ry, tile, (t - t0) / RULE.rescue);
      if (t < t1)
        newTop(ctx, mate, { mode: 'captive' }, doorX, cell.y + cell.h * 0.45, r, Math.PI / 2, {
          sx: breath(t),
          sy: breath(t),
        });
      else {
        const k = ramp(t, t1, t1 + 0.15);
        const px = rx + 0.75 * tile;
        const py = ry - 0.1 * tile;
        const blinkOn = Math.floor(((t - t1) * 1000) / ANIM.protectBlinkMs) % 2 === 0;
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
        newTop(
          ctx,
          'common',
          { walk: (TAU * d) / STRIDE_TILES, stride: 1 },
          p.x,
          p.y,
          R_TILES.survivor * tile,
          p.face,
        );
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
    note: `보호(구조 직후 ${RULE.protect}초): 흰색 50% + 거품 깜빡임 ${MS(ANIM.protectBlinkMs)} · 능력 노출 ${RULE.reveal}초: 역할색 테두리 + 머리 위 역할 문양 (작은 표시라 지금 문양 그대로)`,
    dur: 2.6,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const s = breath(t, 0);
      newTop(ctx, 'common', {}, 110, 220, r, -Math.PI / 2, { sx: s, sy: s });
      text(ctx, '보통', 110, 318, 13, '#94a3b8', 700, 'center');
      const blinkOn = Math.floor((t * 1000) / ANIM.protectBlinkMs) % 2 === 0;
      newTop(ctx, 'common', {}, 280, 220, r, -Math.PI / 2, { alpha: 0.5, sx: s, sy: s });
      bubble(ctx, 280, 220, r, blinkOn);
      text(ctx, '보호 중', 280, 318, 13, '#94a3b8', 700, 'center');
      const rev = t >= 0.5 && t < 0.5 + RULE.reveal;
      newTop(ctx, 'common', {}, 450, 220, r, -Math.PI / 2, { sx: s, sy: s });
      if (rev) oldRevealMark(ctx, 450, 220, r, 'guard');
      text(
        ctx,
        rev ? '능력 노출 (예: 가드)' : '능력 노출 전',
        450,
        318,
        13,
        rev ? '#c084fc' : '#94a3b8',
        700,
        'center',
      );
      header(ctx, 560, this.label, this.note, TEXT_COLOR.common);
    },
  };
}

/**
 * 공통 생존자 수감 (괴물 화면): 괴물 공격 → 흰 번쩍(괴물 화면도 같은 프레임) → 타격 부채꼴 안에서 흩어짐 → 감옥 안 공통 그림이
 * 움츠린 자세로 나타남. 괴물 화면은 불꽃 · 부상을 그리지 않는다 (VISUAL_SPEC 0장 ③)
 */
function commonImprisonScene(): Scene {
  const tile = 130;
  const sx = 150;
  const sy = 215;
  const mx = sx + 1.05 * tile;
  const cell = { x: 380, y: 112, w: 160, h: 160 };
  const tHit = 0.2 + RULE.windup;
  return {
    id: 'common-imprison',
    label: '공통 생존자 · 수감 (괴물 화면)',
    note: `괴물의 두 번째 타격: 흰 번쩍 → 흩어짐 ${ANIM.imprisonDissolveMs / 1000}초 → 감옥 안 공통 그림이 움츠린 자세로 · 불꽃 · 부상 표시 없음`,
    dur: 3.0,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      prisonCell(ctx, cell.x, cell.y, cell.w, cell.h, tile);
      const windup = ramp(t, 0.2, tHit) * (1 - ramp(t, tHit, tHit + 0.05));
      const strike =
        t >= tHit && t < tHit + 0.35
          ? clamp01((t - tHit) / RULE.strike) * (1 - ramp(t, tHit + 0.15, tHit + 0.35))
          : 0;
      if (t >= 0.2 && t < tHit)
        attackFan(ctx, mx, sy, Math.PI, RULE.attackRange * tile, (t - 0.2) / RULE.windup);
      const r = R_TILES.survivor * tile;
      const dt = t - tHit;
      if (dt < 0) newTop(ctx, 'common', {}, sx, sy, r, 0);
      else if (dt < ANIM.hitFlashMs / 1000) newTop(ctx, 'common', { tone: 'flash' }, sx, sy, r, 0);
      dissolve(ctx, sx, sy, r, dt - 0.06);
      const appear = ramp(t, tHit + 0.36, tHit + 0.36 + ANIM.imprisonAppearMs / 1000);
      if (appear > 0)
        newTop(ctx, 'common', { mode: 'captive' }, cell.x + cell.w / 2, cell.y + cell.h / 2, r, Math.PI / 2, {
          alpha: appear,
          sx: breath(t),
          sy: breath(t),
        });
      newTop(
        ctx,
        'monster',
        { windup, strike, cloak: cloakPhase(t, false) },
        mx,
        sy,
        R_TILES.monster * tile,
        Math.PI,
      );
      if (dt >= 0) slashArc(ctx, mx, sy, Math.PI, RULE.attackRange * tile, dt / RULE.strike);
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
    note: `준비 ${RULE.windup}초: 발톱을 뒤로 젖혀 들고 범위가 0 → 100% 차오름 → 타격 ${RULE.strike}초: 두 발톱을 앞으로 휘두름 (전방 ${RULE.attackArc}° · ${RULE.attackRange}타일)`,
    dur: t0 + span + 0.35,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const u = (t - t0) / slow;
      const windup =
        u < 0 ? 0 : u < RULE.windup ? ramp(u, 0, RULE.windup) : 1 - ramp(u, RULE.windup, RULE.windup + 0.06);
      const su = u - RULE.windup;
      const strike = su >= 0 && su < 0.5 ? clamp01(su / RULE.strike) * (1 - ramp(su, 0.2, 0.45)) : 0;
      if (u >= 0 && u < RULE.windup) attackFan(ctx, mx, my, 0, RULE.attackRange * tile, u / RULE.windup);
      newTop(
        ctx,
        'monster',
        { windup, strike, cloak: cloakPhase(t / slow, false), eyes: 'open' },
        mx,
        my,
        R_TILES.monster * tile,
        0,
      );
      if (su >= 0) slashArc(ctx, mx, my, 0, RULE.attackRange * tile, su / RULE.strike);
      text(
        ctx,
        u < 0 ? '대기' : u < RULE.windup ? '공격 준비' : su < 0.25 ? '타격' : '회복',
        mx,
        320,
        15,
        '#f87171',
        700,
        'center',
      );
      header(ctx, 560, this.label, this.note, TEXT_COLOR.monster);
    },
  };
}

function windupScene(): Scene {
  const tile = 150;
  return {
    id: 'monster-windup',
    label: '괴물 · 공격 준비',
    note: `${RULE.windup}초 동안 팔을 뒤로 젖혀 발톱을 높이 들고 망토가 부푼다 (범위 표시는 판정값 그대로, 걸으면서도 준비)`,
    dur: 1.3,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const windup = ramp(t, 0.2, 0.6) * (1 - ramp(t, 1.0, 1.15));
      if (t >= 0.2 && t < 1.0)
        attackFan(ctx, 220, 205, 0, RULE.attackRange * tile, Math.min(1, (t - 0.2) / RULE.windup));
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
    note: `${RULE.dash}초에 ${RULE.dashTiles}타일: 몸을 낮추고 앞으로 늘어나며 망토가 뒤로 흐름 + 잔상(33ms마다) + 붉은 줄 · 오른쪽 위는 몸 확대`,
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
        for (const gh of ghosts)
          newTop(ctx, 'monster', { dash: 1 }, gh.gx, y, r, 0, { shadow: false, alpha: gh.a });
      }
      newTop(ctx, 'monster', { dash: dashPose, cloak: cloakPhase(t / slow, true) }, x, y, r, 0);
      const hh = header(ctx, 560, this.label, this.note, TEXT_COLOR.monster);
      // 몸 확대 (같은 자세를 반지름 54px로): 4타일이 들어가게 타일을 줄여 몸이 작으므로 자세를 따로 보인다
      const ix = 380;
      const iy = hh + 8;
      ctx.fillStyle = 'rgba(15,27,39,0.92)';
      ctx.fillRect(ix, iy, 172, 128);
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ix + 0.5, iy + 0.5, 171, 127);
      ctx.save();
      ctx.beginPath();
      ctx.rect(ix, iy, 172, 128);
      ctx.clip();
      newTop(ctx, 'monster', { dash: dashPose, cloak: cloakPhase(t / slow, true) }, ix + 86, iy + 66, 40, 0);
      ctx.restore();
      text(ctx, '몸 확대', ix + 8, iy + 18, 12, '#94a3b8', 700);
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
    note: `고개를 젖히고 빛나는 이빨을 드러내며 팔을 벌린다 · 충격파 0.6초 (반경 ${RULE.roarRadius}타일 생존자 위치를 괴물에게 ${RULE.roarReveal}초)`,
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
      newTop(
        ctx,
        'monster',
        { roar, cloak: cloakPhase(t, false) },
        mx,
        my,
        R_TILES.monster * tile,
        -Math.PI / 2,
      );
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
    note: `가드 밀치기에 맞으면 ${RULE.stun}초: 축 처지고 팔이 늘어지며 눈이 × · 머리 위 별 셋`,
    dur: t0 + RULE.stun + 0.55,
    w: 560,
    h: 340,
    draw(ctx, t) {
      stage(ctx, 560, 340, tile);
      const on = t >= t0 && t < t0 + RULE.stun;
      const stun = ramp(t, t0, t0 + 0.12) * (1 - ramp(t, t0 + RULE.stun - 0.2, t0 + RULE.stun + 0.1));
      shockwave(ctx, mx, my, 6, 0.6 * tile, (t - t0) / 0.3, 0xfde68a, 0.7);
      newTop(
        ctx,
        'monster',
        { stun, eyes: on ? 'stun' : blink(t), cloak: cloakPhase(t, false) },
        mx,
        my,
        R_TILES.monster * tile,
        0.35,
      );
      if (on) stunStars(ctx, mx, my, R_TILES.monster * tile, t);
      header(ctx, 560, this.label, this.note, TEXT_COLOR.monster);
    },
  };
}

/**
 * 실제 크기 걷기: 다섯 캐릭터가 휴대폰 '높음' 조건(배율 2로 그려 화면 배율 3으로 늘림)으로 걷는 것을 기기 화소 zoom배 최근접
 * 확대. 위 줄 = 지금 그림, 아래 줄 = 새 그림 (같은 시각 · 같은 자리)
 */
function actualWalkScene(dev: Device, zoom: number): Scene {
  const ids: CharId[] = ['runner', 'guard', 'scout', 'common', 'monster'];
  const rS = radiusPx('survivor', dev);
  const tile = rS / R_TILES.survivor;
  // 칸 폭: 괴물 길 바깥 + 괴물 몸 + 여백이 들어가게 (괴물 길 반폭 (0.75 + 0.8) × 1.1타일 + 몸 0.5타일)
  const cellW = Math.ceil(tile * 4.6);
  const cellH = Math.ceil(tile * 2.9);
  // 괴물 길은 빠르기 비율만큼 크게: 다섯이 같은 시간에 한 바퀴를 돈다
  const tr = (i: number, k: number): Track => {
    const m = ids[i] === 'monster' ? SPEED.monster / SPEED.survivor : 1;
    return { cx: cellW * (i + 0.5) * k, cy: (cellH / 2) * k, half: 0.75 * m, rad: 0.8 * m, tile: tile * k };
  };
  const L = trackLen(tr(0, 1));
  const W = cellW * 5;
  const top = 74;
  const rowH = cellH * zoom;
  return {
    id: 'actual-size-walk',
    label: `다섯 캐릭터 실제 크기로 걷기 — ${dev.name}, 품질 '높음' (기기 화소 ${zoom}배 최근접 확대)`,
    note: `위 줄 지금 그림 · 아래 줄 새 그림 · 생존자 ${SPEED.survivor}타일/초 · 괴물 ${SPEED.monster}타일/초 · 왼쪽부터 러너 · 가드 · 스카우트 · 공통 생존자(괴물 화면) · 괴물`,
    dur: L / SPEED.survivor,
    w: W * zoom,
    h: top + rowH * 2 + 8,
    draw(ctx, t) {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, this.w, this.h);
      const small = canvas(W, cellH * 2 + 4);
      small.ctx.fillStyle = BG;
      small.ctx.fillRect(0, 0, W, cellH * 2 + 4);
      for (const [row, old] of [
        [0, true],
        [1, false],
      ] as const)
        onDevice(small.ctx, 0, row * (cellH + 4), W, cellH, dev, (c, k) => {
          floor(c, 0, 0, W * k, cellH * k, tile * k);
          ids.forEach((id, i) => {
            const v = id === 'monster' ? SPEED.monster : SPEED.survivor;
            const d = t * v;
            const p = onTrack(tr(i, k), d);
            const walk = (TAU * d) / STRIDE_TILES;
            const r = backingRadiusPx(kindOf(id), dev);
            const pose =
              id === 'monster' ? { walk, stride: 1, cloak: cloakPhase(t, true) } : { walk, stride: 1 };
            if (old) oldTop(c, id, p.x, p.y, r, p.face, { pose });
            else newTop(c, id, pose, p.x, p.y, r, p.face);
          });
        });
      zoomCopy(ctx, small.c, 0, 0, W, cellH * 2 + 4, 0, top, zoom);
      header(ctx, this.w, this.label, this.note, '#e2e8f0');
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
  out.push(idleScene('common'), commonWalkScene(), commonImprisonScene(), commonStatusScene());
  out.push(idleScene('monster'), walkScene('monster'), windupScene(), attackScene(1), attackScene(4));
  out.push(dashScene(1), dashScene(4), roarScene(), stunScene());
  out.push(actualWalkScene(DEVICES.phone3, 2));
  return out;
}

export function sceneList(): { id: string; label: string; dur: number; w: number; h: number }[] {
  return scenes().map((s) => ({ id: s.id, label: s.label, dur: s.dur, w: s.w, h: s.h }));
}

/** 장면 한 번의 프레임 수 */
export function frameCount(id: string, fps: number): number {
  const s = scenes().find((x) => x.id === id);
  if (!s) throw new Error(`장면 없음: ${id}`);
  return Math.max(1, Math.round(s.dur * fps));
}

/**
 * 장면 프레임들 (PNG data URL), 프레임 번호 from부터 count장. 장면 길이를 프레임 수 n으로 똑같이 나눠 찍는다
 * (t = i × dur / n): 되풀이 장면이 GIF 끝에서 처음으로 이음매 없이 이어진다 (빠르기는 1% 안에서 맞춰진다)
 */
export function sceneFrames(id: string, fps: number, from = 0, count?: number): string[] {
  const s = scenes().find((x) => x.id === id);
  if (!s) throw new Error(`장면 없음: ${id}`);
  const n = frameCount(id, fps);
  const { c, ctx } = canvas(s.w, s.h);
  const out: string[] = [];
  for (let i = from; i < from + (count ?? n); i += 1) {
    ctx.save();
    s.draw(ctx, ((i % n) * s.dur) / n);
    ctx.restore();
    out.push(c.toDataURL('image/png'));
  }
  return out;
}

/**
 * 모아 보기: 한 캐릭터의 장면 여럿을 격자로. 모든 칸이 같이 시작해 한 번 돌고, 짧은 칸은 마지막 자세로 기다린다
 * (GIF가 처음으로 돌아갈 때 모든 칸이 함께 처음으로 — 동작 중간에서 튀지 않게)
 */
export function overviewFrames(
  prefix: string,
  fps: number,
  from: number,
  count: number,
  cols = 3,
): { w: number; h: number; frames: string[] } {
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
      cell.s.draw(cell.ctx, Math.min(t, cell.s.dur - 1 / fps));
      cell.ctx.restore();
      const x = (k % cols) * cw;
      const y = Math.floor(k / cols) * ch;
      const sc = Math.min((cw - 6) / cell.s.w, (ch - 6) / cell.s.h);
      ctx.drawImage(
        cell.c,
        x + (cw - cell.s.w * sc) / 2,
        y + (ch - cell.s.h * sc) / 2,
        cell.s.w * sc,
        cell.s.h * sc,
      );
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
/** 공통 생존자: 괴물 화면이 받는 값(걷기 · 수감 상태 · 사망)으로 정할 수 있는 자세만 — 능력 · 피격 젖힘 · 구조 중 자세는 없다 */
const COMMON_POSES = SURVIVOR_POSES.filter(
  (p) => p.label === '서기' || p.label === '걷기' || p.label === '수감' || p.label === '사망',
);
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
  const H = 1500;
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
  // 상반신 (로비 역할 카드 · 결과 화면 크기) + 회색(남이 고른 카드). 작은 아이콘 자리는 지금 문양을 쓴다 (사용자 결정)
  ctx.fillStyle = '#0f1b27';
  ctx.fillRect(36, 790, 600, 350);
  text(ctx, '상반신 (로비 역할 카드 · 결과 화면: 160 · 96 · 64px) · 회색', 56, 826, 17, '#94a3b8', 700);
  newFront(ctx, id, { bust: true }, 146, 960, 160, 3);
  newFront(ctx, id, { bust: true }, 300, 960, 96, 2.4);
  newFront(ctx, id, { bust: true }, 400, 960, 64, 2);
  newFront(ctx, id, { bust: true, tone: 'gray' }, 540, 950, 110, 2.5);
  text(ctx, '회색 변형 (제안: 남이 고른 카드)', 540, 1080, 13, '#94a3b8', 500, 'center');
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
  // 실제 크기: 지금 vs 새 (세 방향씩, 게임 화면 조건 그대로, 오른쪽에 최근접 확대)
  text(
    ctx,
    "게임 화면 조건 (휴대폰은 품질 '높음': 배율 2로 그려 화면 배율로 늘림) · 왼쪽 셋 지금 그림, 오른쪽 셋 새 그림",
    660,
    826,
    15,
    '#94a3b8',
    700,
  );
  let y = 846;
  const dirs = [-Math.PI / 2, 0.35, Math.PI * 0.8];
  for (const dev of [DEVICES.phone3, DEVICES.phone2, DEVICES.pc768]) {
    const r = backingRadiusPx(kindOf(id), dev);
    const scaleNote = dev.dpr !== dev.backing ? ` → 화면에서 ${dev.dpr / dev.backing}배` : '';
    text(ctx, `${dev.name} · 그리는 반지름 ${r.toFixed(1)}px${scaleNote}`, 660, y + 12, 12.5, '#cbd5e1', 500);
    const yy = y + 20;
    const row = deviceRow(ctx, 660, yy, dev, [
      ...dirs.map((rot) => ({ id, rot, old: true })),
      ...dirs.map((rot) => ({ id, rot })),
    ]);
    const z = Math.min(3, (W - 36 - 660 - row.w - 24) / row.w);
    zoomCopy(ctx, c, 660, yy, row.w, row.h, 660 + row.w + 24, yy, z);
    y = yy + Math.max(row.h, row.h * z) + 10;
  }
  // 공통 생존자: 능력 노출 표시를 휴대폰 실제 크기로 (작은 표시라 지금 문양을 그대로 쓴다 — 사용자 결정)
  if (id === 'common') {
    y += 14;
    text(
      ctx,
      "능력 노출 1초 표시 — 휴대폰 '높음' 실제 크기, 지금 문양 그대로 (왼쪽 셋 지금 그림 · 오른쪽 셋 새 그림)",
      660,
      y,
      15,
      '#94a3b8',
      700,
    );
    const dev = DEVICES.phone3;
    const rS = radiusPx('survivor', dev);
    const cell = Math.ceil(rS * 4.6);
    const w = cell * 6;
    const h = Math.ceil(rS * 6);
    const roles = ['runner', 'guard', 'scout'] as const;
    const yy = y + 12;
    onDevice(ctx, 660, yy, w, h, dev, (cc, k) => {
      floor(cc, 0, 0, w * k, h * k, (rS / R_TILES.survivor) * k);
      const r = backingRadiusPx('survivor', dev);
      roles.forEach((role, i) => {
        const x = cell * (i + 0.5) * k;
        const by = h * 0.62 * k;
        oldTop(cc, 'common', x, by, r, -Math.PI / 2);
        oldRevealMark(cc, x, by, r, role);
        const nx = cell * (i + 3.5) * k;
        newTop(cc, 'common', {}, nx, by, r, -Math.PI / 2);
        oldRevealMark(cc, nx, by, r, role);
      });
    });
    const z = Math.min(3, (W - 36 - 660 - w - 24) / w);
    zoomCopy(ctx, c, 660, yy, w, h, 660 + w + 24, yy, z);
    y = yy + Math.max(h, h * z) + 10;
  }
  // 내용 높이에 맞춰 자른다 (아래가 잘리지 않게)
  const outH = Math.max(1160, Math.ceil(y + 24));
  const out = canvas(W, outH);
  out.ctx.drawImage(c, 0, 0, W, outH, 0, 0, W, outH);
  return out.c.toDataURL('image/png');
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
  // 실제 크기: 다섯 나란히 같은 방향 (위 줄 지금 · 아래 줄 새), 게임 화면 조건 그대로 → 3배 확대 · 흑백
  const dev = DEVICES.phone3;
  const y0 = 880;
  text(
    ctx,
    `${dev.name} · 품질 '높음' 실제 크기 (배율 2로 그려 1.5배로 늘림) — 위 지금 · 아래 새, 모두 위쪽을 봄 → 3배 최근접 · 흑백 2배`,
    36,
    y0 - 10,
    16,
    '#94a3b8',
    700,
  );
  const a = deviceRow(
    ctx,
    36,
    y0,
    dev,
    ids.map((id) => ({ id, rot: -Math.PI / 2, old: true })),
  );
  deviceRow(
    ctx,
    36,
    y0 + a.h,
    dev,
    ids.map((id) => ({ id, rot: -Math.PI / 2 })),
  );
  const zx = 36 + a.w + 24;
  zoomCopy(ctx, c, 36, y0, a.w, a.h * 2, zx, y0, 3);
  const gx = zx + a.w * 3 + 24;
  zoomCopy(ctx, c, 36, y0, a.w, a.h * 2, gx, y0, 2);
  grayscale(ctx, gx, y0, Math.ceil(a.w * 2), Math.ceil(a.h * 4));
  text(ctx, '흑백 (2배 최근접)', gx, y0 + a.h * 4 + 18, 13, '#94a3b8', 500);
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
