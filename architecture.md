# architecture.md — 시스템 아키텍처 (현행 + 변경 이력)

> **버전**: 0.7.0
> **최종 갱신**: 2026-09-09
> **상태**: living document — 모든 아키텍처 변경·신규 개발 사항은 본 파일의 **변경 이력** 섹션에 최상단부터 누적 기록한다.

본 문서는 예봄성경 / 예봄카드의 현재 아키텍처를 단일 소스로 기록한다.
시스템 단면별 상세는 [docs/](docs/) 폴더를 참조한다.
보류·차기 검토 사항은 [plan.md](plan.md) 에 누적된다.
역사적 v0.4.0 설계서는 [backup/architecture-v0.4.0.md](backup/architecture-v0.4.0.md) 보관.

---

## 📜 변경 이력 (최신 위)

### 2026-09-11 — 영희의 대신 읽기 음원을 기기에 저장하지 않음
- **증상**: 롬 3:10·3:13 이 서버엔 영희 음원이 있는데(09:49 업로드) 휴대폰에서 김단아로 나왔다
- **원인**: 기기 캐시(IndexedDB) 키는 `version-book-ch-vs-voice` 라 **본문이 없다**. 영희 음원이 아직 없을 때 들은 절은 서버가 김단아로 대신 읽어 주는데, 그 음원이 기기에 저장되면 나중에 영희 음원이 생겨도 그 기기는 계속 김단아를 튼다. 기본 성우가 영희가 된 뒤로는 교인 누구에게나 생긴다(구약 대부분이 아직 생성 중)
- **해결**: 사전 생성 성우(f4)를 골랐는데 서버가 준 음원의 `X-TTS-Voice` 가 `voice:f4` 가 아니면 대신 읽기 음원으로 보고 기기에 저장하지 않는다(이 세션 메모리에만 — 절 사이 끊김 방지). 이미 저장된 대신 읽기 음원도 무시하고 서버에 다시 묻는다 — `DB_VERSION` 을 올리지 않아도 영희 음원이 생기는 즉시 모든 기기에서 영희로 나온다. `TtsContext` `isPregeneratedFallback` / `rememberAudio`

