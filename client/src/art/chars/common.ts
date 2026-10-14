// 공통 생존자 (괴물 화면, 캐릭터 리디자인): 세 역할을 대신하는 하나의 그림. 역할 단서가 없다 — 후드 끝(러너) ·
// 방패 · 넓은 어깨(가드) · 고글 · 망원경(스카우트)이 없고, 몸 크기 · 비율은 공통 체형 그대로다.
// 흰 방호복 + 둥근 방호 두건 + 얼굴 가리개(무채색). 이름 없는 '미끼'라는 인상. 위 그림은 부푼 방호복으로 판정 원을 채우고,
// 앞쪽 짙은 회색 가리개 초승달이 바라보는 방향을 보인다(옛 공통 실루엣의 앞 노치와 같은 정보).
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
  /** 장갑 · 장화: 밝은 회색 (휴대폰 크기에서 몸 옆 회색 점이 고리처럼 읽히지 않게 테 색에 가깝게) */
  glove: 0xb7bec6,
  boot: 0xb7bec6,
  sole: 0x5b636c,
  visor: 0x9aa3ad,
  /** 가리개 (짙은 무채색 유리: 위 그림에서도 이 색이라 실제 크기에서 바라보는 방향이 읽힌다) */
  visorDark: 0x3a4048,
  seam: 0xaeb5bd,
} as const;

/**
 * 위 그림 치수 (몸 반지름 배수): 부푼 방호복 깊이 · 앞 볼록 · 머리 앞으로 · 가리개 초승달(머리 반지름 배수 · 반각 라디안) ·
 * 방독면 필터(머리 앞에서 몸 밖으로 튀어나온 짧은 원통: 끝 x · 폭). 필터와 짙은 가리개가 휴대폰 크기에서 바라보는 방향을 보인다
 * (옛 공통 실루엣의 앞 노치와 같은 정보 — 역할 단서가 아니라 모든 생존자에게 같은 방호복 부품)
 */
export const COMMON_TOP = {
  /** 어깨 반폭: 공통 체형보다 조금 좁게 (손 끝이 옆 1.1r 안에 들고, 스카우트와 실루엣이 갈리게) */
  halfW: 0.92,
  halfD: 0.86,
  bulge: 0.1,
  headDx: 0.06,
  visor: { inner: 0.46, outer: 0.92, half: 1.05 },
  filter: { tipX: 1.26, width: 0.48 },
} as const;

/** 정면 상반신 아이콘 배율 · 이동 (다른 넷처럼 머리 · 어깨가 상자를 채우게) */
const BUST = { k: 1.5, tx: 0, ty: 0.38 } as const;

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

function top(p: HiddenPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const C = COMMON_COLOR;
  const sk = new Sketch(o.w);
  // 부푼 방호복: 몸통 깊이를 키워 판정 원을 대부분 채운다(옛 흰 원처럼 '판정보다 작아 보이지' 않게).
  // 공통 체형 뼈대는 역할 자세를 받으므로 능력 · 피격 · 구조 값은 늘 0 · 'free'로 채워 넘긴다
  const r = topRig(
    { ...SURVIVOR_REST, walk: p.walk, stride: p.stride, mode: p.captive ? 'captive' : 'free', tone: p.tone },
    COMMON_TOP.halfW,
    COMMON_TOP.halfD,
  );
  // 1) 신발
  for (const [fx, fy] of r.feet) topShoe(sk, fx + r.ox, fy, C.boot, C.sole, ink);
  // 2) 몸통 (흰 방호복)
  sk.part(topTorsoPath(r, COMMON_TOP.bulge), suitDome(ink, 1.05), ink(OUTLINE));
  // 등 이음선 (방호복 지퍼 · 솔기: 무채색 가는 선)
  const m = rotateAbout(r.twist, 0, 0);
  sk.line(path(m).with(translate(r.ox, 0)).M(-0.5, 0).L(-0.2, 0).d, solid(ink(C.seam)), 0.06);
  // 3) 팔
  topArm(sk, r, 0, C.suit, C.glove, ink);
  topArm(sk, r, 1, C.suit, C.glove, ink);
  // 4) 머리: 둥근 방호 두건 + 앞쪽 짙은 무채색 가리개 초승달 — 괴물에게 바라보는 방향을 보여 준다(옛 그림의 앞 노치와 같은 정보,
  //    역할 단서가 아님). 얼굴은 보이지 않는다
  const hx = r.head[0] + COMMON_TOP.headDx;
  const hy = r.head[1];
  const R = r.headR;
  const V = COMMON_TOP.visor;
  const F = COMMON_TOP.filter;
  // 방독면 필터 (가리개 앞 짧은 원통 + 끝 뚜껑 테): 몸 실루엣 앞으로 튀어나오게 머리와 같은 층에 둔다
  sk.part(
    path().roundRect(hx + R * 0.72, hy - F.width / 2, F.tipX - hx - R * 0.72, F.width, F.width * 0.32).d,
    linear(0, hy - F.width / 2, 0, hy + F.width / 2, [
      [0, ink(0xffffff)],
      [0.5, ink(C.rim)],
      [1, ink(C.seam)],
    ]),
    ink(OUTLINE),
    undefined,
    0.3,
  );
  // 머리 (방호 두건): 안쪽 선 없이 가장자리 음영만으로 어깨와 가른다 — 휴대폰 크기에서 머리 테가 회색 고리로 읽히지 않게
  sk.part(path().circle(hx, hy, R).d, suitDome(ink, R * 1.25, hx - 0.05, hy), ink(OUTLINE), undefined, 0);
  sk.fill(
    path()
      .arc(hx, hy, R * V.outer, -V.half, V.half)
      .arc(hx, hy, R * V.inner, V.half - 0.15, -V.half + 0.15, false)
      .Z().d,
    solid(ink(C.visorDark)),
  );
  // 필터 끝 뚜껑 테 (짙은 줄)
  sk.line(
    path()
      .M(F.tipX - 0.1, hy - F.width * 0.38)
      .L(F.tipX - 0.1, hy + F.width * 0.38).d,
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
  topExtent: 1.36,
};
