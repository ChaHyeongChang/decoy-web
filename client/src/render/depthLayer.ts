// 입체감 레이어 (VISUAL_SPEC 14장, 계산은 art/depthGeom.ts). 품질 높음 · 중간의 WebGL에서 설정이 켜져 있을 때만 그린다.
//
// 자리: 구조 레이어(fogRoot) 안, 빛 지도 곱하기 · 테두리 리프트 뒤(구운 비네트 오버레이 앞). 그래서
//  - 캐릭터 · 부채꼴 · 범위 · 마커 · 배지 · 화면 밖 화살표(모두 월드 컨테이너 · HUD)는 늘 이 위에 그려진다 — 가려지지 않는다
//  - 후처리(비네트 · 색보정 · 입체감 등불)는 바닥과 함께 이 레이어에도 걸린다(구조 레이어, R2)
//  - 빛 지도를 곱하지 않으므로 색은 여기서 정한다: 칸 가장자리 바깥 바닥의 빛(받은 시야만, depthGeom lightAt)으로
//    '원래 색 × 하한' ~ '원래 색' 사이. 어둠 속 테두리는 맵 그림과 같은 리프트를 더한 색(시야 밖 구조 2.5:1)
// 프레임마다 Graphics를 다시 채운다(보이는 창 둘레 칸만, 삼각형만 — 원호 · Earcut 없음). 빛은 안개 주기에만 다시 잰다.
// 자기 빛(거점 · 감옥 · 탈출구)은 안개 레이어의 빛 지도 아래 그릇(FogLayer.underLight)에 넣는다: 곱하기 앞이라 어둠 속에서는
// 하한만큼 약하고 시간에 따라 변하지 않는다(R9 — 상태색이 바뀌는 것은 공개 정보).
import type Phaser from 'phaser';
import {
  CAPTURE_POINTS,
  EXITS,
  MAP_H,
  MAP_W,
  POINT_IDS,
  PRISON_CENTER,
  TILE_PX,
  type DepthDebugInfo,
  type ExitView,
  type PointView,
  type Vec2,
} from '@decoy/shared';
import {
  DEPTH,
  DEPTH_COLOR,
  DEPTH_NEON,
  NEON_FRONT_AT,
  PILLAR_PRISMS,
  WALL_LAMPS,
  edgeSample,
  fadedRect,
  faceVisible,
  lampLevel,
  lightAt,
  lightLevel,
  litColor,
  prismFaceVisible,
  projX,
  projY,
  projectTop,
  raisedAt,
  raisedWall,
  rimColor,
  shade,
  splitByRect,
  topRect,
  wallFootprint,
  type DepthLook,
  type Disk,
  type LightEye,
} from '../art/depthGeom';
import type { NeonRun, TileRect } from '../art/mapArtGeom';
import { gfxState } from '../gfx/state';
import { MAP_X, MAP_Y, WORLD_SCALE } from '../ui/layout';
import type { ViewRect } from './camera';
import { DEPTH_LAYER_NAME, createCanvasTexture, nextFogKey, removeCanvasTexture } from './fogPaint';

/** 시험 · 디버그 (__DECOY__.getDepth — grade · cast는 worldRenderer가 채운다) */
export type DepthDebug = DepthDebugInfo;

/** 자기 빛 그림 (흰 둥근 번짐 한 장, 색은 틴트) */
const HALO_PX = 64;

