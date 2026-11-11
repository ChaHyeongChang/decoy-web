// 손맛 계획 (플레이테스트 반영 c, docs/playtest/c-juice.md 4장 P1 · P2 · P4 · P6 · P8 · P10 · P13): 한 스냅샷의 이벤트 → 소리 이름 · 음량 ·
// 진동 패턴 · 흔들림 · 화면 효과 · 일시 배너. 괴물 화면 반응은 이벤트 종류 · 맞은 수 · 자기 조준 방향의 함수뿐이고(역할 · 이름 · 자리 ·
// 거리와 무관), 같은 소리는 한 스냅샷에 가장 큰 음량 하나, 진동은 하나다. 효과 수명 · 화면 효과 곡선 · 익명 칸 펄스도 여기서 본다
import { describe, expect, it } from 'vitest';
import type { AnonStatus, GameEvent, SurvivorStatus } from '../../shared/src/types';
import {
  FX_LIMITS,
  FX_PRESETS,
  FxSystem,
  STRIKE_FEEL,
  strikePunch,
  type FxPen,
} from '../../client/src/art/fx';
import { UI_TEXT } from '../../client/src/data/storyText';
import { HAPTIC_PATTERNS, type HapticKind } from '../../client/src/haptics';
import {
  HAPTIC_RANK,
  JUICE_BANNER,
  JUICE_VOL,
  newAnonCells,
  snapshotJuice,
  type JuiceInput,
  type JuicePlan,
} from '../../client/src/juice';
import {
  HIT_FLASH_REDUCED,
  IMPRISON_FADE_MS,
  IMPRISON_RISE_MS,
  RESCUE_RIM,
  hitFlashLevel,
  imprisonFadeLevel,
} from '../../client/src/render/prefsFx';
import { BANNER_ICONS, BANNER_RIBBONS, TONE } from '../../client/src/ui/hudArt';

const plan = (events: GameEvent[], over: Partial<JuiceInput> = {}): JuicePlan =>
  snapshotJuice({
    role: 'runner',
    events,
    status: 'free',
    prevStatus: 'free',
    team: [],
    prevTeam: null,
    nearMiss: false,
    ...over,
  });
const mon = (events: GameEvent[], over: Partial<JuiceInput> = {}): JuicePlan =>
  plan(events, { role: 'monster', status: null, prevStatus: null, ...over });
const sounds = (p: JuicePlan): string[] => p.sounds.map((s) => `${s.name}:${s.vol}`);
const atk = (hits: number, dir = 0.4, x = 30, y = 21): GameEvent => ({ k: 'attackHit', x, y, dir, hits });

describe('괴물 빗나감 · 명중 (P1 · P2)', () => {
  it('빗나감: 바람 소리 하나뿐 — 타격음 · 쿵 · 흔들림 · 진동 없음', () => {
    const p = mon([atk(0)]);
    expect(sounds(p)).toEqual([`swing:${JUICE_VOL.swingMonster}`]);
    expect(p.shakes).toEqual([]);
    expect(p.haptic).toBeNull();
  });

  it('명중: 바람 + 타격음 + 낮은 쿵, 조준 방향 킥, 진동 [30]. 둘 이상이면 쿵을 키우고 strike 흔들림을 더한다', () => {
    const one = mon([atk(1, 1.2)]);
    expect(sounds(one)).toEqual([
      `swing:${JUICE_VOL.swingMonster}`,
      `hit:${JUICE_VOL.hitMonster}`,
      `thud:${JUICE_VOL.thud}`,
    ]);
    expect(one.shakes).toEqual([{ kind: 'kick', dir: 1.2 }]);
    expect(one.haptic).toBe('strike');
    expect(HAPTIC_PATTERNS.strike).toEqual([30]);
    const two = mon([atk(2, -0.3)]);
    expect(sounds(two)).toContain(`thud:${JUICE_VOL.thudMulti}`);
    expect(two.shakes).toEqual([
      { kind: 'kick', dir: -0.3 },
      { kind: 'strike', dir: 0 },
    ]);
  });

  it('괴물 화면 반응은 타격 자리 · 맞은 생존자와 무관하다 (같은 맞은 수면 같은 소리 · 진동, 킥 방향은 자기 조준뿐)', () => {
    const a = mon([atk(0, 0.4, 30, 21)]);
    const b = mon([atk(0, 0.4, 8.5, 33.2)]);
    expect(a).toEqual(b);
    const c = mon([atk(1, 0.4, 30, 21)]);
    const d = mon([atk(1, 0.4, 12, 3)]);
    expect(c).toEqual(d);
  });

  it('생존자 화면: 타격을 받았을 때(괴물이 보일 때만 온다) 결과와 무관하게 바람 ×0.6 — 거리 · 방향으로 바뀌지 않는다', () => {
    for (const ev of [atk(0, 0.1, 30, 21), atk(1, 2.8, 5, 5)]) {
      const p = plan([ev]);
      expect(p.sounds[0]).toEqual({ name: 'swing', vol: JUICE_VOL.swingSurvivor });
      expect(p.shakes).toEqual([]);
    }
    expect(JUICE_VOL.swingSurvivor).toBe(0.6);
  });
});

