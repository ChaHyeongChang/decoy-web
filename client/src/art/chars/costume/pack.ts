// 의상 '탈출 배낭' (생존자 의상, 판 밖 메타 c): 침낭을 얹은 큰 캔버스 배낭.
// 위 그림: 등 뒤(머리 뒤 끝 ~ 등 끝)에 어깨보다 좁은 둥근 네모 배낭 — 밝은 덮개(윗면) + 짙은 옆면 테. 배낭 위쪽(머리 쪽)
//   끝에 침낭 원통을 가로(y축)로 얹고(짙은 끈 띠 둘), 덮개 위 끈 둘 끝에 쇠 버클, 뒤쪽 옆에 작은 주머니 둘. 멜빵 둘은
//   어깨 위로 앞을 향한다. 가드 · 스카우트는 침낭 가운데가 머리 밑에 숨고 양끝만 머리 옆으로 나온다(머리 바로 뒤부터 밝은
//   덮개가 보여 휴대폰 크기에서 등의 밝은 네모 짐으로 읽히게). 배낭은 몸 기준 자리라 피격 · 밀치기 준비로 머리가 젖혀지면
//   머리가 앞쪽을 덮는다. 몸 가운데 0.45r 원판은 덮지 않는다(러너는 침낭 앞 끝을 원판 뒤에 둔다). 뒤 끝은 판정 원 1.0r 안.
//   배낭 모양은 역할마다 제 등 윤곽 안(TOP_FIT): 가드는 둥근 등을 채우고, 스카우트는 원래 배낭 폭(어깨 옆 오목한 홈이 남게),
//   러너는 뒤로 좁아지는 사다리꼴로 몸판 뒤 끝을 조금만 넘는다 — 의상을 입어도 역할 실루엣이 갈린다(VISUAL_SPEC 0장 ④).
// 정면(로비 역할 카드 · 결과 화면 — 산 사람이 의상을 가장 오래 보는 곳이라 크게): 가드 · 스카우트는 양 어깨 밖으로 나오고
//   머리 위쪽까지 솟은 큰 배낭(둥근 밝은 덮개 · 옆 압축 끈 · 아래 옆 주머니) + 덮개 위로 머리 뒤를 가로지르는 침낭(머리 위
//   둘레와 양옆으로 보이고 끈 띠 둘이 덮개로 내려와 버클로 죈다). 러너(3/4)는 등(화면 왼쪽)으로 불룩한 배낭 옆모습 + 등 쪽
//   위 모서리를 덮은 덮개 + 그 위 침낭의 말린 끝. 가슴 멜빵과 쇠 버클(러너는 둘, 가드는 어깨 갑옷 위로 넘어온 멜빵 둘 + 방패
//   왼쪽 틈 한 줄, 스카우트는 제 멜빵을 그대로 쓴다). 상반신은 역할마다 상반신 배율 뒤에도 상자 안에 드는 만큼 가장 크게.
//   배낭 · 침낭은 따로 층이라 몸 외곽선이 배낭 위에 굵게 남는다. 청록 네온은 덮개 테 솔기 · 버클 점만.
// 움직임: 걸으면 배낭이 몸 비틀림보다 조금 늦게 따라 돈다(몸 중심 기준 회전이라 크기 그대로). 피격 때 몸과 같이 밀리되 뒤 끝은
//   제자리(앞쪽만 눌린다). 정면은 숨쉬기로 오르내리고 바람에 침낭 끈 끝이 흔들린다.
// 색: 캔버스 카키 #7C6A4F(옆면 · 멜빵) · 밝은 덮개 #A08B66 · 짙은 끈 #4A3C2B · 침낭 청회색 #64748B / 짙은 청회색 #4B5563 ·
//   쇠 버클 #CBD5E1.
import {
  IDENTITY,
  apply,
  linear,
  mul,
  path,
  radial,
  rotate,
  rotateAbout,
  shade,
  solid,
  tint,
  type Mat,
  type Paint,
  type Sketch,
} from '../kit';
import type { RoleCharId } from '../types';
import type { Pt, SurvivorCostumeArt, SurvivorFrontAnchor, SurvivorTopAnchor } from './types';

/** 배낭 색 */
const C = {
  canvas: 0x7c6a4f,
  lid: 0xa08b66,
  strap: 0x4a3c2b,
  roll: 0x64748b,
  rollDeep: 0x4b5563,
  steel: 0xcbd5e1,
} as const;

/**
 * 위 그림 치수 (몸 반지름 배수): 배낭 반폭 = 어깨 반폭 × w, 모서리 둥글기, 가장 먼 점(뒤 1.0r 안 — 외곽선 몫),
 * 덮개 안쪽 들임, 침낭 반지름 · 배낭 옆으로 더 나온 길이
 */