export class DepthLayer {
  private readonly box: Phaser.GameObjects.Container;
  private readonly g: Phaser.GameObjects.Graphics;
  private look: DepthLook | null = null;
  /** 칸 가장자리 빛 [n, s, e, w] (안개 주기마다 보이는 칸만 다시) */
  private readonly light = new Float32Array(MAP_W * MAP_H * 4);
  private readonly stamp = new Int32Array(MAP_W * MAP_H).fill(-1);
  /** 기둥 옆면 빛 (덩어리마다 8면) */
  private readonly pillarLight = new Float32Array(PILLAR_PRISMS.length * 8);
  private readonly pillarStamp = new Int32Array(PILLAR_PRISMS.length).fill(-1);
  private cycle = 0;
  private eyes: LightEye[] = [];
  /** 하한 색 (rgb 정수 — 빛 지도 바탕과 같은 값) */
  private readonly ambient: number;
  /** 이번 프레임 칸 알파 (창 둘레 범위, 앞에서부터) */
  private alpha = new Float32Array(0);
  private readonly cam = { x: 0, y: 0 };
  private readonly p0 = { x: 0, y: 0 };
  private readonly p1 = { x: 0, y: 0 };
  private readonly sample = { x: 0, y: 0 };
  private readonly topPts: { x: number; y: number }[] = Array.from({ length: 8 }, () => ({ x: 0, y: 0 }));
  /** 반투명 판단에 쓰는 윗면 외접 사각형 (프레임마다 고쳐 쓴다) */
  private readonly hull = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly quadPts: { x: number; y: number }[] = Array.from({ length: 4 }, () => ({ x: 0, y: 0 }));
  /** 자기 빛 */
  private haloKey: string | null = null;
  private halos: Phaser.GameObjects.Image[] = [];
  readonly debug: DepthDebug = {
    on: false,
    look: null,
    cells: 0,
    pillars: 0,
    fadedBody: 0,
    fadedObjective: 0,
    faded: [],
    lamps: 0,
    lampsLit: 0,
    lightCycle: 0,
    eyes: 0,
    tris: 0,
    litFaces: 0,
    halos: 0,
    grade: false,
    cast: false,
  };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly root: Phaser.GameObjects.Container,
    ambientRgb: readonly [number, number, number],
  ) {
    this.ambient = (ambientRgb[0] << 16) | (ambientRgb[1] << 8) | ambientRgb[2];
    // 타일 좌표로 그린다 (그릇을 월드 배율 × 32px로 키운다)
    this.box = scene.make
      .container({ x: MAP_X, y: MAP_Y }, false)
      .setScale(TILE_PX * WORLD_SCALE)
      .setName(DEPTH_LAYER_NAME)
      .setVisible(false);
    this.g = scene.make.graphics({}, false).clear();
    this.box.add(this.g);
    root.add(this.box);
  }

  /** 시안 (null = 끔: 아무것도 그리지 않는다) */
  setLook(look: DepthLook | null): void {
    this.look = look;
    this.debug.on = look !== null;
    this.debug.look = look ? look.id : null;
    this.box.setVisible(look !== null);
    if (!look) {
      this.g.clear();
      gfxState.features.depthTris = 0;
      this.debug.cells = 0;
      this.debug.pillars = 0;
      this.debug.tris = 0;
      this.debug.faded = [];
      this.debug.fadedBody = 0;
      this.debug.fadedObjective = 0;
      this.debug.lamps = 0;
      this.debug.lampsLit = 0;
      this.debug.litFaces = 0;
    }
    for (const h of this.halos) h.setVisible(look !== null);
  }

  /** 안개 레이어를 다시 만든 뒤: 입체 레이어를 구조 레이어 맨 위로 (구운 비네트 오버레이는 그 뒤 post.raise가 다시 위로) */
  raise(): void {
    this.root.bringToTop(this.box);
  }

  /**
   * 안개 주기 (받은 시야): 빛 표본을 다시 잴 시야. 시야가 지난번과 같으면(같은 다각형 참조 · 같은 자리) 다시 재지 않는다.
   * 생존자 화면 = 팀 시야(자기 + 팀원), 괴물 화면 = 자기 부채꼴 · 근접 원. 상대 쪽 시야는 받지도 그리지도 않는다(R8)
   */
  relight(eyes: readonly LightEye[]): void {
    const prev = this.eyes;
    let same = prev.length === eyes.length;
    for (let k = 0; same && k < eyes.length; k += 1) {
      const a = prev[k];
      const b = eyes[k];
      same =
        !!a &&
        !!b &&
        a.poly === b.poly &&
        a.x === b.x &&
        a.y === b.y &&
        a.r === b.r &&
        a.inner === b.inner &&
        a.hard === b.hard;
    }
    if (same) return;
    // 값을 복사해 둔다 (부르는 쪽은 그릇을 다시 쓴다)
    this.eyes = eyes.map((e) => ({ poly: e.poly, x: e.x, y: e.y, r: e.r, inner: e.inner, hard: e.hard }));
    this.cycle += 1;
    this.debug.lightCycle = this.cycle;
    this.debug.eyes = eyes.length;
  }

  /** 칸 (i, j)의 가장자리 빛을 이번 주기 값으로 (이미 쟀으면 그대로) */
  private lit(i: number, j: number): number {
    const c = j * MAP_W + i;
    if (this.stamp[c] === this.cycle) return c * 4;
    this.stamp[c] = this.cycle;
    const s = this.sample;
    for (let k = 0; k < 4; k += 1) {
      const side = SIDES[k] ?? 'n';
      let v = 0;
      if (raisedAt(i + (SIDE_DI[k] ?? 0), j + (SIDE_DJ[k] ?? 0)) === 0 && this.eyes.length > 0) {
        edgeSample(side, i, j, s);
        if (s.x > 0 && s.y > 0 && s.x < MAP_W && s.y < MAP_H) v = lightAt(s.x, s.y, this.eyes);
      }
      this.light[c * 4 + k] = v;
    }
    return c * 4;
  }

  /** 기둥 덩어리 p의 옆면 빛 (이번 주기) */
  private pillarLit(p: number): number {
    if (this.pillarStamp[p] === this.cycle) return p * 8;
    this.pillarStamp[p] = this.cycle;
    const prism = PILLAR_PRISMS[p];
    if (!prism) return p * 8;
    const b = prism.base;
    for (let k = 0; k < 8; k += 1) {
      const a = b[k];
      const c = b[(k + 1) % 8];
      let v = 0;
      if (a && c && this.eyes.length > 0) {
        const nx = c.y - a.y;
        const ny = -(c.x - a.x);
        const len = Math.hypot(nx, ny) || 1;
        // 받침 8각 변 가운데에서 바깥 바닥으로 (들임 + 표본 거리)
        const out = MAP_ART_INSET + DEPTH.sampleOut;
        v = lightAt((a.x + c.x) / 2 + (nx / len) * out, (a.y + c.y) / 2 + (ny / len) * out, this.eyes);
      }
      this.pillarLight[p * 8 + k] = v;
    }
    return p * 8;
  }

  /**
   * 한 프레임: 보이는 창 둘레의 띄운 벽 · 기둥을 북 → 남 줄 순서로 그린다(남쪽 = 카메라에 가까운 것이 나중). bodies = 이번 프레임에 그린
   * 캐릭터 몸 원(받은 정보만), objectives = 거점 · 탈출구 판정 원, tS = 장식 시계(초, 벽 등 깜빡임)
   */
  draw(view: ViewRect, bodies: readonly Disk[], objectives: readonly Disk[], tS: number): void {
    const look = this.look;
    if (!look) return;
    const g = this.g;
    g.clear();
    const cam = this.cam;
    cam.x = view.x + view.w / 2;
    cam.y = view.y + view.h / 2;
    const i0 = Math.max(0, Math.floor(view.x) - 1);
    const i1 = Math.min(MAP_W - 1, Math.ceil(view.x + view.w) + 1);
    const j0 = Math.max(0, Math.floor(view.y) - 1);
    // 창 아래 칸의 윗면도 위로 올라와 창에 들어온다
    const j1 = Math.min(MAP_H - 1, Math.ceil(view.y + view.h + look.lift + look.parallax * view.h) + 1);
    const w = i1 - i0 + 1;
    const h = j1 - j0 + 1;
    if (this.alpha.length < w * h) this.alpha = new Float32Array(w * h);
    const dbg = this.debug;
    dbg.cells = 0;
    dbg.pillars = 0;
    dbg.fadedBody = 0;
    dbg.fadedObjective = 0;
    dbg.faded.length = 0;
    dbg.lamps = 0;
    dbg.lampsLit = 0;
    dbg.tris = 0;
    dbg.litFaces = 0;
    // 1. 칸 알파 (캐릭터 · 판정 원)
    for (let j = j0; j <= j1; j += 1)
      for (let i = i0; i <= i1; i += 1) {
        let a = 1;
        if (raisedWall(i, j)) {
          const hull = topRect(i, j, cam, look, this.hull);
          if (fadedRect(hull, bodies, NO_DISKS)) {
            a = DEPTH.fadeAlpha;
            dbg.fadedBody += 1;
            dbg.faded.push({ i, j });
          } else if (fadedRect(hull, NO_DISKS, objectives)) {
            a = DEPTH.fadeAlpha;
            dbg.fadedObjective += 1;
            dbg.faded.push({ i, j });
          }
        }
        this.alpha[(j - j0) * w + (i - i0)] = a;
      }
    const alphaAt = (i: number, j: number): number =>
      i < i0 || i > i1 || j < j0 || j > j1 ? 1 : (this.alpha[(j - j0) * w + (i - i0)] ?? 1);
    // 기둥 덩어리를 마지막 줄 다음에 그린다 (줄 순서에 끼운다)
    let nextPillar = 0;
    const pillarRows = PILLAR_ORDER;
    for (let j = j0; j <= j1; j += 1) {
      // 이 줄보다 북쪽에서 끝나는 기둥 먼저
      while (nextPillar < pillarRows.length) {
        const p = pillarRows[nextPillar];
        if (p === undefined) break;
        const prism = PILLAR_PRISMS[p];
        if (!prism || prism.block.y1 - 1 >= j) break;
        this.drawPillar(p, bodies, objectives, i0, i1, j0, j1);
        nextPillar += 1;
      }
      this.drawRowFaces(j, i0, i1, tS);
      this.drawRowTops(j, i0, i1, alphaAt);
      this.drawRowNeon(j, i0, i1);
    }
    while (nextPillar < pillarRows.length) {
      const p = pillarRows[nextPillar];
      if (p !== undefined) this.drawPillar(p, bodies, objectives, i0, i1, j0, j1);
      nextPillar += 1;
    }
    this.drawSideNeon(i0, i1, j0, j1);
    gfxState.features.depthTris = dbg.tris;
  }

  /** 삼각형 하나 (꼭짓점 색 셋) */
  private tri(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    ca: number,
    cb: number,
    cc: number,
    alpha: number,
  ): void {
    this.g.fillGradientStyle(ca, cb, cc, cc, alpha, alpha, alpha, alpha);
    this.g.fillTriangle(ax, ay, bx, by, cx, cy);
    this.debug.tris += 1;
  }

  /** 사각형 (a → b → c → d 둘레, 꼭짓점 색 넷) */
  private quad(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
    ca: number,
    cb: number,
    cc: number,
    cd: number,
    alpha: number,
  ): void {
    this.tri(ax, ay, bx, by, dx, dy, ca, cb, cd, alpha);
    this.tri(bx, by, cx, cy, dx, dy, cb, cc, cd, alpha);
  }

  /** 볼록 다각형 단색 (부채 삼각형 — Earcut 없음) */
  private fan(poly: readonly Vec2[], color: number, alpha: number): void {
    const a = poly[0];
    if (!a) return;
    for (let k = 1; k + 1 < poly.length; k += 1) {
      const b = poly[k];
      const c = poly[k + 1];
      if (b && c) this.tri(a.x, a.y, b.x, b.y, c.x, c.y, color, color, color, alpha);
    }
  }

  /**
   * 반투명 칸의 윗면: 받침 안쪽은 불투명(맵 그림 옛 벽이 겹쳐 비치지 않게), 바닥 위로 뻗은 바깥쪽 조각만 반투명(그 아래 캐릭터 ·
   * 판정 원이 비친다 — 캐릭터 · 정보는 원래 이 레이어 위에 그려진다)
   */
  private splitTop(top: readonly Vec2[], foot: TileRect, color: number, alpha: number): void {
    const parts = splitByRect(top, foot);
    this.fan(parts.inside, color, 1);
    for (const p of parts.outside) this.fan(p, color, alpha);
  }

  /** 단색 사각형 (축에 나란한) */
  private rect(x0: number, y0: number, x1: number, y1: number, color: number, alpha: number): void {
    this.g.fillStyle(color, alpha);
    this.g.fillRect(x0, y0, x1 - x0, y1 - y0);
    this.debug.tris += 2;
  }

  /** 줄 j의 옆면 (남쪽 · 동 · 서) + 남쪽 면의 벽 등 */
  private drawRowFaces(j: number, i0: number, i1: number, tS: number): void {
    const look = this.look;
    if (!look) return;
    const cam = this.cam;
    const amb = this.ambient;
    const face = DEPTH_COLOR.wallFace;
    const yTop = projY(j + 1, cam, look);
    const southVisible = faceVisible('s', 0, j, cam, look);
    for (let i = i0; i <= i1; i += 1) {
      if (!raisedWall(i, j)) continue;
      const o = this.lit(i, j);
      // 남쪽 면 (받침 안이라 늘 불투명 — 반투명은 바닥 위로 뻗은 윗면 조각만)
      if (southVisible && raisedAt(i, j + 1) === 0) {
        const own = this.light[o + 1] ?? 0;
        const lo = this.southNeighbor(i - 1, j) ? (own + (this.light[this.lit(i - 1, j) + 1] ?? 0)) / 2 : own;
        const ro = this.southNeighbor(i + 1, j) ? (own + (this.light[this.lit(i + 1, j) + 1] ?? 0)) / 2 : own;
        const cl = litColor(face, amb, lo);
        const cr = litColor(face, amb, ro);
        const xl = projX(i, cam, look);
        const xr = projX(i + 1, cam, look);
        this.quad(
          xl,
          yTop,
          xr,
          yTop,
          i + 1,
          j + 1,
          i,
          j + 1,
          cl,
          cr,
          shade(cr, DEPTH.faceFoot),
          shade(cl, DEPTH.faceFoot),
          1,
        );
        if (own > 0) this.debug.litFaces += 1;
      }
      // 동 · 서 면 (카메라 중심 쪽)
      for (const side of SIDE_EW) {
        const ni = side === 'e' ? i + 1 : i - 1;
        if (raisedAt(ni, j) !== 0 || !faceVisible(side, i, j, cam, look)) continue;
        const k = side === 'e' ? 2 : 3;
        const own = this.light[o + k] ?? 0;
        const up = this.sideNeighbor(side, i, j - 1)
          ? (own + (this.light[this.lit(i, j - 1) + k] ?? 0)) / 2
          : own;
        const dn = this.sideNeighbor(side, i, j + 1)
          ? (own + (this.light[this.lit(i, j + 1) + k] ?? 0)) / 2
          : own;
        const cu = shade(litColor(face, amb, up), DEPTH.sideShade);
        const cd = shade(litColor(face, amb, dn), DEPTH.sideShade);
        const xb = side === 'e' ? i + 1 : i;
        const xt = projX(xb, cam, look);
        this.quad(
          xt,
          projY(j, cam, look),
          xb,
          j,
          xb,
          j + 1,
          xt,
          projY(j + 1, cam, look),
          cu,
          shade(cu, DEPTH.faceFoot),
          shade(cd, DEPTH.faceFoot),
          cd,
          1,
        );
        if (own > 0) this.debug.litFaces += 1;
      }
    }
    // 벽 등: 남쪽 면 위의 청록 막대 (내 시야 빛을 받는 동안만 깜빡인다 — 어둠 속에서는 정지, R9)
    if (!southVisible) return;
    for (const lamp of LAMPS_BY_ROW[j] ?? NO_LAMPS) {
      if (lamp.i < i0 || lamp.i > i1) continue;
      const o = this.lit(lamp.i, j);
      const l = this.light[o + 1] ?? 0;
      const k = lampLevel(tS, lamp.seed, l);
      const lit = litColor(DEPTH_COLOR.lamp, amb, l);
      const c = l > 0 ? shade(lit, k) : lit;
      const f = DEPTH.lampAt;
      const cx = lamp.i + 0.5;
      const xc = projX(cx, cam, look) + (cx - projX(cx, cam, look)) * f;
      const yc = yTop + (j + 1 - yTop) * f;
      const half = (DEPTH.lampW * (1 + look.parallax * (1 - f))) / 2;
      this.rect(xc - half, yc - DEPTH.lampH / 2, xc + half, yc + DEPTH.lampH / 2, c, 1);
      this.debug.lamps += 1;
      if (l > 0) this.debug.lampsLit += 1;
    }
  }

  /**
   * 줄 j의 앞면 네온 (맵 그림 네온 자리): 남쪽 면의 같은 높이 비율에 (윗면 세로 네온은 drawSideNeon).
   * 발광이라 빛 0에서도 neonFloor만큼 밝다(맵 그림 네온처럼 어둠 속에서 보인다) — 시간에 따라 변하지 않는다(R9)
   */
  private drawRowNeon(j: number, i0: number, i1: number): void {
    const look = this.look;
    if (!look) return;
    const cam = this.cam;
    const amb = this.ambient;
    const hw = DEPTH.neonWidth / 2;
    for (const n of FRONT_NEON_BY_ROW[j] ?? NO_NEON) {
      if (n.x1 < i0 || n.x0 > i1 + 1) continue;
      {
        const ci = Math.floor((n.x0 + n.x1) / 2);
        const o = this.lit(ci, j);
        const l = this.light[o + 1] ?? 0;
        const c = litColor(DEPTH_COLOR.neon, amb, DEPTH.neonFloor + (1 - DEPTH.neonFloor) * l);
        const f = NEON_FRONT_AT;
        const yTop = projY(j + 1, cam, look);
        const y = yTop + (j + 1 - yTop) * f;
        const xa = projX(n.x0, cam, look) + (n.x0 - projX(n.x0, cam, look)) * f;
        const xb = projX(n.x1, cam, look) + (n.x1 - projX(n.x1, cam, look)) * f;
        this.rect(xa, y - hw, xb, y + hw, c, 1);
      }
    }
  }

  /**
   * 윗면 세로 네온 (모든 줄을 그린 뒤 한 번에): 여러 줄에 걸친 선이라 보이는 줄 범위와 겹치면 그린다 — 끝나는 줄로만 고르면 창
   * 아래쪽에서 끝나는 긴 선이 사라졌다 나타난다. 자기 벽 윗면 안이라 남쪽 덩어리 그림과 겹치지 않는다(벽 사이 바닥 1칸 > 띄운 높이)
   */
  private drawSideNeon(i0: number, i1: number, j0: number, j1: number): void {
    const look = this.look;
    if (!look) return;
    const cam = this.cam;
    const hw = DEPTH.neonWidth / 2;
    const c = litColor(DEPTH_COLOR.neon, this.ambient, DEPTH.neonFloor);
    for (const n of SIDE_NEON) {
      if (n.x1 < i0 || n.x0 > i1 + 1 || n.y1 < j0 || n.y0 > j1 + 1) continue;
      const x = projX(n.x0, cam, look);
      this.rect(x - hw, projY(n.y0, cam, look), x + hw, projY(n.y1, cam, look), c, 1);
    }
  }

  /** (i, j)도 남쪽 면이 있는 벽 칸인가 (꼭짓점 빛을 이웃과 나눈다) */
  private southNeighbor(i: number, j: number): boolean {
    return raisedWall(i, j) && raisedAt(i, j + 1) === 0;
  }

  /** (i, j)도 같은 쪽 옆면이 있는 벽 칸인가 */
  private sideNeighbor(side: 'e' | 'w', i: number, j: number): boolean {
    const ni = side === 'e' ? i + 1 : i - 1;
    return raisedWall(i, j) && raisedAt(ni, j) === 0;
  }

  /** 줄 j의 윗면 (같은 빛 단계 · 알파끼리 이어 그린다) + 윗면 가장자리 테두리 */
  private drawRowTops(j: number, i0: number, i1: number, alphaAt: (i: number, j: number) => number): void {
    const look = this.look;
    if (!look) return;
    const cam = this.cam;
    const amb = this.ambient;
    const y0 = projY(j, cam, look);
    const y1 = projY(j + 1, cam, look);
    const r = DEPTH.rim;
    let runStart = -1;
    let runAlpha = 1;
    const topColor = litColor(DEPTH_COLOR.wallTop, amb, DEPTH.topLight);
    const flush = (end: number): void => {
      if (runStart < 0) return;
      this.rect(projX(runStart, cam, look), y0, projX(end, cam, look), y1, topColor, runAlpha);
      runStart = -1;
    };
    // 불투명 칸은 줄로 이어 그리고, 반투명 칸은 칸마다 받침 안 · 밖으로 나눠 그린다
    for (let i = i0; i <= i1 + 1; i += 1) {
      const raised = i <= i1 && raisedWall(i, j);
      const a = raised ? alphaAt(i, j) : 1;
      if (runStart >= 0 && (!raised || a < 1)) flush(i);
      if (!raised) continue;
      this.debug.cells += 1;
      if (a < 1) {
        const q = this.quadPts;
        const xa = projX(i, cam, look);
        const xb = projX(i + 1, cam, look);
        setPt(q[0], xa, y0);
        setPt(q[1], xb, y0);
        setPt(q[2], xb, y1);
        setPt(q[3], xa, y1);
        this.splitTop(q, wallFootprint(i, j), topColor, a);
      } else if (runStart < 0) {
        runStart = i;
        runAlpha = a;
      }
    }
    // 테두리: 윗면에서 이웃이 띄운 칸이 아닌 쪽 가장자리 (그 바깥 바닥의 빛으로)
    for (let i = i0; i <= i1; i += 1) {
      if (!raisedWall(i, j)) continue;
      const a = alphaAt(i, j);
      const o = this.lit(i, j);
      const xl = projX(i, cam, look);
      const xr = projX(i + 1, cam, look);
      if (raisedAt(i, j - 1) === 0)
        this.rect(xl, y0, xr, y0 + r, rimColor(amb, lightLevel(this.light[o] ?? 0)), a);
      if (raisedAt(i, j + 1) === 0)
        this.rect(xl, y1 - r, xr, y1, rimColor(amb, lightLevel(this.light[o + 1] ?? 0)), a);
      if (raisedAt(i + 1, j) === 0)
        this.rect(xr - r, y0, xr, y1, shade(rimColor(amb, lightLevel(this.light[o + 2] ?? 0)), 0.85), a);
      if (raisedAt(i - 1, j) === 0)
        this.rect(xl, y0, xl + r, y1, rimColor(amb, lightLevel(this.light[o + 3] ?? 0)), a);
    }
  }

  /** 기둥 덩어리 하나: 보이는 옆면 → 8각 윗면 → 윗테두리 */
  private drawPillar(
    p: number,
    bodies: readonly Disk[],
    objectives: readonly Disk[],
    i0: number,
    i1: number,
    j0: number,
    j1: number,
  ): void {
    const look = this.look;
    const prism = PILLAR_PRISMS[p];
    if (!look || !prism) return;
    const b = prism.block;
    if (b.x1 < i0 || b.x0 > i1 + 1 || b.y1 < j0 || b.y0 > j1 + 1) return;
    const cam = this.cam;
    const amb = this.ambient;
    const base = prism.base;
    const top = this.topPts;
    let hx0 = Infinity;
    let hy0 = Infinity;
    let hx1 = -Infinity;
    let hy1 = -Infinity;
    for (let k = 0; k < 8; k += 1) {
      const v = base[k];
      const t = top[k];
      if (!v || !t) continue;
      projectTop(v.x, v.y, cam, look, t);
      hx0 = Math.min(hx0, t.x);
      hy0 = Math.min(hy0, t.y);
      hx1 = Math.max(hx1, t.x);
      hy1 = Math.max(hy1, t.y);
    }
    const hull = this.hull;
    hull.x0 = hx0;
    hull.y0 = hy0;
    hull.x1 = hx1;
    hull.y1 = hy1;
    let a = 1;
    if (fadedRect(hull, bodies, NO_DISKS)) {
      a = DEPTH.fadeAlpha;
      this.debug.fadedBody += 1;
      this.debug.faded.push({ i: b.x0, j: b.y0 });
    } else if (fadedRect(hull, NO_DISKS, objectives)) {
      a = DEPTH.fadeAlpha;
      this.debug.fadedObjective += 1;
      this.debug.faded.push({ i: b.x0, j: b.y0 });
    }
    this.debug.pillars += 1;
    const o = this.pillarLit(p);
    for (let k = 0; k < 8; k += 1) {
      const v0 = base[k];
      const v1 = base[(k + 1) % 8];
      const t0 = top[k];
      const t1 = top[(k + 1) % 8];
      if (!v0 || !v1 || !t0 || !t1) continue;
      const l = this.pillarLight[o + k] ?? 0;
      if (!prismFaceVisible(v0, v1, t0, t1)) continue;
      // 남쪽을 볼수록 밝게 (빛은 화면 아래 — 카메라 쪽에서)
      const nx = v1.y - v0.y;
      const ny = -(v1.x - v0.x);
      const len = Math.hypot(nx, ny) || 1;
      const facing = 0.75 + 0.25 * Math.max(0, ny / len);
      const c = shade(litColor(DEPTH_COLOR.pillarFace, amb, l), facing);
      const foot = shade(c, DEPTH.faceFoot);
      // 옆면은 받침 안이라 늘 불투명 (반투명은 바닥 위로 뻗은 윗면 조각만)
      this.quad(t0.x, t0.y, t1.x, t1.y, v1.x, v1.y, v0.x, v0.y, c, c, foot, foot, 1);
      if (l > 0) this.debug.litFaces += 1;
    }
    // 8각 윗면 (부채 삼각형 6개)
    const ct = litColor(DEPTH_COLOR.pillarTop, amb, DEPTH.topLight);
    if (a < 1) this.splitTop(top, b, ct, a);
    else this.fan(top, ct, 1);
    // 윗테두리 (변마다 안쪽 띠, 8각 무게중심 쪽으로)
    let mx = 0;
    let my = 0;
    for (let k = 0; k < 8; k += 1) {
      const t = top[k];
      if (t) {
        mx += t.x / 8;
        my += t.y / 8;
      }
    }
    for (let k = 0; k < 8; k += 1) {
      const ta = top[k];
      const tb = top[(k + 1) % 8];
      if (!ta || !tb) continue;
      const rc = rimColor(amb, lightLevel(this.pillarLight[o + k] ?? 0));
      const ia = inward(ta, mx, my, DEPTH.rim, this.p0);
      const ib = inward(tb, mx, my, DEPTH.rim, this.p1);
      this.quad(ta.x, ta.y, tb.x, tb.y, ib.x, ib.y, ia.x, ia.y, rc, rc, rc, rc, a);
    }
  }

  // ───────────────────────── 자기 빛 (거점 · 감옥 · 탈출구) ─────────────────────────

  /**
   * 안개 레이어의 빛 지도 아래 그릇에 자기 빛 이미지를 단다 (안개 레이어를 다시 만들 때마다 — 지난 그릇과 함께 지난 이미지는
   * 없어졌다). host가 null이면(Canvas 합성) 달지 않는다
   */
  attachHalos(host: Phaser.GameObjects.Container | null): void {
    for (const h of this.halos) if (h.scene) h.destroy();
    this.halos = [];
    this.debug.halos = 0;
    if (!host) return;
    if (!this.haloKey) {
      const c = document.createElement('canvas');
      c.width = HALO_PX;
      c.height = HALO_PX;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const grad = ctx.createRadialGradient(
        HALO_PX / 2,
        HALO_PX / 2,
        0,
        HALO_PX / 2,
        HALO_PX / 2,
        HALO_PX / 2,
      );
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, HALO_PX, HALO_PX);
      this.haloKey = nextFogKey('depth-halo');
      createCanvasTexture(this.scene.textures, this.haloKey, c);
    }
    const k = TILE_PX * WORLD_SCALE;
    const add = (at: Vec2, r: number): void => {
      if (!this.haloKey) return;
      const img = this.scene.make
        .image({ x: MAP_X + at.x * k, y: MAP_Y + at.y * k, key: this.haloKey }, false)
        .setDisplaySize(r * 2 * k, r * 2 * k)
        .setVisible(this.look !== null);
      host.addAt(img, 0);
      this.halos.push(img);
    };
    for (const id of POINT_IDS) add(CAPTURE_POINTS[id], DEPTH.haloPoint);
    add(PRISON_CENTER, DEPTH.haloPrison);
    for (const id of ['N', 'S'] as const) add(EXITS[id].center, DEPTH.haloExit);
    this.debug.halos = this.halos.length;
  }

  /** 자기 빛 색 · 세기 (거점 · 탈출구 상태 — 받는 사람과 무관한 공개 정보) */
  updateHalos(points: readonly PointView[], exits: readonly ExitView[]): void {
    const look = this.look;
    if (!look || this.halos.length === 0) return;
    for (let n = 0; n < POINT_IDS.length; n += 1) {
      const id = POINT_IDS[n];
      const img = this.halos[n];
      if (!img || !id) continue;
      let off = false;
      for (const p of points) if (p.id === id) off = p.state === 'off';
      setHalo(img, off ? DEPTH_COLOR.haloPointOff : DEPTH_COLOR.haloPoint, look.halo);
    }
    const prison = this.halos[POINT_IDS.length];
    if (prison) setHalo(prison, DEPTH_COLOR.haloPrison, look.halo);
    const exitIds = ['N', 'S'] as const;
    for (let n = 0; n < exitIds.length; n += 1) {
      const img = this.halos[POINT_IDS.length + 1 + n];
      if (!img) continue;
      let go = false;
      for (const e of exits) if (e.id === exitIds[n]) go = e.state !== 'inactive';
      setHalo(img, go ? DEPTH_COLOR.haloExitGo : DEPTH_COLOR.haloExitOff, look.halo);
    }
  }

  destroy(): void {
    gfxState.features.depthTris = 0;
    for (const h of this.halos) if (h.scene) h.destroy();
    this.halos = [];
    this.box.destroy();
    if (this.haloKey) removeCanvasTexture(this.scene.textures, this.haloKey);
    this.haloKey = null;
  }
}

