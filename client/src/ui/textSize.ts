// 글자 상자 크기 (렌더링 최적화 2): Phaser Text.updateText가 고정 크기 없이 그릴 때 정하는 width · height를 그리지 않고 잰다.
// Phaser 3.90 GetTextSize(줄 폭 = 획 두께 + measureText 폭(글자 간격이면 글자마다 + 간격), 올림 / 높이 = (글꼴 높이 + 획 두께) ×
// 줄 수 + 줄 간격) + 여백과 같은 식이다. text.ts CrispText가 소수 배율에서 '자연 크기를 재려고 한 번 더 그리던' 것을 없앤다.
// 줄바꿈(wordWrap) 글자는 Phaser의 줄 나누기를 거쳐야 해 여기서 재지 않는다. DOM · Phaser 없음 (tests/unit/hud-gate.test.ts가
// Phaser의 GetTextSize 원본과 견준다)

export interface TextBoxStyle {
  /** style.metrics.fontSize */
  fontSize: number;
  strokeThickness: number;
  /** 0 = 제한 없음 */
  maxLines: number;
  /** style.wordWrap (Phaser가 참이면 줄마다 공백 폭을 뺀다. TextStyle은 이 값을 두지 않아 보통 거짓) */
  wordWrap: boolean;
  letterSpacing: number;
  lineSpacing: number;
  /** Phaser Text.padding (만들 때 네 값 모두 0으로 잡히고 setPadding도 네 값 모두 쓴다 — 빈 값은 없다) */
  padding: { left?: number; right?: number; top?: number; bottom?: number };
}

/** measure(s) = 지금 글꼴의 measureText(s).width */
export function textBoxSize(
  lines: readonly string[],
  measure: (s: string) => number,
  st: TextBoxStyle,
): { width: number; height: number } {
  let drawn = lines.length;
  if (st.maxLines > 0 && st.maxLines < lines.length) drawn = st.maxLines;
  let maxLineWidth = 0;
  for (let i = 0; i < drawn; i += 1) {
    const line = lines[i] ?? '';
    let w = st.strokeThickness;
    if (st.letterSpacing === 0) w += measure(line);
    else {
      for (let j = 0; j < line.length; j += 1) w += measure(line[j] ?? '');
      if (line.length > 1) w += st.letterSpacing * (line.length - 1);
    }
    if (st.wordWrap) w -= measure(' ');
    maxLineWidth = Math.max(maxLineWidth, Math.ceil(w));
  }
  let height = (st.fontSize + st.strokeThickness) * drawn;
  if (drawn > 1) height += st.lineSpacing * (drawn - 1);
  const p = st.padding;
  return {
    width: maxLineWidth + (p.left ?? 0) + (p.right ?? 0),
    height: height + (p.top ?? 0) + (p.bottom ?? 0),
  };
}
