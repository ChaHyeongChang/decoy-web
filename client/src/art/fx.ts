// 장식 입자 · 이벤트 효과 (M10b, VISUAL_SPEC 7장). 순수 로직: DOM · Phaser 없음 (그리기는 FxPen으로).
//
// 규칙 (정보 우선 R4 · R5 · R8 · R9 · 상대 잔여 효과):
//  - 장식 입자(빛 속 먼지 · 발먼지)는 알파 0.2 이하, 크기 2px 이하. 캐릭터 아래 레이어에 그려 몸을 덮지 않는다
//  - 이벤트 효과(불꽃 · 흩어짐 · 충격파 · 셔터 · 베기 호)는 0.4초 이하. 받은 이벤트 좌표나 지금 그린 엔티티에서만 생긴다
//  - 상대에게서 나온 효과는 출처가 이번 스냅샷에서 사라지면 그 프레임에 없앤다(pruneSources)
//  - 빛 속 먼지는 자기 팀 시야(판정 다각형) 안에서만 보이고, 시계(gfxNow)와 시드 고정 해시로만 움직인다
//  - 품질은 개수만 바꾼다(FX_LIMITS). 정보(범위 · 링 · 마커)는 이 모듈이 그리지 않는다
// 난수는 시드 고정(mulberry32, @decoy/shared Rng). Math.random()을 쓰지 않는다.
import { Rng, angleDiff, circleIntersectsSector, pointInPolygon, type Vec2 } from '@decoy/shared';
import type { QualityTier } from '../gfx/presets';
import { fillCirclePen, penArc, strokeCirclePen, type PathPen } from './shapes';

/** 품질별 상한과 규칙 한도 */
export const FX_LIMITS = {
  /** 장식 입자 알파 상한 (R4) */
  decorAlphaMax: 0.2,
  /** 장식 입자 크기 상한 (논리 px) */
  decorSizeMaxPx: 2,
  /** 이벤트 효과 수명 상한 (초, R5) */
  eventLifeMaxS: 0.4,
  /** 빛 속 먼지 개수 */
  dust: { high: 40, medium: 15, low: 0 } as Readonly<Record<QualityTier, number>>,
  /** 발먼지 (높음 · 중간만) */
  footDust: { high: true, medium: true, low: false } as Readonly<Record<QualityTier, boolean>>,
} as const;

export type FxKind = 'spark' | 'dissolve' | 'footDust' | 'shockwave' | 'shutter' | 'slash' | 'impact';

export interface FxPreset {
  /** 수명 (초) */
  readonly life: number;
  /** 시작 알파 */
  readonly alpha: number;
  /** 한 번에 만드는 개수 (입자형) */
  readonly count: number;
  /** 장식 입자인가 (알파 · 크기 상한 적용) */
  readonly decor: boolean;
}

/** 효과 프리셋. 이벤트 효과는 모두 0.4초 이하 */
export const FX_PRESETS: Readonly<Record<FxKind, FxPreset>> = {
  spark: { life: 0.2, alpha: 1, count: 6, decor: false },
  dissolve: { life: 0.3, alpha: 0.9, count: 14, decor: false },
  footDust: { life: 0.3, alpha: 0.16, count: 2, decor: true },
  shockwave: { life: 0.35, alpha: 0.75, count: 1, decor: false },
  shutter: { life: 0.3, alpha: 0.8, count: 1, decor: false },
  slash: { life: 0.12, alpha: 0.95, count: 1, decor: false },
  impact: { life: 0.3, alpha: 0.7, count: 1, decor: false },
};

/** 빛 속 먼지 (장식): 알파 · 크기 · 칸 크기 · 수명 주기 */
export const DUST = {
  alpha: 0.12,
  sizePx: 1.4,
  cell: 1.6,
  periodMinS: 4,
  periodMaxS: 7,
  drift: 0.35,
} as const;

/** 효과 색 (무채색 먼지, 불꽃은 따뜻한 흰색 → 주황, 흩어짐은 빨강: 피해 전용 색) */
export const FX_COLOR = {
  dust: 0xd6dde6,
  footDust: 0xaab4bf,
  sparkHot: 0xfff7d6,
  sparkWarm: 0xf59e0b,
  dissolve: 0xef4444,
  shockwave: 0xe9d5ff,
  shutter: 0xdcfce7,
  slash: 0xffffff,
  impact: 0xfde68a,
} as const;

