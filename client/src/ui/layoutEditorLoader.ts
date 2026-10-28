// 조작 배치 편집 받기 (번들 줄이기, DECISIONS 11절 '번들 줄이기'): 편집 화면(ui/layoutEditor.ts)은 로비 설정의 조작 탭(터치)에서만
// 여는 나눠 받는 조각이다. 로비에서 설정을 열 때 미리 받고(settingsHost.ts), 편집을 누를 때 아직이면 받은 뒤 연다.
// 받은 모듈은 디버그 훅(편집 중 배치 읽기)도 같이 쓴다. CSS(layoutEditor.css)는 첫 CSS에 둔다(settingsHost.ts)
import type * as LayoutEditorNs from './layoutEditor';

type LayoutEditorModule = typeof LayoutEditorNs;

let loading: Promise<LayoutEditorModule | null> | null = null;
let loaded: LayoutEditorModule | null = null;

/** 편집 화면 조각을 받는다 (한 번만. 실패하면 null이고 다음에 다시 시도한다) */
export function loadLayoutEditor(): Promise<LayoutEditorModule | null> {
  loading ??= import('./layoutEditor').then(
    (mod) => (loaded = mod),
    () => {
      loading = null;
      return null;
    },
  );
  return loading;
}

/** 이미 받은 편집 화면 모듈 (아직이면 null — 그때는 편집 화면도 열린 적이 없다) */
export function layoutEditorModule(): LayoutEditorModule | null {
  return loaded;
}
