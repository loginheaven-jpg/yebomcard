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
| 1 | **작업을 마치면 항상 commit & push** — 사용자가 그 작업에 대해 미리 특별히 금한 경우만 예외 (2026-09-10 지시, 이전 '명시 요청 시에만' 규칙 대체). 비밀값·임시 파일은 파일을 지정해 add 하여 제외 | feedback_local_first_workflow |
| 2 | **보류 사항은 [plan.md](plan.md) 단일 파일에 누적** — 기능별 문서 분리 X | feedback_plan_md |
| 3 | **빈도·심각도 낮은 이슈는 변경 자제** — 보험성 변경 제안 시 "변경 안 함" 옵션도 함께 제시 | feedback_low_freq_issues |
| 4 | **master 직접 push** (예봄 계열은 master 가 기본 브랜치) — push 후 운영 반영까지 확인 |  |

## 2. 핵심 시스템 단면

### 인증·세션
- `hooks/useSession.ts`: iron-session 기반, race condition 차단 가드 (loading 중 리다이렉트 보류) + bfcache 복원 시 재검증
- 외부 SSO: `https://saint.yebom.org/login?from=bible` 으로 리다이렉트
- 상세: [AUTH_INTEGRATION_GUIDE.md](AUTH_INTEGRATION_GUIDE.md)

### 하단 6탭 IA
- `BottomTabBar` (**성경**/검색/**말씀의삶**/찬송가/책갈피/설정) — `view==="search" || view==="plan"` 일 때 렌더.
  **세 자리의 역할**(2026-09-17 지휘부): 하단 탭 = 자주 가는 곳 · ⋮ = 지금 이 말씀을 어떻게 볼까(+ 로그인·앱 설치) ·
  설정 = 한 번 정해 두는 것. 2026-09-17 목차+본문을 **성경** 하나로(읽는 중에 누르면 목차, 그 밖에선 마지막 읽던 곳)
  합치고 말씀의삶을 탭으로 돌려놓았다. 찬송가는 화면이 아니라 **창**이라 눌러도 view 가 바뀌지 않는다(설정 탭과 같은 꼴).
  **⋮ 을 누르면 하단 탭바가 함께 올라온다**(메뉴가 열린 동안 자동 숨김 멈춤 + 탭바를 메뉴 막 위로) — [docs/IA_5TAB.md](docs/IA_5TAB.md) §0
- **말씀의삶** — 성경읽기진도표 91회차. 플랜 정의는 정적 파일 `lib/plans/yebom91.ts`,
  회차 완료는 `reading_progress` 에서 **파생 계산**(저장하지 않음). 수동 체크만 `reading_unit_checks`.
  비로그인 = 보기만 / 로그인 = 진도 기록 / 그룹 = 서로의 진도. 진입 때 한 번 그룹 초대코드 창(`GroupCodePrompt` — 참여·건너뛰기 후엔 그 기기에서 다시 안 물음, 비로그인은 로그인 후 자동 참여).
  **초대링크**(2026-09-17): 그룹 카드 코드 옆 '초대링크' → `/?join=코드`. 누르면 말씀의삶이 열리고, 로그인돼 있으면 곧바로 참여,
  아니면 '로그인하고 참여' 한 번(코드는 로그인하러 떠나기 직전에 기기에 적고, 돌아오면 page.tsx 가 말씀의삶을 열어 참여시킨다) — [docs/READING_PLAN.md](docs/READING_PLAN.md).
  진입은 하단 **말씀의삶 탭**(2026-09-17 복귀). 탭바 자동 숨김에서 제외하고 `useHardwareBack` 을 등록해
  키보드 격리까지 해야 한다 — [docs/IA_5TAB.md](docs/IA_5TAB.md) §1 참조