/**
 * 효과를 그리는 펜 (Phaser Graphics의 부분 집합). 좌표는 월드 px. 원 · 호는 shapes.ts penArc로 반지름에 맞춰 편다
 * (Phaser 원호 명령은 크기와 상관없이 100분할이라 매 프레임 그리는 작은 점에 쓰지 않는다)
 */
export type FxPen = PathPen;

interface Fx {
  kind: FxKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  color: number;
  alpha: number;
  /** 출처 엔티티 id (상대 잔여 효과 규칙) */
  src: string | null;
  /** 상대에게서 나온 효과인가 */
  opp: boolean;
  /** 고리 · 호: 끝 반지름 (타일) · 방향 · 각도 */
  r1: number;
  dir: number;
  arc: number;
}

/** 효과 수명 → 알파 배율 (끝으로 갈수록 0) */
function lifeK(f: Fx, nowS: number): number {
  return Math.max(0, 1 - (nowS - f.born) / f.life);
}

export class FxSystem {
  private list: Fx[] = [];
  private readonly rng: Rng;
  private cap: number;

  constructor(seed: number, cap: number) {
    this.rng = new Rng(seed);
    this.cap = cap;
  }

  setCap(cap: number): void {
    this.cap = cap;
    if (this.list.length > cap) this.list.splice(0, this.list.length - cap);
  }

  get count(): number {
    return this.list.length;
  }

  /** 상대에게서 나온 효과 수 (디버그 oppFx) */
  get oppCount(): number {
    let n = 0;
    for (const f of this.list) if (f.opp) n += 1;
    return n;
  }

  /** 상한을 넘으면 가장 오래된 것부터 버린다 */
  private push(f: Fx): void {
    if (this.cap <= 0) return;
    if (this.list.length >= this.cap) this.list.shift();
    this.list.push(f);
  }

  private base(kind: FxKind, x: number, y: number, nowS: number, src: string | null, opp: boolean): Fx {
    const p = FX_PRESETS[kind];
    return {
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      born: nowS,
      life: p.life,
      size: 1,
      color: 0xffffff,
      alpha: p.alpha,
      src,
      opp,
      r1: 0,
      dir: 0,
      arc: 0,
    };
  }

