// 따라가는 카메라 (순수 모듈): 따라가기 · 맵 자르기 · 가장자리 · 잘라 옮기기 · 괴물 앞당김 · 흔들림 · 관전 대상 고르기 ·
// 맵 조각 범위와 원환 칸 · 합성 텍셀 예산 · ?cam 받는 주소
import { describe, expect, it } from 'vitest';
import { MAP_H, MAP_W, type SurvivorView } from '@decoy/shared';
import { camOverrideAllowed, parseCamZoom } from '../../client/src/app';
import { chunkBox, chunkRange, chunkTilesFor, slotsFor } from '../../client/src/art/mapChunks';
import {
  cullable,
  CAMERA,
  CameraRig,
  SHAKE,
  ScreenShake,
  clampCenter,
  coneBox,
  dipAlpha,
  follow,
  followLinear,
  lookAhead,
  snapView,
  viewTiles,
} from '../../client/src/render/camera';
import {
  CameraDirector,
  canSpectate,
  resolveSpectate,
  spectateCandidates,
} from '../../client/src/render/cameraDirector';
import { cameraCompositeScale } from '../../client/src/render/fogMath';
import { loadTestBalance } from '../helpers/fixtures';

const DEG = Math.PI / 180;

describe('카메라 기하', () => {
  it('보이는 범위는 확대 수준만의 함수 (맵의 1/확대), 1 미만 · 숫자 아님은 맵 전체', () => {
    expect(viewTiles(4)).toEqual({ w: 12, h: 8 });
    expect(viewTiles(3)).toEqual({ w: 16, h: 32 / 3 });
    expect(viewTiles(2)).toEqual({ w: 24, h: 16 });
    expect(viewTiles(0.5)).toEqual({ w: MAP_W, h: MAP_H });
    expect(viewTiles(Number.NaN)).toEqual({ w: MAP_W, h: MAP_H });
  });

  it('가운데는 맵 안으로 잘린다: 맵 밖은 보이지 않는다', () => {
    expect(clampCenter({ x: 1, y: 1 }, 12, 8)).toEqual({ x: 6, y: 4 });
    expect(clampCenter({ x: 47, y: 31 }, 12, 8)).toEqual({ x: MAP_W - 6, y: MAP_H - 4 });
    expect(clampCenter({ x: 20, y: 15 }, 12, 8)).toEqual({ x: 20, y: 15 });
    expect(clampCenter({ x: 3, y: 3 }, MAP_W, MAP_H)).toEqual({ x: MAP_W / 2, y: MAP_H / 2 });
  });

  it('시야 외접 사각형: 탐색 110° · 5타일을 오른쪽으로, 추적 50° · 9타일을 위로 (근접 원 포함)', () => {
    const s = coneBox(0, 110 * DEG, 5, 1.5);
    expect(s.x1).toBeCloseTo(5, 6);
    expect(s.x0).toBeCloseTo(-1.5, 6);
    expect(s.y1).toBeCloseTo(5 * Math.sin(55 * DEG), 6);
    expect(s.y0).toBeCloseTo(-5 * Math.sin(55 * DEG), 6);
    const h = coneBox(-90 * DEG, 50 * DEG, 9, 1.5);
    expect(h.y0).toBeCloseTo(-9, 6);
    expect(h.y1).toBeCloseTo(1.5, 6);
    expect(h.x1).toBeCloseTo(9 * Math.sin(25 * DEG), 6);
  });

  it('앞당김: 사각형 가운데로 옮기되 괴물은 가장자리에서 lookMargin 안쪽 (창보다 긴 시야는 먼 쪽이 잘린다)', () => {
    const box = coneBox(-90 * DEG, 50 * DEG, 9, 1.5);
    const l4 = lookAhead(box, 12, 8, CAMERA.lookMargin);
    expect(l4.x).toBeCloseTo(0, 6);
    // 창 높이 8: 괴물이 아래 가장자리에서 1.6 → 가운데에서 2.4 위
    expect(l4.y).toBeCloseTo(-(4 - CAMERA.lookMargin), 6);
    const l2 = lookAhead(box, 24, 16, CAMERA.lookMargin);
    expect(l2.y).toBeCloseTo((box.y0 + box.y1) / 2, 6);
  });

  it('기기 픽셀 격자: 창 자리 × (기기 px / 타일)이 정수', () => {
    const k = 32 * 2.79 * 1.5;
    for (const x of [0, 3.21, 17.504, 35.999]) expect((snapView(x, k) * k) % 1).toBeCloseTo(0, 6);
    expect(snapView(5.3, 0)).toBe(5.3);
  });

  it('지수 따라가기는 프레임 수와 무관하다: 60 · 120fps가 같은 시각에 같은 비율', () => {
    const a60 = 1 - (1 - follow(1000 / 60, 0.12)) ** 6;
    const a120 = 1 - (1 - follow(1000 / 120, 0.12)) ** 12;
    expect(a60).toBeCloseTo(a120, 10);
    expect(follow(0, 0.12)).toBe(0);
    expect(follow(16, 0)).toBe(1);
  });
});

