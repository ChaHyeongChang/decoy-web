// 가드 새 캐릭터 (캐릭터 리디자인): 볏 달린 보라 헬멧 + 큰 어깨 갑옷 + 몸 앞을 가리는 큰 방패. 단단하고 든든한 인상.
// 위에서 보면 몸 앞에 떠 있는 두꺼운 호(옛 초승달 방패)가 실루엣의 핵심이다 — 둥근 헬멧 · 넓은 어깨 판 + 앞쪽 초승달.
// 방패는 층을 나눠(sk.layer) 굵은 외곽선이 몸 위에 그어지게 해서 작은 크기에서도 몸과 갈린다.
// 네온 포인트는 방패 테두리의 밝은 보라 선(위 · 정면)과 정면 방패 문장(십자)뿐이다. 헬멧 챙 선은 네온보다 어둡게 둔다.
// 색은 역할색 보라(#A855F7)와 그 짙은/밝은 변형, 어두운 남회색 바지 · 장갑 · 장화 · 방패 테.
import { OUTLINE, ROLE, ROLE_TEXT } from '../palette';
import { Sketch, linear, mix, path, radial, rotateAbout, shade, solid, tint, translate, type Drawing, type Mat, type Paint } from './kit';
import {
  FRONT,
  MAT,
  TOP,
  domePaint,
  frontArm,
  frontBreath,
  frontClothPaint,
  frontLegs,
  frontTorsoPath,
  inkFor,
  topArm,
  topRig,
  topShoe,
  topTorsoPath,
  type Ink,
} from './survivorBase';
import type { ArtOptions, FrontPose, SurvivorArt, SurvivorPose } from './types';

/** 가드 색 */
export const GUARD_COLOR = {
  armor: ROLE.guard,
  /** 짙은 보라 (갑옷 그늘 · 방패 안쪽) */
  deep: 0x581c87,
  /** 네온 테두리 (밝은 보라, 글자용 역할색) */
  neon: ROLE_TEXT.guard,
  /** 방패 테 · 장갑 · 끈 (어두운 남회색 금속) */
  steel: 0x2b3646,
  pants: 0x253041,
  boot: 0x1b2430,
  sole: 0x0f151d,
  /** 장갑: 방패 테(steel)와 갈리게 한 단 밝게 */
  glove: tint(0x2b3646, 0.12),
} as const;

const C = GUARD_COLOR;

/** 가드 어깨 반폭: 공통 체형 그대로 (넓은 어깨는 어깨 판이 말한다 — 옆으로 커 보이지 않게) */
const HALF_W = TOP.halfW;

/** 위에서 본 방패 모양 (몸 기준): 호 중심 (cx, cy), 바깥 · 안 반지름, 반각, 방향 */
interface ShieldShape {
  cx: number;
  cy: number;
  ro: number;
  ri: number;
  half: number;
  rot: number;
}

/** 끝이 둥근 두꺼운 호 (방패 위 테). 방향 rot = 0이면 앞(+x)을 향한다 */
function bandPath(s: ShieldShape, ro = s.ro, ri = s.ri): string {
  const m: Mat = rotateAbout(s.rot, s.cx, s.cy);
  const rm = (ro + ri) / 2;
  const t = (ro - ri) / 2;
  const h = s.half;
  const e = (a: number): [number, number] => [s.cx + Math.cos(a) * rm, s.cy + Math.sin(a) * rm];
  const [e1x, e1y] = e(h);
  const [e0x, e0y] = e(-h);
  return path(m)
    .arc(s.cx, s.cy, ro, -h, h)
    .arc(e1x, e1y, t, h, h + Math.PI, false)
    .arc(s.cx, s.cy, ri, h, -h, false)
    .arc(e0x, e0y, t, -h + Math.PI, -h + Math.PI * 2, false)
    .Z().d;
}