### 2026-09-11 — 음원 보류 검수: 관리자 화면에 보류가 안 보이던 문제
- **증상**: 새 PC 생성 탭엔 보류가 있는데 설정 → '음원보류절 검수'는 "전부 정상". 이 PC 의 갈 3:7 보류도 사라짐
- **원인 1 — 보고 크기**: 보류 목록에 음원을 전부 실어 한 요청으로 보냈다. 새 PC 보류 22개 음원만 base64 4.08MB — 서버 요청 한도(4.5MB)에 걸려 2026-09-10 오후부터 보고가 통째로 거절됐다
- **원인 2 — 덮어쓰기**: 서버는 PC 마다 목록을 통째로 갈아끼우는데, PC 는 **지금 작업(책)의 보류만** 보냈다. 보류 0 인 책이 끝나면 앞 책의 보류가 지워졌다
- **원인 3 — 판단 반영**: 재생성 요청은 그 절이 든 작업이 **끝날 때**만 확인했다(끝난 책은 영영, 구약을 한 작업으로 도는 PC 는 며칠 뒤). '이대로 사용'은 PC 에 알려지지 않아 생성 탭 보류 숫자가 줄지 않았다
- **해결**: 목록은 음원 없이 보내고 서버에 없는 음원만 한 건씩(`POST held/audio`, 응답 `missingAudio`). 들을 수 있는지는 관리자 화면이 실제 파일로 판단. PC 는 보류를 작업 전부에서 모아 보고. 10분마다 관리자 판단을 모든 작업에 반영 — 재생성 요청은 다시 만들고(끝난 작업은 큐에 다시), 이대로 사용은 합격·업로드됨으로 표시(`held/tasks` 가 `decided` 도 준다)
- **로컬 스튜디오 '3. 검수' 탭**: 이 PC 작업 파일의 절별 결과 — 행을 눌러 들을 수 있다. 판단은 관리자 화면에서 한다(탭에 안내 문구)
- **후속 5 — 나눠 만든 절의 조각 끝**: 새 방식도 나눠 만들면 조각 끝(= 절 중간 문장끝)이 짧게 나오는 일이 있다. 절 끝 검사는 음원 전체의 마지막만, 받아쓰기 합격 때만 봐서 중간 조각 끝은 검사된 적이 없었다 — 이 PC 새 방식 합격 1,466절 중 나눠 만든 60절, 그중 23절이 중간 조각 끝 150ms 미만. 조각마다 끝을 재서 짧으면 그 조각만 다시 뽑는다(`engine._gen_piece`, 최대 3회·가장 긴 것)
- **후속 4 — 다시 보류된 절의 옛 음원**: 욥 39:8 을 새 방식으로 다시 만들었는데 다시 보류되자, 서버에는 9/9 구방식 보류 음원이 그대로 남았다(같은 본문 = 같은 id 라 '이미 있음'). PC 가 보류 음원의 표지(크기-수정시각)를 보내고, 서버는 음원을 받을 때 표지를 적어 두었다가(`held/{기기}/stamps.json`) 다르면 다시 받는다
- **후속 3 — 구방식 보류 음원**: 욥 39:8 의 보류 음원은 9/9 구방식에 강제 분할까지 걸려 절 중간 문장끝(90ms)·절 끝(30ms)이 모두 잘렸다. 같은 날 '이대로 사용'한 마 1:5·눅 3:27·3:36·10:27 도 구방식 음원이었는데, 동결 시각 뒤에 올라가 새 방식 파일로 분류돼 교체에서 빠질 뻔했다(서버 음원을 지우고 새 방식으로 다시 만듦). PC 보고에 생성 방식(`method`)을 싣고, 관리자 화면은 구방식 음원에 표시를 붙이고 '이대로 사용'을 막는다. 관리자 재생성은 절을 통째로 먼저 만든다(tries 0)
- **후속 2 — 끝난 책의 본문 최신화**: 본문 최신화가 '멈춘 작업을 이어갈 때'만 돌아, 끝난 책의 작업은 정정 이전 본문을 계속 들고 있었다. 관리자 재생성 요청이 그 옛 본문(편집자 주석 포함)으로 다시 만들었고(요 1:42), 현재 본문 키에는 영희 음원이 없었다. 작업을 **시작할 때마다** 최신화하고, run_plan 도 시작할 때 모든 작업을 최신화해 만들 절이 생긴 끝난 책을 큐에 올린다(`refresh_all_jobs`)
- **후속 (같은 날)**: 음원이 여전히 하나도 안 올라갔다 — PC 가 항목 id 를 서버 규칙과 다르게 계산해 `missingAudio` 와 짝이 안 맞았다(시험은 가짜 서버가 같은 함수를 써서 못 잡음). 서버가 **보낸 목록의 위치**(`missingAudioIndex`)로 알려 주게 바꿔 PC 쪽 id 계산을 없앴다. 보류 수가 그대로여도 30분마다 다시 보고. 관리자 화면은 음원이 없으면 무조건 '괄호 때문에 만들지 않았다'고 안내하고 재생성 버튼까지 막았다 — 괄호 안내는 주석 잔재 보류에만, 재생성은 음원 없이도 가능하게

### 2026-09-10 — 한국어 성우 정리: 생생·활력 제외, 기본 성우 영희
- **무엇**: 선택 목록(`KOREAN_VOICE_ORDER`)에서 생생(f2)·활력(m2)을 뺐다. 둘 다 GCP Chirp3-HD 인데 새번역 낭독에서 띄어쓰기(끊어 읽기)가 부자연스럽다는 청취 판단. 기본 성우는 날짜 홀짝(생생/활력)에서 **영희(f4)** 로 — 모든 역본 공통
- **저장값 처리**: 예전에 생생·활력을 골라 저장한 사용자는 고른 적이 없는 것으로 보고 영희로 돌린다(`RETIRED_KOREAN_VOICES`). 저장값을 지우지는 않는다
- **서버는 그대로**: Chirp3-HD 는 유료 엔진(ElevenLabs·Supertone)이 실패할 때의 폴백으로 계속 쓰인다. 영희 음원이 없는 절(구약 미생성분·다른 역본)은 김단아(f1)가 대신 읽고 김단아 키로 캐시되므로 영희 캐시가 오염되지 않는다

