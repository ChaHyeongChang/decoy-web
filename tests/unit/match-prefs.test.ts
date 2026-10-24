// 판 중 설정 효과 (설정 화면 통합): 흔들림 · 번쩍임 줄이기의 순수 값, 지도 크게 보기 자리, FPS · 핑 칩 글자 · 자리, PC 메뉴 버튼 자리,
// 판 중 메뉴가 열린 동안 입력 멈춤(InputSampler.suspend). 기본값(설정 모두 끔)은 예전과 같은 값이어야 한다
import { describe, expect, it } from 'vitest';
import { BTN, MAP_H, MAP_W, type SurvivorView } from '@decoy/shared';
import { InputSampler, type InputEnv } from '../../client/src/input';
import { HELP_TEXT } from '../../client/src/data/storyText';
import { PREF_DEFAULTS, shakeScaleOf } from '../../client/src/prefs';
import { CAMERA, ScreenShake } from '../../client/src/render/camera';
import { CameraDirector } from '../../client/src/render/cameraDirector';
import {
  HIT_FLASH_REDUCED,
  MINIMAP_BIG,
  SPOTTED_EDGE,
  bigMinimapPlace,
  hitFlashLevel,
  spottedEdgeAlpha,
} from '../../client/src/render/prefsFx';
import { MENU_BUTTON, menuButtonPlace } from '../../client/src/ui/matchMenuButton';
import { PERF_CHIP, perfChipPlace, perfChipText } from '../../client/src/ui/perfChip';
import { loadTestBalance } from '../helpers/fixtures';

const HIT_MS = 200;

describe('번쩍임 줄이기: 피격 붉은 가장자리', () => {
  it('끄면 예전 식 그대로 (맞은 순간 1, 0.2초 동안 선형으로 0)', () => {
    for (const t of [0, 1, 50, 99.5, 150, 199, 200, 250, 1e9])
      expect(hitFlashLevel(t, HIT_MS, false)).toBe(Math.max(0, 1 - t / HIT_MS));
  });

  it('켜면 가장 진할 때 0.35배 이하, 맞은 순간 확 켜지지 않고(서서히 오른다) 같은 0.2초에 사라진다', () => {
    let peak = 0;
    for (let t = 0; t <= 260; t += 1) peak = Math.max(peak, hitFlashLevel(t, HIT_MS, true));
    expect(peak).toBeCloseTo(HIT_FLASH_REDUCED.peak, 6);
    expect(peak).toBeLessThanOrEqual(0.35 + 1e-9);
    // 맞은 순간 0, 오르는 동안 단조 증가
    expect(hitFlashLevel(0, HIT_MS, true)).toBe(0);
    for (let t = 1; t < HIT_FLASH_REDUCED.riseMs; t += 1)
      expect(hitFlashLevel(t, HIT_MS, true)).toBeGreaterThan(hitFlashLevel(t - 1, HIT_MS, true));
    // 맞았다는 신호는 남는다 (0.1초에 아직 보인다), 끝나면 0
    expect(hitFlashLevel(100, HIT_MS, true)).toBeGreaterThan(0.1);
    expect(hitFlashLevel(HIT_MS, HIT_MS, true)).toBe(0);
    expect(hitFlashLevel(-5, HIT_MS, true)).toBe(0);
    expect(hitFlashLevel(1e9, HIT_MS, true)).toBe(0);
  });
});

