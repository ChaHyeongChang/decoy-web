// HUD (M10c, VISUAL_SPEC 8장): 행동 칸 값(M11 터치 버튼과 공유) · 거점 게이지 · 타이머 · 팀 카드 · 상태 표시(색만으로 구분하지 않기) ·
// 글자 대비 · 9조각 배치 · 아틀라스 목록 · 조작 안내 줄 나누기 · 거점 진행 숫자(플레이테스트 a-7: 값 · 프레임 · 숫자 칸)
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { validateBalance } from '../../shared/src/balance';
import { createMoveState } from '../../shared/src/movement';
import { RESCUE_POINT } from '../../shared/src/map';
import type { PointView, Snapshot, SurvivorView } from '../../shared/src/types';
import { CONTROLS } from '../../client/src/data/storyText';
import { TEXT_PAIRS, UI, WARN, WARN_TEXT, contrastRatio } from '../../client/src/art/palette';
import {
  GAUGE_ICON,
  GAUGE_STATES,
  HC,
  HUD_TEXT_PAIRS,
  PCT_CELL,
  PCT_FOR_MONSTER,
  PCT_TONE,
  STATUS_LOOK,
  TICKS,
  TIMER_LOOK,
  TONE,
  actionSlots,
  fmtTime,
  gaugeColor,
  gaugeFrameColor,
  gaugeShowsProgress,
  gaugeState,
  hudSpecs,
  litTicks,
  packShelves,
  parseControl,
  pctFrames,
  pctShown,
  pctTone,
  pctWidth,
  pointOf,
  pointPercent,
  sliceSpans,
  statusKey,
  teamCards,
  tickAngle,
  slotIconFrame,
  timerView,
  type ActionSlot,
} from '../../client/src/ui/hudArt';
import {
  GAUGE_IDS,
  GAUGE_ROW,
  HUD,
  HUD_BAND,
  MAP_RECT,
  TOUCH_UI,
  VIEW_W,
  applyLayout,
  layoutFor,
  pcLayout,
} from '../../client/src/ui/layout';

afterEach(() => applyLayout(pcLayout()));

const balance = validateBalance(JSON.parse(readFileSync('config/balance.json', 'utf8')));

function snapshot(role: Snapshot['you']['role'], patch: (s: Snapshot) => void = () => {}): Snapshot {
  const s: Snapshot = {
    tick: 0,
    st: 0,
    ack: 0,
    you: {
      id: 'me',
      role,
      move: createMoveState({ x: 10, y: 10 }, 0),
      surv:
        role === 'monster'
          ? null
          : {
              status: 'free',
              hp: 2,
              imprisonCount: 0,
              protectLeft: 0,
              abilityCd: 0,
              abilityActive: 0,
              rescue: 0,
              spotted: false,
            },
      mon:
        role === 'monster'
          ? {
              attackCd: 0,
              windup: 0,
              dashCd: 0,
              roarCd: 0,
              mode: 'search',
              blend: 0,
              camp: 0,
              blockWarn: null,
            }
          : null,
    },
    survivors: [],
    monster: null,
    marks: [],
    world: {
      timeLeft: 600,
      grace: null,
      countdown: 0,
      monsterWait: 0,
      paused: null,
      points: [],
      exits: [],
      imprisoned: 0,
      statusList: null,
    },
    events: [],
  };
  patch(s);
  return s;
}

function mate(id: string, role: SurvivorView['role'], extra: Partial<SurvivorView> = {}): SurvivorView {
  return {
    id,
    x: 0,
    y: 0,
    face: 0,
    role,
    status: 'free',
    protected: false,
    hp: 2,
    imprisonCount: 0,
    abilityCd: 0,
    rescue: 0,
    spotted: false,
    connected: true,
    ...extra,
  };
}

const byId = (list: ActionSlot[], id: ActionSlot['id']): ActionSlot => {
  const s = list.find((x) => x.id === id);
  if (!s) throw new Error(`칸 없음: ${id}`);
  return s;
};

