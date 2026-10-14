// 러너 새 캐릭터 (캐릭터 리디자인): 깊게 눌러쓴 파랑 후드티 + 큰 운동화. 가볍고 빠른 인상.
// 위에서 보면 머리 후드의 끝이 물방울처럼 뒤로 흐른다(옛 물방울 모티프) — 둥근 머리 + 뒤로 뾰족한 꼬리가 실루엣의 핵심.
// 네온 포인트는 후드 테두리의 밝은 파랑 선(위 · 정면)과 가슴의 » 갈매기 무늬 · 후드 끈(정면)뿐이다. 위 그림의 후드 등에도
// » 무늬를 밝은 파랑(네온 아님)으로 넣어 앞쪽을 가리킨다.
// 색은 역할색 파랑(#3B82F6)과 그 짙은/밝은 변형, 어두운 남회색 바지 · 신발, 밝은 회색 밑창.
import { OUTLINE, ROLE } from '../palette';
import { Sketch, linear, path, radial, shade, solid, tint, type Drawing, type Paint } from './kit';
import {
  FRONT,
  MAT,
  TOP,
  domePaint,
  frontBreath,
  frontClothPaint,
  frontEyes,
  frontLegs,
  frontTorsoPath,
  inkFor,
  topArm,
  topRig,
  topTorsoPath,
  type Ink,
} from './survivorBase';
import type { ArtOptions, FrontPose, SurvivorArt, SurvivorPose } from './types';

/** 러너 색 */
export const RUNNER_COLOR = {
  hoodie: ROLE.runner,
  /** 후드 안 그늘 · 짙은 파랑 */
  deep: 0x1e3a8a,
  /** 네온 테두리 (밝은 파랑, 글자용 역할색) */
  neon: 0x60a5fa,
  pants: 0x253041,
  shoe: 0x2b3646,
  /** 밝은 밑창 (작은 면적이라 순백 대신 밝은 회색) */
  sole: 0xcbd5e1,
  glove: 0x334155,
  hair: 0x1b2430,
} as const;

const C = RUNNER_COLOR;

/** 후드 칠 (머리 중심에서 꼬리 끝까지 닿는 위 조명, 회전과 무관) */
function hoodPaint(ink: Ink, cx: number, cy: number, reach: number): Paint {
  return radial(cx, cy, reach, [
    [0, ink(tint(C.hoodie, 0.16))],
    [0.38, ink(C.hoodie)],
    [0.78, ink(shade(C.hoodie, 0.16))],
    [1, ink(shade(C.hoodie, 0.32))],
  ]);
}

/**
 * 위에서 본 물방울 후드: 중심 (hx, hy) 반지름 R의 둥근 머리 + 꼬리 끝 (tx, ty). 꼬리 양옆은 조금 볼록한 곡선
 * (작은 크기에서도 꼬리 면적이 남게)
 */
function dropPath(hx: number, hy: number, R: number, tx: number, ty: number, bulge = 0.08): string {
  const dx = tx - hx;
  const dy = ty - hy;
  const dist = Math.hypot(dx, dy);
  const beta = Math.atan2(dy, dx);
  const phi = Math.acos(Math.min(0.99, R / dist));
  const a0 = beta + phi;
  const a1 = beta - phi + Math.PI * 2;
  const p0: [number, number] = [hx + Math.cos(a0) * R, hy + Math.sin(a0) * R];
  const p1: [number, number] = [hx + Math.cos(a1) * R, hy + Math.sin(a1) * R];
  // 옆 곡선 조절점: 접점 → 꼬리 중간에서 바깥으로 밀어 낸다
  const nx = -Math.sin(beta);
  const ny = Math.cos(beta);
  const c1: [number, number] = [(p1[0] + tx) / 2 + nx * bulge, (p1[1] + ty) / 2 + ny * bulge];
  const c0: [number, number] = [(p0[0] + tx) / 2 - nx * bulge, (p0[1] + ty) / 2 - ny * bulge];
  return path().arc(hx, hy, R, a0, a1).Q(c1[0], c1[1], tx, ty).Q(c0[0], c0[1], p0[0], p0[1]).Z().d;
}

