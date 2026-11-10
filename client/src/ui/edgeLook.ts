// 화면 밖 화살표의 그림 고르기 (순수 · Phaser 없음 — 단위 시험이 읽는다). 무엇을 어디에 놓을지는 render/offscreen.ts,
// 그리기는 edgeMarkers.ts. 색만으로 구분하지 않기: 역할 = 문양 모양 + 색, 괴물 = 괴물 문양, 탐지 · 포효 · 감옥 · 탈출구 · 거점 =
// 아이콘 모양 + 색. 괴물 화면의 포효 핑은 흰 공통 문양(역할 없음) + 흰 펄스 고리이고, 핑마다 완전히 같은 그림이다(흰색 위장)
import type { Role } from '@decoy/shared';
import { EXIT_GO, HIDDEN_SURVIVOR, NEON, PRISON_RED, ROLE, UI, WARN } from '../art/palette';
import type { IconId } from '../art/icons';
import type { EdgeMarker } from '../render/offscreen';
import { EDGE_ART, EDGE_GLYPH, EDGE_ICON, FR } from './hudArt';

/** 화살표 하나의 그림 (강조색 · 배지 안 그림 · 글자) */
export interface EdgeLook {
  color: number;
  /** 배지 안 그림 프레임 */
  inner: string;
  /** 배지 안 글자 (거점 A/B) */
  label: string;
  labelColor: number;
  /** 깜빡임 (괴물 화면 점령 알림) */
  blink: boolean;
  /** 낮은 강조 (대기 거점 · 활성(닫힌) 탈출구) */
  dim: boolean;
  /** 흰 펄스 고리 (괴물 화면 포효 핑만) */
  pulse: boolean;
}

const icon = (id: IconId, color: number, size = EDGE_ICON): string => FR.icon(id, color, size);

/** 포효 핑 화살표의 펄스 고리 프레임 (흰색 하나) */
export const EDGE_HALO = FR.edge('halo', HIDDEN_SURVIVOR);

/** 화살표 그림을 고른다 (프레임은 모두 HUD 아틀라스에 있다 — roar-feedback.test) */
export function edgeLook(m: EdgeMarker, monsterScreen: boolean): EdgeLook {
  const base = { label: '', labelColor: UI.text, blink: false, dim: false, pulse: false };
  const roleColor = (r: Role | null): number => (r ? ROLE[r] : HIDDEN_SURVIVOR);
  switch (m.kind) {
    case 'monster':
      return { ...base, color: ROLE.monster, inner: FR.glyph('monster', EDGE_GLYPH) };
    case 'track':
      return { ...base, color: ROLE.scout, inner: icon('track', ROLE.scout) };
    case 'roar':
      return { ...base, color: WARN, inner: icon('roar', WARN) };
    case 'roarPing':
      return { ...base, color: HIDDEN_SURVIVOR, inner: FR.glyph('hidden', EDGE_GLYPH), pulse: true };
    case 'prison':
      return { ...base, color: PRISON_RED, inner: icon('prison', PRISON_RED) };
    case 'teammate': {
      const r = m.role && m.role !== 'monster' ? m.role : null;
      return {
        ...base,
        color: roleColor(r),
        inner: r ? FR.glyph(r, EDGE_GLYPH) : FR.glyph('hidden', EDGE_GLYPH),
      };
    }
    case 'self': {
      const r = m.role && m.role !== 'monster' ? m.role : null;
      return {
        ...base,
        color: HIDDEN_SURVIVOR,
        inner: r ? FR.glyph(r, EDGE_GLYPH) : FR.glyph('hidden', EDGE_GLYPH),
      };
    }
    case 'exit':
      return { ...base, color: EXIT_GO, inner: icon('exit', EXIT_GO), dim: m.state !== 'open' };
    case 'point': {
      // 괴물 화면: 점령 중 경고(주황 깜빡임). 생존자 화면: 점령 중 청록 · 정지 주황 · 대기 흐림
      const col = monsterScreen || m.state === 'blocked' ? WARN : m.state === 'capturing' ? NEON : UI.textDim;
      return {
        ...base,
        color: col,
        inner: icon('point', col, EDGE_ICON + 4),
        label: m.id,
        labelColor: col,
        blink: monsterScreen,
        dim: !monsterScreen && m.state === 'idle',
      };
    }
  }
}

/**
 * 큰 화살표의 셰브론을 배지 쪽으로 당기는 거리 (그림 단위): 셰브론은 배지 가운데를 기준으로 scale배 커지는데, 그대로 두면 끝이
 * 창 가장자리(inset)를 넘는다. 끝이 보통 화살표와 같은 자리(r + chevGap + chevLen)에 오게 그 차이만큼 당긴다
 */
export function chevBack(scale: number): number {
  return (scale - 1) * (EDGE_ART.r + EDGE_ART.chevGap + EDGE_ART.chevLen);
}

/**
 * 펄스 고리 그림의 배율 (t = 퍼진 정도 0~1, prefsFx.pingPulse): 고리는 커진 배지 둘레(r × pingScale) 크기로 구워 두고
 * 1배에서 r × haloTo까지 퍼진다
 */
export function haloScale(t: number): number {
  return 1 + (EDGE_ART.haloTo / EDGE_ART.pingScale - 1) * t;
}
