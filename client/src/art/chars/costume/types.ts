// 의상 그림 모듈 형식 (판 밖 메타 c). 의상은 역할 그림 위에 얹는 부품이다: 역할 그림(runner · guard · scout · monster)이
// 정해진 자리(훅)에서 의상 함수를 부르고, 의상은 그 자리의 기준점(앵커)만 보고 그린다 — 역할 그림의 내부 값에 기대지 않아
// 한 의상이 세 생존자 역할에 같이 맞는다. 괴물 화면 공통 생존자(common)는 훅이 없다(의상 인자를 받지 않는다).
//
// 지키는 것: 판정 원 · 크기 기준(measure.SIZE_RULE — 뒤 1.0r · 옆 1.05r · 앞 1.15r, 괴물은 자락 기준)은 의상을 입어도 같다.
// 몸 가운데(0.45r 원판)는 역할색 그대로(VISUAL_SPEC 0장 ②). 위 그림(게임 화면)에는 청록을 쓰지 않는다. 모든 색은 ink()를
// 거친다(사망 회색 · 피격 흰 번쩍). 정면 네온은 neon.line · neon.dot만.
import type { Mat, Sketch } from '../kit';
import type { FrontNeon, Ink } from '../survivorBase';
import type { MonsterPose, RoleCharId, SurvivorPose } from '../types';

export type Pt = readonly [number, number];

/** 생존자 위 그림 기준점 (몸 기준 좌표: 단위 = 몸 반지름, +x = 바라보는 방향) */
export interface SurvivorTopAnchor {
  readonly role: RoleCharId;
  /** 다듬은 자세 */
  readonly pose: SurvivorPose;
  readonly ink: Ink;
  /** 외곽선 색 (ink(OUTLINE)) · 외곽선 두께 */
  readonly outline: number;
  readonly w: number;
  /** 몸판 · 어깨 변환 (걸음 비틀림 · 역할마다 피격 젖힘). 등에 붙는 부품은 path(body)로 그린다 */
  readonly body: Mat;
  /** 머리 (그림 좌표): 중심 · 반지름 · 뒤 끝 x(머리 윤곽이 등 쪽으로 가장 멀리 간 x) */
  readonly head: { readonly x: number; readonly y: number; readonly r: number; readonly backX: number };
  /** 몸판 · 등 판 뒤 끝 x (몸 기준, 음수) — 등 부품은 이보다 조금 안쪽까지. 뒤 크기 한도는 −1.0 */
  readonly backX: number;
  /** 어깨 반폭 (옆 크기 한도 1.05r보다 안) */
  readonly halfW: number;
  /** 목(머리 뒤 · 어깨 위 둘레) 중심 x — 머리 원과 몸판이 만나는 곳 */
  readonly neckX: number;
  /** 걷기 위상 · 흔들림(sin(walk) × stride, −1~1) · 세기 */
  readonly walk: number;
  readonly s: number;
  readonly stride: number;
  /** 능력 동작 0~1 (보통 상태일 때만) · 피격 젖힘 0~1 · 수감 0/1 · 구조 0/1 */
  readonly action: number;
  readonly hit: number;
  readonly captive: number;
  readonly reach: number;
}

/**
 * 생존자 정면 기준점 (상자 [−1, 1]², +y 아래). torso = 몸통 변환(러너 3/4 기울임, 가드 · 스카우트는 단위 행렬) —
 * 몸통에 붙는 부품은 path(torso)로, 아래 좌표는 torso 변환 전 몸통 좌표다(머리 · 목은 그림 좌표)
 */
export interface SurvivorFrontAnchor {
  readonly role: RoleCharId;
  readonly ink: Ink;
  readonly neon: FrontNeon;
  readonly outline: number;
  readonly w: number;
  /** 장식 시각(초) · 숨쉬기 오르내림 · 바람 흔들림(−1~1) */
  readonly t: number;
  readonly by: number;
  readonly sway: number;
  /** 상반신(로비 카드 · 결과 화면) — 다리 쪽 부품은 그리지 않는다 */
  readonly bust: boolean;
  readonly torso: Mat;
  /** 목 아래 가운데 · 어깨 둘(등 쪽 · 가슴 쪽, 정면이면 화면 왼쪽 · 오른쪽) · 어깨 높이 · 엉덩이 높이 · 몸통 반폭 */
  readonly neck: Pt;
  readonly shoulders: readonly [Pt, Pt];
  readonly shoulderY: number;
  readonly hipY: number;
  readonly halfW: number;
  /** 머리 (그림 좌표) */
  readonly head: { readonly x: number; readonly y: number; readonly r: number };
  /** 바라보는 쪽: 1 = 화면 오른쪽(3/4, 등은 왼쪽), 0 = 정면 */
  readonly facing: 0 | 1;
}