const TOPP = {
  w: 0.56,
  corner: 0.2,
  rmax: 0.98,
  inset: 0.055,
  rollR: 0.095,
  /** 가드 · 스카우트 침낭 자리 (서 있을 때 머리 뒤 끝 −0.59 바로 안쪽) */
  rollX: -0.47,
  /** 옆 주머니: 길이 len, 몸통 옆선 안쪽 inn, 모서리 r (뒤 끝에서 떨어진 자리 · 바깥으로 나온 길이는 역할마다 TOP_FIT) */
  pocket: { len: 0.3, inn: 0.05, r: 0.07 },
} as const;

/** 위 그림 배낭 모양 한 벌 (TOP_FIT) */
interface TopFit {
  /** 뒤 끝 · 앞 끝 반폭 (어깨 반폭 배수) */
  readonly wb: number;
  readonly wf: number;
  /** 뒤 끝 x (null = 둥근 뒤 모서리가 rmax에 닿는 데까지) */
  readonly back: number | null;
  readonly corner: number;
  /** 옆 주머니: 뒤 끝에서 앞으로 x0 · 옆선 밖으로 나온 길이 out (null = 주머니 없음) */
  readonly pocket: { readonly x0: number; readonly out: number } | null;
  /** 침낭이 배낭 옆(앞 끝 반폭)보다 더 나온 길이 */
  readonly roll: number;
}

/**
 * 역할마다 위 그림 배낭 모양 — 각 역할의 등 윤곽을 지킨다 (VISUAL_SPEC 0장 ④: 의상을 입어도 역할 실루엣이 갈린다 — 서 있는
 * 실루엣 겹침이 역할끼리 0.8 이하, 괴물 화면 공통 생존자와 0.85 이하. 12.7 · 18 · 36px, 두 방향으로 쟀다)
 *  guard: 둥근 원판 등 — 등을 꽉 채운다
 *  scout: 원래 배낭(반폭 약 0.42)만큼 좁고 뒤가 둥글다 — 어깨와 배낭 사이 오목한 홈이 남는다
 *  runner: 뒤로 갈수록 좁아지는 몸판을 따라 뒤가 좁은 사다리꼴, 몸판 뒤 끝(−0.72)을 조금만 넘는다 — 둥근 등이 되지 않게
 */
const TOP_FIT: Record<RoleCharId, TopFit> = {
  guard: { wb: 0.56, wf: 0.56, back: null, corner: 0.2, pocket: { x0: 0.12, out: 0.08 }, roll: 0.1 },
  scout: { wb: 0.38, wf: 0.38, back: null, corner: 0.28, pocket: { x0: 0.2, out: 0.05 }, roll: 0.08 },
  runner: { wb: 0.3, wf: 0.55, back: -0.79, corner: 0.14, pocket: null, roll: 0.03 },
};

/** 위 그림 배낭 윤곽: 뒤 끝 xb(반폭 wb) ~ 앞 끝 xf(반폭 wf), 모서리 r. 앞뒤 폭이 같으면 둥근 네모, 다르면 둥근 사다리꼴 */
function packOutline(M: Mat, xb: number, xf: number, wb: number, wf: number, r: number): string {
  if (wb === wf) return path(M).roundRect(xb, -wb, xf - xb, wb * 2, r).d;
  return path(M)
    .M(xf - r, -wf)
    .L(xb + r, -wb)
    .Q(xb, -wb, xb, -wb + r)
    .L(xb, wb - r)
    .Q(xb, wb, xb + r, wb)
    .L(xf - r, wf)
    .Q(xf, wf, xf, wf - r)
    .L(xf, -wf + r)
    .Q(xf, -wf, xf - r, -wf)
    .Z().d;
}

// ───────────────────────── 위 그림 ─────────────────────────