/** 위에서 본 운동화: 밝은 밑창 앞코 + 어두운 갑피 + 파랑 줄 (공통 신발보다 조금 크다) */
function topSneaker(sk: Sketch, x: number, y: number, ink: Ink, len = 0.3): void {
  sk.part(path().ellipse(x, y, len, 0.155).d, solid(ink(C.sole)), ink(OUTLINE));
  sk.fill(path().ellipse(x - 0.05, y, len - 0.05, 0.14).d, solid(ink(C.shoe)));
  sk.line(
    path()
      .M(x - len * 0.6, y)
      .L(x + len * 0.25, y).d,
    solid(ink(C.hoodie)),
    0.07,
  );
}

function top(p: SurvivorPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  const a = p.action;
  // 날렵한 몸: 어깨 · 몸통이 공통 체형보다 조금 좁고 얇다 (물방울 후드가 덩어리의 주인공). 질주 때 더 움츠린다
  const r = topRig(p, TOP.halfW * (0.96 - 0.06 * a), TOP.halfD * 0.9);
  const s = r.s;
  // 질주: 보폭이 커지고, 팔은 뒤로 접혀 크게 흔든다
  const footK = 1 + 0.35 * a;
  const feet = r.feet.map(([fx, fy]): [number, number] => [fx * footK + 0.06 * a, fy]);
  if (p.mode === 'free') {
    for (const side of [0, 1] as const) {
      const sign = side === 0 ? -1 : 1;
      const [hx0, hy0] = r.hands[side];
      const sprint: [number, number] = [
        (-0.32 * r.halfD) / TOP.halfD + sign * 0.45 * s,
        sign * 0.8 * r.halfW,
      ];
      r.hands[side] = [hx0 + (sprint[0] - hx0) * a, hy0 + (sprint[1] - hy0) * a];
    }
  }
  // 구조 중: 두 손이 후드 앞으로 나와 자물쇠를 만진다 (공통 손 자리는 큰 후드에 가려진다)
  if (p.mode === 'reach') {
    const reachX = r.head[0] + r.headR + 0.14;
    r.hands = [
      [reachX, -0.3],
      [reachX, 0.3],
    ];
  }
  // 1) 운동화
  for (const [fx, fy] of feet) topSneaker(sk, fx + r.ox, fy, ink);
  // 2) 몸통 (후드티)
  // 어깨는 후드보다 한 단 짙게: 위에서 보면 밝은 물방울 후드가 어깨 위에 떠 보인다
  const body = shade(C.hoodie, 0.06);
  sk.part(topTorsoPath(r), domePaint(body, ink, r.halfW * 1.12), ink(OUTLINE));
  // 3) 팔 (소매 + 어두운 장갑)
  topArm(sk, r, 0, body, C.glove, ink, 0.3);
  topArm(sk, r, 1, body, C.glove, ink, 0.3);
  // 4) 물방울 후드: 어깨 위에 드리운 그늘(칠만) 위에 얹어 작은 크기에서도 머리 · 꼬리가 몸통과 갈린다
  const hit = p.hit;
  const R = r.headR * 1.1;
  // 질주: 머리를 앞으로 내민다
  const hx = r.head[0] + 0.04 + 0.26 * a - 0.06 * hit;
  const hy = r.head[1];
  const captive = p.mode === 'captive' ? 1 : 0;
  // 꼬리 끝 (몸 중심 기준): 서기 −1.02, 질주 −1.1 (뒤 한도 1.1). 걷기에 옆으로 흔들리고(질주 때 더 크게),
  // 수감 때 움츠러든다. 피격 때는 몸 쪽으로 눌려 짧고 뭉툭해진다(옆으로 꺾으면 몸을 돌린 것처럼 읽힌다)
  const tx = -1.02 - 0.08 * a + 0.16 * captive + 0.14 * hit + r.ox;
  const ty = hy + 0.13 * (1 + 0.5 * a) * Math.sin(p.walk + 0.9) * p.stride + 0.08 * hit;
  // 꼬리 폭: 서기 때 통통한 물방울, 질주 때 가늘고 긴 혜성 줄기
  const tailBulge = 0.3 - 0.2 * a + 0.08 * hit;
  sk.fill(
    dropPath(hx, hy, R + 0.03, tx - 0.02, ty, tailBulge),
    solid(ink(shade(C.deep, 0.4))),
    0.45,
  );
  sk.part(dropPath(hx, hy, R, tx, ty, tailBulge), hoodPaint(ink, hx - 0.06, hy, hx - tx + 0.05), ink(OUTLINE));
  // 후드 등의 » 갈매기 무늬 (옛 문양, 앞을 가리킨다): 꼬리 위에 두 개, 꼬리 방향을 따라 눕는다
  const ang = Math.atan2(hy - ty, hx - tx);
  const along = (k: number, side: number): [number, number] => {
    const x = tx + (hx - tx) * k;
    const y = ty + (hy - ty) * k;
    return [x - Math.sin(ang) * side, y + Math.cos(ang) * side];
  };
  const chev = path();
  for (const k of [0.44, 0.58]) {
    const [ax, ay] = along(k - 0.08, -0.17);
    const [bx, by] = along(k, 0);
    const [cx, cy] = along(k - 0.08, 0.17);
    chev.M(ax, ay).L(bx, by).L(cx, cy);
  }
  sk.line(chev.d, solid(ink(tint(C.hoodie, 0.3))), 0.06);
  // 앞 얼굴 그늘 (후드 안) + 네온 테두리. 질주 때 네온이 밝아진다
  sk.fill(
    path()
      .arc(hx, hy, R * 0.9, -0.95, 0.95)
      .arc(hx + 0.06, hy, R * 0.52, 0.82, -0.82, false)
      .Z().d,
    solid(ink(C.deep)),
  );
  sk.line(
    path().arc(hx, hy, R * 0.84, -1.15, 1.15).d,
    solid(ink(tint(C.neon, 0.25))),
    0.11,
    'round',
    0.9 + 0.1 * a,
  );
  return sk.drawing();
}