- `SettingsSheet` — 계정 · 화면 · 음성 · 앱 정보(관리자 포함). 2026-09-17 찬송가 카드와 '도구'(예배성경·성경카드·앱 설치)를 지웠다 — 탭·⋮ 에 있다
- **화면 머리줄 — 모든 화면이 한 틀**(`SearchPanel`, 2026-09-17): `[왼쪽 두 줄 제목] … [오른쪽 40px 조작]` 한 줄 44px.
  본문 = `민수기 5 / 총 36장 · 역본 · 대역 · 읽기 · ⋮`, 목록 화면(첫 화면·검색·주제·목차·장 목록) = `제목 · 역본 · ⋮`
  (첫 화면만 Yebom 로고, 장 목록 제목은 `‹ 민수기` 로 누르면 목차). 칩·⋮·플레이어 줄은 한 벌을 함께 쓴다
  (`mainVersionChip`·`subVersionChip`·`moreMenu`·`playerRow`). 옛 3칸 줄의 ⇄·'가' 는 없앴다.
  재생 중엔 모든 화면에서 머리줄 아래에 인라인 플레이어 — 본문은 끝에 ▾ 접기(끝내기는 위 읽기 버튼), 목록 화면은 ✕ 듣기 종료.
  패널이 가려진 화면(말씀의삶·카드)에서는 인라인을 그리지 않아 떠 있는 플레이어가 나온다(`isActiveView`)
- **⋮ 메뉴**(모든 화면) — 글자 크기 · 한 절씩 크게(절이 보이는 화면만) · 예배성경 · 앱으로 설치 · 로그인(로그아웃).
  말씀의삶은 2026-09-17 탭으로 갔다. 안드로이드 뒤로가기로 메뉴만 닫힌다
- **본문 몰입 — 하단 탭바 자동 숨김**: 본문(`browseStep==="verse"`)에서 무조작 3초 → 아래로 슬라이드 감춤(얇은 손잡이만 남김). 복귀 = 하단 손잡이 탭 + 위로 스크롤(본문은 내부 컨테이너 스크롤이라 `window` **capture** 로 수집). 리빌 존은 `safe-area-inset-bottom` 위 28px 에 두어 iOS 홈 인디케이터 제스처와 분리. 상태는 `app/page.tsx` 소유(`tabBarHidden`), SearchPanel 은 `onReadingViewChange` 로 본문 여부만 보고. 설정 토글 `본문 볼 때 하단 메뉴 자동 숨김`(기본 ON, `yebom_autohide_tabbar`). 숨겨도 본문 컨테이너 높이(`browseScrollMaxH`)는 그대로 두어 **리플로우 없음**
- 상세: [docs/IA_5TAB.md](docs/IA_5TAB.md)

### TTS 파이프라인
- `TtsContext` + `TTSMiniPlayer`(속도·재생/정지 + **한국어 성우 선택** 팝오버). 발음/자동다음장/절번호는 `SettingsSheet`(성우도 병행).
- **한국어 성우 — 역본별 목록**(`app/api/tts/route.ts` `KOREAN_VOICE_CONFIG`, 2026-09-11 개편):
  - 새번역(`TtsContext` `KOREAN_VOICE_ORDER`): 여 영희(f4)·생생(f2)·김단아(f1) │ 남 쾌활(m2, 예전 '활력')·천사장(m1). 기본 영희
  - 개역·통독(`RECORDED_VOICE_ORDER`, 새번역과 따로 기억 `recordedVoice`): 생생·쾌활·성우(사람 녹음, 장 통째). 기본 성우. 생생·쾌활이면 녹음을 찾지 않고 절 단위(`wantsRecording`). 성우를 골라도 녹음 없는 장·전체화면은 생생. 재생 중 녹음 ↔ AI 를 바꾸면 지금 장을 처음부터 다시(`setRecordedVoice`)
  - **지성(f3)·감미(m3)·품격(m4)·할부지(m5)(Supertone)는 선택 목록에서 뺌**(`RETIRED_KOREAN_VOICES`, 2026-09-11, 서버 설정은 남김). 옛 저장값은 목록 개편 때 한 번 정리(`VOICE_LINEUP`)
  - 엔진: 천사장·김단아=ElevenLabs / 생생·쾌활=GCP Chirp3-HD / 영희=사전 생성(R2, 새번역) — 음원이 없는 절은 김단아가 대신 읽고 **김단아 키로** 캐시. 생생·쾌활 캐시 칸은 쉼표 쉼 전 음원을 피해 `f2-p`·`m2-p`(`koVoiceCacheSlot`/`cacheVoiceSlot`)
  - **대신 읽기 순서(모든 성우 같은 규칙, 2026-09-11)**: 고른 성우(음원 → 생성) → 영희 음원 → 김단아(음원 → 11labs 생성) → GCP **Chirp3-HD(고른 성우 성별)** → Neural2 → WaveNet → WebSpeech. 각 단계 한 번씩만(`route.ts` `KOREAN_STAND_INS` — 성우끼리 서로를 통째로 부르지 않아 돌고 돌지 않음). 생성 산출물은 그 성우 키로 저장, GCP 폴백은 저장 안 함
  - **한국어 Chirp 는 쉼표를 무시한다**(Google 쪽 문제) → `markup` 입력 + 쉼표마다 `[pause short]`(`route.ts` `koChirpMarkup`, 본문 `[ ]` 는 괄호 글자만 뺌, 거절되면 글자로 다시)
  - Supertone: 요청당 300자 제한 → `splitForSupertone` 문장분할+이어붙이기, 속도는 `voice_settings.speed`, 클론은 `model=supertonic_api_3`+style 생략
  - **기본 성우**: 새번역 영희(f4, `DEFAULT_KOREAN_VOICE`), 개역·통독 성우(녹음, `DEFAULT_RECORDED_VOICE`)
