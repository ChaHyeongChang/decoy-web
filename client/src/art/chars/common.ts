// 공통 생존자 (괴물 화면, 캐릭터 리디자인): 세 역할을 대신하는 하나의 그림. 역할 단서가 없다 — 후드 끝(러너) ·
// 방패 · 넓은 어깨(가드) · 고글 · 망원경(스카우트)이 없고, 몸 크기 · 비율은 공통 체형 그대로다.
// 흰 방호복 + 둥근 방호 두건 + 연회색 얼굴 가리개(무채색). 이름 없는 '미끼'라는 인상.
// 색은 흰색(#F8FAFC) · 무채색 회색뿐이다 (VISUAL_SPEC 0장 ③ 흰색 위장).
import { HIDDEN_SURVIVOR, OUTLINE } from '../palette';
import { Sketch, linear, path, radial, rotateAbout, solid, translate, type Drawing } from './kit';
import {
  FRONT,
  MAT,
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
} from './survivorBase';
import type { ArtOptions, FrontPose, SurvivorArt, SurvivorPose } from './types';

/** 공통 생존자 무채색 (옛 숨은 생존자 음영 · 발 색과 같은 계열) */
export const COMMON_COLOR = {
  suit: HIDDEN_SURVIVOR,
  rim: 0xc5cad1,
  glove: 0x8b939c,
  boot: 0x8b939c,
  sole: 0x5b636c,
  visor: 0x9aa3ad,
  visorDark: 0x3a4048,
  seam: 0xaeb5bd,
} as const;

function top(p: SurvivorPose, o: ArtOptions): Drawing {
  const ink = inkFor(p.tone);
  const C = COMMON_COLOR;
  const sk = new Sketch(o.w);
  const r = topRig(p);
  // 1) 신발
  for (const [fx, fy] of r.feet) topShoe(sk, fx + r.ox, fy, C.boot, C.sole, ink);
  // 2) 몸통 (흰 방호복)
  sk.part(topTorsoPath(r), domePaint(C.suit, ink, 1.0), ink(OUTLINE));
  // 등 이음선 (방호복 지퍼 · 솔기: 무채색 가는 선)
  const m = rotateAbout(r.twist, 0, 0);
  sk.line(path(m).with(translate(r.ox, 0)).M(-0.36, 0).L(-0.12, 0).d, solid(ink(C.seam)), 0.06);
  // 3) 팔
  topArm(sk, r, 0, C.suit, C.glove, ink);
  topArm(sk, r, 1, C.suit, C.glove, ink);
  // 4) 머리: 둥근 방호 두건 + 앞쪽 연회색 가리개 (얼굴이 보이지 않음)
  const [hx, hy] = r.head;
  sk.part(path().circle(hx, hy, r.headR).d, domePaint(C.suit, ink, r.headR * 1.25, hx - 0.05, hy), ink(OUTLINE));
  sk.fill(path().arc(hx, hy, r.headR * 0.86, -0.95, 0.95).arc(hx, hy, r.headR * 0.55, 0.8, -0.8, false).Z().d, solid(ink(C.visor)), 0.85);
  return sk.drawing();
}

function front(p: FrontPose, o: ArtOptions): Drawing {
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
  sk.line(path().M(0, FRONT.neckY + 0.04 + by).L(0, FRONT.hipY - 0.02).d, solid(ink(C.seam)), 0.025);
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
  sk.line(path().M(-0.17, hy - 0.04).L(-0.06, hy - 0.08).d, solid(ink(0xffffff), 0.75), 0.035);
  return sk.drawing();
}

export const COMMON_ART: SurvivorArt = { id: 'common', top, front, topExtent: 1.1 };
