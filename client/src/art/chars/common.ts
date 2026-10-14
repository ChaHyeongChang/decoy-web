// 공통 생존자 (괴물 화면, 캐릭터 리디자인): 세 역할을 대신하는 하나의 그림. 역할 단서가 없다 — 후드 끝 · 얼굴(러너) ·
// 방패 · 넓은 어깨 판(가드) · 고글 · 망원경(스카우트)이 없고, 뼈대(머리 · 어깨 · 손발 자리)는 공통 체형 그대로다.
// 흰 방호복 + 둥근 방호 두건 + 얼굴 가리개(무채색). 이름 없는 '미끼'라는 인상. 위 그림은 부푼 방호복으로 판정 원을 채우고,
// 두건 앞을 두른 짙은 회색 가리개 띠(실루엣 앞 끝에 닿는다) + 그 앞으로 튀어나온 흰 방독면 필터 통이 바라보는 방향을 보인다
// (옛 공통 실루엣의 앞 노치와 같은 정보). 손은 방호복 안쪽에 녹아들게 칠해 옆 · 뒤에 회색 점이 생기지 않게 했다.
// 색은 흰색(#F8FAFC) · 무채색 회색뿐이다 (VISUAL_SPEC 0장 ③ 흰색 위장).
import { HIDDEN_SURVIVOR, OUTLINE } from '../palette';
import {
  Sketch,
  mix,
  linear,
  path,
  radial,
  rotateAbout,
  solid,
  transformDrawing,
  translate,
  type Drawing,
  type Paint,
} from './kit';
import {
  FRONT,
  MAT,
  TOP,
  frontArm,
  frontBreath,
  frontClothPaint,
  frontLegs,
  frontTorsoPath,
  inkFor,
  topRig,
  type Ink,
  type TopRig,
} from './survivorBase';
import {
  SURVIVOR_REST,
  cleanFrontPose,
  cleanHiddenPose,
  type ArtOptions,
  type CommonArt,
  type FrontPose,
  type HiddenPose,
} from './types';

/** 공통 생존자 무채색 (옛 숨은 생존자 음영 · 발 색과 같은 계열) */
export const COMMON_COLOR = {
  suit: HIDDEN_SURVIVOR,
  rim: 0xc5cad1,
  /** 장갑: 방호복에 가까운 밝은 회색 (휴대폰 크기에서 몸 옆 회색 점이 눈처럼 읽히지 않게) */
  glove: 0xd3d8de,
  /** 장화 · 밑창 (정면 그림만. 위 그림에서는 방호복이 덮어 그리지 않는다) */
  boot: 0xb7bec6,
  sole: 0x5b636c,
  visor: 0x9aa3ad,
  /** 가리개 (짙은 무채색 유리: 위 그림에서도 이 색이라 실제 크기에서 흰 몸 앞쪽이 짙게 갈려 바라보는 방향이 읽힌다) */
  visorDark: 0x3a4048,
  seam: 0xaeb5bd,
} as const;

/**
 * 위 그림 치수 (몸 반지름 배수): 부푼 방호복 폭 · 앞뒤 깊이 · 두건(머리 앞으로 · 반지름) · 가리개 · 방독면 필터 · 손 자리.
 * 휴대폰 크기에서 바라보는 방향은 '흰 몸 → 짙은 가리개 → 흰 필터 통' 한 줄이 말한다(옛 공통 실루엣의 앞 노치와 같은 정보 —
 * 역할 단서가 아니라 모든 생존자에게 같은 방호복 부품). 손은 방호복 안쪽에 붙여 옆에 회색 점이 생기지 않게 한다
 */