  /** 피격 불꽃 (≤6개 · 0.2초): 몸 가장자리 밖으로 튄다 */
  sparks(x: number, y: number, bodyR: number, nowS: number, src: string | null, opp: boolean): void {
    const n = FX_PRESETS.spark.count;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + this.rng.next() * 0.8;
      const sp = 3.2 + this.rng.next() * 2.4;
      const f = this.base(
        'spark',
        x + Math.cos(a) * bodyR * 1.05,
        y + Math.sin(a) * bodyR * 1.05,
        nowS,
        src,
        opp,
      );
      f.vx = Math.cos(a) * sp;
      f.vy = Math.sin(a) * sp;
      f.size = 1.2 + this.rng.next() * 0.8;
      f.color = i % 2 === 0 ? FX_COLOR.sparkHot : FX_COLOR.sparkWarm;
      this.push(f);
    }
  }

  /** 수감 흩어짐 (붉은 입자 0.3초): 보이던 자리에서 위로 흩어진다 */
  dissolve(x: number, y: number, bodyR: number, nowS: number, src: string | null, opp: boolean): void {
    const n = FX_PRESETS.dissolve.count;
    for (let i = 0; i < n; i += 1) {
      const a = this.rng.next() * Math.PI * 2;
      const d = Math.sqrt(this.rng.next()) * bodyR;
      const f = this.base('dissolve', x + Math.cos(a) * d, y + Math.sin(a) * d, nowS, src, opp);
      f.vx = Math.cos(a) * (0.6 + this.rng.next() * 0.8);
      f.vy = Math.sin(a) * (0.6 + this.rng.next() * 0.8) - 1.2;
      f.size = 1.4 + this.rng.next() * 1.2;
      f.color = FX_COLOR.dissolve;
      this.push(f);
    }
  }

  /** 발먼지 (장식, 무채색, 0.3초). 괴물 화면 생존자도 모두 같은 값 */
  footDust(x: number, y: number, nowS: number, src: string | null, opp: boolean): void {
    const n = FX_PRESETS.footDust.count;
    for (let i = 0; i < n; i += 1) {
      const a = this.rng.next() * Math.PI * 2;
      const f = this.base('footDust', x, y, nowS, src, opp);
      f.vx = Math.cos(a) * 0.35;
      f.vy = Math.sin(a) * 0.35;
      f.size = 1.1 + this.rng.next() * 0.6;
      f.color = FX_COLOR.footDust;
      this.push(f);
    }
  }

  /** 퍼지는 고리 (밀치기 충격파 · 탐지 셔터 · 기절 충격) */
  ring(
    kind: 'shockwave' | 'shutter' | 'impact',
    x: number,
    y: number,
    r1: number,
    nowS: number,
    src: string | null,
    opp: boolean,
  ): void {
    const f = this.base(kind, x, y, nowS, src, opp);
    f.r1 = r1;
    f.color = FX_COLOR[kind];
    this.push(f);
  }

  /** 괴물 타격 베기 호 (120ms): 공격 방향 · 각도 · 거리 */
  slash(
    x: number,
    y: number,
    dir: number,
    arc: number,
    range: number,
    nowS: number,
    src: string | null,
    opp: boolean,
  ): void {
    const f = this.base('slash', x, y, nowS, src, opp);
    f.dir = dir;
    f.arc = arc;
    f.r1 = range;
    f.color = FX_COLOR.slash;
    this.push(f);
  }

  /** 수명이 끝난 효과와, 출처가 이번 스냅샷에서 사라진 상대 효과를 없앤다 */
  update(nowS: number, presentSources: ReadonlySet<string>): void {
    this.keep(
      (f) =>
        nowS - f.born < f.life &&
        nowS >= f.born - 1 &&
        (!f.opp || f.src === null || presentSources.has(f.src)),
    );
  }

  /** 출처가 사라진 상대 효과를 바로 없앤다 (src = null인 이벤트 좌표 효과는 수명까지) */
  pruneSources(presentSources: ReadonlySet<string>): void {
    this.keep((f) => !f.opp || f.src === null || presentSources.has(f.src));
  }

  /** 조건에 맞는 효과만 같은 순서로 남긴다 (프레임마다 새 배열을 만들지 않게 제자리에서) */
  private keep(pred: (f: Fx) => boolean): void {
    const list = this.list;
    let n = 0;
    for (const f of list) if (pred(f)) list[n++] = f;
    list.length = n;
  }

  clear(): void {
    this.list = [];
  }

  /** 그리기. k = 월드 px / 타일 */
  draw(pen: FxPen, nowS: number, k: number): void {
    for (const f of this.list) {
      const t = nowS - f.born;
      const lk = lifeK(f, nowS);
      if (lk <= 0) continue;
      const x = (f.x + f.vx * t) * k;
      const y = (f.y + f.vy * t) * k;
      switch (f.kind) {
        case 'spark': {
          // 짧은 꼬리를 단 불꽃
          pen.lineStyle(f.size, f.color, f.alpha * lk);
          pen.beginPath();
          pen.moveTo(x - f.vx * 0.035 * k, y - f.vy * 0.035 * k);
          pen.lineTo(x, y);
          pen.strokePath();
          break;
        }
        case 'dissolve':
          pen.fillStyle(f.color, f.alpha * lk);
          fillCirclePen(pen, x, y, f.size * (0.6 + 0.4 * lk));
          break;
        case 'footDust':
          pen.fillStyle(f.color, Math.min(FX_LIMITS.decorAlphaMax, f.alpha) * lk);
          fillCirclePen(pen, x, y, Math.min(FX_LIMITS.decorSizeMaxPx, f.size * (1 + (1 - lk))));
          break;
        case 'shockwave':
        case 'shutter':
        case 'impact': {
          const e = 1 - (1 - (1 - lk)) ** 2; // 빠르게 퍼지고 천천히 멎는다
          const r = (f.kind === 'shutter' ? f.r1 * (1 - 0.65 * e) : f.r1 * (0.15 + 0.85 * e)) * k;
          pen.lineStyle(f.kind === 'shutter' ? 2.5 : 3 * lk + 1, f.color, f.alpha * lk);
          strokeCirclePen(pen, x, y, Math.max(1, r));
          if (f.kind === 'shockwave') {
            pen.lineStyle(1.5, f.color, f.alpha * 0.45 * lk);
            strokeCirclePen(pen, x, y, Math.max(1, r * 0.82));
          }
          break;
        }
        case 'slash': {
          // 공격 방향 호를 한쪽에서 다른 쪽으로 쓸고 지나가는 흰 초승달
          const half = f.arc / 2;
          const sweep = Math.min(1, t / (f.life * 0.6));
          const a0 = f.dir - half;
          const a1 = f.dir - half + f.arc * sweep;
          const r = f.r1 * k;
          pen.lineStyle(3.5, f.color, f.alpha * lk);
          pen.beginPath();
          penArc(pen, x, y, r * 0.92, a0, a1);
          pen.strokePath();
          if (a1 > a0 + 0.12) {
            pen.lineStyle(1.5, f.color, f.alpha * 0.6 * lk);
            pen.beginPath();
            penArc(pen, x, y, r * 0.74, a0 + 0.12, a1);
            pen.strokePath();
          }
          break;
        }
        default:
          break;
      }
    }
  }
}