### 2026-09-09 — 말씀의삶 (성경읽기진도표 91회차 북클럽) — 배포 완료
- **무엇**: 예봄교회 종이 성경읽기진도표 91회차를 앱에 옮긴 층. 하단 탭 6번째. 지시서 [docs/tasks/말씀의삶_클코_작업지시서_v1.1.md](docs/tasks/말씀의삶_클코_작업지시서_v1.1.md), 설계 [docs/READING_PLAN.md](docs/READING_PLAN.md)
- **저장하지 않고 파생한다**: 회차 완료를 별도 저장하지 않고 기존 `reading_progress`(장 단위 자동 기록)에서 매번 계산한다(`lib/plans/yebom91.ts` `computeUnitProgress`). 저장하면 두 값이 갈라지고, 갈라지면 어느 쪽이 맞는지 알 수 없다. 자동으로 알 수 없는 것 하나 — "종이로 읽었다" — 만 `reading_unit_checks` 에 담는다
- **`nextChapter` 와 `entryChapter` 를 나눈 이유**: 진도표는 한 장이 두 회차에 걸치는 **경계 장이 10개**다. "안 읽은 첫 장"을 진입점으로 쓰면 경계 장에서 고정점이 생겨 6개 회차 49장이 영원히 같은 장을 가리켰다. 표시용(`nextChapter`)과 진입용(`entryChapter`)을 분리해 끊었다
- **플랜 모드**: 회차를 열면 장 이동이 정경 순서가 아니라 **진도표 순서**를 따른다(아가 8장 → 잠언 16장). 스와이프·◀▶·여백·키보드 4경로를 `goChapter` 하나로 통합(단계 2.5)하고 그 위에 플랜 오버라이드를 얹었다. TTS 자동 진행도 같은 순서를 따른다
- **책 경계 이동**(별건, 플랜 무관): 기본 장 이동이 책 끝에서 다음 책으로 넘어간다 — 창세기 50장 ▶ 출애굽기 1장
- **그룹**: 목적은 순위표가 아니라 **동행 확인**이다. 벌점·독촉·미읽음 알림을 두지 않는다. 순위는 완료 회차 내림차순, **동률은 이름 가나다순** — `read_at` 은 재열람마다 갱신되어 이미 읽은 장을 다시 열면 순위가 뒤집힌다. 멤버 진도 조회는 `fetchAllRows` 페이지네이션 필수(1,000행 상한, 36명이면 닿는다). `standings` 는 호출자가 멤버인지 먼저 확인한다 — 없으면 `id` 를 올려가며 남의 명단이 보인다
- **DB**: `reading_unit_checks` / `reading_groups` / `reading_group_members` 3종. 전부 RLS enable + 정책 0개(service_role 전용) — anon 키로 조회해 빈 배열임을 실측 확인. [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md) §5c
- **검증**: `npm run verify:plan`(플랜 데이터 7절), `node scripts/verify-reading-groups.mjs`(계정 4개 24항목). 프로덕션 스모크 — buildId `585cf1e`, 신규 API 4개 정상, `reading-progress` 회귀 없음
- **미결**: 실제 `말씀의삶1기` 그룹 생성(지휘부가 UI 로). 보류는 [plan.md](plan.md)

### 2026-06-12 — 뒤로가기 무확인 종료 차단 (Chrome trivial/gesture history intervention)
- **증상**: 6/11~ 로그인 상태에서 뒤로가기·메뉴 닫기 시 확인 없이 앱 밖(빈 화면/로그인 전 화면)으로 튕김. Chrome·Edge 발생, PWA standalone·모바일 면역. 로그아웃(vercel.app 직접 접속)은 정상.
- **원인**: Chrome 이 (a) *trivial session history context*(탭에 히스토리 항목 1개 — 로그인 SSO 가 bible.yebom.org 를 단일 항목으로 올림) 또는 (b) *사용자 제스처 없이 `useEffect` 에서 호출된 `pushState`*(History Manipulation Intervention)를 `replaceState` 로 강등/건너뜀 → `isAppRoot`/`isHome` 종료 트랩과 `useHardwareBack` push 가 무력화 → 뒤로가기가 앱 밖 직행. 콘솔: "Use of history.pushState in a trivial session history context … treated as history.replaceState". 6/10 코드로 되돌려도 동일(코드 회귀 아님 — Chrome 정책 변화가 방아쇠).
- **해결 (2중 안전망)**:
  - `hooks/useHardwareBack.ts`: `addedHistoryEntry` 를 `window.history.length > lenBefore`(실제 증가)만으로 판정 — `lenBefore>1` 오판정 제거. pushState 강등 시 닫을 때 `history.back()` skip → 모달 닫기·뷰전환 튕김 차단(잔여 항목 무해).
  - `app/page.tsx` + `lib/appExit.ts`(신규): **로그인 + 비-PWA 브라우저 탭**에 `beforeunload` 무조건 무장 → trivial/gesture 무관하게 무확인 종료 차단(브라우저 기본 확인창). 종료 버튼(`exitingRef`)·로그인 SSO 이동(`markIntentionalLeave`)은 통과. PWA standalone 면역이라 무장 안 함.
  - 비-trivial 컨텍스트는 기존 `isAppRoot`/`isHome` 커스텀 "종료?" 팝업 유지.
