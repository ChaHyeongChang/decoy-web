// 화면 픽셀 표본 (따라가는 카메라 시험): 스크린샷을 페이지 안에서 디코드해 타일 좌표 둘레 (2·half+1)² 픽셀의 평균 색 ·
// 밝기 · 가장 밝은 픽셀을 잰다. 표본 자리는 지금 카메라 창 안이어야 한다(창 밖은 가리개 색이라 빈 통과가 된다) — 창 밖이면 던진다
import type { Page } from '@playwright/test';

export interface SpotStat {
  rgb: [number, number, number];
  luma: number;
  maxLuma: number;
}

export async function spotStats(
  page: Page,
  tiles: Record<string, [number, number]>,
  half = 12,
): Promise<Record<string, SpotStat>> {
  const shot = await page.screenshot();
  return page.evaluate(
    async ({ b64, tiles, half }) => {
      const d = window.__DECOY__;
      if (!d) throw new Error('디버그 훅 없음');
      const view = d.getCamera()?.view;
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D 컨텍스트 없음');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const out: Record<string, { rgb: [number, number, number]; luma: number; maxLuma: number }> = {};
      for (const [name, [tx, ty]] of Object.entries(tiles)) {
        if (
          view &&
          (tx < view.x + 0.5 || tx > view.x + view.w - 0.5 || ty < view.y + 0.5 || ty > view.y + view.h - 0.5)
        )
          throw new Error(`${name} (${tx}, ${ty})이 카메라 창 밖이다`);
        const p = d.tileToClient(tx, ty);
        if (!p) throw new Error('tileToClient 없음');
        const cx = Math.round(p.x);
        const cy = Math.round(p.y);
        let r = 0;
        let g = 0;
        let bl = 0;
        let n = 0;
        let max = 0;
        for (let y = cy - half; y <= cy + half; y += 1)
          for (let x = cx - half; x <= cx + half; x += 1) {
            const i = (y * c.width + x) * 4;
            const pr = data[i] ?? 0;
            const pg = data[i + 1] ?? 0;
            const pb = data[i + 2] ?? 0;
            r += pr;
            g += pg;
            bl += pb;
            n += 1;
            max = Math.max(max, luma(pr, pg, pb));
          }
        out[name] = {
          rgb: [r / n, g / n, bl / n],
          luma: Math.round(luma(r / n, g / n, bl / n) * 10) / 10,
          maxLuma: Math.round(max * 10) / 10,
        };
      }
      return out;
    },
    { b64: shot.toString('base64'), tiles, half },
  );
}

/** 두 표본의 채널 차 최대 · 가장 밝은 픽셀 차 */
export function spotDiff(a: SpotStat, b: SpotStat): { channel: number; maxLuma: number } {
  let channel = 0;
  for (let k = 0; k < 3; k += 1) channel = Math.max(channel, Math.abs(a.rgb[k]! - b.rgb[k]!));
  return { channel, maxLuma: Math.abs(a.maxLuma - b.maxLuma) };
}
