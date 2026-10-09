// 진동 (MOBILE_PLAN M12 10번): 내가 맞았을 때 한 번, 발각이 꺼짐 → 켜짐으로 바뀔 때 짧게 두 번.
// 2초 넘게 지난 일에는 울리지 않는다. 사용자가 아직 화면을 누르지 않았으면 부르지 않는다. 로비 설정에서 끌 수 있다.
// 판 장면(GameScene)은 아래 두 함수만 부른다. 구현: M12 갈래 B (지금은 아무것도 하지 않는다)

export const haptics = {
  /** 내가 맞았다. ageMs = 그 일이 일어난 뒤 지난 시간(서버 시각 기준, 모르면 0) */
  hit(ageMs = 0): void {
    void ageMs;
  },
  /** 발각 상태 (스냅샷마다 불러도 된다: 꺼짐 → 켜짐으로 바뀔 때만 울린다). ageMs는 hit과 같다 */
  spotted(on: boolean, ageMs = 0): void {
    void on;
    void ageMs;
  },
};