/** 위에서 본 방패: 짙은 보라 안쪽 + 밝은 위 테 + 바깥 네온 선. glow = 네온 세기 0~1 */
function topShield(sk: Sketch, s: ShieldShape, ink: Ink, glow: number): void {
  const d = bandPath(s);
  sk.part(
    d,
    radial(s.cx, s.cy, s.ro, [
      [0, ink(C.deep)],
      [(s.ri - 0.02) / s.ro, ink(shade(C.armor, 0.3))],
      [(s.ri + s.ro) / 2 / s.ro, ink(mix(tint(C.armor, 0.12), C.neon, 0.6 * glow))],
      [1, ink(mix(C.armor, C.neon, 0.7 * glow))],
    ]),
    ink(OUTLINE),
  );
  // 안쪽 그늘 띠 (방패 뒷면이 보이는 쪽)
  sk.fill(bandPath(s, s.ri + 0.04, s.ri), solid(ink(shade(C.deep, 0.2))), 0.85);
  // 바깥 네온 선 (방패 테 · 바깥 끝을 넘지 않게 안쪽에)
  const m = rotateAbout(s.rot, s.cx, s.cy);
  const rim = path(m).arc(s.cx, s.cy, s.ro - 0.075 - 0.05 * glow, -s.half * 0.92, s.half * 0.92).d;
  sk.line(rim, solid(ink(C.neon), 0.3 + 0.5 * glow), 0.1 + 0.12 * glow);
  sk.line(rim, solid(ink(tint(C.neon, 0.35 + 0.45 * glow))), 0.045);
}

/** 능력 동작 → 방패 앞뒤 이동: 0.5 = 뒤로 당겨 힘을 모음, 1 = 앞으로 쭉 */
function shoveOffset(a: number): number {
  if (a <= 0.5) return -0.2 * (a / 0.5);
  const k = (a - 0.5) / 0.5;
  return -0.2 + 0.31 * (1 - (1 - k) * (1 - k));
}