function topBack(sk: Sketch, a: SurvivorTopAnchor): void {
  const { ink } = a;
  const runner = a.role === 'runner';
  // 지연 흔들림: 몸 비틀림보다 덜 돈다 (몸 중심 기준 회전이라 크기 기준은 그대로)
  const lag = 0.07 * a.s * (1 - 0.6 * a.captive);
  const M: Mat = mul(a.body, rotate(lag));
  // 피격으로 몸이 뒤로 밀린 만큼 뒤 끝을 앞으로 (뒤 끝은 제자리, 앞쪽만 눌린다)
  const [ox, oy] = apply(a.body, 0, 0);
  const push = ox < 0 ? Math.hypot(ox, oy) : 0;
  // 역할마다 등 윤곽 안 모양 (TOP_FIT). hw = 뒤 끝 반폭(덮개 · 주머니 · 솔기 기준), wf = 앞 끝 반폭
  const fit = TOP_FIT[a.role];
  const hw = fit.wb * a.halfW;
  const wf = fit.wf * a.halfW;
  const rc = fit.corner;
  // 뒤 끝: 정해 두지 않으면 뒤 모서리 둥근 끝이 rmax 안에 들게 잡는다 (뒤 끝은 곧게 — 네모난 짐으로 읽히게)
  const xb = (fit.back ?? -(Math.sqrt((TOPP.rmax - rc) ** 2 - (hw - rc) ** 2) + rc)) + push;
  // 침낭: 러너는 몸 가운데 원판 바로 뒤(등이 짧아 — 몸판 뒤 끝 −0.72 — 가늘게: 침낭 뒤로 밝은 덮개 · 버클이 보이게),
  // 가드 · 스카우트는 가운데가 머리 밑에 숨고 양끝만 머리 옆으로 나온다 (머리 바로 뒤부터 밝은 덮개가 보이게). 배낭은 몸에
  // 메므로 몸 기준 자리에 둔다 — 피격 · 밀치기 준비로 머리가 뒤로 젖혀지면 머리가 침낭 · 덮개 앞쪽을 덮는다
  const rr = runner ? TOPP.rollR * 0.75 : TOPP.rollR;
  const rollX = runner ? -0.46 - rr : TOPP.rollX;
  const xf = runner ? -0.47 : rollX + 0.12;
  const L = wf + fit.roll;
  /** x 자리에서 배낭 반폭 (사다리꼴 옆선) */
  const wAt = (x: number): number =>
    hw + ((wf - hw) * Math.min(1, Math.max(0, x - xb))) / Math.max(0.01, xf - xb);

  // 0) 옆 주머니 둘 (몸통 뒤쪽 옆에 붙은 둥근 주머니 — 네모난 상자가 아니라 배낭으로 읽히게, 어깨보다는 좁게). 몸통보다 먼저
  //    그려 안쪽 반은 몸통이 덮는다. 뒤 모서리가 rmax 안에 들게 뒤 끝에서 조금 앞
  const pk = { ...TOPP.pocket, x0: fit.pocket?.x0 ?? 0, out: fit.pocket?.out ?? 0 };
  for (const side of fit.pocket ? ([-1, 1] as const) : []) {
    const y0 = side > 0 ? hw - pk.inn : -(hw + pk.out);
    // 빛 중심은 몸통 밖으로 보이는 띠 위 — 좁은 띠가 짙은 귀처럼 보이지 않고 덮개와 같은 천으로 읽히게
    const [px, py] = apply(M, xb + pk.x0 + pk.len * 0.45, side * (hw + pk.out * 0.4));
    sk.part(
      path(M).roundRect(xb + pk.x0, y0, pk.len, pk.inn + pk.out, pk.r).d,
      radial(px, py, pk.len * 0.75, [
        [0, ink(tint(C.lid, 0.12))],
        [1, ink(shade(C.lid, 0.12))],
      ]),
      a.outline,
      1,
      0.3,
    );
    // 주머니 덮개 선 (앞쪽 1/3)
    const fx = xb + pk.x0 + pk.len * 0.62;
    sk.line(
      path(M)
        .M(fx, side * (hw - pk.inn * 0.2))
        .Q(fx - 0.03, side * (hw + pk.out * 0.5), fx, side * (hw + pk.out - 0.012)).d,
      solid(ink(shade(C.canvas, 0.3))),
      0.022,
    );
  }
  // 1) 배낭 몸통 (옆면 테 = 카키) + 덮개 (밝은 윗면, 위에서 받는 빛)
  const [cx, cy] = apply(M, (xf + xb) / 2 - 0.04, 0);
  sk.part(packOutline(M, xb, xf, hw, wf, rc), solid(ink(shade(C.canvas, 0.08))), a.outline, 1, 0.45);
  const n = TOPP.inset;
  sk.fill(
    packOutline(M, xb + n, xf - n, hw - n, wf - n, rc - n * 0.6),
    radial(cx, cy, wf * 1.15, [
      [0, ink(tint(C.lid, 0.3))],
      [0.6, ink(tint(C.lid, 0.12))],
      [1, ink(shade(C.lid, 0.08))],
    ]),
  );
  // 덮개 끝 솔기 (뒤 끝 가까이, 덮개가 접혀 내려오는 선)
  sk.line(
    path(M)
      .M(xb + 0.1, -hw + 0.12)
      .Q(xb + 0.05, 0, xb + 0.1, hw - 0.12).d,
    solid(ink(shade(C.lid, 0.3))),
    0.025,
  );
  // 덮개 끈 둘 (침낭에서 덮개 위로, 카키) + 쇠 버클
  // 덮개 끈 버클 자리 (러너는 짧은 덮개 가운데)
  const bx = xb + (runner ? 0.09 : 0.17);
  const strapY = 0.46 * wAt(bx);
  for (const side of [-1, 1] as const) {
    const y = side * strapY;
    sk.line(
      path(M)
        .M(rollX, y)
        .L(bx - 0.01, y).d,
      solid(ink(C.canvas)),
      0.06,
      'butt',
    );
    sk.fill(path(M).roundRect(bx - 0.05, y - 0.055, 0.1, 0.11, 0.025).d, solid(ink(C.steel)));
    sk.fill(path(M).roundRect(bx - 0.02, y - 0.032, 0.04, 0.064, 0.01).d, solid(ink(shade(C.steel, 0.45))));
  }
  // 2) 멜빵 둘 (배낭 위쪽 끝에서 어깨 위로 앞을 향한다)
  for (const side of [-1, 1] as const) {
    const y0 = side * (wf - 0.1);
    // 앞 끝은 몸 가운데 원판(0.45r) 밖으로 (수감 때 어깨가 움츠러들어도)
    const y1 = side * Math.max(wf + 0.02, 0.52);
    const d = path(M)
      .M(rollX, y0)
      .Q(rollX + 0.35, y1, Math.max(rollX + 0.6, 0.12), y1).d;
    sk.line(d, solid(ink(shade(C.strap, 0.1))), 0.12);
    sk.line(d, solid(ink(C.canvas)), 0.075);
  }
  // 3) 침낭 (가로 원통): 빛은 위에서 — 원통 등(가운데 x)이 밝고 앞뒤 가장자리가 어둡다
  const [r0x, r0y] = apply(M, rollX - rr, 0);
  const [r1x, r1y] = apply(M, rollX + rr, 0);
  sk.part(
    path(M).capsule(rollX, -(L - rr), rollX, L - rr, rr * 2).d,
    linear(r0x, r0y, r1x, r1y, [
      [0, ink(C.rollDeep)],
      [0.5, ink(tint(C.roll, 0.22))],
      [1, ink(shade(C.rollDeep, 0.1))],
    ]),
    a.outline,
    1,
    0.4,
  );
  // 침낭 끈 띠 둘 (짙은 끈이 원통을 감는다)
  for (const side of [-1, 1] as const) {
    const y = side * strapY;
    sk.line(
      path(M)
        .M(rollX - rr, y)
        .L(rollX + rr, y).d,
      solid(ink(C.strap)),
      0.065,
      'butt',
    );
  }
  // 침낭 말린 결 (양끝 둥근 줄)
  for (const side of [-1, 1] as const)
    sk.line(
      path(M)
        .M(rollX - rr * 0.65, side * (L - rr * 0.6))
        .Q(rollX, side * (L - rr * 0.1), rollX + rr * 0.65, side * (L - rr * 0.6)).d,
      solid(ink(shade(C.rollDeep, 0.25))),
      0.022,
    );
}