describe('행동 칸 actionSlots (순수 함수, M11 터치 버튼과 공유)', () => {
  it('생존자: 능력(Space) · 구조(E) 두 칸, 지금 문구 그대로', () => {
    const slots = actionSlots(snapshot('runner'), balance, 'runner');
    expect(slots.map((s) => [s.id, s.key, s.label])).toEqual([
      ['ability', 'Space', '질주'],
      ['rescue', 'E', '구조'],
    ]);
    expect(actionSlots(snapshot('guard'), balance, 'guard')[0]?.label).toBe('밀치기');
    expect(actionSlots(snapshot('scout'), balance, 'scout')[0]?.label).toBe('탐지');
    const a = byId(slots, 'ability');
    expect([a.state, a.fill, a.cd, a.accent, a.icon]).toEqual(['ready', 1, 0, 'runner', 'sprint']);
  });

  it('나올 수 있는 모든 행동 칸 아이콘(역할 · 탐색/추적 · 네 상태)이 아틀라스에 구워져 있다', () => {
    const names = new Set(hudSpecs().map((x) => x.name));
    const cases: [Snapshot['you']['role'], Snapshot][] = [
      ['runner', snapshot('runner')],
      ['guard', snapshot('guard')],
      ['scout', snapshot('scout')],
      ['monster', snapshot('monster')],
      [
        'monster',
        snapshot('monster', (x) => {
          if (x.you.mon) x.you.mon.mode = 'hunt';
        }),
      ],
    ];
    const states: ActionSlot['state'][] = ['ready', 'cooldown', 'active', 'blocked'];
    const missing: string[] = [];
    let checked = 0;
    for (const [role, snap] of cases) {
      for (const slot of actionSlots(snap, balance, role)) {
        for (const state of states) {
          const frame = slotIconFrame({ ...slot, state });
          checked += 1;
          if (!names.has(frame)) missing.push(`${role} ${slot.id} ${slot.icon} ${state} → ${frame}`);
        }
      }
    }
    expect(checked).toBe((2 * 3 + 4 * 2) * states.length);
    expect(missing).toEqual([]);
  });

  it('쿨타임 비율 = 지난 시간 / 쿨타임, 남은 초는 그대로', () => {
    const cd = balance.roles.guard.cooldown;
    const s = snapshot('guard', (x) => {
      if (x.you.surv) x.you.surv.abilityCd = cd / 4;
    });
    const a = byId(actionSlots(s, balance, 'guard'), 'ability');
    expect(a.state).toBe('cooldown');
    expect(a.fill).toBeCloseTo(0.75, 9);
    expect(a.cd).toBeCloseTo(cd / 4, 9);
    expect(litTicks(a.fill)).toBe(18);
  });

  it('효과 중 · 사용 불가 조건 (수감 · 사망 · 탈출 · 판 멈춤)', () => {
    const active = snapshot('runner', (x) => {
      if (x.you.surv) {
        x.you.surv.abilityActive = 2;
        x.you.surv.abilityCd = 19;
      }
    });
    expect(byId(actionSlots(active, balance, 'runner'), 'ability').state).toBe('active');
    for (const status of ['imprisoned', 'dead', 'escaped'] as const) {
      const s = snapshot('scout', (x) => {
        if (x.you.surv) x.you.surv.status = status;
      });
      const a = byId(actionSlots(s, balance, 'scout'), 'ability');
      expect([status, a.state, a.fill]).toEqual([status, 'blocked', 0]);
    }
    const paused = snapshot('scout', (x) => {
      x.world.paused = 20;
    });
    expect(actionSlots(paused, balance, 'scout').map((s) => s.state)).toEqual(['blocked', 'blocked']);
  });

  it('구조: 팀원이 수감 중이고 구조 구역 안일 때만 ready, 구조 중이면 진행이 링 채움', () => {
    const inZone = (x: Snapshot): void => {
      x.you.move.x = RESCUE_POINT.x;
      x.you.move.y = RESCUE_POINT.y + balance.prison.rescueRadius * 0.9;
    };
    expect(byId(actionSlots(snapshot('runner', inZone), balance, 'runner'), 'rescue').state).toBe('blocked');
    const jailed = (x: Snapshot): void => {
      inZone(x);
      x.survivors = [mate('g', 'guard', { status: 'imprisoned' })];
    };
    expect(byId(actionSlots(snapshot('runner', jailed), balance, 'runner'), 'rescue').state).toBe('ready');
    const far = snapshot('runner', (x) => {
      jailed(x);
      x.you.move.y = RESCUE_POINT.y + balance.prison.rescueRadius + 0.2;
    });
    expect(byId(actionSlots(far, balance, 'runner'), 'rescue').state).toBe('blocked');
    const doing = snapshot('runner', (x) => {
      jailed(x);
      if (x.you.surv) x.you.surv.rescue = 0.45;
    });
    const r = byId(actionSlots(doing, balance, 'runner'), 'rescue');
    expect([r.state, r.fill, r.label]).toEqual(['active', 0.45, '구조 중 45%']);
  });

  it('괴물: 공격 · 돌진 · 포효 · 시야 모드 네 칸과 키캡', () => {
    const slots = actionSlots(snapshot('monster'), balance, 'monster');
    expect(slots.map((s) => [s.id, s.key, s.label, s.state])).toEqual([
      ['attack', '좌클릭', '공격', 'ready'],
      ['dash', 'Shift', '돌진', 'ready'],
      ['roar', 'Q', '포효', 'ready'],
      ['mode', '우클릭', '탐색', 'ready'],
    ]);
    const s = snapshot('monster', (x) => {
      if (!x.you.mon) return;
      x.you.mon.dashCd = balance.monster.dash.cooldown / 2;
      x.you.mon.roarCd = balance.monster.roar.cooldown;
      x.you.mon.mode = 'hunt';
    });
    const list = actionSlots(s, balance, 'monster');
    expect(byId(list, 'dash').fill).toBeCloseTo(0.5, 9);
    expect(byId(list, 'roar').fill).toBe(0);
    expect(byId(list, 'roar').state).toBe('cooldown');
    expect([byId(list, 'mode').state, byId(list, 'mode').label, byId(list, 'mode').icon]).toEqual([
      'active',
      '추적',
      'visionHunt',
    ]);
  });

  it('괴물 사용 불가: 시작 대기 · 기절 · 돌진 중 · 공격 준비 중 (기절만 시야 전환도 막는다)', () => {
    const cases: [string, (x: Snapshot) => void, string[]][] = [
      ['대기', (x) => void (x.you.move.frozen = 3), ['blocked', 'blocked', 'blocked', 'ready']],
      ['기절', (x) => void (x.you.move.stun = 1), ['blocked', 'blocked', 'blocked', 'blocked']],
      ['돌진', (x) => void (x.you.move.dash = 0.1), ['blocked', 'active', 'blocked', 'ready']],
      [
        '공격 준비',
        (x) => {
          if (x.you.mon) x.you.mon.windup = 0.2;
        },
        ['active', 'blocked', 'blocked', 'ready'],
      ],
    ];
    for (const [name, patch, want] of cases)
      expect([
        name,
        ...actionSlots(snapshot('monster', patch), balance, 'monster').map((s) => s.state),
      ]).toEqual([name, ...want]);
  });
});

