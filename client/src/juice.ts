// 판 순간의 손맛 (플레이테스트 반영 c, docs/playtest/c-juice.md 4장): 한 스냅샷의 이벤트 → 소리 · 진동 · 흔들림 · 화면 효과 · 일시 배너.
// 순수 함수 (Phaser · DOM 없음). 받는 사람이 이미 받은 이벤트와 자기 스냅샷만 쓴다 — 서버 · 공유 코드 · 프로토콜은 그대로다.
// 괴물 화면 (VISUAL_SPEC 0장 ③ 흰색 위장 · 정보 숨김): 괴물 쪽 반응은 이벤트 종류 · 개수(가둔 수) · 맞은 수(attackHit.hits) · 자기 조준 방향의 함수뿐이다.
//  역할 · 이름 · 체력 · 누가 맞았는지 · 시야 밖 존재 · 생존자와의 거리 · 방향에 따라 달라지지 않는다(빗나감 소리는 늘 같다). 일시 배너에
//  역할 · 이름 · 자리를 넣지 않고, 풀려난 생존자 자리에 효과를 그리지 않는다
// 같은 소리는 한 스냅샷에 한 번 가장 큰 음량으로 낸다 (동료 피격 0.4가 먼저 와도 내 피격 1.0이 60ms 간격 검사에 밀리지 않게 — c-juice 1.4 ⑥).
// 진동은 한 스냅샷에 하나 (HAPTIC_RANK가 높은 것 — 수감이 같은 스냅샷 피격을, 가둠이 명중을 이긴다. navigator.vibrate는 새 호출이 앞을 끊는다)
import type { AnonStatus, GameEvent, Role, RoleId, SurvivorStatus } from '@decoy/shared';
import type { IconId } from './art/icons';
import type { SfxName } from './audio';
import { ROLE_CARDS, UI_TEXT } from './data/storyText';
import type { HapticKind } from './haptics';
import type { ShakeKind } from './render/camera';
import type { Tone } from './ui/hudArt';

/** 소리 음량 (0~1, 효과음 묶음 안) */
export const JUICE_VOL = {
  /** 타격마다 (결과와 무관): 괴물 · 생존자(괴물이 보여 attackHit을 받았을 때만) */
  swingMonster: 1,
  swingSurvivor: 0.6,
  /** 괴물 명중 확인: 타격음 + 낮은 쿵 (둘 이상 맞으면 쿵을 키운다) */
  hitMonster: 1,
  thud: 0.8,
  thudMulti: 1,
  /** 생존자 피격: 나 · 팀원 */
  hitMe: 1,
  hitMate: 0.4,
  /** 철창: 나 · 팀원 · 괴물 */
  jailMe: 1,
  jailMate: 0.5,
  jailMonster: 0.8,
  /** 구조 완료: 생존자 화음 · 괴물 경고 */
  rescue: 1,
  alarm: 1,
  /** 돌진 (생존자: 서버가 괴물이 보일 때만 보낸 dash 이벤트. 괴물 본인은 누른 순간 1.0) */
  dashSurvivor: 0.8,
  /** 아슬아슬 회피 */
  graze: 0.6,
} as const;

/** 한 스냅샷의 진동 고르기 (높은 것 하나) */
export const HAPTIC_RANK: Readonly<Record<HapticKind, number>> = {
  spotted: 0,
  graze: 1,
  rescue: 2,
  strike: 3,
  hit: 4,
  stunned: 5,
  capture: 6,
  jailed: 7,
};

/** 일시 배너 한 줄 */
export interface JuiceBanner {
  text: string;
  sec: number;
  tone: Tone;
  icon: IconId;
}