/** 칸 가장자리 [북, 남, 동, 서]와 그 쪽 이웃 칸 */
const SIDES = ['n', 's', 'e', 'w'] as const;
const SIDE_DI: readonly number[] = [0, 0, 1, -1];
const SIDE_DJ: readonly number[] = [-1, 1, 0, 0];
const SIDE_EW = ['e', 'w'] as const;
const NO_DISKS: readonly Disk[] = [];

/** 기둥 받침 들임 (맵 그림 pillarShape와 같은 값) */
const MAP_ART_INSET = 0.07;

/** 기둥 덩어리를 마지막 줄 순서로 */
const PILLAR_ORDER: readonly number[] = PILLAR_PRISMS.map((_, i) => i).sort(
  (a, b) => (PILLAR_PRISMS[a]?.block.y1 ?? 0) - (PILLAR_PRISMS[b]?.block.y1 ?? 0),
);

/** 줄별 벽 등 */
const LAMPS_BY_ROW: readonly (readonly (typeof WALL_LAMPS)[number][])[] = (() => {
  const rows: (typeof WALL_LAMPS)[number][][] = Array.from({ length: MAP_H }, () => []);
  for (const l of WALL_LAMPS) rows[l.j]?.push(l);
  return rows;
})();
const NO_LAMPS: readonly (typeof WALL_LAMPS)[number][] = [];