// ───────────────────────── 정면 ─────────────────────────

/** 정면 크기 한 벌: 배낭 가장 넓은 반폭(정면) 또는 등 쪽 끝 x(러너) · 침낭 바깥 끝 */
interface FrontSize {
  readonly W: number;
  readonly E: number;
}

/**
 * 정면 크기 (몸통 좌표). 상반신(로비 역할 카드 · 결과 화면)은 역할마다 상반신 배율 · 옮김 뒤에도 상자 좌우 [−1, 1] 안에
 * 외곽선 몫 0.02를 남긴 만큼 — 가드(1.45배 −0.05) [−0.634, 0.703] · 스카우트(1.5배 +0.04) [−0.673, 0.62] · 러너(1.65배
 * +0.03) [−0.606, 0.57]에서 좁은 쪽으로 대칭. 전신은 상자 여유가 커 어깨 밖으로 더 크게 나온다
 *  guard · scout: W = 배낭 반폭, E = 침낭 양끝
 *  runner: W = 등 쪽(화면 왼쪽) 배낭 끝 x, E = 침낭 가까운 끝 x (그림 좌표)
 */
const FRONT_SIZE: Record<RoleCharId, { readonly full: FrontSize; readonly bust: FrontSize }> = {
  guard: { full: { W: 0.7, E: 0.78 }, bust: { W: 0.6, E: 0.63 } },
  scout: { full: { W: 0.68, E: 0.76 }, bust: { W: 0.57, E: 0.6 } },
  runner: { full: { W: -0.7, E: -0.77 }, bust: { W: -0.57, E: -0.6 } },
};

/** 정면 침낭 반지름 */
const ROLL_R = 0.13;
/** 정면(가드 · 스카우트) 배낭 위 끝 = 머리 중심 − 머리 반지름 × TOP_K — 침낭이 머리 위 둘레로 보이는 높이 */
const TOP_K = 0.72;

/** 배낭 몸통 칠 (빛은 왼쪽 위) */
function bodyPaint(a: SurvivorFrontAnchor, x0: number, x1: number): Paint {
  const { ink } = a;
  return linear(x0, 0, x1, 0, [
    [0, ink(tint(C.canvas, 0.24))],
    [0.5, ink(tint(C.canvas, 0.06))],
    [1, ink(shade(C.canvas, 0.25))],
  ]);
}