/** 손맛 배너의 표시 시간 · 톤 · 아이콘 (아이콘 · 톤 조합은 hudArt.BANNER_ICONS에 구워져 있어야 한다) */
export const JUICE_BANNER = {
  jailedMe: { sec: 2, tone: 'danger', icon: 'prison' },
  jailedMate: { sec: 1.5, tone: 'warn', icon: 'prison' },
  jailedOne: { sec: 1.5, tone: 'info', icon: 'prison' },
  /** 한 번에 둘 이상 (한 번 휘둘러 부상자 둘을 함께 가둠): 모양은 한 명과 같고 글자만 가둔 수 */
  jailedMany: { sec: 1.5, tone: 'info', icon: 'prison' },
} as const satisfies Record<string, Omit<JuiceBanner, 'text'>>;

/** 팀원 한 명 (생존자 화면 스냅샷) */
export interface TeamMate {
  id: string;
  role: RoleId | null;
  status: SurvivorStatus;
}

export interface JuiceInput {
  role: Role;
  events: readonly GameEvent[];
  /** 내 상태: 이번 · 지난 스냅샷 (괴물은 null) */
  status: SurvivorStatus | null;
  prevStatus: SurvivorStatus | null;
  /** 팀원 (생존자 화면): 이번 스냅샷 · 지난 스냅샷 상태 (지난 것을 모르면 null) */
  team: readonly TeamMate[];
  prevTeam: ReadonlyMap<string, SurvivorStatus> | null;
  /** 이 스냅샷의 아슬아슬 회피 (nearMiss.ts nearMissStrike) */
  nearMiss: boolean;
}

export interface JuicePlan {
  sounds: { name: SfxName; vol: number }[];
  haptic: HapticKind | null;
  /** 흔들림 (dir = 방향 킥의 조준 방향, 다른 종류는 0) */
  shakes: { kind: ShakeKind; dir: number }[];
  hitFlash: boolean;
  imprisonFade: boolean;
  rescueRim: boolean;
  /** 괴물 화면 익명 상태 칸: 새로 생긴 칸만 짧게 펄스 (Hud.pulseAnon) */
  anonPulse: boolean;
  /** 내가 감옥 문을 열었다 (ALERT_RESCUED 대신 '문을 열었다.') */
  rescuer: boolean;
  banners: JuiceBanner[];
}