describe('피격 (P4): 같은 소리는 한 스냅샷에 가장 큰 음량 하나', () => {
  it('동료 피격(0.4)이 먼저 와도 내 피격음은 1.0으로 한 번 (예전: 0.4가 나고 1.0은 60ms 간격 검사에 버려졌다)', () => {
    const mate: GameEvent = { k: 'hit', you: false, x: 31, y: 21 };
    const me: GameEvent = { k: 'hit', you: true, x: 31.5, y: 21 };
    for (const events of [
      [mate, me],
      [me, mate],
    ]) {
      const p = plan(events);
      expect(p.sounds.filter((s) => s.name === 'hit')).toEqual([{ name: 'hit', vol: JUICE_VOL.hitMe }]);
      expect(p.hitFlash).toBe(true);
      expect(p.haptic).toBe('hit');
      expect(p.shakes).toEqual([{ kind: 'hitMe', dir: 0 }]);
    }
    expect(sounds(plan([mate]))).toEqual([`hit:${JUICE_VOL.hitMate}`]);
    expect(HAPTIC_PATTERNS.hit).toEqual([70]);
  });
});

describe('수감 (P6)', () => {
  it('내 수감: 철창 1.0 · 암전 · 진동 [40,60,120]이 같은 스냅샷 피격 [70]을 이긴다 · 위험 톤 배너', () => {
    const p = plan([
      { k: 'hit', you: true, x: 31, y: 21 },
      { k: 'imprisoned', you: true },
    ]);
    expect(sounds(p)).toEqual([`hit:${JUICE_VOL.hitMe}`, `jail:${JUICE_VOL.jailMe}`]);
    expect(p.hitFlash && p.imprisonFade).toBe(true);
    expect(p.haptic).toBe('jailed');
    expect(HAPTIC_PATTERNS.jailed).toEqual([40, 60, 120]);
    expect(p.banners).toEqual([{ text: UI_TEXT.jailedMe, ...JUICE_BANNER.jailedMe }]);
  });

  it('동료 수감: 철창 0.5 + "{역할}가 붙잡혔다." — 누구인지는 같은 스냅샷의 자유 → 수감 팀원으로 안다 (모르면 배너 없음)', () => {
    const prevTeam = new Map<string, SurvivorStatus>([
      ['a', 'free'],
      ['b', 'free'],
    ]);
    const team = [
      { id: 'a', role: 'guard' as const, status: 'imprisoned' as const },
      { id: 'b', role: 'scout' as const, status: 'free' as const },
    ];
    const p = plan([{ k: 'imprisoned', you: false }], { team, prevTeam });
    expect(sounds(p)).toEqual([`jail:${JUICE_VOL.jailMate}`]);
    expect(p.banners).toEqual([{ text: '가드가 붙잡혔다.', ...JUICE_BANNER.jailedMate }]);
    expect(p.haptic).toBeNull();
    expect(plan([{ k: 'imprisoned', you: false }], { team, prevTeam: null }).banners).toEqual([]);
    // 이미 수감 중이던 팀원은 고르지 않는다
    const already = new Map<string, SurvivorStatus>([['a', 'imprisoned']]);
    expect(plan([{ k: 'imprisoned', you: false }], { team, prevTeam: already }).banners).toEqual([]);
  });

  it('괴물 화면: 철창 0.8 · 익명 칸 펄스 · 진동 [30,40,60](명중 대신) · "한 명을 가뒀다." — 역할 · 이름 · 자리 없음', () => {
    const p = mon([atk(1), { k: 'imprisoned', you: false }]);
    expect(sounds(p)).toContain(`jail:${JUICE_VOL.jailMonster}`);
    expect(p.anonPulse).toBe(true);
    expect(p.haptic).toBe('capture');
    expect(HAPTIC_PATTERNS.capture).toEqual([30, 40, 60]);
    expect(p.banners).toEqual([{ text: UI_TEXT.jailedOne, ...JUICE_BANNER.jailedOne }]);
    // 팀 정보를 넣어도(괴물에게는 원래 없다) 괴물 계획은 같다 — 역할 이름이 배너에 들어갈 길이 없다
    const withTeam = mon([atk(1), { k: 'imprisoned', you: false }], {
      team: [{ id: 'x', role: 'guard', status: 'imprisoned' }],
      prevTeam: new Map([['x', 'free']]),
    });
    expect(withTeam).toEqual(p);
    for (const b of p.banners)
      for (const name of ['러너', '가드', '스카우트']) expect(b.text).not.toContain(name);
    // 둘이 한 번에 갇혀도 배너는 한 줄 (같은 문구)
    expect(
      mon([atk(2), { k: 'imprisoned', you: false }, { k: 'imprisoned', you: false }]).banners,
    ).toHaveLength(1);
  });
});