/** 배낭 쇠 버클 (가운데 x, y · 폭 · 높이). 조금 짙은 쇠 — 작은 크기에서 밝은 카키 위 흰 티끌로 보이지 않게 */
function buckle(
  sk: Sketch,
  a: SurvivorFrontAnchor,
  M: Mat,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { ink } = a;
  sk.part(
    path(M).roundRect(x - w / 2, y - h / 2, w, h, h * 0.25).d,
    solid(ink(shade(C.steel, 0.3))),
    a.outline,
    1,
    0.3,
  );
  sk.fill(
    path(M).roundRect(x - w * 0.32, y - h * 0.13, w * 0.64, h * 0.26, h * 0.1).d,
    solid(ink(shade(C.steel, 0.6))),
  );
}

/** 침낭 말린 끝 (나선 한 바퀴 반, 가로로 눌린 타원 — 원통 끝을 비스듬히 본 모양) */
function spiral(cx: number, cy: number, r: number, squash: number, dir: 1 | -1): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 18; i += 1) {
    const th = (i / 18) * Math.PI * 3;
    const k = 0.18 + (0.82 * i) / 18;
    pts.push([cx + dir * Math.cos(th) * r * k * squash, cy - Math.sin(th) * r * k]);
  }
  return pts;
}

function frontBehind(sk: Sketch, a: SurvivorFrontAnchor): void {
  const size = FRONT_SIZE[a.role][a.bust ? 'bust' : 'full'];
  if (a.facing === 1) frontSide(sk, a, size);
  else frontFace(sk, a, size);
}

/**
 * 정면(가드 · 스카우트): 어깨 양옆 밖으로 나오고 머리 위쪽까지 솟은 배낭 — 위가 둥근 밝은 덮개(아래 테에 청록 솔기)가
 * 자루 위에 얹혀 조금 넓고, 자루는 어깨 높이에서 가장 넓다가 바닥으로 좁아진다. 옆 압축 끈 · 버클, 아래 옆 불룩한 주머니.
 * 덮개 위에 머리 뒤로 가로지르는 침낭(머리 위 둘레와 양옆으로 보인다) + 끈 띠 둘이 덮개 위로 내려와 버클로 죈다.
 * 배낭 · 침낭은 따로 층 — 머리 · 어깨 외곽선이 배낭 위에 굵게 남아 몸 실루엣이 그대로 읽힌다
 */
function frontFace(sk: Sketch, a: SurvivorFrontAnchor, size: FrontSize): void {
  const { ink } = a;
  const M = a.torso;
  const { W, E } = size;
  const top = a.head.y - a.head.r * TOP_K;
  const bottom = a.hipY - 0.02;
  const lidY = top + 0.28;
  // 1) 자루 (덮개 밑에서 시작 — 어깨 높이에서 가장 넓고 바닥으로 좁아지는 둥근 자루)
  const sy = top + 0.1;
  const sack = path(M)
    .M(-(W - 0.03), sy)
    .L(W - 0.03, sy)
    .C(W - 0.005, top + 0.32, W - 0.01, top + 0.6, W - 0.08, bottom - 0.14)
    .C(W - 0.11, bottom - 0.04, W - 0.16, bottom, W - 0.26, bottom)
    .Q(0, bottom + 0.035, -(W - 0.26), bottom)
    .C(-(W - 0.16), bottom, -(W - 0.11), bottom - 0.04, -(W - 0.08), bottom - 0.14)
    .C(-(W - 0.01), top + 0.6, -(W - 0.005), top + 0.32, -(W - 0.03), sy)
    .Z().d;
  sk.part(sack, bodyPaint(a, -W, W), a.outline);
  // 아래 옆 불룩한 주머니 (자루가 좁아지는 곳에서 옆으로 나온다) + 덮개 선
  for (const s of [-1, 1] as const) {
    const px = s > 0 ? W - 0.165 : -W;
    const py = top + 0.68;
    const ph = bottom - 0.05 - py;
    sk.part(
      path(M).roundRect(px, py, 0.165, ph, 0.08).d,
      solid(ink(s < 0 ? tint(C.canvas, 0.16) : shade(C.canvas, 0.12))),
      a.outline,
      1,
      0.35,
    );
    sk.line(
      path(M)
        .M(px + 0.015, py + 0.075)
        .Q(px + 0.08, py + 0.11, px + 0.145, py + 0.075).d,
      solid(ink(shade(C.canvas, 0.38))),
      0.022,
    );
  }
  // 옆 압축 끈 (가로 짙은 띠, 머리 옆 어깨 위로 보이는 높이) + 작은 쇠 버클
  const cy = top + 0.5;
  sk.line(
    path(M)
      .M(-(W - 0.01), cy)
      .L(W - 0.01, cy).d,
    solid(ink(C.strap)),
    0.05,
    'butt',
  );
  for (const s of [-1, 1] as const) buckle(sk, a, M, s * (W - 0.1), cy, 0.065, 0.068);
  // 2) 덮개 (자루 위에 얹힌 둥근 천, 자루보다 조금 넓다) + 테 그늘 · 청록 네온 솔기
  const lid = path(M)
    .M(-W, lidY)
    .L(-W, top + 0.15)
    .C(-W, top + 0.03, -(W - 0.07), top - 0.01, -(W - 0.17), top - 0.015)
    .Q(0, top - 0.07, W - 0.17, top - 0.015)
    .C(W - 0.07, top - 0.01, W, top + 0.03, W, top + 0.15)
    .L(W, lidY)
    .Q(0, lidY + 0.14, -W, lidY)
    .Z().d;
  sk.part(
    lid,
    linear(-W, top, W, lidY, [
      [0, ink(tint(C.lid, 0.32))],
      [0.55, ink(tint(C.lid, 0.06))],
      [1, ink(shade(C.lid, 0.14))],
    ]),
    a.outline,
  );
  sk.line(
    path(M)
      .M(W - 0.01, lidY - 0.005)
      .Q(0, lidY + 0.13, -W + 0.01, lidY - 0.005).d,
    solid(ink(shade(C.canvas, 0.45))),
    0.03,
  );
  a.neon.line(
    path(M)
      .M(W - 0.035, lidY - 0.04)
      .Q(0, lidY + 0.09, -W + 0.035, lidY - 0.04).d,
    0.013,
    0.55,
  );
  // 침낭을 죄는 끈 둘 (침낭에서 덮개 위로 내려와 덮개 테 밑까지) + 쇠 버클
  const bandX = E - 0.17;
  const ry = top - ROLL_R * 0.3;
  for (const s of [-1, 1] as const) {
    const x = s * bandX;
    sk.line(
      path(M)
        .M(x, ry)
        .L(x, lidY + 0.1).d,
      solid(ink(C.strap)),
      0.055,
      'butt',
    );
    buckle(sk, a, M, x, top + 0.17, 0.08, 0.068);
  }
  sk.layer();
  // 3) 침낭 (머리 뒤로 가로지르는 원통, 바람에 아주 조금 기운다)
  frontRoll(sk, a, M, -E, E, ry, [-bandX, bandX], 0.015 * a.sway);
  sk.layer();
}