/** 한 스냅샷의 손맛 계획 (stale 스냅샷에는 부르지 않는다 — 지난 일의 소리 · 진동은 내지 않는다) */
export function snapshotJuice(p: JuiceInput): JuicePlan {
  const mon = p.role === 'monster';
  const V = JUICE_VOL;
  const plan: JuicePlan = {
    sounds: [],
    haptic: null,
    shakes: [],
    hitFlash: false,
    imprisonFade: false,
    rescueRim: false,
    anonPulse: false,
    rescuer: false,
    banners: [],
  };
  const play = (name: SfxName, vol: number): void => {
    const s = plan.sounds.find((x) => x.name === name);
    if (s) s.vol = Math.max(s.vol, vol);
    else plan.sounds.push({ name, vol });
  };
  const buzz = (k: HapticKind): void => {
    if (plan.haptic === null || HAPTIC_RANK[k] > HAPTIC_RANK[plan.haptic]) plan.haptic = k;
  };
  const banner = (key: keyof typeof JUICE_BANNER, text: string): void => {
    if (!plan.banners.some((b) => b.text === text)) plan.banners.push({ text, ...JUICE_BANNER[key] });
  };
  let mates = 0;
  /** 괴물이 이 스냅샷에 가둔 수 (imprisoned 이벤트 수 — 누구인지 · 어디인지는 쓰지 않는다) */
  let caught = 0;
  let freed = false;
  for (const ev of p.events) {
    switch (ev.k) {
      case 'attackHit':
        play('swing', mon ? V.swingMonster : V.swingSurvivor);
        if (mon && ev.hits > 0) {
          play('hit', V.hitMonster);
          play('thud', ev.hits >= 2 ? V.thudMulti : V.thud);
          plan.shakes.push({ kind: 'kick', dir: ev.dir });
          if (ev.hits >= 2) plan.shakes.push({ kind: 'strike', dir: 0 });
          buzz('strike');
        }
        break;
      case 'hit':
        if (mon) break;
        if (ev.you) {
          play('hit', V.hitMe);
          plan.shakes.push({ kind: 'hitMe', dir: 0 });
          plan.hitFlash = true;
          buzz('hit');
        } else play('hit', V.hitMate);
        break;
      case 'imprisoned':
        if (mon) {
          play('jail', V.jailMonster);
          plan.anonPulse = true;
          buzz('capture');
          caught += 1;
        } else if (ev.you) {
          play('jail', V.jailMe);
          plan.imprisonFade = true;
          buzz('jailed');
          banner('jailedMe', UI_TEXT.jailedMe);
        } else {
          play('jail', V.jailMate);
          mates += 1;
        }
        break;
      case 'rescued':
        if (mon) {
          play('alarm', V.alarm);
          plan.anonPulse = true;
        } else {
          play('rescue', V.rescue);
          plan.rescueRim = true;
          freed = true;
          if (ev.you) {
            plan.rescuer = true;
            buzz('rescue');
          }
        }
        break;
      case 'dash':
        if (!mon) play('dash', V.dashSurvivor);
        break;
      case 'stunned':
        if (mon) {
          plan.shakes.push({ kind: 'stunMe', dir: 0 });
          buzz('stunned');
        }
        break;
      default:
        break;
    }
  }
  // 괴물이 가둔 배너: 한 스냅샷에 한 줄, 가둔 수가 사실과 맞게 (한 명 · n명). 역할 · 이름 · 자리는 넣지 않는다
  if (caught === 1) banner('jailedOne', UI_TEXT.jailedOne);
  else if (caught > 1) banner('jailedMany', UI_TEXT.jailedMany.replace('{n}', String(caught)));
  // 풀려난 사람이 나 (rescued.you는 문을 연 사람만 참이다 — 내 상태가 수감 → 자유로 바뀐 것으로 안다)
  if (freed && p.prevStatus === 'imprisoned' && p.status === 'free') buzz('rescue');
  // 팀원 수감 배너: 누구인지는 같은 스냅샷에서 자유 → 수감으로 바뀐 팀원으로 안다 (모르면 띄우지 않는다)
  if (mates > 0 && p.prevTeam)
    for (const t of p.team) {
      if (mates <= 0) break;
      if (!t.role || t.status !== 'imprisoned' || p.prevTeam.get(t.id) !== 'free') continue;
      banner('jailedMate', UI_TEXT.jailedMate.replace('{role}', ROLE_CARDS[t.role].name));
      mates -= 1;
    }
  if (p.nearMiss && !mon) {
    play('graze', V.graze);
    buzz('graze');
  }
  return plan;
}

/**
 * 괴물 화면 익명 상태 목록에서 새로 생긴 칸 (펄스할 칸 번호): 지난 목록보다 많아진 (상태, 수감 횟수) 짝. 목록은 심각도 순이라 칸이
 * 옮겨 가는 것은 그리지 않는다(같은 사람을 따라가는 것처럼 읽힌다). 같은 짝 칸이 여럿이면 늘어난 몫만큼 뒤쪽 칸 — 같은 짝 칸은 그림이 같다
 */
export function newAnonCells(prev: readonly AnonStatus[], next: readonly AnonStatus[]): number[] {
  const same = (a: AnonStatus, b: AnonStatus): boolean =>
    a.state === b.state && a.imprisonCount === b.imprisonCount;
  const out: number[] = [];
  next.forEach((c, i) => {
    let before = 0;
    for (const q of prev) if (same(q, c)) before += 1;
    let upTo = 0;
    for (let j = 0; j <= i; j += 1) {
      const q = next[j];
      if (q && same(q, c)) upTo += 1;
    }
    if (upTo > before) out.push(i);
  });
  return out;
}