/** 그림 전체를 고르게 키워 옮긴다 (상반신 아이콘: 머리 · 어깨를 상자에 꽉 채우게). x' = k x + tx */
function scaleDrawing(dr: Drawing, k: number, tx: number, ty: number): Drawing {
  const pt = (x: number, y: number): [number, number] => [x * k + tx, y * k + ty];
  const mapD = (d: string): string => {
    let i = 0;
    return d.replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (v) => {
      const n = Number(v);
      const out = i % 2 === 0 ? n * k + tx : n * k + ty;
      i += 1;
      return String(Math.round(out * 1000) / 1000);
    });
  };
  const mapPaint = (pa: Paint): Paint => {
    if (pa.kind === 'solid') return pa;
    if (pa.kind === 'linear') {
      const [x0, y0] = pt(pa.x0, pa.y0);
      const [x1, y1] = pt(pa.x1, pa.y1);
      return { ...pa, x0, y0, x1, y1 };
    }
    const [cx, cy] = pt(pa.cx, pa.cy);
    const f =
      pa.fx === undefined || pa.fy === undefined ? {} : (([fx, fy]) => ({ fx, fy }))(pt(pa.fx, pa.fy));
    return { ...pa, cx, cy, r: pa.r * k, ...f };
  };
  return {
    ops: dr.ops.map((op) => ({
      ...op,
      d: mapD(op.d),
      ...(op.fill ? { fill: mapPaint(op.fill) } : {}),
      ...(op.stroke
        ? { stroke: { ...op.stroke, paint: mapPaint(op.stroke.paint), width: op.stroke.width * k } }
        : {}),
    })),
  };
}

/** 정면 팔 (어깨 → 팔꿈치 → 주먹, 두 마디 캡슐): 달리기 준비 자세 */
function frontBentArm(
  sk: Sketch,
  ink: Ink,
  side: -1 | 1,
  elbow: readonly [number, number],
  hand: readonly [number, number],
  by: number,
): void {
  const sx = side * (FRONT.shoulderX - 0.04);
  const sy = FRONT.shoulderY + 0.07 + by;
  const sleeve = linear(sx - 0.12, 0, sx + 0.12, 0, [
    [0, ink(tint(C.hoodie, 0.14))],
    [1, ink(shade(C.hoodie, 0.28))],
  ]);
  sk.part(path().capsule(sx, sy, elbow[0], elbow[1], 0.17, 0.15).d, sleeve, ink(OUTLINE));
  sk.part(path().capsule(elbow[0], elbow[1], hand[0], hand[1], 0.15, 0.14).d, sleeve, ink(OUTLINE));
  // 소매 끝 (짙은 파랑 고무단)
  const ang = Math.atan2(hand[1] - elbow[1], hand[0] - elbow[0]);
  const cx = hand[0] - Math.cos(ang) * 0.07;
  const cy = hand[1] - Math.sin(ang) * 0.07;
  sk.fill(path().ellipse(cx, cy, 0.035, 0.075, ang).d, solid(ink(shade(C.hoodie, 0.35))));
  // 주먹 (손가락 없는 어두운 장갑)
  sk.part(
    path().circle(hand[0], hand[1], 0.075).d,
    radial(hand[0] - 0.03, hand[1] - 0.03, 0.11, [
      [0, ink(tint(C.glove, 0.28))],
      [1, ink(C.glove)],
    ]),
    ink(OUTLINE),
  );
  // 장갑 손등 파랑 줄
  sk.line(
    path()
      .M(hand[0] - 0.035, hand[1] - 0.03)
      .L(hand[0] + 0.035, hand[1] - 0.03).d,
    solid(ink(C.hoodie)),
    0.02,
  );
}