describe('CameraRig', () => {
  const target = (x: number, y: number) => ({ x, y, look: null, tauS: 0.12, keepInside: true });

  it('첫 프레임은 목표에 바로 (판 시작에 미끄러지지 않는다), 맵 가장자리에서는 대상이 가운데가 아니다', () => {
    const rig = new CameraRig(12, 8);
    const f = rig.update(16, target(20, 15));
    expect(f.cut).toBe(false);
    expect(f.view).toEqual({ x: 14, y: 11, w: 12, h: 8 });
    const rig2 = new CameraRig(12, 8);
    expect(rig2.update(16, target(2, 2)).view).toEqual({ x: 0, y: 0, w: 12, h: 8 });
  });

  it('창 폭의 cutFraction보다 멀리 튀면 잘라 옮긴다 (가로질러 미끄러지지 않음)', () => {
    const rig = new CameraRig(12, 8);
    rig.update(16, target(10, 15));
    const f = rig.update(16, target(10 + 12 * CAMERA.cutFraction + 0.5, 15));
    expect(f.cut).toBe(true);
    expect(rig.center.x).toBeCloseTo(10 + 12 * CAMERA.cutFraction + 0.5, 6);
  });

  it('가장자리 띠 밖으로 한 번에 튀면(세로 6타일 · 확대 4) 잘라 옮긴다: 순간 점프 뒤 멈칫이 없다', () => {
    const rig = new CameraRig(12, 8);
    rig.update(16, target(20, 10));
    const f = rig.update(16, target(20, 16));
    expect(f.cut).toBe(true);
    expect(rig.center.y).toBeCloseTo(16, 6);
    // 그 뒤 프레임은 움직이지 않는다 (이미 목표)
    const before = rig.center.y;
    rig.update(16, target(20, 16));
    expect(rig.center.y).toBeCloseTo(before, 9);
  });

  it('띠 안의 작은 점프는 매 프레임 조금씩 미끄러진다 (멈춘 프레임 없이, 잘라 옮기지 않음)', () => {
    const rig = new CameraRig(12, 8);
    rig.update(16, target(20, 10));
    let prev = rig.center.y;
    for (let i = 0; i < 20; i += 1) {
      const f = rig.update(1000 / 60, target(20, 12));
      expect(f.cut).toBe(false);
      const step = rig.center.y - prev;
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(1);
      prev = rig.center.y;
    }
  });

  it('괴물 돌진 빠르기(16타일/초)로 계속 움직여도 잘라 옮기지 않고, 대상은 늘 가장자리 띠 안이다', () => {
    const rig = new CameraRig(12, 8);
    let x = 8;
    rig.update(16, target(x, 16));
    for (let i = 1; i <= 100; i += 1) {
      x = 8 + (i * 16) / 60;
      const f = rig.update(1000 / 60, target(x, 16));
      expect(f.cut).toBe(false);
      const v = f.view;
      expect(x).toBeGreaterThanOrEqual(Math.max(0, v.x) - 1e-9);
      expect(x).toBeLessThanOrEqual(v.x + v.w + 1e-9);
    }
  });

  it('앞당김은 따로 천천히 따라간다 (조준을 뒤집어도 한 프레임에 휘둘리지 않음)', () => {
    const rig = new CameraRig(12, 8);
    rig.update(16, { x: 20, y: 16, look: { x: 3, y: 0 }, tauS: 0.12, keepInside: true });
    expect(rig.center.x).toBeCloseTo(23, 6);
    rig.update(1000 / 60, { x: 20, y: 16, look: { x: -3, y: 0 }, tauS: 0.12, keepInside: true });
    expect(rig.center.x).toBeGreaterThan(22);
  });
});