/** 앞면 네온을 그 벽 줄로 */
const FRONT_NEON_BY_ROW: readonly (readonly NeonRun[])[] = (() => {
  const rows: NeonRun[][] = Array.from({ length: MAP_H }, () => []);
  for (const n of DEPTH_NEON)
    if (n.face === 'front') rows[Math.max(0, Math.min(MAP_H - 1, Math.floor(n.y0)))]?.push(n);
  return rows;
})();
/** 윗면 세로 네온 (여러 줄에 걸친다) */
const SIDE_NEON: readonly NeonRun[] = DEPTH_NEON.filter((n) => n.face === 'side');
const NO_NEON: readonly NeonRun[] = [];

/** 점을 중심 쪽으로 d만큼 (윗테두리 안쪽 변) */
function inward(
  p: Vec2,
  cx: number,
  cy: number,
  d: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  const dx = cx - p.x;
  const dy = cy - p.y;
  const len = Math.hypot(dx, dy) || 1;
  out.x = p.x + (dx / len) * d;
  out.y = p.y + (dy / len) * d;
  return out;
}

function setPt(p: { x: number; y: number } | undefined, x: number, y: number): void {
  if (!p) return;
  p.x = x;
  p.y = y;
}

function setHalo(img: Phaser.GameObjects.Image, color: number, alpha: number): void {
  if (img.tintTopLeft !== color) img.setTint(color);
  if (img.alpha !== alpha) img.setAlpha(alpha);
}
