# 예봄성경 — 보류·차기 검토 사항

> 흩어진 .md 대신 보류·연기·차기 검토 항목을 한 곳에 누적 기록.
> 최신 항목이 위쪽. 완료/취소된 항목은 ~~취소선~~ 후 일정 기간 보관 후 정리.

---

## TTS 백그라운드 재생 keep-alive (보류, 2026-06-01)

**무엇이 보류되었나**
TTS 재생 중 모바일 화면 잠금 / 백그라운드 전환 시에도 오디오가 끊기지 않도록 유지하는 기능. prayer-house-v2의 `src/features/tts/lib/bg-audio.ts`(227줄, 7계층 방어 패턴)에 구현된 것과 동등 수준.

**왜 보류했나**
- 코드량이 크고 (227줄) OS·브라우저별 동작 편차가 커서 회귀 위험이 높음
- 현재 TTS 기능을 처음 도입하는 단계 — 사용자가 모바일 백그라운드 재생을 얼마나 요구할지 데이터 부족
- Phase 1+2의 핵심(절 단위 재생, 미니 플레이어, 자동 다음 장, 재개 위치)만으로도 데스크탑·모바일 포그라운드 사용엔 충분
- 메모리 룰 "빈도·심각도 낮은 이슈는 변경 자제" 정신 — 검증 후 도입

**도입 트리거 조건**
- 사용자가 "잠금 화면에서도 듣고 싶다"는 피드백을 명시적으로 줄 때
- 또는 TTS 일일 활성 사용자 비율이 일정 수준(예: 활성 사용자의 10%) 넘었을 때

**구현 시 7계층 방어 (prayer-house-v2 그대로 차용)**
1. 무음 WAV 앵커 — 5초 루프, ±3 micro-noise
2. Web Worker keep-alive — inline worker, 20초 간격 tick
3. Fallback Timer — Worker 실패 시 setInterval
4. Wake Lock API — `navigator.wakeLock.request('screen')`
5. Media Session — 시스템 컨트롤 메타데이터 (제목, 위치)
6. Visibility Listener — 포그라운드 복귀 시 resume
7. 20초 통합 핸들러 — anchor 재생 + Wake Lock 재획득 + position 업데이트

**참고**
- 원본: `C:\dev\yebom\prayer-house-v2\src\features\tts\lib\bg-audio.ts`
- 통합 지점: `hooks/useVerseTTS` 또는 `contexts/TtsContext` 의 play/pause/stop 라이프사이클
- 모바일 iOS Safari는 Wake Lock 미지원 — 무음 앵커만으로 부분 동작

**예상 작업량** ~3시간 (포팅 1h + yebom TTS 컨텍스트와 통합 1h + iOS/Android 실기 검증 1h)

---
