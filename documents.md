# documents.md — 문서 체계 (living index)

> **버전**: 1.0
> **최종 갱신**: 2026-06-11
> **상태**: living document — 새 문서 생성·실효·갱신 시 본 파일에 반영

본 파일은 예봄성경 / 예봄카드 저장소의 모든 문서 자산을 단일 인덱스로 관리한다.
새 문서를 생성하거나 기존 문서를 backup 으로 이동할 때마다 본 파일의 **현재 문서 트리** 와 **변경 이력** 을 함께 갱신한다.

---

## 📋 현재 문서 트리

### 루트 (시스템 진입점·외부 계약·운영 규칙)

| 문서 | 카테고리 | 역할 | 갱신 정책 |
|---|---|---|---|
| [CLAUDE.md](CLAUDE.md) | 메타 | AI 도구 진입점 — `@AGENTS.md` 위임 마커 (11B) | 거의 불변 |
| [AGENTS.md](AGENTS.md) | 운영 규칙 | 코딩 규칙·시스템 단면·환경변수·위험 패턴 | 정책 변경 시 |
| [architecture.md](architecture.md) | 시스템 | 현재 아키텍처 + **변경 이력 누적** (living) | **모든 아키텍처 변경 시 변경 이력 섹션 갱신** |
| [documents.md](documents.md) | 메타 | 본 파일 — 문서 체계 인덱스 | 문서 생성·실효·이동 시 |
| [plan.md](plan.md) | 운영 | 보류·차기 검토 단일 누적 | 보류 항목 추가/완료 시 |

### 외부 계약 가이드 (외부 사용자·서비스 연동용)

| 문서 | 카테고리 | 역할 | 갱신 정책 |
|---|---|---|---|
| [AUTH_INTEGRATION_GUIDE.md](AUTH_INTEGRATION_GUIDE.md) | 인증 계약 | saint.yebom.org SSO 통합 가이드 | SSO 인터페이스 변경 시 |
| [CLIENT_INTEGRATION_GUIDE.md](CLIENT_INTEGRATION_GUIDE.md) | AI 계약 | AI Gateway 연동 가이드 | Gateway API 변경 시 |
| [성경데이터확장문서.md](성경데이터확장문서.md) | 데이터 가이드 | 한글 3개 역본 적재 가이드 | 한글 역본 확장 시 |

### docs/ (시스템 단면 상세)

| 문서 | 카테고리 | 단면 | 갱신 정책 |
|---|---|---|---|
| [docs/TTS_PIPELINE.md](docs/TTS_PIPELINE.md) | TTS | 3단 폴백 / 캐시 v5 / accent 분기 / WEB R2 음원 / 미니플레이어 패턴 | TTS 정책·인프라 변경 시 |
| [docs/IA_5TAB.md](docs/IA_5TAB.md) | UI/UX | BottomTabBar(6탭) + SettingsSheet + QuickNavFab + 모달 스택 / 좌우 스와이프 / 다크 추종 | IA 또는 탭 정책 변경 시 |
| [docs/READING_PLAN.md](docs/READING_PLAN.md) | 말씀의삶 | 플랜 층 설계 — 판정 규칙(entryChapter/nextChapter) · 경계 장 10개 · 플랜 모드 개입 지점 · TTS 세 묶음 | 플랜 정책·판정 규칙 변경 시 |
| [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md) | 데이터 | bible_verses/bible_audio/scraps + UNIQUE 정책 + RLS + 마이그레이션 + BibleVersion 추가 체크리스트 | DB 스키마·정책 변경 시 |

### docs/tasks/ (진행 중 작업 지시서)

작업이 끝나면 `backup/` 으로 옮긴다.

| 문서 | 상태 | 내용 |
|---|---|---|
| [docs/tasks/말씀의삶_클코_작업지시서_v1.1.md](docs/tasks/말씀의삶_클코_작업지시서_v1.1.md) | **확정본** | 성경읽기진도표 91회차 북클럽 — 단계 0~4. §번호는 v1 유지 |
| [docs/tasks/말씀의삶_주요화면시안.html](docs/tasks/말씀의삶_주요화면시안.html) | 별첨 | 화면 A~D 시안. 단, 시안 D 의 "먼저 마친 사람이 위" 는 폐기(v1.1 §6.3) |
| [docs/tasks/말씀의삶_클코_작업지시서_v1.md](docs/tasks/말씀의삶_클코_작업지시서_v1.md) | 이력 | v1.1 로 대체. 검토 경과 확인용 |

### backup/ (실효 보관 — git 이력 보존)