describe('번쩍임 줄이기: 발각 빛 테두리 · 잘라 옮김 어두워짐', () => {
  it('발각 테두리: 끄면 1.2Hz 맥동(0.6~1, 예전 식 그대로), 켜면 맥동 없이 0.9로 늘 보인다', () => {
    for (const t of [0, 123, 416.6, 1000, 5555])
      expect(spottedEdgeAlpha(t, false)).toBe(0.8 + 0.2 * Math.cos((t / 1000) * Math.PI * 2 * 1.2));
    const seen = new Set<number>();
    for (let t = 0; t < 2000; t += 7) seen.add(spottedEdgeAlpha(t, true));
    expect([...seen]).toEqual([SPOTTED_EDGE.steady]);
    expect(SPOTTED_EDGE.steady).toBeGreaterThanOrEqual(SPOTTED_EDGE.mid);
  });

  it('잘라 옮김: noDip이면 어두워지지 않고 바로 옮긴다 (잘라 옮긴 횟수 · 창 자리는 같다)', () => {
    const balance = loadTestBalance();
    const base = {
      dtMs: 16,
      selfId: 's',
      myStatus: 'free' as const,
      survivors: new Map<string, SurvivorView>(),
      team: ['s'],
      balance,
      blend: 0,
      viewW: 16,
      viewH: 32 / 3,
      devPerTile: 40,
      role: 'runner' as const,
    };
    const run = (noDip: boolean): { cuts: number; dips: number[]; view: { x: number; y: number } } => {
      const d = new CameraDirector(16, 32 / 3);
      d.noDip = noDip;
      d.update({ ...base, nowMs: 0, me: { x: 4, y: 4, face: 0 } });
      // 먼 순간 이동 → 잘라 옮긴다
      const v = d.update({ ...base, nowMs: 16, me: { x: 44, y: 28, face: 0 } });
      const dips: number[] = [];
      for (let t = 16; t < 16 + CAMERA.dipOutMs + CAMERA.dipInMs + 40; t += 10) dips.push(d.dip(t));
      return { cuts: d.cuts, dips, view: { x: v.x, y: v.y } };
    };
    const normal = run(false);
    const reduced = run(true);
    expect(normal.cuts).toBe(1);
    expect(Math.max(...normal.dips)).toBeGreaterThan(0.3);
    expect(reduced.cuts).toBe(1);
    expect(reduced.dips.every((a) => a === 0)).toBe(true);
    expect(reduced.view).toEqual(normal.view);
  });
});

describe('흔들림 줄이기', () => {
  it('설정 · OS 동작 줄이기면 배율 0, 그때 맞거나 포효해도 화면 창이 움직이지 않는다', () => {
    expect(shakeScaleOf(false, PREF_DEFAULTS)).toBe(1);
    expect(shakeScaleOf(true, PREF_DEFAULTS)).toBe(0);
    expect(shakeScaleOf(false, { ...PREF_DEFAULTS, reduceShake: true })).toBe(0);
    const out = { x: 0, y: 0 };
    const sh = new ScreenShake();
    sh.add('hitMe', 0);
    sh.add('roar', 0);
    expect(Math.hypot(sh.offset(30, out).x, out.y)).toBeGreaterThan(0);
    sh.scale = shakeScaleOf(false, { ...PREF_DEFAULTS, reduceShake: true });
    sh.add('hitMe', 40);
    for (let t = 40; t < 400; t += 8) {
      sh.offset(t, out);
      expect(out.x).toBe(0);
      expect(out.y).toBe(0);
    }
    expect(sh.active).toBe(0);
  });
});

describe('지도 크게 보기 자리', () => {
  const PC_MAP = { x: 246, y: 64, w: 1428, h: 952 };
  it('맵 창 가운데, 틀 높이 = 맵 창 높이 × 0.66, 틀이 맵 창 안, 그림은 맵 비율(3:2)', () => {
    for (const [map, pad, title] of [
      [PC_MAP, 6, 30],
      [{ x: 120.5, y: 0, w: 900.3, h: 600.2 }, 9, 36],
      [{ x: 10, y: 40, w: 300, h: 400 }, 6, 24],
    ] as const) {
      const p = bigMinimapPlace(map, pad, title, MAP_W / MAP_H);
      const h = Math.round((p.w * MAP_H) / MAP_W);
      const frame = { x: p.x - pad, y: p.y - title, w: p.w + pad * 2, h: h + title + pad };
      expect(frame.x).toBeGreaterThanOrEqual(map.x - 1);
      expect(frame.y).toBeGreaterThanOrEqual(map.y - 1);
      expect(frame.x + frame.w).toBeLessThanOrEqual(map.x + map.w + 1);
      expect(frame.y + frame.h).toBeLessThanOrEqual(map.y + map.h + 1);
      // 가운데 (반올림 1px 안)
      expect(Math.abs(frame.x + frame.w / 2 - (map.x + map.w / 2))).toBeLessThanOrEqual(1.5);
      expect(Math.abs(frame.y + frame.h / 2 - (map.y + map.h / 2))).toBeLessThanOrEqual(1.5);
      expect(frame.h).toBeLessThanOrEqual(map.h * MINIMAP_BIG.heightFrac + 1);
      expect(frame.w).toBeLessThanOrEqual(map.w * MINIMAP_BIG.maxWidthFrac + 1);
    }
    // PC: 틀 높이 628 (맵 창 952의 0.66) — 작은 미니맵(폭 222)의 4배 남짓
    const pc = bigMinimapPlace(PC_MAP, 6, 30, MAP_W / MAP_H);
    expect(pc.w).toBe(888);
    expect(pc.w / 222).toBeGreaterThan(3.9);
  });
});

