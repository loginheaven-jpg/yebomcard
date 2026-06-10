# architecture.md — 시스템 아키텍처 (현행 + 변경 이력)

> **버전**: 0.5.0
> **최종 갱신**: 2026-06-11
> **상태**: living document — 모든 아키텍처 변경·신규 개발 사항은 본 파일의 **변경 이력** 섹션에 최상단부터 누적 기록한다.

본 문서는 예봄성경 / 예봄카드의 현재 아키텍처를 단일 소스로 기록한다.
시스템 단면별 상세는 [docs/](docs/) 폴더를 참조한다.
보류·차기 검토 사항은 [plan.md](plan.md) 에 누적된다.
역사적 v0.4.0 설계서는 [backup/architecture-v0.4.0.md](backup/architecture-v0.4.0.md) 보관.

---

## 📜 변경 이력 (최신 위)

### 2026-06-11 — AI 주제 추천 모든 version 호환
- 증상: mainVersion=KJV 에서 "추천된 구절을 DB에서 찾을 수 없습니다" 에러
- 원인: AI 가 한국어 책명("사도행전")만 반환 → SearchPanel 이 `book_name='사도행전'` 으로 KJV(`book_name='Acts'`) 조회 → 0건
- 수정: `lib/books.ts` 에 `getBookByName(name)` 신규 (한글/영문/약어/code 모두 인식). SearchPanel topic 조회를 `book_code` 매칭으로 변경
- 결과: KJV/NIrV/GNT/WEB 등 영문 mainVersion 에서도 주제 추천 정상 동작
- plan.md D 항목 완료 처리

### 2026-06-11 — 문서 체계 재정비
- architecture.md 를 living document 로 재구성. 변경 이력 누적 시작
- [documents.md](documents.md) 신규 — 문서 체계 단일 인덱스
- 실효 문서 16건 → [backup/](backup/) 격리
- [AGENTS.md](AGENTS.md) + [docs/TTS_PIPELINE.md](docs/TTS_PIPELINE.md) + [docs/IA_5TAB.md](docs/IA_5TAB.md) + [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md) 신규
- 기존 architecture.md v0.4.0 → [backup/architecture-v0.4.0.md](backup/architecture-v0.4.0.md) 이동

### 2026-06-11 — useSession race condition fix
- `hooks/useSession.ts`: `requireAuth()` 에 `loading` 가드 추가. 세션 fetch 미완료 중 외부 로그인 페이지로 점프하던 회귀 차단
- `pageshow` (event.persisted) 리스너 추가 — bfcache 복원 시 세션 자동 재검증
- `app/page.tsx`: `handleCreateCard` / `onOpenScrap` 가 `sessionLoading` 일 때 "로그인 확인 중..." 토스트 안내

### 2026-06-11 — 미니플레이어 single-toggle 패턴 + 0.7x 속도
- 미니플레이어 컨트롤 재구성: `[▶] [ref+bar] [AI/녹음] [속도] [발음] [음성] [⋮] [✕]`
- 발음(`미국식` ↔ `영국식`) / 음성(`여` ↔ `남`) single-button 즉시 전환 토글
- 설정창은 두 옵션 모두 노출(segmented), 플레이어는 현재 값만 노출 — 패턴 분리
- 재생 속도 `0.7x` 추가 (영문 청취 학습용). 7단계 그리드
- 누름 영역 ~2배 확대 (px-1 → px-3, text-9px → 11px)
- 본문 하단 가림 보정 — 4개 verse 스크롤 컨테이너 max-h 에 `env(safe-area-inset-bottom)` 동적 가산

### 2026-06-11 — 미니플레이어 라벨 단순화 + 캐시 키 accent 분기
- `Chirp/Neural2/Wavenet` → 단일 `AI` 라벨 (사용자 인지 통합)
- `KOR/ENG` 라벨 제거 (발음 토글 존재 자체로 영문 컨텍스트 암시)
- `ttsCache.makeCacheKey` 에 `accent` 필드 추가 → 같은 절도 미국식·영국식 별도 캐싱