export const COMMON_TOP = {
  /** 어깨 반폭 */
  halfW: 0.96,
  /** 몸통 앞 · 뒤 깊이: 앞은 얕게(두건 앞 가리개가 실루엣 앞 끝에 닿게), 뒤는 부푼 방호복으로 판정 원 테까지 */
  frontD: 0.8,
  backD: 0.97,
  /** 두건: 몸 앞으로 · 반지름 (공통 머리보다 조금 크게 — 부푼 방호 두건) */
  headDx: 0.16,
  headR: 0.64,
  /**
   * 가리개: 두건 앞을 두른 띠 (두건과 같은 중심). 바깥 = 두건 반지름 배수, 반각(라디안), 두께 = 가운데 · 끝(두건 반지름 배수).
   * 가운데가 두껍고 끝으로 갈수록 얇아져 둥근 끝으로 닫힌다 (뒤를 향한 뾰족한 모서리 없이). 안쪽 테에서 몸 중심까지 가장
   * 가까운 거리 0.48 (몸 가운데 0.45r 원판은 흰 방호복으로 남긴다)
   */
  visor: { outer: 0.97, half: 1.14, mid: 0.53, end: 0.27 },
  /**
   * 방독면 필터: 가리개 앞 짧은 목 + 넓은 통 (정면 턱 앞 둥근 통을 옆에서 본 모양). 목 끝 x · 목 폭, 통 끝 x · 통 폭 ·
   * 모서리, 뚜껑 테 x (통 앞쪽 중간 회색 줄 — 짙게 하면 휴대폰 크기에서 흰 통 끝이 어두워져 앞 돌출이 덜 보인다).
   * 목을 통보다 아주 가늘게 하면 휴대폰 크기에서 외곽선에 묻혀 심지처럼 보여, 목 · 통 폭 차이는 0.12만 둔다
   */
  filter: { neckX: 0.95, neckW: 0.36, tipX: 1.2, width: 0.48, corner: 0.08, bandX: 1.14 },
  /** 손 자리 (앞뒤 · 옆 · 걸음 흔들림 · 반지름): 방호복 테 안쪽, 두건 옆 */
  handX: 0.08,
  handY: 0.72,
  handSwing: 0.24,
  handR: 0.16,
} as const;

/** 정면 상반신 (로비 역할 카드 · 결과 화면, 64~160px) 배율 · 이동: 다른 넷처럼 머리 · 어깨가 상자를 채우게 */
const BUST = { k: 1.5, tx: 0, ty: 0.38 } as const;

/**
 * 위에서 본 부푼 방호복 몸통: 앞은 얕고 뒤 · 옆은 판정 원 테까지 둥글게 (rig 비틀림 반영). 공통 topTorsoPath는 앞뒤가
 * 같은 깊이라 두건 앞에 흰 방호복 띠가 남는다
 */
function suitTorsoPath(r: TopRig): string {
  const w = r.halfW;
  const f = COMMON_TOP.frontD;
  const b = COMMON_TOP.backD;
  const pts: [number, number][] = [
    [f, 0],
    [f * 0.86, -w * 0.64],
    [f * 0.3, -w * 0.98],
    [-b * 0.5, -w * 0.88],
    [-b * 0.9, -w * 0.5],
    [-b, 0],
    [-b * 0.9, w * 0.5],
    [-b * 0.5, w * 0.88],
    [f * 0.3, w * 0.98],
    [f * 0.86, w * 0.64],
  ];
  return path(rotateAbout(r.twist, 0, 0))
    .with(translate(r.ox, 0))
    .smooth(pts, 1).d;
}

/**
 * 방호복 돔 음영: 옛 숨은 생존자처럼 가장자리까지 밝은 흰색(#F8FAFC → 테 #C5CAD1). 공통 domePaint는 가장자리를 짙게 칠해
 * 괴물 화면에서 흰 생존자가 회색빛으로 작아 보였다
 */
function suitDome(ink: Ink, reach: number, cx = 0, cy = 0): Paint {
  const C = COMMON_COLOR;
  return radial(cx, cy, reach, [
    [0, ink(0xffffff)],
    [0.5, ink(C.suit)],
    [0.88, ink(mix(C.suit, C.rim, 0.55))],
    [1, ink(C.rim)],
  ]);
}

/**
 * 팔 (어깨 → 손) + 손: 방호복 안쪽에 붙은 소매 · 장갑. 짙은 외곽선 없이 흰 음영과 아주 옅은 테만 그린다 — 장갑도 방호복과
 * 같은 방사 음영(반 단 회색)이라 휴대폰 크기에서 몸 옆에 회색 점 · 고리가 생기지 않고 앞 단서(가리개 · 필터)만 남는다.
 * 어깨 끝은 몸통 테 안쪽으로 당겨(SLEEVE_IN) 소매 끝이 몸통 외곽선을 덮어 귀마개처럼 튀어나오지 않게 한다
 */
function suitArm(sk: Sketch, r: TopRig, side: 0 | 1, ink: Ink): void {
  const C = COMMON_COLOR;
  const [sx, sy] = r.shoulders[side];
  const [hx, hy] = r.hands[side];
  const m = rotateAbout(r.twist, 0, 0);
  const sleeve = path(m)
    .with(translate(r.ox, 0))
    .capsule(sx, sy * SLEEVE_IN, hx, hy, 0.3, 0.26).d;
  sk.fill(sleeve, suitDome(ink, 1.05));
  sk.line(sleeve, solid(ink(C.rim)), 0.025);
  const glove = path(m).with(translate(r.ox, 0)).circle(hx, hy, COMMON_TOP.handR).d;
  sk.fill(
    glove,
    radial(0, 0, 1.05, [
      [0, ink(0xffffff)],
      [0.5, ink(mix(C.suit, C.glove, 0.5))],
      [1, ink(mix(C.rim, C.glove, 0.3))],
    ]),
  );
  sk.line(glove, solid(ink(C.seam), 0.5), 0.02);
}