| 문서 | 실효 사유 |
|---|---|
| [backup/architecture-v0.4.0.md](backup/architecture-v0.4.0.md) | v0.4.0 기준. living architecture.md 로 대체 |
| [backup/ADD_WEB_BIBLE.md](backup/ADD_WEB_BIBLE.md) | WEB 적재 완료된 1회성 작업 지시서 |
| [backup/AI_IMAGE_GENERATION_REQUEST.md](backup/AI_IMAGE_GENERATION_REQUEST.md) | 외부 요청 1회성 (AI Gateway 통합 후 결과는 CLIENT_INTEGRATION_GUIDE 에 흡수) |
| [backup/AI_IMAGE_EDIT_REQUEST.md](backup/AI_IMAGE_EDIT_REQUEST.md) | 위와 동일 |
| [backup/SSO_SUPPLEMENT.md](backup/SSO_SUPPLEMENT.md) | useSession 완성 + AUTH_INTEGRATION_GUIDE 통합으로 실효 |
| [backup/design/redesign-review.md](backup/design/redesign-review.md) | Phase 2a~3 commit 으로 코드 반영 완료된 검토 보고서 |
| backup/design/*.html (12개) | UI 시안 — Phase 2a~3 commit 으로 코드 반영 완료 |

---

## 📝 문서 유지보수 규칙

### 1. 새 문서 생성 시

**시스템 단면 신규?** → [docs/](docs/) 에 작성
- 예: `docs/CARD_PIPELINE.md`, `docs/SEARCH_RECOMMENDATION.md`

**외부 계약 신규?** → 루트에 작성
- 예: `EXTERNAL_PARTNER_INTEGRATION_GUIDE.md`

**운영 규칙·정책?** → [AGENTS.md](AGENTS.md) 에 흡수 (별도 파일 만들지 않음)

**보류·차기 검토 항목?** → [plan.md](plan.md) 에 누적 (별도 파일 X)

→ **본 documents.md 의 "현재 문서 트리" 표에 새 항목 추가 + 갱신 정책 명시**

### 2. 기존 문서 실효 시

- 1회성 작업 완료 (작업 지시서, 요청서) → backup 이동
- 시안·prototype 이 코드에 반영됨 → backup 이동
- 동일 주제의 신규 문서가 통합 흡수함 → backup 이동
- 외부 의존성 deprecated → backup 이동

**이동 명령**: `git mv 원본 backup/`
**본 documents.md 갱신**: backup/ 표에 추가 + 실효 사유 1줄

### 3. 기존 문서 갱신 시

- 갱신 정책 컬럼에 따라 책임 발생 시점에 갱신
- 큰 변화는 architecture.md 의 변경 이력에도 1줄 기록 (시스템 영향 있을 때)

### 4. backup 폴더 정리

- 1주~1개월 무참조 시 영구 삭제 검토 (`git rm -r backup/<file>`)
- git 이력에 보존되므로 복구 가능

---

## 🗺 카테고리 별 진입 경로

### 새 개발자·AI 도구가 처음 진입할 때

1. [CLAUDE.md](CLAUDE.md) → [AGENTS.md](AGENTS.md) (코딩 규칙·시스템 단면 요약)
2. [architecture.md](architecture.md) (현재 아키텍처 + 변경 이력)
3. 필요한 단면 → [docs/](docs/)
4. 보류 사항 → [plan.md](plan.md)

### 외부 서비스 통합 담당자가 진입할 때

- 인증: [AUTH_INTEGRATION_GUIDE.md](AUTH_INTEGRATION_GUIDE.md)
- AI: [CLIENT_INTEGRATION_GUIDE.md](CLIENT_INTEGRATION_GUIDE.md)
- 성경 데이터: [성경데이터확장문서.md](성경데이터확장문서.md)

### 특정 시스템 단면 작업 시

- TTS · 음원: [docs/TTS_PIPELINE.md](docs/TTS_PIPELINE.md)
- UI · IA · 모달: [docs/IA_5TAB.md](docs/IA_5TAB.md)
- 스키마 · 마이그레이션: [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md)

---

## 📜 변경 이력 (최신 위)

### 2026-06-11 — 문서 체계 v1.0 출범
- documents.md 신규 (본 파일)
- architecture.md → living document 재구성 (v0.5.0). 변경 이력 누적 시작
- 기존 architecture.md v0.4.0 → `backup/architecture-v0.4.0.md`
- 실효 문서 16건 격리 (4 tracked rename + 12 untracked archive)
- AGENTS.md + docs/TTS_PIPELINE.md + docs/IA_5TAB.md + docs/DATA_SCHEMA.md 신규

---

## 💡 원칙 요약

1. **단일 소스**: 각 시스템 단면은 한 곳에서만 깊게 다룬다. 중복 작성 금지.
2. **계층 분리**: 진입점(CLAUDE/AGENTS) → 비전·이력(architecture) → 단면(docs/) → 외부 계약(루트 가이드)
3. **living 문서**: architecture.md / documents.md / plan.md 3종이 살아있는 누적 문서.
4. **실효 격리**: 1회성·중간 산출물·deprecated 는 backup/ 으로 즉시 격리. 루트 오염 방지.
5. **갱신 정책 명시**: 본 documents.md 표에 각 문서의 "언제 갱신해야 하는가" 컬럼 유지.