/**
 * 러너(3/4, 오른쪽을 본다): 등(화면 왼쪽)으로 크게 불룩한 배낭 옆모습 — 밝은 덮개(테에 청록 솔기)가 등 쪽 위 모서리를
 * 덮고, 옆 압축 끈 · 버클, 아래 등 쪽 주머니. 덮개 위에 침낭을 가로로 얹고 가까운 끝(말린 나선)이 등 밖으로 나온다.
 * 후드 끝 천이 침낭 윗등에 걸쳐 흘러내린다 (후드 · 몸이 앞, 배낭은 뒤 층)
 */
function frontSide(sk: Sketch, a: SurvivorFrontAnchor, size: FrontSize): void {
  const { ink } = a;
  // 그림 좌표로 잡는다 (등 쪽 실루엣이 몸통 기울임 없이 곧게 불룩하다): 앞 끝 xr은 몸통 · 후드 뒤에 숨는다
  const B = size.W;
  const XL = size.E;
  const top = a.head.y + 0.04;
  const bottom = a.hipY - 0.02;
  const xr = 0.05;
  const lidY = top + 0.3;
  // 1) 자루 (등 쪽 옆선이 조금 불룩하다)
  const sack = path()
    .M(xr, top + 0.06)
    .L(B + 0.17, top + 0.06)
    .C(B + 0.03, top + 0.06, B - 0.025, top + 0.3, B - 0.02, top + 0.45)
    .C(B - 0.015, bottom - 0.12, B + 0.04, bottom, B + 0.18, bottom)
    .L(xr - 0.05, bottom)
    .Z().d;
  sk.part(sack, bodyPaint(a, B, xr), a.outline);
  // 아래 등 쪽 불룩한 주머니 + 덮개 선
  const py = top + 0.52;
  sk.part(
    path().roundRect(B - 0.012, py, 0.17, bottom - 0.04 - py, 0.07).d,
    solid(ink(tint(C.canvas, 0.16))),
    a.outline,
    1,
    0.35,
  );
  sk.line(
    path()
      .M(B, py + 0.075)
      .Q(B + 0.075, py + 0.11, B + 0.15, py + 0.075).d,
    solid(ink(shade(C.canvas, 0.38))),
    0.022,
  );
  // 옆 압축 끈 + 버클
  const cy = top + 0.45;
  sk.line(
    path()
      .M(B - 0.015, cy)
      .L(xr, cy).d,
    solid(ink(C.strap)),
    0.05,
    'butt',
  );
  buckle(sk, a, IDENTITY, B + 0.1, cy, 0.065, 0.068);
  // 2) 덮개 (등 쪽 위 모서리를 둥글게 덮고 등 밖으로 조금 넘친다) + 테 그늘 · 청록 네온 솔기
  const lid = path()
    .M(xr, top)
    .L(B + 0.16, top - 0.01)
    .C(B + 0.04, top - 0.01, B - 0.02, top + 0.06, B - 0.025, top + 0.17)
    .L(B - 0.03, lidY)
    .Q(B + 0.3, lidY + 0.08, xr, lidY - 0.03)
    .Z().d;
  sk.part(
    lid,
    linear(B, top, xr, lidY, [
      [0, ink(tint(C.lid, 0.32))],
      [0.6, ink(tint(C.lid, 0.06))],
      [1, ink(shade(C.lid, 0.14))],
    ]),
    a.outline,
  );
  sk.line(
    path()
      .M(B - 0.02, lidY - 0.005)
      .Q(B + 0.3, lidY + 0.075, xr, lidY - 0.035).d,
    solid(ink(shade(C.canvas, 0.45))),
    0.03,
  );
  a.neon.line(
    path()
      .M(B + 0.005, lidY - 0.04)
      .Q(B + 0.3, lidY + 0.035, xr - 0.1, lidY - 0.07).d,
    0.013,
    0.55,
  );
  // 침낭 죄는 끈 (침낭에서 덮개 위로 내려와 덮개 테 밑까지) + 버클
  const rr = ROLL_R * 0.92;
  const ry = top - 0.08;
  const bandX = XL + 0.21;
  sk.line(
    path()
      .M(bandX, ry)
      .L(bandX, lidY + 0.1).d,
    solid(ink(C.strap)),
    0.055,
    'butt',
  );
  buckle(sk, a, IDENTITY, bandX, (ry + rr + lidY) / 2 + 0.01, 0.08, 0.068);
  sk.layer();
  // 3) 침낭 (가로 원통: 가까운 끝은 말린 단면 타원, 먼 끝은 머리 뒤에 숨는다)
  const ex = XL + 0.065;
  const x1 = 0.25;
  sk.part(
    path()
      .M(ex, ry - rr)
      .L(x1, ry - rr)
      .L(x1, ry + rr)
      .L(ex, ry + rr)
      .arc(ex, ry, 0.065, Math.PI / 2, Math.PI * 1.5, false, rr)
      .Z().d,
    linear(ex, ry - rr, ex, ry + rr, [
      [0, ink(tint(C.roll, 0.2))],
      [0.4, ink(C.roll)],
      [1, ink(shade(C.rollDeep, 0.2))],
    ]),
    a.outline,
  );
  sk.line(
    path()
      .M(ex + 0.05, ry - rr * 0.5)
      .L(x1 - 0.1, ry - rr * 0.5).d,
    solid(ink(tint(C.roll, 0.35))),
    0.022,
    'round',
    0.8,
  );
  // 끈 띠 (원통을 감는다)
  sk.line(
    path()
      .M(bandX, ry - rr - 0.012)
      .L(bandX, ry + rr + 0.012).d,
    solid(ink(C.strap)),
    0.055,
    'butt',
  );
  // 말린 단면 (조금 밝은 타원 + 나선)
  sk.part(path().ellipse(ex, ry, 0.065, rr).d, solid(ink(tint(C.roll, 0.12))), a.outline, 1, 0.5);
  sk.line(path().curve(spiral(ex, ry, rr * 0.85, 0.5, 1)).d, solid(ink(shade(C.rollDeep, 0.3))), 0.02);
  // 늘어진 끈 끝 (바람에 흔들린다)
  const sw = 0.035 * a.sway;
  sk.line(
    path()
      .M(bandX, ry + rr + 0.01)
      .Q(bandX - 0.02 + sw * 0.5, ry + rr + 0.07, bandX - 0.05 + sw, ry + rr + 0.12).d,
    solid(ink(C.strap)),
    0.034,
  );
  sk.layer();
}