/**
 * 생존자 의상 그림. 훅마다 역할 그림의 그리는 순서 한 자리다(없으면 건너뛴다).
 *  topBack: 몸판 · 팔 위, 머리 밑 (배낭 · 망토 · 목도리 자락)
 *  topOver: 머리 위 — 머리 뒤쪽 반에만 (목도리 감은 곳). 앞 단서(챙 · 고글 · 헬멧 앞)를 덮지 않는다
 *  frontBehind: 모든 것 뒤 (망토 자락 · 배낭 몸통)
 *  frontTorso: 몸통 위, 팔 · 머리 밑 (멜빵 · 망토 어깨)
 *  frontNeck: 얼굴 · 머리 위 (목도리 · 망토 걸쇠)
 */
export interface SurvivorCostumeArt {
  readonly id: string;
  topBack?(sk: Sketch, a: SurvivorTopAnchor): void;
  topOver?(sk: Sketch, a: SurvivorTopAnchor): void;
  frontBehind?(sk: Sketch, a: SurvivorFrontAnchor): void;
  frontTorso?(sk: Sketch, a: SurvivorFrontAnchor): void;
  frontNeck?(sk: Sketch, a: SurvivorFrontAnchor): void;
  /** 역할 그림의 등 부품을 감출지 (스카우트 배낭 · 안테나 — 큰 배낭이 대신한다) */
  readonly hidesPack?: boolean;
}

/** 괴물 위 그림 기준점 (몸 기준 좌표) */
export interface MonsterTopAnchor {
  readonly pose: MonsterPose;
  readonly ink: Ink;
  readonly outline: number;
  readonly w: number;
  /** 망토 몸 변환 · 목(두건) 변환 · 머리 변환 (monster.ts monsterRig: body · neck · H) */
  readonly body: Mat;
  readonly neck: Mat;
  readonly headM: Mat;
  /** 망토 뒤 자락 끝점들 (body 좌표, 망토 물결 · 돌진 반영) — 뒤 크기 한도 안 */
  readonly tail: readonly Pt[];
  /** 어깨 반폭 (body 좌표) */
  readonly halfW: number;
  readonly walk: number;
  readonly s: number;
  readonly stride: number;
  /** 망토 물결 위상 · 돌진 · 포효 · 기절 · 타격 0~1 */
  readonly cloak: number;
  readonly dash: number;
  readonly roar: number;
  readonly stun: number;
  readonly strike: number;
}

/** 괴물 정면 기준점 (상자 [−1, 1]²) */
export interface MonsterFrontAnchor {
  readonly ink: Ink;
  readonly outline: number;
  readonly w: number;
  readonly t: number;
  readonly by: number;
  readonly bust: boolean;
  /** 그림 변환 (전신 · 상반신 배율) · 길이 배율 */
  readonly m: Mat;
  readonly ls: number;
  /** 머리(두건) 높이 기준 hy (두건 꼭대기 ≈ hy − 0.5) · 망토 아랫단 반폭 */
  readonly hy: number;
  readonly hemW: number;
  /** 두 손목 (m 좌표, 화면 왼쪽 · 오른쪽) — 상반신은 망토 앞을 쥔 손 */
  readonly wrists: readonly [Pt, Pt];
  /** 붉은 림 빛 색 */
  readonly rim: number;
}

/**
 * 괴물 의상 그림.
 *  topCloak: 망토 · 주름 위, 두건 그늘 · 팔 밑 (사슬 · 깃 망토)
 *  topHead: 두건 위, 얼굴 그늘 밑 (두건 끝 · 목 사슬)
 *  frontCloak: 뒤 망토 위, 팔 밑
 *  frontMantle: 어깨 망토 위, 두건 밑
 *  frontHood: 두건 그림 바꾸기 — 두건 윤곽 점들을 받아 새 윤곽을 돌려준다 (없으면 그대로)
 *  frontOver: 두건 · 얼굴 위 (손목 족쇄 등 맨 앞)
 */
export interface MonsterCostumeArt {
  readonly id: string;
  topCloak?(sk: Sketch, a: MonsterTopAnchor): void;
  topHead?(sk: Sketch, a: MonsterTopAnchor): void;
  frontCloak?(sk: Sketch, a: MonsterFrontAnchor): void;
  frontMantle?(sk: Sketch, a: MonsterFrontAnchor): void;
  frontHood?(hood: readonly Pt[], a: MonsterFrontAnchor): readonly Pt[];
  frontOver?(sk: Sketch, a: MonsterFrontAnchor): void;
}