describe('FPS · 핑 칩', () => {
  it('글자: 정수 FPS · 핑, 모르면 -', () => {
    expect(perfChipText(59.6, 42.4)).toBe('60 FPS · 핑 42ms');
    expect(perfChipText(120, null)).toBe(`120 FPS · 핑 ${HELP_TEXT.perfChipUnknown}ms`);
    expect(perfChipText(null, Number.NaN)).toBe('- FPS · 핑 -ms');
  });

  it('자리: 맵 창 왼쪽 위 안쪽, 같은 구석의 ?debug=1 칩이 있으면 그 아래', () => {
    const canvas = { left: 10, top: 20, k: 0.5 };
    const map = { x: 246, y: 64 };
    const p = perfChipPlace(canvas, map, null);
    expect(p).toEqual({ left: 10 + 123 + PERF_CHIP.insetCss, top: 20 + 32 + PERF_CHIP.insetCss });
    // ?debug=1 칩 (터치: 맵 왼쪽 끝 + 6 · 화면 맨 위, 높이 20)
    const dbg = { left: p.left, top: p.top - 2, width: 90, height: 20 };
    const q = perfChipPlace(canvas, map, dbg);
    expect(q.left).toBe(p.left);
    expect(q.top).toBe(dbg.top + dbg.height + PERF_CHIP.gapCss);
    // 다른 구석(PC: 왼쪽 아래)이면 그대로
    expect(perfChipPlace(canvas, map, { left: 8, top: 500, width: 200, height: 20 })).toEqual(p);
    // 여럿 (좌우 반전 터치: 시스템 버튼 두 줄이 맵 왼쪽 위에 걸침 + ?debug=1 칩) → 위에서부터 차례로 맨 아래 것 밑
    const sys1 = { left: p.left - 30, top: p.top - 10, width: 48, height: 48 };
    const sys2 = { left: p.left - 30, top: sys1.top + 48 + 2, width: 48, height: 48 };
    const r = perfChipPlace(canvas, map, [sys2, dbg, sys1]);
    expect(r.left).toBe(p.left);
    expect(r.top).toBe(sys2.top + sys2.height + PERF_CHIP.gapCss);
    // 빈 목록 = 그대로
    expect(perfChipPlace(canvas, map, [])).toEqual(p);
  });
});

describe('PC 판 중 메뉴 버튼 자리', () => {
  it('위 띠 왼쪽 (팀 카드 왼쪽 끝 줄), 띠가 높으면 세로 가운데 · 낮으면 캔버스 맨 위', () => {
    // 1920×1080 창: 띠 64 CSS px → 가운데 (10px 아래)
    expect(menuButtonPlace({ left: 0, top: 0, k: 1 }, 64)).toEqual({ left: 14, top: 10 });
    // 960×540 창: 띠 32 CSS px < 44 → 맨 위
    expect(menuButtonPlace({ left: 0, top: 0, k: 0.5 }, 64)).toEqual({ left: 7, top: 0 });
    // 레터박스 캔버스
    expect(menuButtonPlace({ left: 100, top: 50, k: 1.5 }, 64)).toEqual({ left: 121, top: 50 + 26 });
    expect(MENU_BUTTON.heightCss).toBeGreaterThanOrEqual(44);
  });
});