function top(p: SurvivorPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  const a = p.action;
  const free = p.mode === 'free';
  const captive = p.mode === 'captive';
  const r = topRig(p, captive ? HALF_W * 0.94 : HALF_W);
  const s = r.s;
  const push = free ? shoveOffset(a) : 0;
  // 힘을 모을 때 방패를 조금 비스듬히 + 몸통을 비튼다 (왼쪽 어깨를 앞으로), 내지르면 다시 정면
  const load = free ? Math.sin(Math.PI * Math.min(1, a / 0.75)) : 0;
  const coil = -0.08 * load;
  r.twist += -0.18 * load;
  // 몸 기울임: 당길 때 머리가 뒤로, 내지를 때 앞으로 (몸이 방패 쪽으로 쏠린다)
  r.head = [r.head[0] + push * 0.9, r.head[1]];
  const tw = rotateAbout(r.twist, 0, 0);
  // 1) 장화 (무게를 실은 앞뒤 버팀 자세: 능력 중엔 왼발 앞 · 오른발 뒤)
  const brace = free ? Math.min(1, a * 2) : 0;
  const feet = r.feet.map(([fx, fy], i): [number, number] => [fx + (i === 0 ? 0.22 : -0.26) * brace, fy]);
  for (const [fx, fy] of feet) topShoe(sk, fx + r.ox, fy, C.boot, C.sole, ink, 0.28);
  // 방패 자리: 보통 = 몸 앞 두꺼운 호, 구조 = 앞에 둔 채 왼쪽으로 비킴(오른손이 자물쇠로), 수감 = 앞에 끌어안은 작은 호.
  // 어느 때든 방패는 앞쪽에 있다 → 바라보는 방향 단서가 뒤집히지 않는다
  const shield: ShieldShape =
    p.mode === 'reach'
      ? { cx: r.ox, cy: 0, ro: 1.3, ri: 0.98, half: 0.55, rot: -0.4 + r.twist * 0.5 }
      : captive
        ? { cx: r.ox, cy: 0, ro: 1.1, ri: 0.76, half: 0.7, rot: 0 }
        : {
            cx: r.ox - 0.05 * p.hit + push,
            cy: 0.03 * s,
            ro: 1.42,
            ri: 0.96,
            half: 0.7,
            rot: 0.05 * s + 0.08 * p.hit + coil,
          };
  // 2) 등 갑옷 판 (몸통 뒤로 비죽 나온 두꺼운 판 — 위에서 '단단한 체격'이 보이게)
  const back = path(tw).with(translate(r.ox, 0));
  sk.part(back.ellipse(-0.36, 0, 0.44, 0.62).d, domePaint(shade(C.armor, 0.18), ink, 0.7, -0.36 + r.ox, 0), ink(OUTLINE));
  sk.line(path(tw).with(translate(r.ox, 0)).M(-0.76, 0).L(-0.3, 0).d, solid(ink(shade(C.armor, 0.4))), 0.04);
  // 3) 몸통 (보라 갑옷)
  sk.part(topTorsoPath(r), domePaint(shade(C.armor, 0.12), ink, r.halfW * 1.1), ink(OUTLINE));
  // 4) 팔: 왼손(위쪽)은 방패 손잡이, 오른손은 걸음에 흔들리다 능력 중엔 방패를 같이 민다
  const gripAt = (ang: number): [number, number] => {
    const g = shield.ri - 0.17;
    return [shield.cx + Math.cos(ang + shield.rot) * g, shield.cy + Math.sin(ang + shield.rot) * g];
  };
  if (free) {
    r.hands[0] = gripAt(-0.36);
    const [bx, by] = gripAt(0.36);
    // 빈 손은 몸 쪽으로 조금 붙인다 (넓은 어깨 판 때문에 옆으로 커 보이지 않게)
    const [hx, hy] = [r.hands[1][0], r.hands[1][1] * 0.93];
    r.hands[1] = [hx + (bx - hx) * brace, hy + (by - hy) * brace];
  } else if (p.mode === 'reach') {
    // 구조 중: 왼손은 방패 손잡이, 오른손만 헬멧 앞으로 쭉 뻗어 자물쇠를 만진다
    r.hands = [gripAt(0), [r.head[0] + r.headR + 0.2, 0.3]];
  } else {
    // 수감: 방패를 끌어안고 두 손을 그 안쪽에 모은다 (헬멧 밖으로 보이게)
    r.hands = [
      [0.56, -0.46],
      [0.56, 0.46],
    ];
  }
  topArm(sk, r, 0, C.armor, C.glove, ink, 0.3);
  topArm(sk, r, 1, C.armor, C.glove, ink, 0.3);
  // 5) 큰 어깨 갑옷 (두 겹 판, 헬멧보다 한 단 어둡게 — 헬멧이 가장 밝은 중심)
  for (const side of [0, 1] as const) {
    const [sx, sy] = r.shoulders[side];
    const pd = path(tw).with(translate(r.ox, 0)).ellipse(sx - 0.14, sy * 0.97, 0.4, 0.26).d;
    sk.part(pd, domePaint(shade(C.armor, 0.1), ink, 0.44, sx - 0.16 + r.ox, sy * 0.92), ink(OUTLINE));
    const sgn = side === 0 ? -1 : 1;
    sk.line(
      path(tw)
        .with(translate(r.ox, 0))
        .arc(sx - 0.14, sy * 0.97, 0.27, sgn * Math.PI / 2 - 1.1, sgn * Math.PI / 2 + 1.1, true, 0.15).d,
      solid(ink(shade(C.armor, 0.35))),
      0.05,
    );
  }
  // 6) 헬멧: 보라 돔 + 가운데 볏 + 앞 챙
  const [hx, hy] = r.head;
  const R = r.headR * 1.02;
  sk.part(path().circle(hx, hy, R).d, domePaint(C.armor, ink, R * 1.2, hx - 0.04, hy), ink(OUTLINE));
  // 앞 챙 (어두운 보라 띠)
  sk.fill(
    path()
      .arc(hx, hy, R * 0.97, -1.05, 1.05)
      .arc(hx, hy, R * 0.66, 0.9, -0.9, false)
      .Z().d,
    solid(ink(C.deep)),
  );
  // 볏 (뒤 → 앞 가운데 솟은 판, 앞이 뾰족): 빛 받는 위쪽 반은 밝게, 아래쪽 반은 그늘 (역할색에 가까운 두 단)
  const crestHalf = (side: -1 | 1, w: number): string =>
    path()
      .M(hx - R * 0.95, hy)
      .Q(hx - R * 0.2, hy + side * w, hx + R * 0.75, hy)
      .Z().d;
  sk.fill(crestHalf(-1, 0.2), solid(ink(tint(C.armor, 0.2))));
  sk.fill(crestHalf(1, 0.12), solid(ink(shade(C.armor, 0.16))));
  // 7) 방패 (몸 앞, 따로 층): 외곽선이 팔 · 몸 위에 굵게
  sk.layer();
  topShield(sk, shield, ink, free ? Math.max(0, (a - 0.5) / 0.5) : 0);
  return sk.drawing();
}

