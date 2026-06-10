# 예봄성경 — 에이전트(AI 개발 보조) 작업 규칙

> `CLAUDE.md` 가 위임하는 본 파일. AI 개발 도구가 본 저장소에서 동작할 때 따를 기준.

## 📚 문서 진입 경로

| 목적 | 진입 문서 |
|---|---|
| 현재 시스템 + 변경 이력 | [architecture.md](architecture.md) (living) |
| 모든 문서 인덱스 + 유지보수 규칙 | [documents.md](documents.md) (living) |
| 보류·차기 검토 | [plan.md](plan.md) (living) |
| 시스템 단면 상세 | [docs/](docs/) |
| 외부 계약 (SSO/AI/데이터) | 루트 `*_GUIDE.md` |

---

## 1. 기본 정책 (memory 반영)

| # | 규칙 | 출처 |
|---|---|---|
| 1 | **자동 commit/push 금지** — 사용자가 "commit & push" 명시 요청 시에만 git 진행 | feedback_local_first_workflow |
| 2 | **보류 사항은 [plan.md](plan.md) 단일 파일에 누적** — 기능별 문서 분리 X | feedback_plan_md |
| 3 | **빈도·심각도 낮은 이슈는 변경 자제** — 보험성 변경 제안 시 "변경 안 함" 옵션도 함께 제시 | feedback_low_freq_issues |
| 4 | **master 직접 push 허용** (예봄 계열은 master 가 기본 브랜치) — 단 명시 요청 시 |  |

## 2. 핵심 시스템 단면

### 인증·세션
- `hooks/useSession.ts`: iron-session 기반, race condition 차단 가드 (loading 중 리다이렉트 보류) + bfcache 복원 시 재검증
- 외부 SSO: `https://saint.yebom.org/login?from=bible` 으로 리다이렉트
- 상세: [AUTH_INTEGRATION_GUIDE.md](AUTH_INTEGRATION_GUIDE.md)

### 하단 5탭 IA
- `BottomTabBar` (목차/검색/읽기/책갈피/설정) — `view==="search"` 일 때만 렌더
- `SettingsSheet` — 계정/찬송가/예배성경/카드빌더/풀스크린/관리자/종료 통합
- 상세: [docs/IA_5TAB.md](docs/IA_5TAB.md)

### TTS 파이프라인
- `TtsContext` + `TTSMiniPlayer`. 3단 폴백: Cloud TTS (Chirp3-HD → Neural2) → WebSpeech
- 영문 분기: `en-US` / `en-GB` accent (사용자 토글)
- 캐시 키 v5: `version-book-ch-vs-voice-speed-accent`
- 상세: [docs/TTS_PIPELINE.md](docs/TTS_PIPELINE.md)

### 데이터 (Supabase)
- `bible_verses` 7개 version (nkrv/rnksv/easy/kjv/nirv/gnt/web)
- `bible_audio` 3개 version (easy/nkrv/web — WEB 은 R2 호스팅)
- `scraps` UNIQUE `(user_id, book_code, chapter, verse_start, version)`
- 상세: [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md)

### 모달·하드웨어 백
- `useHardwareBack` + `modalStack` 패턴. push/pop history state 로 브라우저 back 흡수
- 종료 팝업: `isAppRoot && !isHome` 상태 popstate 시
- 모달 X 버튼은 그립 영역과 pointer capture 충돌 주의 (`onPointerDown stopPropagation`)

## 3. 폴더 구조

```
app/                  Next.js App Router (page.tsx, api/, share/)
components/           UI 컴포넌트 (SearchPanel, VerseDisplay, TTSMiniPlayer, ...)
contexts/             React Context (TtsContext, FontContext)
hooks/                커스텀 훅 (useSession, useHardwareBack, useWakeLock)
lib/                  유틸·도메인 로직 (supabase, scrap, books, parseReference, tts/)
scripts/              1회성 운영 스크립트 (upload-*, gen-*, verify-*)
bible/                음원 원본 (gitignore)
docs/                 시스템 상세 문서
backup/               실효 문서 보관
```

## 4. 개발 컨벤션

### 코드
- Tailwind v4 + `var(--*)` 토큰 (paper/canvas/amber 계열)
- 다크모드: 시스템 추종 (`prefers-color-scheme`) + theme: light/dark/system 옵션
- `BibleVersion` 타입 확장 시: [lib/types.ts](lib/types.ts), [lib/versions.ts](lib/versions.ts), [components/SearchPanel.tsx](components/SearchPanel.tsx) 의 6개 배열 일관 갱신 필수

### 환경 변수 (`.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SESSION_SECRET                 # iron-session
GCP_SERVICE_ACCOUNT_JSON       # Cloud TTS (base64)
R2_ACCOUNT_ID                  # 영문 음원 호스팅 (옵션)
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE
```

### 빌드·배포
- 로컬 빌드: `npx next build`
- Vercel 자동 배포 (master push 시 webhook)
- TtsContext 변경 시 캐시 무효화 필요하면 `lib/tts/ttsCache.ts` 의 `DB_VERSION` bump

## 5. 위험 패턴 (사전 차단)

| 패턴 | 회피 |
|---|---|
| `requireAuth()` 즉시 호출 (loading 미체크) | `useSession().loading` 가드 + 토스트 안내 |
| pointer capture 영역 안에 클릭 버튼 | `onPointerDown={(e)=>e.stopPropagation()}` |
| `scraps` INSERT (UNIQUE 미인지) | API `SELECT-then-UPDATE/INSERT` 패턴 사용 |
| TTS 영문 본문에 ko-KR voice 사용 | `lang="en"` 자동 분기 (`isEnglishVersion`) |
| 캐시 키에 신규 분기 누락 | `makeCacheKey` 확장 + `DB_VERSION` bump |
| `BibleVersion` 신규 추가 시 일부 배열 누락 | SearchPanel 6개 + FullscreenReader + WorshipBible 모두 일관 갱신 |

## 6. 외부 의존성 컨택트

| 서비스 | 용도 | 가이드 |
|---|---|---|
| Supabase | DB + Storage(easy/nkrv 음원) | [성경데이터확장문서.md](성경데이터확장문서.md) |
| saint.yebom.org | SSO 로그인 hub | [AUTH_INTEGRATION_GUIDE.md](AUTH_INTEGRATION_GUIDE.md) |
| Cloudflare R2 | WEB 영문 음원 호스팅 | [docs/TTS_PIPELINE.md](docs/TTS_PIPELINE.md) |
| GCP Cloud TTS | 한국어/영문 합성음 | [docs/TTS_PIPELINE.md](docs/TTS_PIPELINE.md) |
| AI Gateway | 이미지 생성/편집/AI 추천 | [CLIENT_INTEGRATION_GUIDE.md](CLIENT_INTEGRATION_GUIDE.md) |

## 7. 변경 로그

본 파일은 **시스템 변경 사항을 직접 누적하지 않는다**. 상세는:
- 시스템 아키텍처 변경 이력 → [architecture.md](architecture.md) (living)
- 문서 체계 변경 → [documents.md](documents.md) (living)
- 보류·차기 검토 → [plan.md](plan.md) (living)
- commit 단위 변경 → `git log`