/** 소매 어깨 끝 옆 자리 배율 (공통 체형 어깨 자리 대비): 소매 끝 원이 몸통 테 안에 들게 */
const SLEEVE_IN = 0.9;

/**
 * 가리개 경로: 두건 원(중심 hx, hy · 반지름 R) 앞쪽 바깥 호 + 두께가 가운데 → 끝으로 줄어드는 안쪽 테(제곱으로 이어 가운데는
 * 둥근 호에 가깝다), 양 끝은 반원으로 둥글게 닫는다
 */
function visorPath(hx: number, hy: number, R: number): string {
  const V = COMMON_TOP.visor;
  const ro = R * V.outer;
  const h = V.half;
  const inner = (a: number): number => ro - R * (V.mid + (V.end - V.mid) * (a / h) ** 2);
  const at = (a: number, rr: number): [number, number] => [hx + Math.cos(a) * rr, hy + Math.sin(a) * rr];
  // 끝 반원: 바깥 · 안 테 가운데에 중심, 반지름 = 끝 두께의 반
  const t = (R * V.end) / 2;
  const [x1, y1] = at(h, ro - t);
  const [x0, y0] = at(-h, ro - t);
  return path()
    .arc(hx, hy, ro, -h, h)
    .arc(x1, y1, t, h, h + Math.PI, false)
    .curve(
      Array.from({ length: 13 }, (_, i) => {
        const a = h - (2 * h * i) / 12;
        return at(a, inner(a));
      }),
      1,
      false,
    )
    .arc(x0, y0, t, -h + Math.PI, -h + Math.PI * 2, false)
    .Z().d;
}

function top(p: HiddenPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const C = COMMON_COLOR;
  const T = COMMON_TOP;
  const sk = new Sketch(o.w);
  // 부푼 방호복: 몸통 깊이를 키워 판정 원을 대부분 채운다(옛 흰 원처럼 '판정보다 작아 보이지' 않게).
  // 공통 체형 뼈대는 역할 자세를 받으므로 능력 · 피격 · 구조 값은 늘 0 · 'free'로 채워 넘긴다
  const r = topRig(
    { ...SURVIVOR_REST, walk: p.walk, stride: p.stride, mode: p.captive ? 'captive' : 'free', tone: p.tone },
    T.halfW,
  );
  // 손은 방호복 안쪽 (수감 중엔 앞에 모은 공통 자리 그대로)
  if (!p.captive)
    r.hands = [
      [T.handX - T.handSwing * r.s, -T.handY],
      [T.handX + T.handSwing * r.s, T.handY],
    ];
  // 1) 몸통 (흰 방호복). 신발은 그리지 않는다 — 부푼 방호복이 걸음 내내 덮는다
  //    (1차 시안 검토: 걸음 위상 64 × 보폭 3 × 수감 2 = 384자세 모두 신발이 몸통 칠 안에 가렸다)
  sk.part(suitTorsoPath(r), suitDome(ink, 1.05), ink(OUTLINE));
  // 등 이음선 (방호복 지퍼 · 솔기: 무채색 가는 선, 몸 가운데 원판 밖)
  const m = rotateAbout(r.twist, 0, 0);
  sk.line(path(m).with(translate(r.ox, 0)).M(-0.74, 0).L(-0.5, 0).d, solid(ink(C.seam)), 0.06);
  // 2) 팔
  suitArm(sk, r, 0, ink);
  suitArm(sk, r, 1, ink);
  // 3) 머리: 둥근 방호 두건 + 앞쪽 짙은 무채색 가리개 — 괴물에게 바라보는 방향을 보여 준다(역할 단서가 아님).
  //    얼굴은 보이지 않는다
  const hx = r.head[0] + T.headDx;
  const hy = r.head[1];
  const R = T.headR * (r.headR / TOP.headR);
  const F = T.filter;
  // 방독면 필터 (가리개 앞 짧은 목 + 넓은 통 + 끝 테): 몸 실루엣 앞으로 튀어나오게 머리와 같은 층에 둔다.
  // 목 뒤 끝은 두건 안에 묻힌다(두건 칠이 덮는다)
  const neckX0 = hx + R * 0.6;
  const canPaint = (w: number): Paint =>
    linear(0, hy - w / 2, 0, hy + w / 2, [
      [0, ink(0xffffff)],
      [0.5, ink(C.suit)],
      [1, ink(C.rim)],
    ]);
  sk.part(
    path().roundRect(neckX0, hy - F.neckW / 2, F.neckX - neckX0 + F.corner, F.neckW, F.corner).d,
    canPaint(F.neckW),
    ink(OUTLINE),
    undefined,
    0.3,
  );
  sk.part(
    path().roundRect(F.neckX, hy - F.width / 2, F.tipX - F.neckX, F.width, F.corner).d,
    canPaint(F.width),
    ink(OUTLINE),
    undefined,
    0.3,
  );
  // 머리 (방호 두건): 짙은 안쪽 선 없이 가장자리 음영 + 아주 가는 밝은 회색 테로 어깨와 가른다 — 큰 그림에서는 두건이
  // 몸과 갈려 '머리 + 가리개'로 읽히고(흰 덩어리 + 필터가 병처럼 보이지 않게), 휴대폰 크기(테 0.2px)에서는 고리가 생기지 않는다
  sk.part(path().circle(hx, hy, R).d, suitDome(ink, R * 1.25, hx - 0.05, hy), ink(OUTLINE), undefined, 0);
  sk.line(path().circle(hx, hy, R).d, solid(ink(C.seam), 0.7), 0.03);
  sk.fill(visorPath(hx, hy, R), solid(ink(C.visorDark)));
  // 필터 통 뚜껑 테 (중간 회색 줄)
  sk.line(
    path()
      .M(F.bandX, hy - F.width * 0.36)
      .L(F.bandX, hy + F.width * 0.36).d,
    solid(ink(C.visor)),
    0.05,
  );
  return sk.drawing();
}

