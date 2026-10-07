# 사람이 직접 확인할 것

자동 테스트로는 판단할 수 없는 손맛 · 재미 · 밸런스 · 실제 환경 항목이다. 플레이테스트 때 확인하고, 결과를 `docs/playtest/`나 이슈로 남긴다. 수치를 바꿀 때는 `config/balance.json`만 고치면 된다.

## 실제 환경

- [ ] **GPU가 있는 실제 PC에서 브라우저 탭 4개 평균 FPS 55 이상** (WebGL 기본 렌더러). 컨테이너에는 GPU가 없어 Canvas 렌더러(`?renderer=canvas`)로만 자동 측정했다
- [ ] 실제 `docker build`와 배포 후 접속 (`docs/DEPLOY.md`)
- [ ] 실제 인터넷 핑(한국 · 일본 리전 30~60ms)에서 조작 체감
- [ ] 발표장 네트워크에서 접속

## 손맛 · 밸런스

- [ ] **회전 감속이 직각 코너에도 걸려야 하는가.** 지금은 문서대로 90° "초과"만 감속한다(반대 방향 꺾기, 135° 꺾기). 기둥을 직각으로 돌 때도 감속하게 하려면 `monster.turnSlowAngle`을 89로 바꾼다
- [ ] **공격 준비 중 괴물 이동 허용**(`monster.attack.windupMoveMultiplier` 1.0)이 적당한가. 피하기 너무 어려우면 0.5나 0으로 낮춘다
- [ ] **거점 지키기 방지 5초**(`capturePoint.monsterBlockGrace`)가 적당한가
