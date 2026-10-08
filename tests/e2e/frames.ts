// 각 페이지가 받은 WebSocket 프레임을 모두 모은다 (클라이언트 코드에 기대지 않고 원문 그대로)
import type { Page } from '@playwright/test';
import type { ServerMessage, Snapshot } from '@decoy/shared';

export interface CollectedFrames {
  raw: string[];
  snaps: { raw: string; snap: Snapshot }[];
}

export function collectFrames(page: Page): CollectedFrames {
  const out: CollectedFrames = { raw: [], snaps: [] };
  page.on('websocket', (ws) => {
    ws.on('framereceived', (ev) => {
      const text = typeof ev.payload === 'string' ? ev.payload : ev.payload.toString('utf8');
      out.raw.push(text);
      try {
        const msg = JSON.parse(text) as ServerMessage;
        if (msg.t === 'snap') out.snaps.push({ raw: text, snap: msg.s });
      } catch {
        // 무시
      }
    });
  });
  return out;
}