/**
 * 정면 침낭: 가로 원통 x0 ~ x1(둥근 끝 포함 바깥 끝), 가운데 높이 y, 기울기 tilt(가운데 기준). 윗등 밝은 결 · 양끝 말린 나선 ·
 * 끈 띠(bands x) — 왼쪽 띠에 쇠 버클 + 바람에 흔들리는 늘어진 끈 끝
 */
function frontRoll(
  sk: Sketch,
  a: SurvivorFrontAnchor,
  M: Mat,
  x0: number,
  x1: number,
  y: number,
  bands: readonly number[],
  tilt: number,
): void {
  const { ink } = a;
  const rr = ROLL_R;
  const mid = (x0 + x1) / 2;
  const R: Mat = mul(M, rotateAbout(tilt, mid, y));
  sk.part(
    path(R).capsule(x0 + rr, y, x1 - rr, y, rr * 2).d,
    linear(mid, y - rr, mid, y + rr, [
      [0, ink(tint(C.roll, 0.2))],
      [0.4, ink(C.roll)],
      [1, ink(shade(C.rollDeep, 0.2))],
    ]),
    a.outline,
  );
  // 윗등 밝은 결 · 겉감 끝단 선 (말린 담요로 읽히게 — 쇠 파이프처럼 고르지 않게 조금 휜다)
  sk.line(
    path(R)
      .M(x0 + rr * 1.2, y - rr * 0.5)
      .Q(mid, y - rr * 0.62, x1 - rr * 1.2, y - rr * 0.5).d,
    solid(ink(tint(C.roll, 0.35))),
    0.024,
    'round',
    0.8,
  );
  sk.line(
    path(R)
      .M(x0 + rr * 1.1, y + rr * 0.42)
      .Q(mid, y + rr * 0.2, x1 - rr * 1.1, y + rr * 0.42).d,
    solid(ink(shade(C.rollDeep, 0.3))),
    0.018,
  );
  // 양끝 말린 나선
  for (const s of [-1, 1] as const) {
    const ex = s < 0 ? x0 + rr * 0.85 : x1 - rr * 0.85;
    sk.line(path(R).curve(spiral(ex, y, rr * 0.75, 0.55, s)).d, solid(ink(shade(C.rollDeep, 0.3))), 0.02);
  }
  bands.forEach((bx, i) => {
    sk.line(
      path(R)
        .M(bx, y - rr - 0.012)
        .L(bx, y + rr + 0.012).d,
      solid(ink(C.strap)),
      0.055,
      'butt',
    );
    if (i > 0) return;
    // 늘어진 끈 끝 (바람에 흔들린다)
    const sw = 0.035 * a.sway;
    sk.line(
      path(R)
        .M(bx, y + rr)
        .Q(bx - 0.015 + sw * 0.5, y + rr + 0.06, bx - 0.04 + sw, y + rr + 0.11).d,
      solid(ink(C.strap)),
      0.034,
    );
  });
}