// ───────────────────────── 수감 흩어짐 자리 (괴물 화면) ─────────────────────────

/** 괴물 타격 이벤트 (attackHit: 타격 순간의 괴물 자리 · 방향 · 맞은 수) */
export interface StrikeHit {
  x: number;
  y: number;
  dir: number;
  hits: number;
}

/** 보간 지연(약 0.1초)만큼 보이던 자리가 서버 자리와 어긋나도 맞은 사람을 놓치지 않는 여유 (타일) */
export const DISSOLVE_SLACK = 0.1;

/**
 * 괴물 화면 수감 흩어짐 자리 고르기: 잡힘 알림 직전까지 보이던 생존자(이번에 사라졌거나 더 이상 자유가 아닌 별칭) 중
 * 같은 순간의 타격 부채꼴(attack.range · arc 라디안, 몸 반지름 겹침 — 서버 타격 판정 circleIntersectsSector와 같은 모양) 안에
 * 있던 것만 후보로 둔다. 타격이 없거나(hits = 0) 맞는 후보가 없으면 null(연출 생략: 같은 순간 시야를 벗어난 다른 생존자 자리에서
 * 흩어지지 않게). 여럿이면 조준 방향에 가장 가까운 것 → 타격 중심에 가까운 것
 */
export function pickDissolveTarget<T extends { x: number; y: number }>(
  cands: readonly T[],
  hit: StrikeHit | null,
  attack: { range: number; arc: number },
  bodyR: number,
): T | null {
  if (!hit || hit.hits <= 0) return null;
  const sector = { dir: hit.dir, arc: attack.arc, range: attack.range };
  let best: { c: T; da: number; d: number } | null = null;
  for (const c of cands) {
    if (!circleIntersectsSector(hit, sector, c, bodyR + DISSOLVE_SLACK)) continue;
    const da = Math.abs(angleDiff(hit.dir, Math.atan2(c.y - hit.y, c.x - hit.x)));
    const d = Math.hypot(c.x - hit.x, c.y - hit.y);
    if (!best || da < best.da - 1e-9 || (Math.abs(da - best.da) <= 1e-9 && d < best.d)) best = { c, da, d };
  }
  return best ? best.c : null;
}

// ───────────────────────── 빛 속 먼지 (상태 없음) ─────────────────────────

export interface DustEye {
  /** 시야 다각형 (판정 그대로, 타일) */
  poly: readonly Vec2[];
  center: Vec2;
  /** 완전히 밝은 반경 (생존자: 판정 반경 − 흐림 띠, 괴물: 부채꼴 길이). 이 안에만 먼지 */
  radius: number;
}

export interface DustMote {
  x: number;
  y: number;
  alpha: number;
  size: number;
}