describe('구조 완료 (P8)', () => {
  it('문을 연 사람: 화음 · 청록 가장자리 · 진동 [25,50,25] · 구조자 배너 표시', () => {
    const p = plan([{ k: 'rescued', you: true }]);
    expect(sounds(p)).toEqual([`rescue:${JUICE_VOL.rescue}`]);
    expect(p.rescueRim && p.rescuer).toBe(true);
    expect(p.haptic).toBe('rescue');
    expect(HAPTIC_PATTERNS.rescue).toEqual([25, 50, 25]);
    expect(UI_TEXT.rescuedByMe).toBe('문을 열었다.');
  });

  it('풀려난 나: 내 상태가 수감 → 자유면 진동, 다른 팀원은 화음 · 가장자리만', () => {
    const freed = plan([{ k: 'rescued', you: false }], { prevStatus: 'imprisoned', status: 'free' });
    expect(freed.haptic).toBe('rescue');
    expect(freed.rescuer).toBe(false);
    const other = plan([{ k: 'rescued', you: false }]);
    expect(other.haptic).toBeNull();
    expect(other.rescueRim).toBe(true);
  });

  it('괴물 화면: 경고 두 음 + 익명 칸 펄스뿐 — 가장자리 · 배너(기존 알림이 따로 온다) · 진동 없음', () => {
    const p = mon([{ k: 'rescued', you: false }]);
    expect(sounds(p)).toEqual([`alarm:${JUICE_VOL.alarm}`]);
    expect(p.anonPulse).toBe(true);
    expect(p.rescueRim || p.rescuer).toBe(false);
    expect(p.banners).toEqual([]);
    expect(p.haptic).toBeNull();
  });
});