### 2026-06-11 — 설정 시트 X 버튼 fix
- 그립 드래그 영역(`setPointerCapture`) 내부 X 버튼 click 가로채짐 해소
- `onPointerDown={(e) => e.stopPropagation()}` 추가 패턴

### 2026-06-10 — 영문 발음 분기 (en-US / en-GB)
- `/api/tts`: `accent` 파라미터 수용. `en-GB-Chirp3-HD-Aoede/Charon` voice 추가
- `TtsContext`: `englishAccent` state + `localStorage["yebom_tts_english_accent"]` 영속
- SettingsSheet 음성 섹션: `[여성][남성]` + `[미국식][영국식]` segmented 신설
- `DB_VERSION` 4→5 bump

### 2026-06-10 — 스크랩 중복 row 차단
- DB: `scraps_unique_per_user` UNIQUE `(user_id, book_code, chapter, verse_start, version)` 추가 + 기존 중복 20+ 그룹 정리
- API: SELECT-then-UPDATE/INSERT 패턴으로 재작성. UNIQUE 있든 없든 안전
- `handleSelectScrap` 가 `setMainVersion(version)` 동기화 — version 키 달라서 새 row 생성 차단

### 2026-06-10 — WEB 영문 음원 (Williams + R2)
- 1189장 mp3 (1.33 GB, 48 kbps mono) Cloudflare R2 bucket 적재
- `bible_audio` 1189 row upsert. 코드 변경 0줄 (TtsContext 이미 version 무관 동작)
- 영문 mainVersion=web 선택 시 "녹음" 배지 + 사람 낭독 mp3 자동 재생

### 2026-06-10 — WEB 역본 31,098절 + 영문 그룹 최상위
- `bible_verses` version=`web` 적재 (Classic, Yahweh 표기)
- 셀렉터 순서: 한국어 3종 → WEB → KJV → NIrV → GNT (WEB 영문 그룹 최상위)
- `EnglishVersion` 타입 + 6개 하드코딩 배열 일관 갱신

### 2026-06-10 — 영문 TTS voice 자동 분기 + 캐시 무효화
- `/api/tts`: `lang` 파라미터 수용. `isEnglishVersion(track.version)` 자동 판정
- 영문 역본(KJV/NIrV/GNT/WEB) → `en-US-Chirp3-HD` voice
- 장 안내 announcement: 영문이면 "Psalms chapter 23" 형식
- 절 prefix: 영문이면 "Verse 16." 형식
- `DB_VERSION` 3→4 bump

### 2026-06 — 글꼴 조정 미리보기 (Kindle 패턴)
- SettingsSheet 글꼴 섹션: 미리보기 카드 + 압축 바 모드
- 압축 모드: 본문 보이는 채로 사이즈/폰트 즉시 변경

### 2026-06 — 5탭 IA Phase 3 완료
- 시스템 다크 추종 (`FontContext.theme: "system"`)
- 그립 드래그 시트 닫기 (BottomSheet 패턴)
- 길게 누름(500ms) → 전체화면 진입
- QuickNavFab 우상단 고정 + 더블탭 위치 토글

### 2026-06 — 5탭 IA Phase 2 (a/b/c)
- 하단 `BottomTabBar` (목차/검색/읽기/책갈피/설정) 도입
- 통합 `SettingsSheet` — 우상단/하단 FAB 제거. 찬송가/예배성경/카드빌더/풀스크린/계정 흡수
- 상단 4탭(성경목차/본문검색/주제추천/책갈피) → 검색 세그먼트 + 책갈피 탭으로 흡수
- 좌하단 스크랩 FAB → 책갈피 메뉴 안 "스크랩" 버튼
- 좌우 스와이프 장 이동

### 2026-06 — 시각 토큰 시스템 (Phase 1)
- `--paper / --canvas / --paper-2 / --ink / --amber / ...` 토큰 도입
- amber 강조 색상 시스템
- sub 번역본 세로줄 (모바일 only)