- **한계**: 로그인 브라우저 탭에선 새로고침·탭닫기도 브라우저 기본 확인창(커스텀 팝업은 trivial 에서 원천 불가). 후속(옵션): 단일 센티넬+메모리 스택으로 뒤로가기=모달닫기 UX 복원.
- **부수**: `requireAuth()` 죽은 코드 제거(무확인 로그인 리다이렉트 지뢰) + 음원 이전 실험 스크립트 4종 제거. 음원 Supabase→R2 이전(easy/nkrv/web 3567파일 8.3GB, `bible_audio.audio_url` R2 전환, 원본 마스터 보존) 반영.

### 2026-06-11 — 로그인 게이트 통일 + 로그인 전용 기능 4종 (코드 완료, DB 마이그레이션 대기)
- **게이트 보완**: `components/LoginGate.tsx` 신규 — `LoginGateProvider`(layout 마운트) + `useLoginGate().ensureLogin(label)`. 찬송가 악보 인앱 모달을 공용화. `requireAuth()` 즉시 외부 튕김(page/VerseDisplay/HymnModal) → 인앱 "로그인 필요" 모달 경유로 통일. `LOGIN_URL` 단일화(`useSession.ts` export)
- **401 피드백**: CardPreview 카드저장 거짓 성공 안내 수정 + 사진삭제 실패 중단, ScrapList 삭제 실패 롤백+alert
- **A 통독진도**: `reading_progress` 테이블 + `/api/reading-progress` + `lib/reading-progress.ts`(computeProgress) + `lib/books.ts` `CHAPTER_COUNTS`(1189장). SearchPanel 3초 트리거에 `markChapterRead` 합류, 책갈피 메뉴에 전체/구약/신약 진도 바
- **B 묵상노트·하이라이트**: `verse_notes` 테이블 + `/api/verse-notes` + `lib/verse-notes.ts`(4색). renderVerseItem 하이라이트 배경+메모 표시, 하단 액션바 [형광펜][메모], 메모 에디터 모달
- **C 카드갤러리**: 신규 테이블 0. ScrapList `myCards` 탭 — `image_url` 있는 스크랩 그리드 + 라이트박스(확대/재다운로드)
- **E 기기간 동기화**: `user_state` 테이블 + `/api/user-state` + `lib/userSync.ts`. 책갈피 union 머지 + 마지막위치(recent) last-write-wins. 로그인 시 1회 동기화 + 변경 시 푸시
- **마이그레이션**: `scripts/migration-login-features.sql` (3개 테이블, RLS enable+정책없음=service-role 전용) — **적용 대기**
- 빌드 통과(`npx next build`). [plan.md](plan.md) "로그인 게이트 보완" 항목 참조

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

**인증 (`hooks/useSession` + `components/LoginGate`)**:
- `/api/auth/session` 1회 fetch (mount) + bfcache 시 재검증
- `useLoginGate().ensureLogin(label)` 가 `loading` 가드 → race 차단
- 미로그인 시 인앱 "로그인 필요" 모달 → "로그인" 클릭 시에만 saint.yebom.org 외부 이동
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
  1. ensureLogin("카드 만들기") 가드 (미로그인 시 인앱 모달)
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
ensureLogin(label):
  - loading=true → false 반환 ("로그인 확인 중..." 토스트)
  - session.isLoggedIn → true 반환 → 액션 진행
  - 그 외 → 인앱 "로그인 필요" 모달 ("로그인" 클릭 시에만 saint.yebom.org/login?from=bible 이동)

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
| 로그인 게이트에 `loading` 미체크 | `useLoginGate().ensureLogin()` (loading 가드 내장) |
| history `pushState` 트랩만으로 뒤로가기 종료 차단 | Chrome trivial/gesture intervention 으로 강등 → `beforeunload` 안전망 병행 |
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