- **서킷 브레이커 + 헬스**(`lib/tts/engineHealth.ts`, `app/api/tts/health`):
  - ElevenLabs/Supertone 가 401/402/403/429/타임아웃이면 해당 엔진을 쿨다운(10분) `down` 표시 → 그 동안 1순위 시도 건너뛰고 폴백 직행(매 절 실패 왕복 제거). 성공 시 자동 복구.
  - `/api/tts/health`(5분 캐시): EL `subscription`·Supertone `/credits` 로 잔여 판단 + 브레이커 병합 → 클라(`ttsHealth`)가 소진/장애 성우를 **disable+뱃지**(소진/키오류/미설정/지연). `koreanVoiceStatusFrom`.
- 영문: GCP Chirp3-HD(`en-US`/`en-GB` accent) → Neural2 → WebSpeech
- **비용 절감(공유 캐시)**: 합성은 항상 **1.0x** 로만 하고 재생 속도는 클라이언트 `playbackRate`(녹음과 동일). `app/api/tts` 가 합성 전 **R2 공유 캐시**(`lib/tts/r2Cache.ts`, 키 `tts/v1/{ko|en}/{voiceKey}/{sha1(본문)}.mp3`) 조회→hit 시 서빙(`X-TTS-Cache: hit`). canonical(요청 성우 1순위 산출물: 영문/한국어 Chirp, 또는 EL/Supertone 성공)만 업로드 → 절·성우당 **전역 1회만 합성**(교인 N명=1회). 폴백 산출물은 캐시 안 함. 본문 변경은 sha1 로 자동 무효화, 엔진 재매핑은 `TTS_CACHE_VERSION` bump.
- 클라 캐시 키: `version-book-ch-vs-voice-accent` (speed 제외 — playbackRate). 한국어는 voice 슬롯에 koreanVoice. 엔진 재매핑 시 `ttsCache.ts` `DB_VERSION` bump. 다음 절 프리페치(`prefetchIndex`)로 절 사이 무음 제거.
  - **대신 읽은 음원은 기기에 저장하지 않는다**(모든 성우 — `TtsContext` `isStandInAudio`: 고른 성우의 표지가 아니면 세션 메모리만, 이미 저장된 것도 무시). 캐시 키에 본문도 실제 목소리도 없어, 저장하면 고른 성우 음원이 생기거나 엔진이 돌아와도 대신 읽은 음원이 계속 나온다
- **절 음원 다시 만들기(관리자)**: 절 선택 팝업 '음원 다시 만들기' 또는 새번역 본문 수정 저장 → `voice-studio/verse-regen` 요청 → 생성 PC 가 10분 안에 가져가 먼저 만들고 기존 음원을 덮어씀(`lib/voiceStudio/verseRegen.ts`). 결과는 관리자 '보류 절 검수' 아래 목록
- **고른 절부터 읽기**: 본문에서 절을 고른 채 읽기를 누르면 고른 절(여럿이면 읽는 순서로 맨 앞)부터 — 절 단위 음원일 때만(장 통째 녹음은 처음부터, `tts.start()` 가 절 단위 여부를 돌려줌). 시작하면 선택을 푼다(다른 장 절까지 모아 둔 중이면 유지). 2초 동안 `N절부터 읽습니다` 아래 `처음부터 │ 확인`(기본 = 고른 절부터, 처음부터 = 장 처음부터 다시)
- 상세: [docs/TTS_PIPELINE.md](docs/TTS_PIPELINE.md)