---

## 1. 시스템 개요

### 1.1 서비스 정의

**예봄성경** — 한글·영문 7개 역본을 검색·낭독·카드로 만들 수 있는 PWA 웹 서비스.

- 본문 검색·열람 (목차·단어·주제 추천)
- 카드 만들기 (배경 이미지 + 절 텍스트 → PNG 다운로드)
- 사람 녹음 음원 + TTS 합성 통합 재생
- 스크랩 (개인 + 커뮤니티)
- 책갈피 + 최근 읽음 자동 추적
- 풀스크린 리더 모드

### 1.2 기술 스택

| 영역 | 선택 |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Style | Tailwind v4 (`@theme inline` + CSS 변수 토큰) |
| State | React Context (Tts, Font) + useState/useReducer |
| DB | Supabase Postgres |
| Storage | Supabase Storage (한글 음원) + Cloudflare R2 (영문 음원) |
| Auth | iron-session (cookie) + saint.yebom.org SSO |
| TTS | GCP Cloud TTS (Chirp3-HD → Neural2 → Web Speech 3단 폴백) |
| AI | AI Gateway (이미지 생성/편집/주제 추천) |
| Deploy | Vercel (master push 자동 배포) |

### 1.3 외부 의존성

| 서비스 | 용도 | 가이드 |
|---|---|---|
| Supabase | DB + Storage(easy/nkrv 음원) | [성경데이터확장문서.md](성경데이터확장문서.md) |
| saint.yebom.org | SSO 로그인 hub | [AUTH_INTEGRATION_GUIDE.md](AUTH_INTEGRATION_GUIDE.md) |
| Cloudflare R2 | WEB 영문 음원 호스팅 | [docs/TTS_PIPELINE.md](docs/TTS_PIPELINE.md#7-web-영문-음원-williams--r2) |
| GCP Cloud TTS | 한국어/영문 합성음 | [docs/TTS_PIPELINE.md](docs/TTS_PIPELINE.md) |
| AI Gateway | 이미지 생성/편집/추천 | [CLIENT_INTEGRATION_GUIDE.md](CLIENT_INTEGRATION_GUIDE.md) |

---

## 2. 컴포넌트 구조

### 2.1 폴더 레이아웃

```
app/                  Next.js App Router
  page.tsx              메인 상태 머신 (view, modal, 인증)
  api/
    tts/                Cloud TTS 프록시
    scrap/              스크랩 CRUD
    photos/             카드 배경 이미지
    auth/session        세션 조회
    ai/recommend        AI 주제 추천
  share/                공유 페이지 (절 + URL 파라미터)

components/
  SearchPanel             검색·목차·읽기 통합 (2000+ 줄)
  VerseDisplay            선택 절 표시 + 카드 만들기 진입
  CardPreview             카드 미리보기 + PNG 다운로드
  CardBuilder             다중 책 절 선택 빌더
  FullscreenReader        풀스크린 리더
  TTSMiniPlayer           재생 컨트롤 (하단 고정)
  BottomTabBar            5탭 네비 (목차/검색/읽기/책갈피/설정)
  SettingsSheet           통합 설정 시트
  ScrapList               스크랩 목록 (나의/커뮤니티)
  HymnModal               찬송가
  WorshipBible            예배성경
  QuickNavFab             우상단 빠른 네비

contexts/
  TtsContext              TTS 큐·재생·캐시
  FontContext             글꼴·테마(시스템 다크 추종)

hooks/
  useSession              인증 (loading 가드 + bfcache)
  useHardwareBack         모달 스택 + popstate
  useWakeLock             화면 켜짐 유지

lib/
  supabase                anon 클라이언트
  supabaseAdmin           service role (API only)
  scrap                   스크랩 fetch/CRUD
  books                   책 메타 (한글/영문 명, 약어)
  parseReference          한글 책명 → book_code
  versions                getVersionLabel + isEnglishVersion
  bookmark                책갈피 localStorage
  bibleAudio              bible_audio 매핑 lookup
  tts/
    cloudTtsClient          /api/tts 호출
    webSpeechClient         Web Speech 폴백
    ttsCache                IndexedDB 캐시
  auth/session            iron-session 정의

scripts/                  운영 1회성 (upload-*, gen-*, verify-*)

docs/                     시스템 단면 상세
backup/                   실효 문서 보관
```

### 2.2 핵심 패턴

**상태 머신 (`app/page.tsx`)**:
- `view: "search" | "display" | "card" | "scrap"` + 다수 modal boolean
- 각 view·modal 에 `useHardwareBack` 등록

**모달 스택 (`hooks/useHardwareBack`)**:
- 전역 `modalStack` 배열 + 단일 popstate listener
- 모달 push 시 history.pushState({modalId})
- UI 닫기 시 history.back() (skipPopstateCount 로 listener 회피)
- 상세: [docs/IA_5TAB.md §4](docs/IA_5TAB.md)

**TTS 큐 (`contexts/TtsContext`)**:
- `queueRef` + `playGenRef` (race 차단)
- 절 단위 트랙 + 장 안내 announcement + mp3 통째 트랙 (음원 모드)
- 캐시 → fetch → 폴백 3단
- 상세: [docs/TTS_PIPELINE.md](docs/TTS_PIPELINE.md)

**인증 (`hooks/useSession`)**:
- `/api/auth/session` 1회 fetch (mount) + bfcache 시 재검증
- `requireAuth()` 가 `loading` 가드 → race 차단
- 미로그인 시 saint.yebom.org 로 외부 리다이렉트
- 상세: [AUTH_INTEGRATION_GUIDE.md](AUTH_INTEGRATION_GUIDE.md)

---

## 3. 데이터 흐름

### 3.1 본문 조회

```
사용자: 책·장 선택 (목차/책갈피/QuickNav)
  ↓
SearchPanel: setMainVersion + setBookCode + setChapter
  ↓
useEffect → Supabase SELECT bible_verses WHERE version=main+book+chapter
  ↓
browseVerses 상태 갱신 → 화면 렌더
```

### 3.2 절 선택 → 카드 만들기

```
사용자: 절 클릭 (단일/다중)
  ↓
handleToggleVerse → selectedVerses 추가/제거
  ↓
사용자: "이 말씀으로 카드 만들기"
  ↓
handleCreateCard:
  1. requireAuth() 가드 + sessionLoading 토스트
  2. addScrapToServer(selectedVerses, mainVersion)
     → API: SELECT-then-UPDATE/INSERT (scraps)
  3. setView("card") → CardPreview
  4. CardPreview: AI 배경 추천 → PNG 합성 → 다운로드
```

### 3.3 TTS 재생

```
사용자: 미니플레이어 ▶ 또는 본문 길게 누름
  ↓
SearchPanel.handleTtsToggle → buildTtsTracks(browseVerses)
  ↓
tts.start({tracks, loadNextChapter})
  ↓
TtsContext.playIndex(0):
  1. transformWithChapterAudio: bible_audio lookup → mp3Url 채움
  2. injectChapterAnnouncements: "Genesis chapter 1" 안내 삽입
  3. 트랙별:
     - mp3Url 있으면 <audio> 직재생
     - 없으면 IndexedDB cache get
        - hit → blob 재생
        - miss → /api/tts POST {text, voice, speed, lang, accent}
                → blob 캐시 + 재생
                → 401/500 시 WebSpeechController.speak() 폴백
```

### 3.4 인증 흐름

```
페이지 mount
  ↓
useSession effect: fetch /api/auth/session
  ↓
응답: { session: { isLoggedIn, user_id, name } | null }
  ↓
loading=false, session=값 또는 null

사용자: 보호 액션 (스크랩/카드/링크)
  ↓
requireAuth():
  - loading=true → false 반환 ("로그인 확인 중..." 토스트)
  - session.isLoggedIn → true 반환 → 액션 진행
  - 그 외 → window.location.href = "https://saint.yebom.org/login?from=bible"

bfcache 복원 (모바일 백그라운드 → 포그라운드)
  ↓
pageshow event.persisted=true
  ↓
useSession refresh() → /api/auth/session 재조회 → loading 잠시 true → 응답 도착
```

---

## 4. 데이터 모델

상세 + UNIQUE 정책 + 마이그레이션 이력은 [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md) 참조.

핵심 테이블:
- `bible_verses` — 본문 (7 version × ~31,000절)
- `bible_audio` — 장 단위 음원 매핑 (3 version × 1,189장)
- `scraps` — 사용자 스크랩 (UNIQUE per user)
- `user_photos` — 카드 배경

클라이언트 영속:
- `localStorage["yebom_main_version"]`, `_sub_version`, `_tts_voice`, `_tts_speed`, `_tts_english_accent`, `_tts_auto_next`, `_tts_read_verse_number`, `_bookmarks`, `_quicknav_pos`
- `IndexedDB["yebom_tts_cache"]` (DB_VERSION 5)

---

## 5. 환경 변수

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://....supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# 인증
SESSION_SECRET=...                  # iron-session

# TTS
GCP_SERVICE_ACCOUNT_JSON=...        # base64 인코딩

# WEB 영문 음원 (R2)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=attached
R2_PUBLIC_BASE=https://pub-....r2.dev

# AI Gateway (CLIENT_INTEGRATION_GUIDE 참조)
AI_GATEWAY_URL=...
AI_GATEWAY_KEY=...
```

---

## 6. 배포 + 운영

- **빌드**: `npx next build`
- **로컬 dev**: `npm run dev`
- **Vercel**: master push 시 자동 배포 (webhook)
- **DB 변경**: Supabase MCP 또는 Dashboard SQL 에디터
- **음원 적재**: `scripts/upload-*.mjs` 로컬 실행 (자격증명 .env.local)
- **캐시 무효화**: `lib/tts/ttsCache.ts` `DB_VERSION` bump → 다음 사용자 접속 시 IndexedDB 재생성

---

## 7. 위험 패턴 (사전 차단)

| 패턴 | 회피 |
|---|---|
| `requireAuth()` 즉시 호출 | `useSession().loading` 가드 |
| pointer capture 안에 click 버튼 | `onPointerDown stopPropagation` |
| `scraps` INSERT (UNIQUE 미인지) | API SELECT-then-UPDATE 패턴 |
| TTS 영문 본문 ko-KR voice | `lang="en"` 자동 분기 |
| 캐시 키 신규 분기 누락 | `makeCacheKey` 확장 + `DB_VERSION` bump |
| `BibleVersion` 신규 추가 시 배열 누락 | 6+ 위치 일관 갱신 ([docs/DATA_SCHEMA.md §9](docs/DATA_SCHEMA.md#9-bibleversion-신규-추가-체크리스트)) |

---

## 8. 관련 문서

| 문서 | 역할 |
|---|---|
| [documents.md](documents.md) | 문서 체계 인덱스 + 유지보수 규칙 |
| [AGENTS.md](AGENTS.md) | AI 개발 보조 작업 규칙 |
| [plan.md](plan.md) | 보류·차기 검토 단일 누적 |
| [docs/TTS_PIPELINE.md](docs/TTS_PIPELINE.md) | TTS 단면 |
| [docs/IA_5TAB.md](docs/IA_5TAB.md) | 5탭 IA + 모달 스택 |
| [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md) | Supabase 스키마 |
| [AUTH_INTEGRATION_GUIDE.md](AUTH_INTEGRATION_GUIDE.md) | SSO 계약 |
| [CLIENT_INTEGRATION_GUIDE.md](CLIENT_INTEGRATION_GUIDE.md) | AI Gateway 계약 |
| [성경데이터확장문서.md](성경데이터확장문서.md) | 한글 역본 적재 가이드 |