describe('돌진 · 기절 · 아슬아슬 (P10 · P13 · 5장)', () => {
  it('생존자는 dash 이벤트에 ×0.8, 괴물은 이벤트로 내지 않는다 (누른 순간 이미 냈다)', () => {
    const ev: GameEvent = { k: 'dash', x: 30, y: 21, dir: 0 };
    expect(sounds(plan([ev]))).toEqual([`dash:${JUICE_VOL.dashSurvivor}`]);
    expect(mon([ev]).sounds).toEqual([]);
  });

  it('괴물 기절: stunMe 흔들림 + 진동 [90]', () => {
    const p = mon([{ k: 'stunned' }]);
    expect(p.shakes).toEqual([{ kind: 'stunMe', dir: 0 }]);
    expect(p.haptic).toBe('stunned');
    expect(HAPTIC_PATTERNS.stunned).toEqual([90]);
  });

  it('아슬아슬: 휙 0.6 + 진동 [15] — 흔들림 · 화면 번쩍임 없음, 괴물 역할이면 무시', () => {
    const p = plan([atk(0)], { nearMiss: true });
    expect(sounds(p)).toEqual([`swing:${JUICE_VOL.swingSurvivor}`, `graze:${JUICE_VOL.graze}`]);
    expect(p.haptic).toBe('graze');
    expect(HAPTIC_PATTERNS.graze).toEqual([15]);
    expect(p.shakes).toEqual([]);
    expect(p.hitFlash || p.rescueRim).toBe(false);
    expect(mon([atk(0)], { nearMiss: true })).toEqual(mon([atk(0)]));
  });

  it('진동 고르기: 패턴마다 순위가 있고, 한 스냅샷에 하나', () => {
    const kinds = Object.keys(HAPTIC_PATTERNS) as HapticKind[];
    for (const k of kinds) expect(HAPTIC_RANK[k]).toBeTypeOf('number');
    expect(HAPTIC_RANK.jailed).toBeGreaterThan(HAPTIC_RANK.hit);
    expect(HAPTIC_RANK.capture).toBeGreaterThan(HAPTIC_RANK.strike);
    expect(HAPTIC_RANK.hit).toBeGreaterThan(HAPTIC_RANK.graze);
    for (const p of Object.values(HAPTIC_PATTERNS)) for (const ms of p) expect(ms).toBeGreaterThan(0);
  });

  it('손맛 배너의 톤 · 아이콘 조합과 알림 줄 리본은 HUD 아틀라스에 구워져 있다 (없으면 아이콘 · 리본이 빠진다)', () => {
    for (const b of Object.values(JUICE_BANNER)) {
      const color = TONE[b.tone].text;
      expect(
        BANNER_ICONS.some(([id, c]) => id === b.icon && c === color),
        `${b.tone}:${b.icon}`,
      ).toBe(true);
      expect(
        BANNER_RIBBONS.some(([t, row]) => t === b.tone && row),
        `rb:${b.tone}`,
      ).toBe(true);
    }
  });
});

describe('효과 수명 · 모양 (fx.ts)', () => {
  it('새 이벤트 효과(명중 호 · 빗나간 호 · 아슬아슬 · 풀려남)도 0.4초 이하, 명중 호 0.18 · 빗나간 호 0.2 · 아슬아슬 0.3 · 풀려남 0.35', () => {
    for (const k of ['slashHit', 'slashMiss', 'graze', 'release'] as const)
      expect(FX_PRESETS[k].life).toBeLessThanOrEqual(FX_LIMITS.eventLifeMaxS);
    expect(FX_PRESETS.slashHit.life).toBeLessThanOrEqual(0.18);
    expect(FX_PRESETS.slashMiss.life).toBeLessThanOrEqual(0.2);
    expect(FX_PRESETS.slashMiss.alpha).toBe(0.5);
    expect(FX_PRESETS.graze.life).toBe(0.3);
  });

  /** 그린 선 굵기 · 색 기록 펜 */
  function pen(): { pen: FxPen; lines: { w: number; color: number; a: number }[] } {
    const lines: { w: number; color: number; a: number }[] = [];
    const noop = (): void => undefined;
    const p = {
      lineStyle: (w: number, color: number, a: number) => lines.push({ w, color, a }),
      fillStyle: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      strokePath: noop,
      fillPath: noop,
      closePath: noop,
      arc: noop,
    } as unknown as FxPen;
    return { pen: p, lines };
  }

  it('명중 · 빗나감 호는 색 말고 굵기 · 겹수로도 갈린다 (명중 두 겹 굵게, 빗나감 한 줄 가늘게)', () => {
    const hit = new FxSystem(1, 40);
    hit.slash(0, 0, 0, Math.PI / 2, 1.2, 0, null, false, 'slashHit');
    const h = pen();
    hit.draw(h.pen, 0.1, 32);
    const miss = new FxSystem(1, 40);
    miss.slash(0, 0, 0, Math.PI / 2, 1.2, 0, null, false, 'slashMiss');
    const m = pen();
    miss.draw(m.pen, 0.1, 32);
    expect(h.lines).toHaveLength(2);
    expect(m.lines).toHaveLength(1);
    expect(Math.min(...h.lines.map((l) => l.w))).toBeGreaterThan(Math.max(...m.lines.map((l) => l.w)));
    expect(Math.max(...m.lines.map((l) => l.a))).toBeLessThanOrEqual(0.5);
  });

  it('아슬아슬 효과는 흰 이중 호(빨강 없음)이고 몸을 따라 옮겨진다 · 0.3초 뒤 없다', () => {
    const fx = new FxSystem(1, 40);
    fx.graze(5, 5, 0.3, Math.PI, 0);
    fx.anchor('graze', 6, 5);
    const g = pen();
    fx.draw(g.pen, 0.15, 32);
    expect(g.lines.length).toBe(2);
    for (const l of g.lines) expect(l.color).toBe(0xffffff);
    fx.update(0.31, new Set());
    expect(fx.count).toBe(0);
  });

  it('명중 펀치: 1 → 1 + punch → 1 (punchMs), 그 밖은 1', () => {
    expect(strikePunch(-1)).toBe(1);
    expect(strikePunch(0)).toBe(1);
    expect(strikePunch(STRIKE_FEEL.punchMs / 2)).toBeCloseTo(1 + STRIKE_FEEL.punch, 9);
    expect(strikePunch(STRIKE_FEEL.punchMs)).toBe(1);
    expect(STRIKE_FEEL.punchMs).toBeLessThanOrEqual(FX_LIMITS.eventLifeMaxS * 1000);
  });
});