/** 정면 다리 벌림 (가볍게 선 자세) */
const LEG_SPREAD = 0.05;

function frontBody(p: FrontPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  const by = frontBreath(p.t);
  const sway = Math.sin(p.t * 2.4) * 0.04;
  // 1) 다리 (어두운 조거 바지) + 큰 운동화
  if (!p.bust) {
    frontLegs(sk, C.pants, C.shoe, C.sole, ink, LEG_SPREAD, 0.18);
    for (const s of [-1, 1]) {
      const x = s * (FRONT.legX + LEG_SPREAD);
      // 바지 옆줄 (파랑)
      sk.line(
        path()
          .M(s * FRONT.legX * 0.9 + s * 0.08, FRONT.hipY + 0.02)
          .L(x + s * 0.075, FRONT.ankleY - 0.04).d,
        solid(ink(C.hoodie)),
        0.025,
      );
      // 발목 고무단
      sk.fill(
        path().roundRect(x - 0.085, FRONT.ankleY - 0.05, 0.17, 0.05, 0.02).d,
        solid(ink(shade(C.pants, 0.3))),
      );
      // 운동화 파랑 줄 (뒤꿈치 → 앞코로 쓸어 올림)
      const fx = x + s * 0.03;
      sk.line(
        path().curve([
          [fx - s * 0.13, FRONT.footY + 0.01],
          [fx, FRONT.footY - 0.01],
          [fx + s * 0.1, FRONT.footY - 0.05],
        ]).d,
        solid(ink(C.hoodie)),
        0.03,
      );
    }
  }
  // 2) 몸통 (후드티) + 밑단 · 캥거루 주머니
  sk.part(frontTorsoPath(by), frontClothPaint(C.hoodie, ink), ink(OUTLINE));
  sk.fill(
    path()
      .M(-0.24, FRONT.hipY - 0.06)
      .L(0.24, FRONT.hipY - 0.06)
      .L(0.25, FRONT.hipY - 0.005)
      .Q(0, FRONT.hipY + 0.035, -0.25, FRONT.hipY - 0.005)
      .Z().d,
    solid(ink(shade(C.hoodie, 0.32))),
  );
  sk.part(
    path().M(-0.15, 0.25).L(0.15, 0.25).L(0.19, 0.36).L(-0.19, 0.36).Z().d,
    solid(ink(shade(C.hoodie, 0.12))),
    ink(OUTLINE),
    1,
    0.3,
  );
  // 가슴 » 갈매기 무늬 (네온: 넓은 은은한 빛 + 밝은 선)
  const chev = path()
    .M(-0.09, 0.06 + by)
    .L(-0.02, 0.12 + by)
    .L(-0.09, 0.18 + by)
    .M(0.0, 0.06 + by)
    .L(0.07, 0.12 + by)
    .L(0.0, 0.18 + by).d;
  sk.line(chev, solid(ink(C.neon), 0.3), 0.075);
  sk.line(chev, solid(ink(tint(C.neon, 0.35))), 0.032);
  // 3) 팔 (달리기 준비: 팔꿈치를 뒤로, 주먹을 허리 앞에)
  frontBentArm(sk, ink, -1, [-0.42, 0.27 + by], [-0.3, 0.36 + by], by);
  frontBentArm(sk, ink, 1, [0.43, 0.24 + by], [0.33, 0.06 + by], by);
  // 4) 후드: 둥근 머리 덮개 + 바람에 날리는 물방울 끝 (옛 물방울 모티프)
  const hy = FRONT.headY + by;
  const hoodR = FRONT.headR * 1.16;
  sk.part(
    dropPath(0, hy - 0.01, hoodR, 0.68, hy - 0.36 + sway, 0.1),
    radial(-0.16, hy - 0.2, 0.95, [
      [0, ink(tint(C.hoodie, 0.22))],
      [0.4, ink(C.hoodie)],
      [0.8, ink(shade(C.hoodie, 0.2))],
      [1, ink(shade(C.hoodie, 0.35))],
    ]),
    ink(OUTLINE),
  );
  // 후드 끝 솔기 (꼭대기에서 끝으로 흐르는 그늘 선)
  sk.line(
    path().curve([
      [0.08, hy - 0.3],
      [0.3, hy - 0.31 + sway * 0.5],
      [0.56, hy - 0.33 + sway],
    ]).d,
    solid(ink(shade(C.hoodie, 0.25))),
    0.018,
  );
  // 후드 안 그늘 (얼굴 둘레)
  const fy = hy + 0.06;
  sk.fill(path().ellipse(0, fy, 0.31, 0.3).d, solid(ink(shade(C.deep, 0.35))));
  // 얼굴
  sk.fill(
    path().ellipse(0, fy + 0.03, 0.27, 0.255).d,
    radial(-0.08, fy - 0.06, 0.38, [
      [0, ink(tint(MAT.skin, 0.12))],
      [0.7, ink(MAT.skin)],
      [1, ink(MAT.skinShade)],
    ]),
  );
  // 앞머리 (후드 밑으로 삐져나온 뾰족한 머리칼)
  sk.fill(
    path()
      .M(-0.27, fy - 0.01)
      .Q(-0.24, fy - 0.24, 0, fy - 0.26)
      .Q(0.24, fy - 0.24, 0.27, fy - 0.01)
      .L(0.2, fy - 0.08)
      .L(0.15, fy - 0.01)
      .L(0.08, fy - 0.1)
      .L(0.0, fy - 0.03)
      .L(-0.07, fy - 0.11)
      .L(-0.14, fy - 0.02)
      .L(-0.2, fy - 0.09)
      .Z().d,
    solid(ink(C.hair)),
  );
  // 눈 · 눈썹 · 입 (자신 있는 표정)
  frontEyes(sk, ink, fy + 0.07, 0.11, 0.052);
  for (const s of [-1, 1])
    sk.line(
      path()
        .M(s * 0.17, fy - 0.005)
        .L(s * 0.06, fy + 0.005).d,
      solid(ink(C.hair)),
      0.024,
    );
  sk.line(
    path()
      .M(-0.05, fy + 0.17)
      .Q(0.0, fy + 0.2, 0.06, fy + 0.155).d,
    solid(ink(MAT.skinShade)),
    0.02,
  );
  // 후드 테두리 (두꺼운 고무단 + 네온 선)
  const rim = path().ellipse(0, fy, 0.31, 0.3).d;
  sk.line(rim, solid(ink(shade(C.hoodie, 0.1))), 0.07);
  sk.line(rim, solid(ink(C.neon), 0.35), 0.05);
  sk.line(rim, solid(ink(tint(C.neon, 0.3))), 0.016);
  // 후드 끈 (목에서 늘어진 두 줄 + 밝은 끈 끝)
  for (const s of [-1, 1]) {
    const x0 = s * 0.09;
    const x1 = s * 0.11 + sway * 0.4;
    sk.line(
      path()
        .M(x0, fy + 0.29)
        .Q(s * 0.1, fy + 0.36, x1, fy + 0.44).d,
      solid(ink(tint(C.neon, 0.5))),
      0.018,
    );
    sk.fill(path().roundRect(x1 - 0.015, fy + 0.43, 0.03, 0.05, 0.012).d, solid(ink(C.sole)));
  }
  return sk.drawing();
}

function front(p: FrontPose, o: ArtOptions): Drawing {
  if (!p.bust) return frontBody(p, o);
  // 상반신: 머리 · 후드 끝 · 어깨 · 가슴 무늬가 상자를 채우게 1.5배 (외곽선 굵기는 그대로)
  const k = 1.5;
  return scaleDrawing(frontBody(p, { w: o.w / k }), k, -0.08, 0.42);
}

export const RUNNER_ART: SurvivorArt = { id: 'runner', top, front, topExtent: 1.15 };