/** 그림 전체를 고르게 키워 옮긴다 (상반신 아이콘). x' = k x + tx */
function scaleDrawing(dr: Drawing, k: number, tx: number, ty: number): Drawing {
  const pt = (x: number, y: number): [number, number] => [x * k + tx, y * k + ty];
  const mapD = (d: string): string => {
    let i = 0;
    return d.replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (v) => {
      const out = i % 2 === 0 ? Number(v) * k + tx : Number(v) * k + ty;
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
    const f = pa.fx === undefined || pa.fy === undefined ? {} : (([fx, fy]) => ({ fx, fy }))(pt(pa.fx, pa.fy));
    return { ...pa, cx, cy, r: pa.r * k, ...f };
  };
  return {
    ops: dr.ops.map((op) => ({
      ...op,
      d: mapD(op.d),
      ...(op.fill ? { fill: mapPaint(op.fill) } : {}),
      ...(op.stroke ? { stroke: { ...op.stroke, paint: mapPaint(op.stroke.paint), width: op.stroke.width * k } } : {}),
    })),
  };
}

/** 정면 방패 (위 평평 · 아래 뾰족한 옛 방패 문양): 중심 x, 위 y, 반폭, 높이 */
function frontShieldPath(cx: number, y0: number, hw: number, h: number): string {
  const yb = y0 + h * 0.5;
  return path()
    .M(cx - hw, y0 + 0.04)
    .Q(cx, y0 - 0.04, cx + hw, y0 + 0.04)
    .L(cx + hw, yb)
    .C(cx + hw, yb + h * 0.28, cx + hw * 0.45, y0 + h * 0.9, cx, y0 + h)
    .C(cx - hw * 0.45, y0 + h * 0.9, cx - hw, yb + h * 0.28, cx - hw, yb)
    .Z().d;
}

/** 정면 다리 벌림 (버티고 선 자세) */
const LEG_SPREAD = 0.08;

function frontBody(p: FrontPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const sk = new Sketch(o.w);
  const by = frontBreath(p.t);
  const sb = Math.sin(p.t * 1.6) * 0.008;
  const SX = 0.36;
  // 1) 다리 (어두운 바지) + 무릎 보호대 + 무거운 장화
  if (!p.bust) {
    frontLegs(sk, C.pants, C.boot, C.sole, ink, LEG_SPREAD, 0.17);
    for (const s of [-1, 1]) {
      const x = s * (FRONT.legX + LEG_SPREAD);
      sk.part(path().roundRect(x - 0.085, 0.62, 0.17, 0.12, 0.05).d, frontClothPaint(C.armor, ink), ink(OUTLINE), 1, 0.3);
    }
  }
  // 방패 자리 (몸 가운데 쪽으로, 몸통의 약 65%를 가린다)
  const cx = 0.11;
  const y0 = 0.0 + by + sb;
  const hw = 0.39;
  const h = 0.84;
  // 2) 팔 (화면 왼쪽 = 빈 주먹, 화면 오른쪽 = 방패 손잡이를 쥔 팔 — 주먹이 방패 가장자리 밖으로 반쯤 보인다)
  frontArm(sk, 1, C.armor, C.glove, ink, [cx + hw + 0.05, y0 + 0.32], by, 0.19);
  frontArm(sk, -1, C.armor, C.glove, ink, [-0.47, 0.38 + by], by, 0.19);
  // 3) 몸통 (보라 갑옷 조끼) + 허리띠
  sk.part(frontTorsoPath(by, SX, 0.28), frontClothPaint(C.armor, ink), ink(OUTLINE));
  sk.fill(path().roundRect(-0.27, FRONT.hipY - 0.1, 0.54, 0.07, 0.02).d, solid(ink(C.steel)));
  sk.fill(path().roundRect(-0.05, FRONT.hipY - 0.105, 0.1, 0.08, 0.02).d, solid(ink(shade(C.armor, 0.2))));
  // 가슴판 갈래 (가운데 이음)
  sk.line(path().M(0, FRONT.neckY + 0.06 + by).L(0, FRONT.hipY - 0.12).d, solid(ink(shade(C.armor, 0.3))), 0.025);
  // 4) 어깨 갑옷 (두 겹 둥근 판)
  for (const s of [-1, 1]) {
    const px = s * (SX - 0.02);
    const py = FRONT.shoulderY + 0.06 + by;
    const pad = radial(px - 0.06, py - 0.08, 0.26, [
      [0, ink(tint(C.armor, 0.28))],
      [0.6, ink(C.armor)],
      [1, ink(shade(C.armor, 0.35))],
    ]);
    sk.part(path().M(px - 0.18, py + 0.07).Q(px - 0.17, py - 0.15, px, py - 0.15).Q(px + 0.17, py - 0.15, px + 0.18, py + 0.07).Q(px, py + 0.03, px - 0.18, py + 0.07).Z().d, pad, ink(OUTLINE));
    sk.line(path().M(px - 0.15, py + 0.0).Q(px, py - 0.06, px + 0.15, py + 0.0).d, solid(ink(shade(C.armor, 0.35))), 0.02);
  }
  // 5) 머리 + 헬멧
  const hy = FRONT.headY + by;
  const hr = FRONT.headR;
  // 얼굴
  sk.part(
    path().circle(0, hy + 0.02, hr * 0.96).d,
    radial(-0.1, hy - 0.08, hr * 1.25, [
      [0, ink(tint(MAT.skin, 0.12))],
      [0.7, ink(MAT.skin)],
      [1, ink(MAT.skinShade)],
    ]),
    ink(OUTLINE),
  );
  // 눈 (굳은 눈매: 짧고 굵은 눈썹이 아래로)
  for (const s of [-1, 1]) {
    sk.fill(path().ellipse(s * 0.12, hy + 0.1, 0.042, 0.055).d, solid(ink(MAT.eye)));
    sk.fill(path().circle(s * 0.12 - 0.012, hy + 0.08, 0.015).d, solid(ink(0xffffff), 0.9));
    sk.line(path().M(s * 0.2, hy + 0.0).L(s * 0.06, hy + 0.035).d, solid(ink(MAT.eye)), 0.035);
  }
  sk.line(path().M(-0.05, hy + 0.21).L(0.05, hy + 0.21).d, solid(ink(MAT.skinShade)), 0.022);
  // 헬멧 (돔 + 볼 가리개). 얼굴 위쪽 · 옆을 덮는다
  const helm = path()
    .M(-hr * 1.08, hy + 0.2)
    .L(-hr * 1.1, hy - 0.05)
    .C(-hr * 1.1, hy - hr * 1.2, hr * 1.1, hy - hr * 1.2, hr * 1.1, hy - 0.05)
    .L(hr * 1.08, hy + 0.2)
    .Q(hr * 0.9, hy + 0.24, hr * 0.78, hy + 0.17)
    .L(hr * 0.74, hy - 0.02)
    .Q(0, hy - 0.08, -hr * 0.74, hy - 0.02)
    .L(-hr * 0.78, hy + 0.17)
    .Q(-hr * 0.9, hy + 0.24, -hr * 1.08, hy + 0.2)
    .Z().d;
  sk.part(
    helm,
    radial(-0.14, hy - 0.26, 0.62, [
      [0, ink(tint(C.armor, 0.3))],
      [0.45, ink(C.armor)],
      [0.85, ink(shade(C.armor, 0.28))],
      [1, ink(shade(C.armor, 0.45))],
    ]),
    ink(OUTLINE),
  );
  // 챙 (어두운 띠 + 보라 선)
  const brim = path().M(-hr * 0.98, hy - 0.04).Q(0, hy - 0.13, hr * 0.98, hy - 0.04).d;
  sk.line(brim, solid(ink(C.deep)), 0.06);
  sk.line(brim, solid(ink(tint(C.armor, 0.25))), 0.016);
  // 챙 위 가로 홈 (시설 경비대 헬멧 느낌)
  sk.line(path().M(-hr * 0.8, hy - 0.13).Q(0, hy - 0.21, hr * 0.8, hy - 0.13).d, solid(ink(C.deep)), 0.03);
  // 볏 (가운데 솟은 판, 실루엣에 보인다)
  sk.part(
    path()
      .M(-0.07, hy - hr * 0.88)
      .Q(-0.06, hy - hr * 1.1, 0.03, hy - hr * 1.12)
      .Q(0.08, hy - hr * 1.02, 0.07, hy - hr * 0.88)
      .Z().d,
    linear(-0.06, 0, 0.06, 0, [
      [0, ink(tint(C.armor, 0.35))],
      [1, ink(shade(C.armor, 0.2))],
    ]),
    ink(OUTLINE),
  );
  // 6) 큰 방패 (따로 층: 몸 앞에 떠 있다)
  sk.layer();
  const sh = frontShieldPath(cx, y0, hw, h);
  sk.part(
    sh,
    linear(cx - hw, y0, cx + hw, y0 + h * 0.7, [
      [0, ink(shade(C.armor, 0.05))],
      [0.5, ink(shade(C.armor, 0.3))],
      [0.5, ink(C.deep)],
      [1, ink(shade(C.deep, 0.35))],
    ]),
    ink(OUTLINE),
  );
  // 테 (어두운 금속) + 네온 안선
  sk.line(sh, solid(ink(C.steel)), 0.07);
  const inner = frontShieldPath(cx, y0 + 0.055, hw - 0.055, h - 0.11);
  sk.line(inner, solid(ink(C.neon), 0.35), 0.045);
  sk.line(inner, solid(ink(tint(C.neon, 0.4))), 0.014);
  // 문장: 십자 (네온) + 가운데 둥근 징
  const ey = y0 + h * 0.4;
  const cross = path()
    .M(cx, y0 + 0.13)
    .L(cx, y0 + h - 0.2)
    .M(cx - 0.19, ey)
    .L(cx + 0.19, ey).d;
  sk.line(cross, solid(ink(C.deep)), 0.11);
  sk.line(cross, solid(ink(C.neon), 0.45), 0.075);
  sk.line(cross, solid(ink(tint(C.neon, 0.5))), 0.03);
  sk.part(path().circle(cx, ey, 0.055).d, radial(cx - 0.015, ey - 0.02, 0.07, [[0, ink(tint(C.neon, 0.6))], [1, ink(C.armor)]]), ink(OUTLINE), 1, 0.3);
  // 방패 위 반사 (왼쪽 위 빛)
  sk.line(path().M(cx - hw + 0.1, y0 + 0.12).L(cx - hw + 0.1, y0 + 0.36).d, solid(ink(0xffffff), 0.35), 0.025);
  return sk.drawing();
}

function front(p: FrontPose, o: ArtOptions): Drawing {
  if (!p.bust) return frontBody(p, o);
  // 상반신: 헬멧 · 어깨 · 방패 윗부분(문장)이 상자를 채우게 1.45배 (외곽선 굵기는 그대로)
  const k = 1.45;
  return scaleDrawing(frontBody(p, { w: o.w / k }), k, -0.05, 0.36);
}

export const GUARD_ART: SurvivorArt = { id: 'guard', top, front, topExtent: 1.58 };