function front(p: FrontPose, o: ArtOptions): Drawing {
  if (p.bust) return transformDrawing(frontBody(p, { w: o.w / BUST.k }), BUST.k, BUST.tx, BUST.ty);
  return frontBody(p, o);
}

function frontBody(p: FrontPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const C = COMMON_COLOR;
  const sk = new Sketch(o.w);
  const by = frontBreath(p.t);
  if (!p.bust) frontLegs(sk, C.suit, C.boot, C.sole, ink);
  // 팔 (몸 뒤)
  frontArm(sk, -1, C.suit, C.glove, ink, [-FRONT.handX, FRONT.handY + by], by);
  frontArm(sk, 1, C.suit, C.glove, ink, [FRONT.handX, FRONT.handY + by], by);
  // 몸통 (방호복) + 지퍼 · 허리띠
  sk.part(frontTorsoPath(by), frontClothPaint(C.suit, ink), ink(OUTLINE));
  sk.line(
    path()
      .M(0, FRONT.neckY + 0.04 + by)
      .L(0, FRONT.hipY - 0.02).d,
    solid(ink(C.seam)),
    0.025,
  );
  sk.fill(path().roundRect(-0.25, FRONT.hipY - 0.12, 0.5, 0.06, 0.02).d, solid(ink(C.rim)));
  // 머리: 둥근 두건 (얼굴을 덮는 가리개)
  const hy = FRONT.headY + by;
  sk.part(
    path().circle(0, hy, FRONT.headR * 1.04).d,
    radial(-0.12, hy - 0.16, FRONT.headR * 1.45, [
      [0, ink(0xffffff)],
      [0.6, ink(C.suit)],
      [1, ink(C.rim)],
    ]),
    ink(OUTLINE),
  );
  // 가리개 (어두운 회색 유리 + 흰 반사 줄)
  const visor = path().roundRect(-0.27, hy - 0.12, 0.54, 0.3, 0.14).d;
  sk.part(
    visor,
    linear(0, hy - 0.12, 0, hy + 0.18, [
      [0, ink(C.visorDark)],
      [1, ink(MAT.eye)],
    ]),
    ink(OUTLINE),
  );
  sk.line(
    path()
      .M(-0.17, hy - 0.04)
      .L(-0.06, hy - 0.08).d,
    solid(ink(0xffffff), 0.75),
    0.035,
  );
  // 방독면 필터 (가리개 아래 턱 앞 둥근 통 — 위 그림의 앞으로 튀어나온 통과 같은 부품)
  sk.part(
    path().circle(0, hy + 0.27, 0.105).d,
    radial(-0.03, hy + 0.24, 0.13, [
      [0, ink(0xffffff)],
      [0.6, ink(C.rim)],
      [1, ink(C.seam)],
    ]),
    ink(OUTLINE),
    undefined,
    0.3,
  );
  sk.fill(path().circle(0, hy + 0.27, 0.05).d, solid(ink(C.visor)));
  return sk.drawing();
}

export const COMMON_ART: CommonArt = {
  id: 'common',
  top: (p, o) => top(cleanHiddenPose(p), o),
  front: (p, o) => front(cleanFrontPose(p), o),
  /** 실제 최대 반쪽 크기 1.2 (방독면 필터 통 끝, 가장 먼 점 반지름 1.21) + 여유 */
  topExtent: 1.26,
};