function frontTorso(sk: Sketch, a: SurvivorFrontAnchor): void {
  const { ink } = a;
  if (a.role === 'scout') return; // 스카우트는 제 멜빵(짙은 끈 + 네온 파이핑)이 배낭 멜빵 노릇을 한다
  const M = a.torso;
  const sy = a.shoulderY;
  const end = a.hipY - 0.1;
  // [어깨 쪽 x, 허리 쪽 x, 버클 높이(몸통 기준)]
  const straps: readonly (readonly [number, number, number])[] =
    a.role === 'runner'
      ? [
          [-0.17, -0.12, 0.2],
          [0.24, 0.21, 0.2],
        ]
      : // 가드: 방패 왼쪽 끝과 팔 사이 틈으로 한 줄만 보인다 (어깨 갑옷 위 멜빵은 frontNeck)
        [[-0.31, -0.285, 0.27]];
  straps.forEach(([x0, x1, yb], i) => {
    const by = yb + a.by;
    const d = path(M)
      .M(x0, sy - 0.02)
      .Q(x0 + 0.02, (sy + end) / 2, x1, end).d;
    strapLine(sk, a, d);
    // 버클 (쇠 사다리 고리)
    const bx = x0 + (x1 - x0) * ((by - sy) / (end - sy)) + 0.01;
    sk.part(
      path(M).roundRect(bx - 0.05, by - 0.033, 0.1, 0.066, 0.016).d,
      solid(ink(C.steel)),
      a.outline,
      1,
      0.3,
    );
    sk.fill(
      path(M).roundRect(bx - 0.034, by - 0.009, 0.068, 0.018, 0.006).d,
      solid(ink(shade(C.steel, 0.5))),
    );
    if (i === 0) {
      const [nx, ny] = apply(M, bx, by);
      a.neon.dot(nx, ny, 0.012, 0.8, 0.04);
    }
  });
}

/** 멜빵 한 줄 (짙은 테 + 카키 심 + 가운데 박음 선 — 두툼한 패드 멜빵) */
function strapLine(sk: Sketch, a: SurvivorFrontAnchor, d: string): void {
  const { ink } = a;
  sk.line(d, solid(ink(shade(C.strap, 0.1))), 0.09);
  sk.line(d, solid(ink(C.canvas)), 0.058);
  sk.line(d, solid(ink(tint(C.canvas, 0.2))), 0.014, 'round', 0.7);
}

/**
 * 가드 어깨 멜빵: 어깨 갑옷 위로 넘어와 가슴 쪽으로 내려간다 (갑옷 위에 멘 배낭 — 방패가 아래를 가린다). 머리 · 볼
 * 가리개보다 아래에서 시작한다
 */
function frontNeck(sk: Sketch, a: SurvivorFrontAnchor): void {
  if (a.role !== 'guard') return;
  const M = a.torso;
  const sy = a.shoulderY;
  for (const s of [-1, 1] as const)
    strapLine(
      sk,
      a,
      path(M)
        .M(s * 0.265, sy - 0.1)
        .Q(s * 0.275, sy + 0.04, s * 0.3, sy + 0.14).d,
    );
}

export const PACK_ART: SurvivorCostumeArt = {
  id: 'pack',
  hidesPack: true,
  topBack,
  frontBehind,
  frontTorso,
  frontNeck,
};