describe('화면 효과 곡선 (prefsFx)', () => {
  it('수감 암전: 60~80ms에 걸쳐 오른 뒤 0.5초에 걸쳐 밝아진다 (맞은 순간 바로 검정이 아니다)', () => {
    expect(IMPRISON_RISE_MS).toBeGreaterThanOrEqual(60);
    expect(IMPRISON_RISE_MS).toBeLessThanOrEqual(80);
    expect(imprisonFadeLevel(0)).toBe(0);
    expect(imprisonFadeLevel(IMPRISON_RISE_MS / 2)).toBeCloseTo(0.5, 9);
    expect(imprisonFadeLevel(IMPRISON_RISE_MS)).toBe(1);
    expect(imprisonFadeLevel(IMPRISON_RISE_MS + IMPRISON_FADE_MS)).toBe(0);
    expect(imprisonFadeLevel(-5)).toBe(0);
    expect(imprisonFadeLevel(Number.NaN)).toBe(0);
  });

  it('구조 완료 가장자리: 0.3초, 청록, 번쩍임 줄이기면 0.35배 · 60ms 상승 (피격 가장자리와 같은 식)', () => {
    expect(RESCUE_RIM.ms).toBe(300);
    expect(RESCUE_RIM.color).toBe(0x22d3ee);
    expect(hitFlashLevel(0, RESCUE_RIM.ms, false)).toBe(1);
    expect(hitFlashLevel(0, RESCUE_RIM.ms, true)).toBe(0);
    expect(hitFlashLevel(HIT_FLASH_REDUCED.riseMs, RESCUE_RIM.ms, true)).toBeCloseTo(
      HIT_FLASH_REDUCED.peak,
      9,
    );
    expect(hitFlashLevel(RESCUE_RIM.ms, RESCUE_RIM.ms, false)).toBe(0);
  });
});

describe('괴물 화면 익명 칸 펄스 (newAnonCells)', () => {
  const st = (state: AnonStatus['state'], imprisonCount = 0): AnonStatus => ({ state, imprisonCount });

  it('새로 생긴 (상태, 수감 횟수) 칸만 — 칸이 옮겨 간 것은 펄스하지 않는다', () => {
    const before = [st('injured'), st('normal'), st('normal')];
    const after = [st('imprisoned', 1), st('normal'), st('normal')];
    expect(newAnonCells(before, after)).toEqual([0]);
    // 심각도 순 정렬로 자리만 바뀐 칸은 새 칸이 아니다
    const b2 = [st('imprisoned', 1), st('normal'), st('normal')];
    const a2 = [st('imprisoned', 1), st('imprisoned', 1), st('normal')];
    expect(newAnonCells(b2, a2)).toEqual([1]);
    expect(newAnonCells(after, after)).toEqual([]);
  });

  it('구조 완료: 풀려난 칸 (수감 → 정상 · 수감 횟수 그대로)', () => {
    const before = [st('imprisoned', 1), st('normal'), st('normal')];
    const after = [st('normal', 1), st('normal'), st('normal')];
    expect(newAnonCells(before, after)).toEqual([0]);
  });
});