describe('잘라 옮김 어두워짐 · 흔들림', () => {
  it('어두워짐: 0에서 dipOutMs에 가장 어둡고 dipInMs 뒤 0', () => {
    expect(dipAlpha(0)).toBe(0);
    expect(dipAlpha(CAMERA.dipOutMs)).toBeCloseTo(CAMERA.dipAlpha, 6);
    expect(dipAlpha(CAMERA.dipOutMs + CAMERA.dipInMs + 1)).toBe(0);
    expect(dipAlpha(-5)).toBe(0);
  });

  it('흔들림은 한 곳에서: 같은 시각이면 같은 값(결정적), 길이가 지나면 없어지고, 세기 0이면 늘 0', () => {
    const a = new ScreenShake();
    const b = new ScreenShake();
    a.add('hitMe', 1000);
    b.add('hitMe', 1000);
    const pa = a.offset(1050, { x: 0, y: 0 });
    const pb = b.offset(1050, { x: 0, y: 0 });
    expect(pa).toEqual(pb);
    expect(Math.hypot(pa.x, pa.y)).toBeGreaterThan(0);
    expect(Math.hypot(pa.x, pa.y)).toBeLessThanOrEqual(SHAKE.hitMe.amp * 2);
    expect(a.offset(1000 + SHAKE.hitMe.ms + 1, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(a.active).toBe(0);
    const off = new ScreenShake();
    off.scale = 0;
    off.add('roar', 0);
    expect(off.offset(50, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('시점 돌려보기 (관전)', () => {
  const sv = (id: string, status: SurvivorView['status'], x = 10, y = 10): SurvivorView =>
    ({ id, role: 'runner', x, y, face: 0, status, hp: 2, protectedFor: 0 }) as unknown as SurvivorView;

  it('돌려볼 수 있는 상태는 수감 · 사망 · 탈출뿐 (괴물 · 자유는 아님)', () => {
    expect(canSpectate('imprisoned')).toBe(true);
    expect(canSpectate('dead')).toBe(true);
    expect(canSpectate('escaped')).toBe(true);
    expect(canSpectate('free')).toBe(false);
    expect(canSpectate(null)).toBe(false);
  });

  it('후보는 맵 위의 동료 (자유 · 수감, 카드 순서), 나 · 사망 · 탈출 동료는 아님', () => {
    const m = new Map([
      ['b', sv('b', 'dead')],
      ['c', sv('c', 'imprisoned')],
      ['d', sv('d', 'free')],
    ]);
    expect(spectateCandidates(['a', 'b', 'c', 'd'], 'a', m)).toEqual(['c', 'd']);
  });

  it('수감 중에는 내 시점이 기본, 요청하면 그 동료 · 사망 · 탈출이면 자유인 동료를 자동으로', () => {
    const m = new Map([
      ['c', sv('c', 'imprisoned')],
      ['d', sv('d', 'free')],
    ]);
    expect(resolveSpectate(null, 'imprisoned', ['c', 'd'], m)).toBeNull();
    expect(resolveSpectate('d', 'imprisoned', ['c', 'd'], m)).toBe('d');
    expect(resolveSpectate(null, 'dead', ['c', 'd'], m)).toBe('d');
    expect(resolveSpectate('x', 'escaped', ['c', 'd'], m)).toBe('d');
    expect(resolveSpectate('d', 'free', ['c', 'd'], m)).toBeNull();
    expect(resolveSpectate(null, 'dead', [], m)).toBeNull();
  });

  it('감독: 창은 늘 맵 안 · 기기 픽셀 격자, 괴물은 앞당김이 실제 창 가운데 − 괴물로 남는다', () => {
    const balance = loadTestBalance();
    const k = 32 * 2.7904 * 0.7114;
    const d = new CameraDirector(12, 8);
    const base = {
      dtMs: 16,
      selfId: 'm',
      myStatus: null,
      survivors: new Map<string, SurvivorView>(),
      team: [],
      balance,
      blend: 1,
      viewW: 12,
      viewH: 8,
      devPerTile: k,
    };
    for (const [x, y, face] of [
      [46, 30, -Math.PI / 2],
      [2, 2, Math.PI],
      [24, 16, 0.3],
    ] as const) {
      d.reset();
      const v = d.update({ ...base, nowMs: 1000, role: 'monster', me: { x, y, face } });
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.y).toBeGreaterThanOrEqual(0);
      expect(v.x + v.w).toBeLessThanOrEqual(MAP_W + 1e-9);
      expect(v.y + v.h).toBeLessThanOrEqual(MAP_H + 1e-9);
      expect((v.x * k) % 1).toBeCloseTo(0, 6);
      expect(d.lookApplied.x).toBeCloseTo(v.x + 6 - x, 9);
    }
  });
});

describe('맵 조각 · 합성 예산 · ?cam', () => {
  it('조각 한 변은 192px에 가까운 1~8타일', () => {
    expect(chunkTilesFor(119)).toBe(2);
    expect(chunkTilesFor(48)).toBe(4);
    expect(chunkTilesFor(10)).toBe(8);
    expect(chunkTilesFor(400)).toBe(1);
  });

  it('조각 사각형은 맞닿고(틈 · 겹침 없음) 맵 끝에서 잘린다', () => {
    const k = 119.0464;
    const t = chunkTilesFor(k);
    for (let cx = 0; cx < Math.ceil(MAP_W / t) - 1; cx += 1)
      expect(chunkBox(cx, 0, t, k).x1).toBe(chunkBox(cx + 1, 0, t, k).x0);
    const last = chunkBox(Math.ceil(MAP_W / t) - 1, 0, t, k);
    expect(last.x1).toBe(Math.round(MAP_W * k));
  });

  it('창 + 여유가 걸치는 조각들은 원환 칸에서 서로 다른 칸을 쓴다 (어느 자리든)', () => {
    for (const [vw, vh] of [
      [12, 8],
      [16, 32 / 3],
      [24, 16],
    ] as const) {
      for (const t of [1, 2, 4, 8]) {
        const margin = 2;
        const nx = slotsFor(vw, margin, t, MAP_W);
        const ny = slotsFor(vh, margin, t, MAP_H);
        for (let x = 0; x <= MAP_W - vw; x += 0.37)
          for (let y = 0; y <= MAP_H - vh; y += 0.41) {
            const r = chunkRange({ x, y, w: vw, h: vh }, margin, t);
            const seen = new Set<number>();
            for (let cy = r.cy0; cy <= r.cy1; cy += 1)
              for (let cx = r.cx0; cx <= r.cx1; cx += 1) {
                const slot = (cx % nx) + (cy % ny) * nx;
                expect(seen.has(slot)).toBe(false);
                seen.add(slot);
              }
          }
      }
    }
  });

  it('합성 배율: 맵 전체(확대 1)는 예산 없이 그대로, 확대하면 창 + 여유의 텍셀이 예산 이하', () => {
    expect(cameraCompositeScale(2, 2, 0.93, 1, { w: 48, h: 32 }, 2, 3e6)).toBe(2);
    const ws = 0.9297 * 4;
    const s = cameraCompositeScale(2, 2, ws, 4, { w: 12, h: 8 }, 2, 3e6);
    const texels = (12 + 6) * (8 + 6) * (32 * ws * s) ** 2;
    expect(texels).toBeLessThanOrEqual(3e6 * 1.0001);
    // 예산 안이면 기기 픽셀 1:1 그대로
    expect(cameraCompositeScale(0.6, 1.5, ws, 4, { w: 12, h: 8 }, 2, 1.6e6)).toBe(0.6);
  });

  it('?cam은 1~6 수만, 로컬 주소에서만 받는다 (배포 주소에서는 확대 수준을 바꿀 수 없다)', () => {
    expect(parseCamZoom('3')).toBe(3);
    expect(parseCamZoom('2.5')).toBe(2.5);
    expect(parseCamZoom('0.5')).toBeNull();
    expect(parseCamZoom('9')).toBeNull();
    expect(parseCamZoom('')).toBeNull();
    expect(parseCamZoom(null)).toBeNull();
    expect(camOverrideAllowed('localhost')).toBe(true);
    expect(camOverrideAllowed('127.0.0.1')).toBe(true);
    expect(camOverrideAllowed('decoy.onrender.com')).toBe(false);
    expect(camOverrideAllowed('192.168.0.10')).toBe(false);
  });
});

describe('창 밖 컬링 (cullable)', () => {
  const map = { x: 246, y: 64, w: 1428, h: 952 };
  const view = { viewW: 1920, viewH: 1080, canvasW: 1920, canvasH: 1080 };
  const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it('맵 창(± 여유)과 겹치면 그린다, 가리개 밑 · 캔버스 밖에 통째로 있으면 거른다', () => {
    expect(cullable(r(500, 500, 40, 40), map, 1, view)).toBe(false);
    // 가장자리에 걸침
    expect(cullable(r(230, 500, 20, 20), map, 1, view)).toBe(false);
    // 여유 1px 안
    expect(cullable(r(225, 500, 20.5, 20), map, 1, view)).toBe(false);
    // 왼쪽 가리개 밑 · 위 가리개 밑 · 캔버스 밖
    expect(cullable(r(100, 500, 40, 40), map, 1, view)).toBe(true);
    expect(cullable(r(500, 10, 40, 40), map, 1, view)).toBe(true);
    expect(cullable(r(-400, -300, 40, 40), map, 1, view)).toBe(true);
    expect(cullable(r(2500, 2000, 40, 40), map, 1, view)).toBe(true);
  });

  it('캔버스가 논리 크기보다 조금 크면 가리개가 못 덮는 오른쪽 · 아래 띠에 걸친 그림은 그린다', () => {
    const big = { viewW: 1920, viewH: 1080, canvasW: 1921.4, canvasH: 1081.2 };
    expect(cullable(r(1900, 1079, 30, 10), map, 1, big)).toBe(false);
    expect(cullable(r(1919, 500, 10, 10), map, 1, big)).toBe(false);
    // 띠가 없으면(같은 크기) 거른다
    expect(cullable(r(1900, 1079, 30, 10), map, 1, view)).toBe(true);
  });

  it('좌표가 숫자가 아니면 거르지 않는다', () => {
    expect(cullable(r(Number.NaN, 0, 10, 10), map, 1, view)).toBe(false);
    expect(cullable(r(0, 0, Number.POSITIVE_INFINITY, 10), map, 1, view)).toBe(false);
  });
});

// ───────────── 내 움직임 고르기 (2026-10-24) ─────────────

/** 8.33 · 16.67ms가 섞인 프레임 간격 (시드, 120Hz에서 vsync를 30% 놓친 기기) */
function unevenIntervals(n: number, seed = 7): number[] {
  let s = seed;
  return Array.from({ length: n }, () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 < 0.3 ? 1000 / 60 : 1000 / 120;
  });
}

describe('내 움직임 고르기: 따라가기는 프레임 간격과 상관없이 같은 늦음 (followLinear)', () => {
  it('같은 빠르기로 걸으면 8.3 · 16.7ms가 섞여도 목표 − 카메라 = 빠르기 × τ (프레임마다 같다). 예전 식은 간격마다 달랐다', () => {
    const v = 5 / 1000; // 타일/ms
    const tau = CAMERA.followTauS;
    let t = 0;
    let target = 10;
    let lin = target;
    let old = target;
    const linLag: number[] = [];
    const oldLag: number[] = [];
    for (const dt of unevenIntervals(400)) {
      const prev = target;
      t += dt;
      target = 10 + v * t;
      lin = followLinear(lin, prev, target, dt, tau);
      old += (target - old) * follow(dt, tau);
      // 시작 늦음이 가라앉은 뒤 (τ의 20배 남짓: e^-20)
      if (t > 2500) {
        linLag.push(target - lin);
        oldLag.push(target - old);
      }
    }
    for (const lag of linLag) expect(lag).toBeCloseTo(v * tau * 1000, 9);
    const spread = Math.max(...oldLag) - Math.min(...oldLag);
    // 예전 식: 늦음 ≈ 빠르기 × (τ − 간격 / 2)라 간격이 바뀔 때마다 0.01타일 넘게 출렁였다 (확대 3 휴대폰에서 약 1 기기 px)
    expect(spread).toBeGreaterThan(0.01);
  });

  it('목표가 서 있으면 예전 식과 같고, 간격 0이면 그대로 · τ 0이면 목표', () => {
    for (const dt of [1000 / 120, 1000 / 60, 33.3]) {
      expect(followLinear(3, 8, 8, dt, 0.12)).toBeCloseTo(3 + 5 * follow(dt, 0.12), 12);
    }
    expect(followLinear(3, 8, 9, 0, 0.12)).toBe(3);
    expect(followLinear(3, 8, 9, 16, 0)).toBe(9);
    // 아주 짧은 간격: 빠르기 나눗셈 없이 예전 식
    expect(followLinear(3, 8, 9, 0.01, 0.12)).toBeCloseTo(3 + 6 * follow(0.01, 0.12), 12);
  });

  it('점프(띠 안)도 한 프레임 안에 곧게 움직인 것으로 풀어 미끄러진다: 처음 걸음이 예전 식보다 작고 그 뒤는 같다', () => {
    const dt = 1000 / 60;
    const first = followLinear(10, 10, 12, dt, 0.12);
    expect(first).toBeGreaterThan(10);
    expect(first).toBeLessThan(10 + 2 * follow(dt, 0.12));
    expect(followLinear(first, 12, 12, dt, 0.12)).toBeCloseTo(first + (12 - first) * follow(dt, 0.12), 12);
  });

  it('카메라 감독: 창은 기기 픽셀 격자에 맞추고, 그 나머지(snapResidual)만큼 옮겨 그린 내 자리는 화면에서 프레임마다 같은 자리다', () => {
    const balance = loadTestBalance();
    const k = 89.28 * 1.25; // 기기 px / 타일 (확대 3 휴대폰 어림)
    const d = new CameraDirector(16, 10.67);
    const v = 5 / 1000;
    let t = 0;
    const base = {
      selfId: 's',
      role: 'runner' as const,
      myStatus: 'free' as const,
      survivors: new Map<string, SurvivorView>(),
      team: ['s'],
      balance,
      blend: 0,
      viewW: 16,
      viewH: 10.67,
      devPerTile: k,
    };
    const drawnScreen: number[] = [];
    const rawScreen: number[] = [];
    for (const dt of unevenIntervals(400, 11)) {
      t += dt;
      const me = { x: 14 + v * t, y: 16.5, face: 0 };
      const view = d.update({ ...base, nowMs: t, dtMs: dt, me });
      // 창은 격자 위
      expect(Math.abs(view.x * k - Math.round(view.x * k))).toBeLessThan(1e-6);
      expect(Math.abs(d.snapResidual.x) * k).toBeLessThanOrEqual(0.5 + 1e-9);
      if (t > 2500) {
        drawnScreen.push((me.x + d.snapResidual.x - view.x) * k);
        rawScreen.push((me.x - view.x) * k);
      }
    }
    const span = (a: number[]): number => Math.max(...a) - Math.min(...a);
    expect(span(drawnScreen)).toBeLessThan(1e-6);
    // 옮기지 않으면 반 픽셀씩 흔들린다 (격자 맞추기)
    expect(span(rawScreen)).toBeGreaterThan(0.5);
  });
});