// ── 판 중 메뉴가 열린 동안 입력 멈춤 ──

class FakeDoc extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

function rig(): { sampler: InputSampler; host: EventTarget; win: EventTarget } {
  const env: InputEnv = { win: new EventTarget(), doc: new FakeDoc(), orientation: null };
  const host = new EventTarget();
  const sampler = new InputSampler();
  sampler.attach(host, { touch: null, env });
  return { sampler, host, win: env.win };
}

const keyEv = (type: 'keydown' | 'keyup', code: string, repeat = false): Event =>
  Object.assign(new Event(type, { cancelable: true }), { code, repeat });
const ptrEv = (type: string, pointerType: string, button = 0): Event =>
  Object.assign(new Event(type, { cancelable: true }), { pointerType, button });

describe('판 중 메뉴: 입력 멈춤 (InputSampler.suspend)', () => {
  it('열면 누르던 키 · 마우스를 모두 떼고, 여는 동안 키 · 클릭 · Tab을 받지 않으며 기본 동작도 막지 않는다', () => {
    const r = rig();
    r.win.dispatchEvent(keyEv('keydown', 'KeyW'));
    r.host.dispatchEvent(ptrEv('pointerdown', 'mouse', 0));
    const before = r.sampler.sample(1, 0.5);
    expect(before.my).toBe(-1);
    expect(before.held & BTN.ATTACK).toBe(BTN.ATTACK);
    r.sampler.suspend(true);
    expect(r.sampler.isSuspended).toBe(true);
    // 판 장면이 프레임마다 읽고 비운다 (여는 동안 누른 것은 조작 안내 닫기로도 세지 않는다)
    r.sampler.anyKeyPressed = false;
    const tab = keyEv('keydown', 'Tab');
    r.win.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(r.sampler.tabHeld).toBe(false);
    const space = keyEv('keydown', 'Space');
    r.win.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(false);
    r.win.dispatchEvent(keyEv('keydown', 'KeyD'));
    r.host.dispatchEvent(ptrEv('pointerdown', 'mouse', 2));
    r.win.dispatchEvent(keyEv('keydown', 'Digit2'));
    for (let seq = 2; seq < 6; seq += 1) {
      const f = r.sampler.sample(seq, 0.5);
      expect(f).toEqual({ seq, mx: 0, my: 0, aim: 0.5, held: 0, pressed: 0 });
    }
    expect(r.sampler.takeSpectatePick()).toBeNull();
    expect(r.sampler.anyKeyPressed).toBe(false);
  });

  it('닫으면 다시 받는다: 여는 동안 누른 키는 눌린 채 남지 않고, 새로 누른 것만', () => {
    const r = rig();
    r.sampler.suspend(true);
    r.win.dispatchEvent(keyEv('keydown', 'KeyA'));
    r.sampler.suspend(false);
    expect(r.sampler.isSuspended).toBe(false);
    expect(r.sampler.sample(1, 0)).toMatchObject({ mx: 0, my: 0, held: 0, pressed: 0 });
    r.win.dispatchEvent(keyEv('keyup', 'KeyA'));
    r.win.dispatchEvent(keyEv('keydown', 'KeyS'));
    r.win.dispatchEvent(keyEv('keydown', 'Space'));
    const f = r.sampler.sample(2, 0);
    expect(f.my).toBe(1);
    expect(f.pressed & BTN.ABILITY).toBe(BTN.ABILITY);
    // 같은 값으로 다시 불러도 그대로 (누르던 키를 다시 떼지 않는다)
    r.sampler.suspend(false);
    expect(r.sampler.sample(3, 0).my).toBe(1);
  });

  it('떼어 내면(판 장면 끝) 멈춤도 풀린다', () => {
    const r = rig();
    r.sampler.suspend(true);
    r.sampler.detach();
    expect(r.sampler.isSuspended).toBe(false);
  });
});