describe('거점 게이지 · 타이머 · 상태 표시', () => {
  it('거점 상태: 서버 blocked = 정지, 점령 중 · 정지 · 완료 · 꺼짐은 서로 다른 칩 아이콘 (색만으로 구분하지 않기)', () => {
    expect(gaugeState('blocked')).toBe('paused');
    expect(gaugeState('capturing')).toBe('capturing');
    expect(gaugeState('off')).toBe('off');
    const icons = (['capturing', 'paused', 'done', 'off'] as const).map((s) => GAUGE_ICON[s]);
    expect(icons).toEqual(['play', 'pause', 'check', 'off']);
    expect(new Set(icons).size).toBe(icons.length);
    expect(GAUGE_ICON.idle).toBeNull();
  });

  it('꺼진 거점 (플레이테스트 b): 회색(대기 · 점령 중 · 정지 · 완료와 다른 색) + ⊘ 칩, 채움 · 진행 숫자 없음 — 아이콘은 패널 위 3:1', () => {
    const others = (['idle', 'capturing', 'paused', 'done'] as const).map(gaugeColor);
    expect(gaugeColor('off')).toBe(HC.gaugeOff);
    expect(others).not.toContain(gaugeColor('off'));
    // 틀(막대 · 배지 · 줄 판)은 꺼진 칸 색, 다른 상태의 틀과 다르다
    expect(gaugeFrameColor('off')).toBe(HC.off);
    expect((['idle', 'capturing', 'paused', 'done'] as const).map(gaugeFrameColor)).not.toContain(HC.off);
    // 진행을 보이지 않는 것은 꺼짐뿐 (멈춘 진행 · 0%는 그대로 보인다)
    expect(GAUGE_STATES.filter((st) => !gaugeShowsProgress(st))).toEqual(['off']);
    expect(contrastRatio(HC.gaugeOff, UI.panel)).toBeGreaterThanOrEqual(3);
    expect(HUD_TEXT_PAIRS.some((p) => p.fg === HC.gaugeOff && p.bg === UI.panel && p.min === 3)).toBe(true);
    // ⊘ 아이콘 · 꺼진 틀 프레임이 PC · 터치 아틀라스에 있다
    for (const touch of [false, true]) {
      if (touch) applyLayout(layoutFor(750, 369, true));
      const names = new Set(hudSpecs().map((x) => x.name));
      const want = touch ? ['grow:off', 'gicon:off'] : ['gbar:off', 'dia:off', 'chip:off'];
      for (const n of want) expect(names.has(n), `${touch} ${n}`).toBe(true);
    }
  });

  it('타이머: 최후의 30초 > 1분 미만 > 보통, 모드마다 아이콘도 다르다', () => {
    expect(fmtTime(720)).toBe('12:00');
    expect(fmtTime(59.2)).toBe('1:00');
    expect(fmtTime(-3)).toBe('0:00');
    expect(timerView({ timeLeft: 300, grace: null })).toEqual({ mode: 'normal', text: '5:00' });
    expect(timerView({ timeLeft: 59.5, grace: null })).toEqual({ mode: 'low', text: '1:00' });
    expect(timerView({ timeLeft: 10, grace: 12.1 })).toEqual({ mode: 'grace', text: '0:13' });
    const icons = new Set(Object.values(TIMER_LOOK).map((l) => l.icon));
    expect(icons.size).toBe(3);
  });

  it('생존자 상태는 아이콘이 모두 다르고, 상태 이름은 지금 문구 그대로', () => {
    expect(statusKey({ status: 'free', hp: 1 }, 2)).toBe('injured');
    expect(statusKey({ status: 'free', hp: 2 }, 2)).toBe('normal');
    expect(statusKey({ status: 'free', hp: null }, 2)).toBe('normal');
    expect(statusKey({ status: 'imprisoned', hp: 2 }, 2)).toBe('imprisoned');
    const icons = Object.values(STATUS_LOOK).map((l) => l.icon);
    expect(new Set(icons).size).toBe(icons.length);
    expect(icons).not.toContain('disconnected');
  });

  it('팀 카드: 역할 순서(러너 · 가드 · 스카우트), 나 표시, 로스터 이름, 수감 · 사망이면 체력 칸 0', () => {
    const s = snapshot('guard', (x) => {
      x.you.id = 'g';
      x.survivors = [
        mate('s', 'scout', { status: 'dead', hp: 2 }),
        mate('r', 'runner', { hp: 1, imprisonCount: 1, abilityCd: 5, connected: false }),
      ];
    });
    const roster = [
      { id: 'g', name: '가', role: 'guard' as const, bot: false },
      { id: 'r', name: '나나', role: 'runner' as const, bot: false },
      { id: 's', name: '다', role: 'scout' as const, bot: false },
    ];
    const cards = teamCards(s, roster, balance);
    expect(cards.map((c) => [c.role, c.me, c.name, c.status, c.hp, c.jail, c.cd, c.connected])).toEqual([
      ['runner', false, '나나', 'injured', 1, 1, 5, false],
      ['guard', true, '가', 'normal', 2, 0, 0, true],
      ['scout', false, '다', 'dead', 0, 0, 0, true],
    ]);
  });

  it('눈금 링: 12시에서 시계 방향, 채움 → 켜진 눈금 수', () => {
    expect(tickAngle(0)).toBeCloseTo(-Math.PI / 2 + Math.PI / TICKS, 9);
    expect(tickAngle(TICKS / 4)).toBeGreaterThan(0 - 1e-9);
    expect([litTicks(0), litTicks(0.5), litTicks(0.999), litTicks(1), litTicks(2)]).toEqual([
      0, 12, 23, 24, 24,
    ]);
  });
});

