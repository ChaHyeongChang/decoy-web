// 브라우저 디버그 훅(window.__DECOY__)의 타입. 클라이언트와 E2E 테스트가 같이 쓴다.
import type { MoveState } from './movement';
import type { InputFrame, MatchResult, Role, Snapshot, TestCommand } from './types';

/** 이번 프레임에 실제로 그린 엔티티 */
export interface DrawnEntity {
  id: string;
  kind: 'self' | 'survivor' | 'monster' | 'mark';
  x: number;
  y: number;
  face: number;
  /** 화면: 메인 또는 미니맵 */
  layer?: 'main' | 'minimap';
  /** 마커 종류 등 부가 정보 */
  tag?: string;
}

export interface DecoyDebug {
  readonly role: Role | null;
  readonly you: string | null;
  readonly room: string | null;
  readonly phase: string | null;
  readonly fps: number;
  readonly ping: number;
  readonly serverOffset: number;
  readonly pendingInputs: number;
  readonly correction: number;
  readonly renderer: 'webgl' | 'canvas' | 'none';
  readonly balanceHash: string;
  readonly snapCount: number;
  getLocalState(): MoveState | null;
  getRenderPos(): { x: number; y: number; face: number } | null;
  getLastSnapshot(): Snapshot | null;
  getDrawn(): DrawnEntity[];
  /** 미니맵에 그린 엔티티 */
  getDrawnMinimap(): DrawnEntity[];
  /** 지금 보이는 배너 · 메모 문구 */
  getBanners(): string[];
  getResult(): MatchResult | null;
  getLastInput(): InputFrame | null;
  serverNow(): number;
  sendTest(cmd: TestCommand): void;
  /** 타일 좌표 → 브라우저 창 좌표 (E2E에서 마우스를 옮길 때) */
  tileToClient(x: number, y: number): { x: number; y: number } | null;
}