function hash2(i: number, j: number, salt: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 빛 속 먼지 (장식): 월드 칸마다 하나씩 시드 고정 위치 · 주기로 떠다니며 숨쉬듯 나타났다 사라진다.
 * 시계(tS)만의 함수라 시계를 멈추면 멈춘다. 자기 팀 시야 다각형 안(완전히 밝은 반경 안)에 있는 것만 돌려준다.
 * 고르는 순서(우선값 pri)는 시계와 상관없는 칸의 값이라, 칸을 우선값 순서로 먼저 늘어놓고(같으면 나열 순서, 안정 정렬)
 * 앞에서부터 자리 · 시야 안을 재다가 count개를 채우면 멈춘다: '시야 안 칸을 모두 재서 우선값 순으로 count개'와 결과가 같고,
 * 다각형 검사는 칸 전부(시야 3개면 약 150번)가 아니라 count개 남짓만 한다 (M12 휴대폰 성능, 프레임마다 부른다)
 */
export function dustMotes(tS: number, eyes: readonly DustEye[], count: number): DustMote[] {
  if (count <= 0 || eyes.length === 0) return [];
  const cell = DUST.cell;
  const seen = new Set<number>();
  const cells: { pri: number; i: number; j: number }[] = [];
  for (const e of eyes) {
    const i0 = Math.floor((e.center.x - e.radius) / cell);
    const i1 = Math.floor((e.center.x + e.radius) / cell);
    const j0 = Math.floor((e.center.y - e.radius) / cell);
    const j1 = Math.floor((e.center.y + e.radius) / cell);
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const key = j * 4096 + i;
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push({ pri: hash2(i, j, 7), i, j });
      }
    }
  }
  cells.sort((a, b) => a.pri - b.pri);
  const out: DustMote[] = [];
  for (const { i, j } of cells) {
    if (out.length >= count) break;
    const period = DUST.periodMinS + hash2(i, j, 3) * (DUST.periodMaxS - DUST.periodMinS);
    const ph = (tS / period + hash2(i, j, 4)) % 1;
    const wob = tS * 0.21 + hash2(i, j, 5) * 6.28;
    const x = (i + 0.2 + 0.6 * hash2(i, j, 1)) * cell + Math.sin(wob) * DUST.drift;
    const y = (j + 0.2 + 0.6 * hash2(i, j, 2)) * cell + Math.cos(wob * 0.8) * DUST.drift - ph * 0.3;
    let inside = false;
    for (const q of eyes) {
      if (Math.hypot(x - q.center.x, y - q.center.y) > q.radius) continue;
      if (pointInPolygon({ x, y }, q.poly)) {
        inside = true;
        break;
      }
    }
    if (!inside) continue;
    out.push({
      x,
      y,
      alpha: DUST.alpha * Math.sin(Math.PI * ph),
      size: DUST.sizePx * (0.6 + 0.4 * hash2(i, j, 6)),
    });
  }
  return out;
}

// ───────────────────────── 후처리 수식 (effects.ts WorldPostFx · 셰이더 · 구운 오버레이가 같이 쓴다) ─────────────────────────

/**
 * 비네트 · 색보정 값 (그래픽 상수). 비네트는 맵 사각형 모서리에서만 어두워진다(최대 0.3): 맵 가운데 · 가장자리 중간은 0이라
 * 시야 안 밝기 · 안개 탐침을 바꾸지 않는다. 색보정은 밝기(Rec.709 가중 합)를 바꾸지 않는 채도 +8% · 그늘 청록 기울기
 */
export const POST = {
  /** 모서리 최대 어둡게 (0~1) */
  vignetteMax: 0.3,
  /** 맵 반폭 · 반높이로 정규화한 거리: 이 안쪽은 0, 모서리(√2)에서 최대 */
  vignetteStart: 0.95,
  vignetteEnd: Math.SQRT2,
  saturation: 0.08,
  /** 그늘 색 기울기 (밝기 가중 합이 0이라 밝기 불변) */
  shadowTone: [-0.02, 0, 0.0589] as const,
} as const;

/** 비네트 세기 (맵 정규화 좌표 nx, ny ∈ [−1, 1]) — 셰이더 · 구운 오버레이 · 단위 테스트가 같이 쓴다 */
export function vignetteAt(nx: number, ny: number, max: number = POST.vignetteMax): number {
  const d = Math.hypot(nx, ny);
  const t = Math.max(0, Math.min(1, (d - POST.vignetteStart) / (POST.vignetteEnd - POST.vignetteStart)));
  return max * t * t * (3 - 2 * t);
}