describe('거점 진행 숫자 (플레이테스트 a-7)', () => {
  const point = (progress: number, state: PointView['state'] = 'capturing'): PointView => ({
    id: 'A',
    progress,
    state,
  });

  it('거점 진행 숫자: 내림 · 완료 전 99까지 · 완료만 100 · 0 미만 · 1 초과는 자른다', () => {
    const cases: [number, PointView['state'], number][] = [
      [0, 'idle', 0],
      [0, 'capturing', 0],
      [0.0099, 'capturing', 0],
      [0.01, 'capturing', 1],
      [0.29, 'capturing', 29], // 0.29 × 100 = 28.999…(부동소수)여도 29
      [0.57, 'capturing', 57],
      [0.6299, 'capturing', 62],
      [0.63, 'blocked', 63],
      [0.999, 'capturing', 99],
      [0.9996, 'capturing', 99], // 완료 직전 최댓값 (1 − 1/2400, 소수 4자리)
      [1, 'capturing', 99], // 진행이 1이어도 서버가 완료라고 하기 전에는 99
      [1, 'idle', 99],
      [1, 'done', 100],
      [0.4, 'done', 100], // 완료는 진행 값과 무관하게 100
      [-0.2, 'capturing', 0],
      [1.7, 'blocked', 99],
    ];
    for (const [progress, state, want] of cases)
      expect([progress, state, pointPercent(point(progress, state))]).toEqual([progress, state, want]);
    // 서버가 보내는 값(소수 4자리) 전부: 내림과 같고 단조 증가
    let last = 0;
    for (let i = 0; i <= 10000; i += 1) {
      const n = pointPercent(point(i / 10000));
      expect(n, `${i}`).toBe(Math.min(99, Math.floor(i / 100)));
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });

  it('거점 진행 숫자 함수는 스냅샷 거점 한 칸의 진행 · 상태만 받는다 — 역할 · 시야 · 다른 칸 자리가 없다 (타입 검사)', () => {
    // 실행하지 않는 함수: tsc -p tests가 @ts-expect-error 줄에 타입 에러가 있는지(= 인자 자리가 없는지) 확인한다
    const typeOnly = (f: typeof pointPercent, p: PointView, snap: Snapshot): void => {
      f(p);
      f({ progress: 0.5, state: 'capturing' });
      // @ts-expect-error 역할(받는 사람)을 넘길 자리가 없다
      f(p, 'monster');
      // @ts-expect-error 스냅샷 전체(나 · 다른 사람 · 시야)를 받지 않는다
      f(snap);
      // @ts-expect-error 진행 없이 상태만으로는 부를 수 없다
      f({ state: 'capturing' });
    };
    expect(typeOnly.length).toBe(3);
    expect(pointPercent.length).toBe(1);
    // 같은 거점 값이면 누가 보든 같은 숫자다: 다른 칸(id)이 달라도 값은 진행 · 상태에서만 나온다
    for (const [progress, state] of [
      [0.4321, 'capturing'],
      [0.4321, 'blocked'],
      [0.4321, 'idle'],
      [1, 'done'],
    ] as const)
      expect(pointPercent({ id: 'B', progress, state } as PointView)).toBe(pointPercent({ progress, state }));
  });

  it('게이지는 거점 값을 순서 번호가 아니라 id로 찾는다 — 스냅샷 순서가 게이지 순서(GAUGE_IDS)와 달라도 줄마다 제 거점 값', () => {
    expect(GAUGE_IDS).toEqual(['A', 'B', 'C']);
    const a: PointView = { id: 'A', progress: 0.12, state: 'capturing' };
    const b: PointView = { id: 'B', progress: 0.87, state: 'blocked' };
    const c: PointView = { id: 'C', progress: 0.5, state: 'off' };
    for (const points of [
      [a, b, c],
      [c, b, a],
      [b, c, a],
      [c, a, b],
    ]) {
      const shown = GAUGE_IDS.map((id) => {
        const p = pointOf(points, id);
        return p ? `${p.id}:${pointPercent(p)}` : '';
      });
      expect(shown, points.map((p) => p.id).join('')).toEqual(['A:12', 'B:87', 'C:50']);
    }
    // 거점이 빠진 스냅샷이면 그 줄만 비고 다른 거점 값으로 채우지 않는다
    expect(GAUGE_IDS.map((id) => pointOf([b, a], id)?.id ?? '')).toEqual(['A', 'B', '']);
    // 스냅샷에 없는 거점은 그리지 않는다 (순서 번호로 짝지으면 다른 거점 값이 나온다)
    expect(pointOf([b], 'A')).toBeUndefined();
    expect(pointOf([], 'B')).toBeUndefined();
  });

  it('괴물 화면에는 진행 숫자를 보이지 않는다 (플레이테스트 b — 1% 단위로 거점 안 사람 수가 읽힌다), 생존자 화면은 그대로', () => {
    expect(PCT_FOR_MONSTER).toBe(false);
    expect(pctShown(false)).toBe(true);
    expect(pctShown(true)).toBe(false);
  });

  it('숫자 색: 정지 = 주황, 0% = 흐린 글자, 그 밖 = 본문 (상태는 칩 아이콘이 가른다)', () => {
    expect(pctTone('paused', 0)).toBe('warn');
    expect(pctTone('paused', 40)).toBe('warn');
    expect(pctTone('idle', 0)).toBe('dim');
    expect(pctTone('capturing', 0)).toBe('dim');
    expect(pctTone('idle', 40)).toBe('text');
    expect(pctTone('capturing', 99)).toBe('text');
    expect(pctTone('done', 100)).toBe('text');
    expect(PCT_TONE).toEqual({ text: UI.text, warn: WARN, dim: UI.textDim });
  });

  /** 나올 수 있는 (상태, 숫자) 전부의 프레임 이름 */
  const reachable = (): { label: string; frames: readonly [string, string] }[] => {
    const out: { label: string; frames: readonly [string, string] }[] = [];
    for (const s of GAUGE_STATES)
      for (let n = 0; n <= 100; n += 1) {
        // 꺼진 거점은 숫자를 보이지 않는다
        if (!gaugeShowsProgress(s)) continue;
        // 완료는 100뿐이고 100은 완료뿐이다 (pointPercent)
        if ((s === 'done') !== (n === 100)) continue;
        out.push({ label: `${s} ${n}`, frames: pctFrames(n, pctTone(s, n)) });
      }
    return out;
  };

  it('0~100 모든 숫자의 프레임이 PC · 터치 아틀라스 목록에 있다 (한 자리 · 100은 한 장, 두 자리는 두 장)', () => {
    expect(pctFrames(7, 'text')).toEqual(['', 'pct:text:o7']);
    expect(pctFrames(63, 'warn')).toEqual(['pct:warn:t6', 'pct:warn:o3']);
    expect(pctFrames(100, 'text')).toEqual(['', 'pct:text:100']);
    expect(pctFrames(0, 'dim')).toEqual(['', 'pct:dim:o0']);
    // 같은 숫자면 같은 배열 (스냅샷마다 문자열 · 배열을 만들지 않는다)
    expect(pctFrames(63, 'text')).toBe(pctFrames(63, 'text'));
    expect(pctFrames(101, 'text')).toEqual(['', '']);
    expect(pctFrames(-1, 'text')).toEqual(['', '']);
    const all = reachable();
    expect(all.length).toBe(100 * 3 + 1);
    for (const touch of [false, true]) {
      if (touch) applyLayout(layoutFor(844, 390, true));
      expect(HUD.touch !== null).toBe(touch);
      const names = new Set(hudSpecs().map((x) => x.name));
      const missing: string[] = [];
      for (const { label, frames } of all) {
        expect(frames[1], label).not.toBe('');
        for (const f of frames) if (f !== '' && !names.has(f)) missing.push(`${touch} ${label} → ${f}`);
      }
      expect(missing).toEqual([]);
      // 굽는 숫자 프레임은 쓰는 것뿐이다: 본문 20(십의 자리 9 + 일의 자리 10 + 100%) · 주황 19 · 흐림 1
      const used = new Set(all.flatMap((a) => a.frames).filter((f) => f !== ''));
      const baked = [...names].filter((n) => n.startsWith('pct:'));
      expect(baked.sort()).toEqual([...used].sort());
      expect(baked.length).toBe(40);
    }
  });

  it('숫자 글자 크기: PC 15 논리 px · 터치 12 CSS px 이상, 터치 줄 게이지 거점 글자는 14 CSS px 이상', () => {
    expect(HUD.touch).toBeNull();
    expect(HUD.gauge.pctFont).toBeGreaterThanOrEqual(15);
    for (const [w, h] of [
      [844, 390],
      [802, 293],
      [640, 360],
      [1024, 768],
    ] as const) {
      applyLayout(layoutFor(w, h, true));
      expect(HUD.gauge.pctFont * TOUCH_UI.art, `${w}×${h}`).toBeGreaterThanOrEqual(TOUCH_UI.font.small);
      expect(HUD.gauge.letterFont * TOUCH_UI.art, `${w}×${h}`).toBeGreaterThanOrEqual(TOUCH_UI.font.main);
    }
  });

  it("숫자 칸 (PC): 게이지 전체 폭 288 그대로, 배지 · 칩 · 숫자 칸 · 막대가 겹치지 않고 '100%'가 칸에 들어간다", () => {
    const G = HUD.gauge;
    expect(G.w).toBe(288);
    expect([HUD.gaugeA.x, HUD.gaugeB.x, HUD.gaugeC.x]).toEqual([278, 580, 1340]);
    // 배지 쪽 끝에서 안쪽으로: 배지 · 칩 · 숫자 칸 · 막대
    const chip0 = G.dia + G.gap;
    const pct0 = chip0 + G.chip + G.pctGap;
    const bar0 = pct0 + G.pctW + G.pctGap;
    expect([chip0, chip0 + G.chip, pct0, pct0 + G.pctW, bar0, bar0 + G.barW]).toEqual([
      44, 68, 74, 122, 128, 288,
    ]);
    expect(bar0 + G.barW).toBe(G.w);
    // 가장 넓은 숫자 '100%'가 칸 안
    expect(pctWidth(G.pctFont)).toBeLessThanOrEqual(G.pctW);
    expect(pctWidth(G.pctFont)).toBeCloseTo((PCT_CELL.digit * 3 + PCT_CELL.pct) * G.pctFont, 9);
    // 숫자 프레임은 칸 오른쪽 끝(기준점) 왼쪽에만 있고 칸 폭을 넘지 않는다
    const pctSpecs = hudSpecs().filter((x) => x.name.startsWith('pct:'));
    expect(pctSpecs.length).toBe(40);
    for (const sp of pctSpecs) {
      if (sp.kind !== 'frame') throw new Error(`${sp.name}: 고정 크기 그림이 아니다`);
      expect(sp.x1, sp.name).toBeLessThanOrEqual(1e-9);
      expect(sp.x0, sp.name).toBeGreaterThanOrEqual(-G.pctW);
      // 위 띠(64) 안: 세로로 배지(38)보다 크지 않다
      expect(sp.y1 - sp.y0, sp.name).toBeLessThanOrEqual(G.dia);
    }
    // 십의 자리 칸과 일의 자리 칸은 맞닿고 겹치지 않는다
    const tens = pctSpecs.find((x) => x.name === 'pct:text:t6');
    const ones = pctSpecs.find((x) => x.name === 'pct:text:o3');
    if (tens?.kind !== 'frame' || ones?.kind !== 'frame') throw new Error('숫자 프레임 없음');
    expect(tens.x1).toBeCloseTo(ones.x0, 9);
  });

  it("터치 줄 게이지 한 줄: 글자 · 상태 아이콘 · '100%'가 한 줄(110 × 26)에 겹치지 않게 들어가고, 그림은 줄 위 · 아래 여백 안에만 있다", () => {
    applyLayout(layoutFor(844, 390, true));
    const G = HUD.gauge;
    const R = GAUGE_ROW;
    expect([G.w, G.rowH]).toEqual([110, 26]);
    // 왼쪽부터: 거점 글자 칸 · 상태 아이콘 · 숫자(오른쪽 맞춤)
    const letter = [R.letterX - R.letterW / 2, R.letterX + R.letterW / 2] as const;
    const icon = [R.iconX - R.icon / 2, R.iconX + R.icon / 2] as const;
    const num = [R.pctRight - pctWidth(G.pctFont), R.pctRight] as const;
    expect(letter[0]).toBeGreaterThanOrEqual(0);
    expect(icon[0]).toBeGreaterThanOrEqual(letter[1]);
    expect(num[0]).toBeGreaterThanOrEqual(icon[1]);
    expect(num[1]).toBeLessThanOrEqual(G.w);
    const specs = hudSpecs();
    const row = specs.filter((x) => /^(grow|growfill|gicon|gltr|pct):/.test(x.name));
    // 판 5(상태 — 꺼짐 포함) + 채움 2 + 상태 아이콘 4(▶ ‖ ✓ ⊘) + 거점 글자(거점 수) + 숫자 40
    expect(GAUGE_STATES.length).toBe(5);
    expect(row.length).toBe(5 + 2 + 4 + GAUGE_IDS.length + 40);
    for (const id of GAUGE_IDS) expect(row.some((x) => x.name === `gltr:${id}`)).toBe(true);
    for (const sp of row) {
      if (sp.kind !== 'frame') throw new Error(`${sp.name}: 고정 크기 그림이 아니다`);
      expect(sp.y0, sp.name).toBeGreaterThanOrEqual(R.inset);
      expect(sp.y1, sp.name).toBeLessThanOrEqual(G.rowH - R.inset);
      expect(sp.x0, sp.name).toBeGreaterThanOrEqual(0);
      expect(sp.x1, sp.name).toBeLessThanOrEqual(G.w);
    }
    // 쓰지 않는 PC 그림(막대 · 배지 · 칩)과 옛 링 게이지의 주황 눈금은 굽지 않는다
    const names = specs.map((x) => x.name);
    for (const gone of ['gbar:idle', 'gfill:neon', 'gstripe', 'dia:idle', 'chip:done', 'r:warn', 't:warn:0'])
      expect(names, gone).not.toContain(gone);
    // 맞닿은 줄끼리 그린 상자가 겹치지 않는다: hudKit이 프레임 둘레에 두는 1텍셀까지 줄 간격(기기 픽셀 정수) 안이다.
    // 기기 배율 1 · 1.5 · 2 · 2.625 · 3 × UI 크기 1~1.5 (굽는 배율 z = 그림 1단위의 기기 px)
    for (const dpr of [1, 1.5, 2, 2.625, 3])
      for (let ui = 1; ui <= 1.5001; ui += 0.05) {
        const z = TOUCH_UI.art * ui * dpr;
        const top = Math.floor(R.inset * z) - 1;
        const bottom = Math.ceil((G.rowH - R.inset) * z) + 1;
        expect(top, `위 dpr ${dpr} ui ${ui.toFixed(2)}`).toBeGreaterThanOrEqual(0);
        expect(bottom, `아래 dpr ${dpr} ui ${ui.toFixed(2)}`).toBeLessThanOrEqual(Math.round(G.rowH * z));
      }
  });
});

describe('글자 대비 (HUD에서 새로 쓰는 쌍)', () => {
  it('HUD 글자 쌍은 모두 기준 이상 (글자 4.5:1, 아이콘 3:1)', () => {
    for (const p of HUD_TEXT_PAIRS) expect(contrastRatio(p.fg, p.bg), p.name).toBeGreaterThanOrEqual(p.min);
    // 거점 진행 숫자의 바탕 쌍이 들어 있다 (PC 위 띠 · 터치 줄 게이지 채움)
    const names = HUD_TEXT_PAIRS.map((p) => p.name);
    for (const n of [
      '진행 숫자 정지 / 띠 바탕',
      '진행 숫자 · 거점 글자 / 줄 게이지 채움',
      '진행 숫자 정지 / 줄 게이지 정지 채움',
    ])
      expect(names).toContain(n);
  });

  it('배너 톤 글자: 경고 배너는 #0B1622 (8.49:1), 발각 · 정보는 흰 글자 (palette.TEXT_PAIRS)', () => {
    expect(TONE.warn).toEqual({ bg: WARN, text: WARN_TEXT });
    for (const t of Object.values(TONE)) expect(contrastRatio(t.text, t.bg)).toBeGreaterThanOrEqual(4.5);
    expect(TEXT_PAIRS.some((p) => p.fg === UI.textDim)).toBe(true);
  });
});

describe('9조각 · 아틀라스 · 배치', () => {
  it('9조각 한 축: 양 끝 조각 크기는 그대로, 가운데가 나머지, 좁으면 가운데 0', () => {
    expect(sliceSpans(10, 110, 12, 8)).toEqual([
      [10, 12],
      [22, 80],
      [102, 8],
    ]);
    expect(sliceSpans(0, 15, 12, 8)).toEqual([
      [0, 12],
      [12, 0],
      [12, 8],
    ]);
  });

  it('선반 채우기: 겹치지 않고 폭 안에 들어간다', () => {
    const sizes = Array.from({ length: 60 }, (_, i) => ({ w: 5 + ((i * 37) % 90), h: 3 + ((i * 53) % 40) }));
    const { at, w, h } = packShelves(sizes, 256, 2);
    expect(w).toBeLessThanOrEqual(256);
    sizes.forEach((a, i) => {
      const p = at[i]!;
      expect(p.x + a.w).toBeLessThanOrEqual(w);
      expect(p.y + a.h).toBeLessThanOrEqual(h);
      sizes.forEach((b, j) => {
        if (j <= i) return;
        const q = at[j]!;
        const sep = p.x + a.w <= q.x || q.x + b.w <= p.x || p.y + a.h <= q.y || q.y + b.h <= p.y;
        expect(sep, `${i} · ${j}`).toBe(true);
      });
    });
  });

  it('아틀라스 목록: 이름이 겹치지 않고 범위 · 조각 크기가 올바르다', () => {
    const specs = hudSpecs();
    const names = specs.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(specs.length).toBeGreaterThan(150);
    for (const s of specs) {
      if (s.kind === 'frame') {
        expect(s.x1 > s.x0 && s.y1 > s.y0, s.name).toBe(true);
      } else {
        expect(Math.min(s.l, s.r, s.t), s.name).toBeGreaterThan(0);
        if (s.v) expect(s.b, s.name).toBeGreaterThan(0);
      }
    }
    // 그림마다 그리기 함수가 실제로 돈다 (가짜 2D 컨텍스트)
    // 그림마다 칠하기 명령이 하나 이상 (공용 래퍼가 아무것도 그리지 않게 바뀌는 회귀를 잡는다)
    const painted = paintAll(specs);
    expect(painted.size).toBe(specs.length);
    const empty = [...painted].filter(([, n]) => n === 0).map(([name]) => name);
    expect(empty).toEqual([]);
  });

  it('늘 떠 있는 HUD 자리는 맵 사각형과 겹치지 않는다 (위 띠 · 왼쪽 카드 · 아래 띠 · 미니맵)', () => {
    const G = HUD.gauge;
    /** 게이지 사각형 (배지 쪽 바깥 끝에서 안쪽으로 전체 폭) */
    const gaugeRect = (o: { x: number; y: number; side: 1 | -1 }): [number, number, number, number] => [
      o.side === 1 ? o.x : o.x - G.w,
      o.y - G.dia / 2,
      G.w,
      G.dia,
    ];
    const rects: [string, number, number, number, number][] = [
      ...HUD.gauges.map((o): [string, number, number, number, number] => [`게이지 ${o.id}`, ...gaugeRect(o)]),
      ['타이머', HUD.timer.x - HUD.timer.w / 2, HUD.timer.y - HUD.timer.h / 2, HUD.timer.w, HUD.timer.h],
      [
        '카드',
        HUD.leftCards.x,
        HUD.leftCards.y,
        HUD.leftCards.w,
        3 * HUD.leftCards.h + 2 * HUD.leftCards.gap,
      ],
      ['행동 칸', VIEW_W / 2 - 400, HUD.bottom.y - HUD.slot.tile / 2, 800, HUD.slot.tile],
      ['미니맵', HUD.minimap.x - HUD.minimap.pad, HUD.minimap.y - HUD.minimap.title, HUD.minimap.w + 12, 160],
    ];
    const m = MAP_RECT;
    for (const [name, x, y, w, h] of rects) {
      const apart = x + w <= m.x || m.x + m.w <= x || y + h <= m.y || m.y + m.h <= y;
      expect(apart, name).toBe(true);
    }
    // 위 띠 (플레이테스트 b): 왼쪽부터 A · B · 타이머 · C, 배지는 바깥(타이머 반대쪽). 위 띠 안이고 서로 · 타이머와 겹치지 않는다
    expect(HUD.gauges.map((o) => o.id)).toEqual(['A', 'B', 'C']);
    expect(HUD.gauges.map((o) => o.side)).toEqual([1, 1, -1]);
    const top = rects.slice(0, 4).map(([, x, y, w, h]) => ({ x, y, w, h }));
    const xs = top.map((r) => r.x);
    expect(xs[0]! + G.w).toBeLessThan(xs[1]!);
    expect(xs[1]! + G.w).toBeLessThan(HUD.timer.x - HUD.timer.w / 2);
    expect(HUD.timer.x + HUD.timer.w / 2).toBeLessThan(xs[2]!);
    for (const r of top) {
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + r.h).toBeLessThanOrEqual(HUD_BAND);
    }
    // 위 띠 오른쪽(선명도 탐침 자리 x 1490~)은 비운다 — 가장 오른쪽 게이지(C)의 오른쪽 끝
    expect(Math.max(...top.map((r) => r.x + r.w))).toBeLessThan(1490);
    // 왼쪽은 판 중 메뉴 버튼 자리: 1920×1080 실제 버튼(14 + 119 + 간격 4)보다 오른쪽에서 시작 (작은 창은 matchMenuButton이 줄인다)
    expect(HUD.gaugeA.x - G.dia / 2).toBeGreaterThan(14 + 119 + 4);
  });
});