### 음원 생성 PC 무리 (여러 대 · 며칠짜리 작업)

**진행 상황을 물으면 추측하지 말고 이 한 줄을 실행한다** — 모든 PC 의 현황이 서버에 모여 있다:

```bash
python C:\dev\yebomcard\voice\fleet_cli.py status      # --json 으로 기계가 읽을 형태
python C:\dev\yebomcard\voice\fleet_cli.py books       # 책 배분
python C:\dev\yebomcard\voice\fleet_cli.py log         # 최근 지시와 결과
```

지시도 같은 도구로 보낸다(`stop` · `resume` · `batch N` · `queue 책,책` · `replace 구약|신약` ·
`regen "창세기 1:1,…"`, `--pc 이름` 으로 한 대만). 각 PC 가 **10초 안에** 가져가 실행하고 결과를
`log` 에 적는다 — 즉시 반영되지 않는 것이 정상이다. 사람은 `설정 → 관리자 → 음원 생성 현황`
에서 같은 것을 보고, 책 배분을 고정·차단·회수로 조정한다.

- 각 PC 는 스튜디오(`voice/app.py`)를 켜면 `fleet.py` 가 함께 돌며 보고·수신·임대를 맡는다
- **전체 생성**을 켠 PC 는 진도표(`voice/plan.py`) 순서로 책을 하나씩 빌려 혼자 진행한다.
  여러 대가 붙어도 서버가 겹치지 않게 나눠 준다
- **운영 전반은 [docs/VOICE_OPERATIONS.md](docs/VOICE_OPERATIONS.md)** — 런북 · 기준값과 근거 · 하지 말 것 · 새 성우 절차 · 남은 일.
  음원 생성은 2026-09-16 부터 **별도 대화**에서 다룬다(앱 개발 대화와 분리). 설계 근거는 [voice/README.md](voice/README.md)

### 데이터 (Supabase)
- `bible_verses` 7개 version (nkrv/rnksv/easy/kjv/nirv/gnt/web)
- `bible_audio` 3개 version (easy/nkrv/web — WEB 은 R2 호스팅)
- `scraps` UNIQUE `(user_id, book_code, chapter, verse_start, version)`
- 상세: [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md)

### 모달·하드웨어 백
- `useHardwareBack` + `modalStack` 패턴. push/pop history state 로 브라우저 back 흡수
- 종료 팝업: `isAppRoot && !isHome` 상태 popstate 시
- 모달 X 버튼은 그립 영역과 pointer capture 충돌 주의 (`onPointerDown stopPropagation`)
- **trivial/gesture history intervention 안전망**: Chrome/Edge 가 항목 1개 탭 또는 제스처 없는 `pushState` 를 강등 → history 트랩 무력화로 뒤로가기 무확인 종료. **로그인+비PWA 브라우저 탭에 `beforeunload` 무장**(`lib/appExit` 의도적 이탈 우회)으로 차단. `useHardwareBack` 닫기 `back()` 은 실제 length 증가 시에만. 상세: [architecture.md](architecture.md) 2026-06-12 변경 이력

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
ELEVENLABS_API_KEY             # 한국어 성우 m1 천사장/f1 김단아 (로컬은 11LABS 도 인식)
SUPERTONE_API_KEY              # 한국어 성우 m3 Watson/m4 Garret/m5 Daddy(클론)/f3 Cindy
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
| 로그인 게이트에 `loading` 미체크 (race) | `useLoginGate().ensureLogin(label)` (loading 가드+인앱 모달 내장) |
| history `pushState` 트랩만으로 뒤로가기 종료 차단 | Chrome trivial/gesture intervention 으로 강등됨 → `beforeunload` 안전망 병행(로그인+비PWA) |
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