describe('조작 안내 줄 나누기', () => {
  it('키캡 · 덧말 · 설명으로 나누고, 원래 글자를 잃지 않는다', () => {
    expect(parseControl('E (누르고 있기)  감옥 문 앞에서 구조')).toEqual({
      kind: 'keys',
      pairs: [{ key: 'E', note: '(누르고 있기)', desc: '감옥 문 앞에서 구조' }],
    });
    expect(parseControl('Tab (누르고 있기)  점수판 · 상태')).toEqual({
      kind: 'keys',
      pairs: [{ key: 'Tab', note: '(누르고 있기)', desc: '점수판 · 상태' }],
    });
    expect(parseControl('WASD  이동 · 마우스  조준')).toEqual({
      kind: 'keys',
      pairs: [
        { key: 'WASD', note: '', desc: '이동' },
        { key: '마우스', note: '', desc: '조준' },
      ],
    });
    for (const team of ['survivor', 'monster'] as const)
      for (const line of CONTROLS[team]) {
        const r = parseControl(line);
        const words =
          r.kind === 'goal' ? r.text : r.pairs.map((p) => `${p.key} ${p.note} ${p.desc}`).join(' ');
        for (const w of line.split(/\s+/).filter((x) => x !== '·')) expect(words, line).toContain(w);
      }
  });
});

/** 모든 그림을 기록용 가짜 컨텍스트로 그려 본다 (예외 없음). 부른 그리기 명령 수를 돌려준다 */
/** 실제로 칠하는 명령 (경로 만들기 · 상태 저장과 달리 픽셀이 나온다) */
const PAINT_OPS = new Set([
  'fill',
  'stroke',
  'fillRect',
  'strokeRect',
  'drawImage',
  'fillText',
  'strokeText',
  'putImageData',
]);

/** 그림마다 칠하기 명령 수 (이름 → 수) */
function paintAll(specs: ReturnType<typeof hudSpecs>): Map<string, number> {
  const out = new Map<string, number>();
  let calls = 0;
  const gradient = { addColorStop: (): void => {} };
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
        return (..._a: unknown[]): void => {
          if (typeof key === 'string' && PAINT_OPS.has(key)) calls += 1;
        };
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  const g = globalThis as { Path2D?: unknown };
  const had = g.Path2D;
  g.Path2D = class {
    constructor(readonly d?: string) {}
  };
  try {
    for (const s of specs) {
      calls = 0;
      if (s.kind === 'frame') s.paint(ctx, 1.5);
      else s.paint(ctx, s.l + s.r + 4, s.v ? s.t + s.b + 4 : s.t, 1.5);
      out.set(s.name, calls);
    }
  } finally {
    g.Path2D = had;
  }
  return out;
}
