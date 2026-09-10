# 예봄성경 — 보류·차기 검토 사항

> 흩어진 .md 대신 보류·연기·차기 검토 항목을 한 곳에 누적 기록.
> 최신 항목이 위쪽. 완료/취소된 항목은 ~~취소선~~ 후 일정 기간 보관 후 정리.

---

## 뒤로가기 모달 시스템 — 단일 센티넬 리팩터링 (대책 A) (향후 필요시 검토, 2026-06-12)

뒤로가기 무확인 종료는 `beforeunload` 안전망으로 이미 차단됨(architecture.md 2026-06-12 변경이력). 본 항목은 **모달 히스토리 처리를 더 견고·매끄럽게** 하는 선택적 리팩터링이며 *지금 막힌 문제를 더 막는 건 아님*.

- **현재 방식**: 모달/뷰마다 개별 `pushState` + 닫을 때 `history.back()` → (1) Chrome 강등 시 back() 이 앱 밖으로 오작동, (2) 뷰 전환(display↔card) cleanup-back + setup-push 레이스, (3) intervention 표적 다수.
- **대책 A**: 히스토리엔 "모달 활성" 센티넬 1개만 두고, 실제 중첩 순서는 메모리 `modalStack` 에서 관리. 뒤로가기(popstate)=메모리 최상단 모달 닫고 센티넬 재푸시, 마지막이면 소비. 모달 N개라도 히스토리 추가 항목은 항상 1개.
- **득**: ③ 레이스 영구 제거 + 코드 단순화 + 정상(비-trivial) 탭에서 뒤로가기=모달닫기 UX 매끄러움.
- **한계**: 센티넬도 `pushState` 1회라 **trivial 탭의 루트 종료 차단은 여전히 `beforeunload` 몫**(대책 A가 대체 못 함). 마지막 모달 X닫기 시 센티넬 정리용 `back()` 1회 잔존.
- **비용**: `useHardwareBack` + 8개 등록부 재작성·재테스트.
- **도입 트리거**: 정상 탭에서 뒤로가기 모달 닫기 글리치가 관찰되거나, 모달 히스토리 코드 정리를 원할 때. **현재 보류** — 핵심 요구(무확인 종료 금지)는 `beforeunload` 로 충족됨.

---

## 🚧 로그인 게이트 보완 + 로그인 전용 신규 기능 (구현 완료, 런타임 검증 대기, 2026-06-11)

로그인 게이트 UX 통일 + 로그인 명분을 강화하는 개인 신앙 데이터 기능 4종 신설.

**상태**: 5개 Phase 코드 완료 + `npx next build` 통과 + **DB 마이그레이션 적용 완료**(Supabase MCP, project `iityjmjgnjtvqujpivjg`). **남은 일**: 앱에서 로그인 상태 런타임 검증(진도 기록·하이라이트/메모·카드갤러리·기기 동기화).

### 📌 후속 발견 (별건): AI 생성 게이트 누락
감사 중 [components/CardPreview.tsx](components/CardPreview.tsx) 의 AI 배경/삽화 생성(`/api/ai/background`, `/api/ai/recommend`)이 **로그인 체크 없이** 호출됨을 확인. 운영비 노출 가능성. 빈도·심각도 판단 후 게이트 추가 여부 결정(변경 안 함도 옵션).

### 🔒 공유 DB(yebomsaint) RLS 점검 (별건, 보류)
마이그레이션 적용 중 Supabase advisor 가 **기존 32개 테이블의 RLS 비활성** 경고 — `members`(306), `attendance`(33,495), `prayer_requests`, `prayer_notifications`(26,149) 등 민감 데이터 포함. anon key 보유자가 읽기/수정 가능.
- **성격**: `yebomsaint` DB 공유 앱들(교적부/기도의집/와이즈톡/성경)의 **기존 설정** — 이번 작업과 무관(신규 3개 테이블은 RLS enable 로 적재). 예봄성경 단독 이슈 아님.
- **왜 보류**: 블랭킷 `ENABLE ROW LEVEL SECURITY`(정책 없이) 시 해당 앱들 전면 차단되어 깨짐. 테이블별 접근 패턴 파악 + 정책 설계 선행 필요. advisor remediation_sql(32개 일괄 enable) 그대로 실행 금지.
- **트리거**: 공유 DB 보안 점검을 별도 과제로 착수 + 앱별 소유자 합의 시.

### 확정 결정
- **A 통독진도**: 자유 진도 (읽은 장 자동 집계 → 전체/구약/신약 % + 권별 dot grid). 1년1독 플랜 X
- **B 묵상노트**: 하이라이트 **4색**(노랑/분홍/파랑/초록) + 절 메모. 진입 = **절 선택 → 하단 액션바**에 [형광펜][메모] 버튼
- **C 카드갤러리**: 기존 `scraps` 재사용(`image_url IS NOT NULL`). ScrapList 세 번째 탭. 카드 클릭 = 이미지 확대+재다운로드
- **E 기기간 동기화**: 책갈피(union 머지) + 마지막 위치(recent, last-write-wins). TTS 재생위치는 영속 상태가 없어 recent로 갈음(통독진도 A와 보완)
- **진도 기록 기준**: 장 진입 3초(기존 `saveRecent` 트리거 재사용)

### 신규 테이블 (모두 `scraps` RLS 패턴 복제 — RLS 작성 필수)
- `reading_progress(user_id, book_code, chapter, version, read_at)` UNIQUE(user_id, book_code, chapter)
- `verse_notes(user_id, user_name, book_code, chapter, verse, color?, note?, version, created_at, updated_at)` UNIQUE(user_id, book_code, chapter, verse). color·note 둘 다 비면 행 삭제
- `user_state(user_id, key, value jsonb, updated_at)` PK(user_id, key). key='bookmarks'|'recent'
- C는 신규 테이블 0

### 구현 순서 (게이트 먼저 — 신규 기능이 전부 같은 게이트 사용)
1. **게이트 보완**: `components/LoginGate.tsx`(Provider+`useLoginGate().ensureLogin(label)`) — HymnModal 모달 공용화. `requireAuth()` 즉시 외부 튕김 3곳 + silent 401 토스트 일괄 교체. `LOGIN_URL` 단일화
2. **C 카드갤러리**: ScrapList `myCards` 탭 + `fetchMyCards()` 래퍼
3. **A 통독진도**: `/api/reading-progress`(scrap 라우트 복제) + SearchPanel 3초 useEffect에 `markChapterRead()` + 책갈피/목차 진도 섹션
4. **B 묵상노트**: `/api/verse-notes` + renderVerseItem 하이라이트 배경/메모 아이콘 + `noteEditorVerseId` 편집(기존 `editingVerseId` 패턴 복제)
5. **E 동기화**: `/api/user-state` + 로그인 시 클라우드→localStorage 머지

### 주의 (워크플로 감사 risk)
- renderVerseItem 메모 아이콘 onClick은 `stopPropagation()` 필수(절 선택 토글 발화 방지)
- 길게누름 타이머 가드에 `noteEditorVerseId!==null` 추가(에디터 중 전체화면 차단)
- 병기·검색 모드 절 렌더 분기까지 하이라이트/메모 적용
- LoginGate z-index `z-[155]` (HymnModal 150/160 경합 회피)
- GET류(fetchMyScraps/ChapterNotes/ReadChapters) 401 무음 유지 — 빈 목록이 정상, 토스트 과잉 금지

---

## WEB 역본 후속 — 음원 통합 + 부가 정합 (대기, 2026-06-10)

WEB(World English Bible) 31,098절 적재 완료(또는 적재 진행 중). 후속 정합 항목들.

### ~~A. WEB 음원 통합~~ — 완료 (2026-06-10)

WEB 1189장 음원 적재 완료. 낭독자 David Williams (WEB Classic, Public Domain, AudioTreasure 출처).

**적재 위치**: Cloudflare R2 bucket `attached` 에 `web/<book_code>/<NNN>.mp3` 형태로 1189 파일 (1.33GB)
- Public URL base: `https://pub-7f869002b64b4501aa6e28ee31b1bd6c.r2.dev`
- 캐시: `Cache-Control: public, max-age=31536000, immutable` (1년)

**DB**: `bible_audio` 1189행 (version='web', narrator='David Williams (WEB)')

**코드 변경 0줄** — `lib/bibleAudio.ts` 가 version 무관 동작, `TtsContext.transformWithChapterAudio` 가 mp3 자동 우선 재생, 미니플레이어 "녹음" 배지 자동 적용. 영문 TTS voice 분기는 mp3 없을 때 폴백으로 사용.

**산출 스크립트**: `scripts/upload-web-audio-r2.mjs`, `scripts/gen-manifest.mjs`, `scripts/insert-web-audio-rows.mjs`, `scripts/verify-web-mapping.mjs`

**백업**: 원본 LibriVox 124파일 묶음은 `bible/web-librivox-backup/` 보관 (1주 후 삭제 예정), Williams 원본은 `bible/web-source/` (R2 업로드용 원본, 모두 .gitignore 처리)

**보안**: R2 API Token (`yebom-bible-audio-upload`) 작업 후 revoke 권장 — Cloudflare Dashboard → R2 → Manage R2 API Tokens.

### ~~B. 영문 TTS voice 분기~~ — 완료 (2026-06-10, 커밋 별건)

WEB 적재 직후 즉시 적용. KJV/NIrV/GNT/WEB 모두 en-US-Chirp3-HD voice 로 자동 분기.
- `/api/tts/route.ts` `lang` 필드 수용 (ko/en) + languageCode·voice candidate 분기
- `TtsContext` 가 `track.version` 으로 자동 판정 (`isEnglishVersion`)
- 장 시작 announcement: "Psalms chapter 23" / 절 prefix: "Verse 16."
- WebSpeech 폴백은 여전히 ko-KR — 폴백 빈도 낮아 별건 보류

### C. 시편 표제(superscription) 절 매칭 보정 (보류)

**문제**: WEB(Classic)은 히브리어 전통에 따라 시편 표제를 1절로 셈. KJV/nkrv는 표제를 절로 안 셈. 병기 모드에서 시 51:1 같은 절이 한국어(기도) vs WEB(표제) 어긋남.

**도입 트리거**: 사용자 피드백 누적 후 결정. 영향 절 ~116편의 1절 위주.

**옵션**:
- A. 표제 자동 매칭 보정 (UI 측 verse offset)
- B. WEBU 에디션(표제 미카운트) 으로 재적재
- C. 그대로 유지 (학계 표준)

**예상 작업량** ~3시간 (옵션 A) / 데이터 재적재 (옵션 B)

### ~~D. AI 추천 — WEB 호환~~ — 완료 (2026-06-11)

SearchPanel 의 topic 조회 로직을 `book_name` → `book_code` 매칭으로 변경. AI 가 한글 책명 반환해도 `getBookByName()` 으로 BookInfo 조회 → `book.code` 로 DB 조회. 모든 7개 version 일괄 호환.

`getBookByName(name)` 신규 ([lib/books.ts](lib/books.ts)) — 한글/영문/약어/code 모두 인식.

mainVersion=kjv 에서 "사도행전" 추천 → "act" 변환 → KJV 본문 정상 표시. 책명 매핑 실패 시에는 별도 에러 메시지로 진단 가능.

### E. KJV 데살로니가전·후 보충 (별건, 보류)

KJV 64권/66권 적재 — `1th`/`2th` 약 135절 누락. WEB 적재 후 병기 모드에서 KJV 측 빈칸 노출.

**해결**: KJV 원본에서 데살로니가전·후 본문 추출 후 별도 import

**예상 작업량** ~30분

### F. WEBU 에디션 (LORD 표기) 재수급 (보류, 선택)

현재 WEB Classic(Yahweh 표기). 일부 사용자는 영어 전통 LORD 표기 선호.

**도입 트리거**: 사용자 명시 요청 시. WEBU 에디션 별도 확보 + DELETE WHERE version='web' + 재import.

---

## ~~음원 호스팅 이전 — Supabase → Cloudflare R2~~ — 완료 (2026-06-12)

**완료 요약**: Supabase Storage 한도 초과(402)로 easy/nkrv 음원을 R2(`attached` 버킷)로 이전. recipe3(80k 평균다운믹스 0.5L+0.5R + -2.5dB) 재인코딩 → easy/nkrv/web 합 8.3GB. `bible_audio.audio_url` 전부 R2(r2.dev)로 치환. Supabase `bible-audio` 버킷(원본 easy 6.36+nkrv 4.77=11.1GB) **삭제 완료** → Supabase Storage ~165MB, DB 195MB(둘 다 Free tier 한도 내). 원본 마스터는 사용자 결정으로 미보존(80k가 유일본). 상세는 architecture.md 2026-06-12 변경이력. 아래는 이전 검토 기록(보존).

**(이전 검토 기록)**
음원은 Supabase Storage `bible-audio` 버킷에 호스팅. 시편 150편(414MB) 적재 완료. 전체 성경(통독 구약 + 신약 추정) ≈ 6.5GB 예상.

**비교**

| 항목 | Supabase Storage | Cloudflare R2 |
|---|---|---|
| Free tier 용량 | 1GB | 10GB |
| Free tier egress | 월 2GB | **무제한** |
| 추가 용량 | $0.021/GB/월 | $0.015/GB/월 |
| 추가 egress | $0.09/GB | **$0/GB** (Cloudflare 정책: egress 무료) |
| CDN | Smart CDN (region-based) | 전 세계 Cloudflare edge |
| 인증 | RLS + signed URL | Public bucket 또는 signed URL |
| 통합도 | yebomcard 가 이미 Supabase 사용 | 별도 설정 필요 |

**시나리오별 월 비용 추산** (전체 성경 6.5GB 적재 가정, 사용자 1인당 월 30장 ≈ 120MB 청취)

| 사용자 수 | 월 egress | Supabase 비용 | R2 비용 |
|---|---|---|---|
| 10 | 1.2GB | $0 (free) | $0 |
| 100 | 12GB | $0.9 | $0 |
| 500 | 60GB | $5.2 | $0 |
| 1000 | 120GB | $10.6 | $0 |

스토리지 자체 비용(6.5GB)은 양쪽 다 free tier 내. **차이는 egress 에서 발생**.

**왜 보류했나**
- 현재 사용자 규모(개인/소그룹)에서 비용 차이 미미 (월 $1 이내)
- Supabase 통합도 유지가 운영 단순함
- R2 이전 시 추가 작업: AWS S3 호환 SDK 설치, R2 access key 발급, custom domain 또는 public URL 패턴 변경, bible_audio.audio_url 일괄 업데이트

**도입 트리거**
- 활성 사용자 100명 초과 또는 월 egress 50GB 초과
- 또는 Supabase 월 청구액에 Storage 항목이 $5 초과로 잡힐 때

**이전 작업량** ~2시간
1. R2 계정 + 버킷 생성, custom domain 설정 (예: `audio.yebom.org`)
2. `upload-bible-audio.mjs` 의 Supabase Storage 업로드 부분만 R2 S3 호환 SDK 호출로 교체 (10-20줄)
3. 새 URL 형식으로 bible_audio.audio_url 일괄 UPDATE (단일 SQL)
4. 기존 Supabase Storage 음원은 정합 확인 후 정리

---

## TTS 음질 추가 개선 — ElevenLabs 통합 (보류, 2026-06-01)

**현재 상태**
GCP Chirp 3 HD voice(Aoede/Charon) + Neural2 폴백으로 사용자 청취 만족 확인 (2026-06-01). 본 항목은 향후 만족도 저하 시 활성화.

**도입 트리거**
- 사용자가 "Chirp 도 부자연스럽다" 피드백을 명시적으로 줄 때
- 또는 새 voice 모델 출시 후 비교 필요 시점

**작업 내용**
- `/api/tts/route.ts` 에 `provider` 분기 추가 (`gcp` | `elevenlabs`)
- ElevenLabs Korean voice (Rachel/Bella multilingual v2) 통합
- API key 발급 후 `.env.local` + Vercel env 추가
- 미니 플레이어에 "고품질 음성" 토글 (운영비 통제용)
- IndexedDB 캐시 키에 provider 포함 → 엔진 전환 시 자동 분리 캐시

**비용**
- Starter $5/월 (30K자) — 한국어 60~70장 분량
- Creator $22/월 (100K자)
- 무료 tier 10K자/월
- pay-as-you-go: 1M자 $165 (Creator 가격)

**예상 작업량** ~3시간 (라우트 분기 1h + UI 토글 0.5h + 키 등록/배포 0.5h + 비교 검증 1h)

---

## Supabase 일괄 사전 캐싱 — bible_audio 인프라 재활용 (보류, 사용자 임계 도달 시)

**현재 상태**
인프라(bible_audio 테이블 + Storage 버킷 + download-audio.mjs)는 이미 구축됨 (bskorea 다운로드용으로 만들었으나 그 시도는 취소됨 — 아래 ~~취소 항목~~ 참고). 이 인프라를 GCP TTS 일괄 합성용으로 **재활용** 가능.

**왜 보류했나**
현재 IndexedDB 클라이언트 캐시로 충분 (개인/소그룹 무료 tier 안). 사용자 규모 확장 시점에만 효용.

**도입 트리거**
- 활성 사용자 100명 초과
- 또는 GCP Cloud TTS 월 청구액 $50 초과
- 또는 동일 본문을 여러 사용자가 자주 청취해서 first-fetch 비용이 누적될 때

**작업 내용**
1. `download-audio.mjs` 수정 — bskorea 다운로드 로직 제거하고 GCP Chirp 합성 호출 로직으로 교체
   - 입력: 절 별 텍스트 (또는 장 합본)
   - 출력: mp3 blob → Supabase Storage 적재 → bible_audio 매핑 INSERT
2. `lib/bibleAudio.ts` 신설 — `lookupChapterAudio(version, bookCode, chapter)` Supabase 조회 + 메모리 캐시
3. `contexts/TtsContext.tsx` 분기:
   - L1: bible_audio 매핑 hit → public URL 의 mp3 재생
   - L2: 매핑 miss → 기존 /api/tts (Chirp on-demand) 폴백
4. 미니 플레이어 엔진 배지 확장: `Real`(파랑, Supabase 적재) | Chirp | N2 | Web

**비용 추산**
- 일회성 합성: 1,189장 × 2 버전 × 2 voice = 4,756 트랙 × 500자 × 3bytes ≈ 7.1MB → $213 (무료 tier 차감 시 ~$200)
- 합성 후 운영비 0 (Supabase Storage free tier 1GB 안에 충분)
- voice/속도 추가 조합은 별도 합성 필요 → 1.0배속 + 여/남만 기본 적재 권장

**예상 작업량** ~3시간 (스크립트 변환 1.5h + bibleAudio.ts + Context 분기 1h + UI/검증 0.5h)

**보유 자산 (재활용 대상)**
- [bible_audio_create_table.sql](bible_audio_create_table.sql) — 테이블 스키마 + RLS (그대로 사용)
- [download-audio.mjs](download-audio.mjs) — 동시성·재시도·MP3 검증 패턴 (소스 부분만 GCP 합성으로 교체)

---

## TTS 절 단위 타임스탬프 — seek 정확도 향상 (보류, 우선순위 낮음)

**현재 상태**
미니 플레이어 진행바는 "절 N / 전체 M" 단위. 사용자가 화면 중간 절을 클릭해서 "이 절부터 듣기"는 가능하지만, 한 절 안에서 seek (예: 절 5의 중간으로 이동)은 불가.

**도입 트리거**
- 사용자가 "긴 절 중간으로 점프하고 싶다"는 피드백
- 또는 장 단위 음원(Supabase 캐시) 도입 후 절 동기화 정확도 필요할 때

**작업 내용**
- GCP Chirp 3 HD 의 timepoint 지원 확인 (SSML `<mark>` 또는 word-level boundary API)
- 또는 클라이언트 측 절 길이 추정 (텍스트 길이 비례) 후 진행바 분할
- 미니 플레이어에 절 간 ◀ ▶ 버튼 추가 (현재 절 다시 / 다음 절)

**예상 작업량** ~2시간 (조사 1h + 구현 1h)

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

## ~~성경 음원 다운로드 — 대한성서공회 bskorea (취소, 2026-06-01)~~

~~bskorea.or.kr 의 성경듣기 음원을 받아 Supabase Storage 에 재호스팅하려 했음.~~

**취소 이유**: bskorea 음원이 실제 성우 녹음이 아니라 **AI 합성 음성**으로 확인됨 (2026-06-01). GCP Chirp 와 본질적으로 같은 카테고리라 다운로드 가치 없음. 또한 실제 URL 이 CloudFront signed URL 패턴(3개월 만료)이라 정적 경로 가정도 어긋남.

**보존되는 자산** (다른 항목에서 재활용)
- `bible_audio_create_table.sql` — Supabase 사전 캐싱 (위 #2 항목) 에서 그대로 사용
- `download-audio.mjs` — 동시성·재시도·MP3 검증 패턴 추출용. 소스 부분만 GCP 합성 호출로 교체하면 #2 항목 스크립트로 변신

---

---

## 커스텀 보이스 '영희(f4)' — 진행 상황 (2026-09-09)

로컬 GPU 스튜디오(`voice/`)로 새번역을 성경읽기진도표 순서대로 생성 중.

### 지금 상태 (2026-09-09 23:30)
| 책 | 상태 |
|---|---|
| 욥기 | 완료 — 합격 1,069 / 보류 1 · R2 업로드 완료(1,057파일 96.2MB) |
| 창세기 | 완료 — 합격 1,517 / 보류 16 |
| 마태복음 | 완료 — 합격 1,055 / 보류 13 |
| 마가복음 | 완료 — 합격 667 / 보류 7 |
| 누가복음 | 생성 중 (1,149절) |
| 이후 | `run_plan.py` 가 진도표 순서로 66권까지 자동 진행 |

보류 누계 41건. 전부 `음원 보류 절 검수` 관리자 페이지에 모인다.

### 보류 1건 — 욥기 39:8
```
원문: 산은 들나귀가 마음껏 풀을 뜯는 초장이다. 푸른 풀은 들나귀가 찾는 먹이다.
음원: 사는 딜라기가 …                        풀은 풀른 딜라기가 찾는 먹이다
```
어순이 뒤바뀐 **실제 오독**(ASR 3회 동일). 강제 분할로 2회 더 뽑아도 같은 자리에서 틀린다.
생성이 끝난 뒤 온도(`temp`)를 바꿔 재시도할 것. 현재는 R2 에 이 절만 없어
프로덕션에서 f4 선택 시 이 한 절만 Chirp(여) 폴백으로 읽힌다.

### ~~배포 대기~~ — 완료 (2026-09-09)
master `0352a0a` 까지 푸시·배포됨. 새번역 선택 시 기본 성우가 영희(f4)이고,
아직 음원이 없는 절은 김단아(f1)로 폴백한다(f4 키를 오염시키지 않는다).

### 검증된 것 (2026-09-09)
- 스튜디오 `engine.cache_key()` 가 서버가 실제로 쓴 키를 재현함 — 말라기 1:1~5,
  예레미야 19:1~2 를 스튜디오 규칙으로 해싱하니 R2 에 그 키가 그대로 있었다
  (실제로 재생했던 구간과 절 단위로 일치). 키 규칙·자격증명·ffmpeg 경로 이상 없음.
- `upload_r2.mjs --dry` 는 R2 오류를 삼키므로 **연결 확인용으로 쓰면 안 된다** —
  자격증명이 틀려도 "건너뜀 0" 으로 똑같이 보인다. 별도 List 호출로 확인할 것.

### ~~DB 본문 자체가 오염된 절~~ — 정정 완료 (2026-09-10, `736c51a`)

새번역 본문에 크롤링 잔재로 섞여 들어간 주석·소제목 **327절을 정정했다.**
원인은 `scripts/restore-rnksv-notes.ts` 가 각주 마커(`1)` `2)`)를 지울 때 숫자만 먹고
`)` 를 남긴 것. 판정 근거는 `scripts/data/rnksv-paren-fix.json`(절마다 before/after/사유),
적용·복원은 `scripts/fix-rnksv-stray-parens.mjs`(`--restore` 로 되돌린다).

| 유형 | 건수 | 처리 |
|---|---|---|
| `)` 하나만 군더더기 | 230 | 그 한 글자만 삭제 |
| 각주 본문이 절 안에 유입 | 89 | 각주 꼬리 전체 삭제(2~133자) |
| 절 경계를 넘는 정상 괄호 | 3 | **손대지 않음** (삿 20:28 · 왕상 9:17 · 신 29:6) |
| 장 소제목이 절 안에 박힘 | 8 | 소제목+상호참조 삭제 (막 6:6 등) |

**일괄 `)` 삭제는 틀린 처방이었다.** 322건 중 그것으로 되는 것은 230건뿐이고,
89건은 각주 문장이 성경 본문으로 남으며, 3건은 멀쩡한 본문이 깨진다.
신 29:6 은 기계 분류가 "안전"으로 봤는데 절 경계 괄호였다 — 일괄 삭제였다면 틀렸을 절이다.

**안 닫힌 `(` 91건은 손대지 않았다.** 대부분 절 경계 괄호이거나 `(주:` 각주인데,
낭독은 `(주:` 부터 절 끝까지 제외하므로(`NOTE_RE`) 화면 표기상 문제에 그친다.
고칠 값이 낮고 잘못 건드리면 본문이 상한다 — 지금은 두는 쪽이 낫다.

### 본문 정정의 뒤처리 — 남은 음원 작업

공유 캐시 키가 `sha1(주석 제거 본문)` 이라 본문이 바뀐 절은 기존 음원이 고아가 된다.
그중 **낭독 내용이 그대로인 절**(스튜디오가 생성 전에 이미 고아 괄호를 떼고 읽었다)은
다시 만들 필요 없이 키만 옮기면 된다 — `scripts/rekey-tts-cache.mjs` (멱등, 복사만 한다).

| 책 | 정정절 | 재생성 필요 | 키만 이전 |
|---|---|---|---|
| 창세기 | 3 | 3 | 0 |
| 마태복음 | 71 | 10 | 61 |
| 마가복음 | 38 | 7 | 31 |
| 누가복음 | 53 | 6 | 47 |
| **소계** | **165** | **26** | **139** |

아직 생성 전인 책의 162절은 정정된 본문으로 처음부터 만들어지므로 할 일이 없다.
2026-09-10 현재 103건을 이전 완료했다.

**진행 중인 누가복음 작업은 정정 이전 본문 스냅샷을 들고 있다.**
서버가 로컬이 보낸 본문으로 키를 만들기 때문에(`app/api/voice-studio/upload`),
그대로 두면 47절이 옛 키로 올라가 앱에서는 캐시 미스가 난다(김단아로 폴백).
파일이 상하는 것은 아니고 **생성이 끝난 뒤 재배치를 한 번 더 돌리면 해소된다.**

#### 누가복음 생성 완료 후 할 일 (순서대로)
1. `node scripts/rekey-tts-cache.mjs scripts/data/rnksv-paren-fix.json --apply`
   — 멱등이라 여러 번 돌려도 안전하다. 리부팅 전에 이미 생성된 누가복음 8절이 대상이다
   (나머지 45절은 작업 파일 본문을 정정본으로 교체해 처음부터 새 키로 만들어진다).
2. 재생성 — 창세기 3 · 마태 10 · 마가 7 · 누가 2(9:43, 23:56).
   그때 각주·소제목을 소리 내어 읽은 절들이라 다시 만들어야 한다.
3. 중앙 보류 큐 정리 — 125건이 이 괄호 문제였고 이제 무의미하다.
   각 PC 가 자기 목록을 다시 보고해야 갱신된다(`voice-studio/held/{토큰}/index.json`).
   **워커가 도는 동안 job JSON 을 건드리지 말 것** — 진행 상태를 덮어쓴다.

정리 후 사람이 실제로 들어봐야 할 보류는 **8건**(ASR 불일치)만 남는다.

### 설치본과 개발본이 작업 폴더를 공유하지 않는다 (2026-09-10 발견)

2026-09-10 00:28 PC 리부팅으로 누가복음 생성이 332/1149 에서 끊겼다. 배치파일로
스튜디오를 다시 띄웠지만(00:39) **재개되지 않았다.**

원인은 경로다. `run_plan.py` 는 개발본 `c:\dev\yebomcardoice\` 에서 돌고 작업 파일도
거기 쌓이는데, 설치본 스튜디오는 `%LOCALAPPDATA%\YebomVoice\` 에서 돌며 자기 `jobs/` 만 본다
(`jobs.JOBS = engine.JOBS`, 스크립트 위치 기준). 설치본 `jobs/` 는 비어 있어 이어갈 작업이
없다고 판단한다. `app.py` 는 `__main__` 에서 `start_worker()` 를 부르고 `_loop` 는
status in ("queued","running") 을 집으므로 **로직은 멀쩡한데 보는 폴더가 다르다.**

증상이 조용하다 — 오류도 경고도 없이 GPU 만 놀고 있다. 리부팅 뒤 "왜 안 도는지"를
알아내려면 GPU 사용률과 작업 파일 갱신 시각을 봐야 한다.

지금 재개 방법 (개발본에서 직접):
```
cd c:\dev\yebomcardoice
python run_plan.py --voice 영희 --testament new
```
`ensure_job` 이 같은 제목의 미완료 작업을 재사용하므로 중복 생성되지 않는다.

**차기 검토 — 손대지 않음.** 고치려면 작업 폴더를 두 copy 가 공유하게 해야 하는데
(`YEBOM_JOBS_DIR` 환경변수, 또는 `%LOCALAPPDATA%` 로 고정), 지금 도는 작업을 멈춰야 하고
`out` 절대경로도 함께 봐야 한다. 지금은 재개 방법을 아는 것으로 충분하다.
새 PC 는 설치본만 쓰므로 이 문제가 없다 — 개발본과 설치본이 같은 PC 에 있을 때만 생긴다.

#### 바탕화면 배치 2개로 대신한다 (2026-09-10)

스튜디오의 `이어하기` 가 이 작업에 대해 아무 일도 하지 않으므로, 바탕화면에 두 개를 두었다.
저장소에는 넣지 않는다 — `C:\dev\yebomcard`, `C:\Python313` 같은 이 PC 전용 절대경로가 박혀 있다.
자격증명은 넣지 않았다. `voice/studio.json`(gitignore)이 기기 토큰을 갖고 있다.

| 파일 | 하는 일 |
|---|---|
| `신약 음원 이어하기.bat` | 개발본에서 `run_plan.py --voice 영희 --testament new`. 끝난 책과 이미 만든 절은 건너뛴다 |
| `신약 음원 중지.bat` | 도는 워커를 멈춘다. 진행 상황은 남고 다음에 이어간다 |

**중복 실행 가드에 함정이 있었다.** 처음엔 명령줄에 `run_plan.py` 가 들어간 프로세스를 모두
찾게 했는데, 그 검사를 도는 powershell 자신의 명령줄에도 그 글자가 들어 있어 **자기 자신을
찾아내 늘 "이미 실행 중"으로 막혔다.** `Name -eq 'python.exe'` 로 한정해서 고쳤다.
중지 배치도 같은 이유로 한정해야 한다 — 아니면 자기를 죽이려 든다.

#### 워커는 세션과 분리해서 띄운다 (2026-09-10 재발)

`Start-Process` 로 띄운 워커는 **그 세션이 끝나면 함께 정리된다.** 2026-09-10 03:00 에
누가복음 1078/1149 에서 오류 없이 끊겼는데, 예외 흔적이 없고 로그가 진행 줄에서 그대로
멈춘 것이 리부팅 때와 같은 서명이었다. 원인은 워커가 세션의 자식 프로세스였던 것이다.

분리해서 띄우려면 `start` 를 거쳐 부모 사슬을 끊는다:
```
cmd /c start "" "C:\Users\예봄교회\Desktop\신약 음원 이어하기.bat"
```
띄운 뒤 부모 사슬을 확인할 것 — 부모가 이미 종료돼 있어야 세션과 무관하게 산다.
```
Get-CimInstance Win32_Process -Filter "ProcessId=<워커의 부모>"   → 없으면 분리 성공
```

배치가 콘솔로 출력하므로 `run_plan_resume.log` 는 더 이상 갱신되지 않는다.
진행 감시는 **작업 파일(`voice/jobs/*.json`)의 갱신**을 기준으로 해야 한다.

**워커는 한 번에 하나만.** 두 개를 띄우면 한 GPU 를 나눠 써서 둘 다 느려지고 같은 절을
두 번 만든다. 스튜디오에서 '이어하기'나 새 생성을 누르지 말 것(검수·조회는 무방).

### VRAM 이 부풀면 생성이 스스로 멎는다 — 워커 재시작으로 푼다 (2026-09-10)

요한복음 264절에서 12분 넘게 한 절도 늘지 않았다. 그런데 **GPU 는 100%** 였고 워커 CPU 도
45초/45초로 한 코어를 꽉 물고 있었다 — 멈춘 것이 아니라 갈리고 있었다.

원인은 우리 워커 자신이었다. 프로세스별 GPU 메모리를 재 보니:
```
11,583 MB  PID 17656  python    ← 우리 워커 (카드 12,288MB 의 94%)
   142 MB  PID 21172  chrome
```
지휘부가 PC 를 쓰기 시작해서가 아니었다. 시작 때 4.4GB 였던 것이 한 시간 만에 11.6GB 까지
불어 카드 한계에 닿았고, 그 지점부터 할당이 막혀 처리량이 무너졌다.

**시간대별로 보면 서서히가 아니라 절벽이다.**
```
09:30  64절/10분  ← 정상 (9초·절)
10:00  28절
10:10   0절       ← 붕괴
10:20   1절
```

**대처는 워커 재시작 하나면 된다.** 진행 상황은 절마다 저장되므로 잃는 것이 없고,
모델 재적재 2분이면 원래 속도로 돌아온다. 실측: 재시작 후 VRAM 4,386MB, 속도 7.0초·절 회복.

진단 순서 — 멈춘 것과 갈리는 것을 먼저 가른다:
1. 워커 CPU 가 느는가 (`(Get-Process -Id N).CPU` 를 45초 간격으로 두 번)
   늘지 않으면 죽은 것, 늘면 갈리는 것이다
2. 프로세스별 GPU 메모리 — `Get-Counter '\GPU Process Memory(*)\Local Usage'`
   `nvidia-smi` 는 Windows WDDM 에서 프로세스별 VRAM 을 못 준다(N/A). 이 카운터를 써야 한다
3. 우리 워커가 카드의 90% 이상을 쥐고 있으면 재시작

2026-09-09 밤 2시간 13분 연속 실행에서는 이 현상이 없었다(10.7GB 에서 안정).
매번 나는 것이 아니므로 **상시 대책보다 감시로 잡는 편이 낫다** — 12분 정체 알림이 이것을 잡았다.

### 절 끝 잘림 — 원인과 새 생성 방식 (2026-09-10 결정)

**증상** — 절 끝 글자가 짧게 끊겨 들린다. 절 안 문장끝('말씀하셨다.')은 자연스럽고 절 끝('않았다.')만 그렇다.
절 사이 쉼(설정)이나 끝 페이드로는 나아지지 않았다(지휘부 청취).

**원인** — 음성 복제 기본값인 '본문 흘려 넣기'(`non_streaming_mode=False`). 라이브러리 설명대로 흘려 넣기를
**흉내만 내는** 모드인데, 참조 원고+대상 본문+끝 신호를 참조 음성 프레임 위에 겹쳐 놓아 **대상 본문의
끝 신호가 참조 음성 한가운데에 찍힌다.** 모델이 어디서 끝나는지를 흐릿하게 알고 마지막 음절을 서둘러 맺는다.
같은 라이브러리의 다른 두 생성 방식은 기본값이 통째로 넣기(`True`)다.

| 걸러낸 가설 | 근거 |
|---|---|
| 디코더가 끝을 버림 | 인과 구조, 끝 여분 약 23ms 뿐 |
| 종료 토큰을 일찍 뽑음 | 편향을 걸어도 안 길어짐, 과하면 163초 폭주 |
| 배치 생성 | 한 건씩과 차이 오차 범위(82 vs 98ms) |
| 참조 음성·mp3 변환 | 참조 꼬리 무음 800ms · mp3 는 오히려 +48~64ms |

**측정**(출 33:2·4·11 × 4회, 절 끝 음절 덩이) — 흘려 넣기 98ms(12회 중 9회 150ms 미만),
**통째로 넣기 218ms(3회)**, 꼬리말 절단 250ms 이지만 33:2 에서 4회 모두 절단 실패. 절 안 문장끝 310ms.

**새 방식** (`voice/engine.py`, `voice/jobs.py`)
- `NON_STREAMING = True` — `gen_kwargs` 가 한 건씩·배치 모두에 싣는다
- 절 끝 검사 `END_MIN_MS = 150` — 받아쓰기는 통과했는데 끝이 짧으면 끝이 가장 긴 시도를 보관하고 다시 만든다.
  이때는 본문을 더 쪼개지 않는다. 상한에 닿으면 **보류하지 않고** 가장 나은 시도를 쓴다
- 절마다 `method: "ns1"` 표지 — 구방식 항목에는 없다
- 모델을 올릴 때 `[생성 방식] 본문 통째로 넣기 …` 줄을 찍는다 — 새 PC 에서 적용 여부를 눈으로 확인한다
- 주의: 운영 경로(배치 4)로 시험하니 8회 중 4회가 150ms 미만이었다(한 건씩은 12회 중 3회).
  재시도가 잡지만 생성 시간이 늘어난다 — **첫 책이 끝나면 재생성 비율을 실측**하고, 너무 높으면 배치 1 을 검토한다

**구방식 동결 목록** — `scripts/data/f4-legacy-streaming.json` (`scripts/snapshot-f4-legacy.mjs` 로 한 번만 찍음)
- 동결 시각 2026-09-10T10:28:53.602Z · 마지막 업로드 3시간 전이라 어느 PC 도 구코드로 만들고 있지 않았다
- 구방식 **9,868절**(파일 9,705개) — 신약 4,655 · 구약 5,213. 어느 절에도 안 맞는 고아 파일 112개
- 서버 기준 시각 `LEGACY_BEFORE.f4` (`lib/tts/verseText.ts`) 와 같은 값이다

**교체 경로**
- `GET /api/voice-studio/cache-index?legacy=1` — 올라온 시각이 기준 이전인 파일만 준다. 교체가 진행되면 저절로 빠진다
- `POST /api/voice-studio/upload` `replace: true` — **기존 파일이 기준 이전일 때만** 덮어쓴다(`replaced`).
  두 PC 가 겹쳐도 새 방식 파일을 되돌리지 않는다. 존재 확인은 HEAD 로 바꿨다(예전엔 mp3 를 통째로 내려받았다)
- 교체 작업 = 책마다 '아직 구방식인 절' 만 담은 작업(`replace` 표지), 순번 10000+ — 남은 절 작업이 다 끝난 뒤 돈다.
  작업을 시작할 때 목록을 다시 물어 그 사이 교체된 절은 건너뛴다
- 이 PC: `run_plan.py --testament new --then-replace` (바탕화면 '신약 음원 이어하기') — 남은 절 → 교체까지 자동
- 새 PC: 스튜디오 '2. 생성' 탭 **[구방식 교체 작업 걸기]** (구약) — 한 번 눌러 두면 남은 절이 끝난 뒤 진행

**분담 (지휘부 지시)** — 이 PC: 신약 남은 절 → 신약 구방식 교체 / 새 PC: 구약 남은 절 → 구약 구방식 교체.
구방식 창세기·욥기는 이 PC 가 만들었지만 교체는 새 PC 가 한다 — 대상은 서버가 판정하므로 상관없다.

**교체가 끝나면 할 일** — `lib/tts/ttsCache.ts` 의 `DB_VERSION` 을 올린다. 교인 기기의 IndexedDB 에
구방식 음원이 남아 있으면 서버 파일을 바꿔도 계속 그것을 튼다(클라이언트 캐시 키에 본문 해시가 없다).

앞 절(본문 정정의 뒤처리 — 재배치·재생성 26절·보류 큐 정리)은 이 교체로 모두 흡수된다. 구방식은 전부 다시 만든다.

### 스튜디오 작업 규칙 (실수 재발 방지)
- **워커는 한 번에 하나만.** `app.py`(UI) 와 `run_plan.py` 는 각자 워커를 띄운다.
  동시 실행하면 같은 절을 두 번 만들고 서로의 진행 상태를 덮어쓴다.
- `engine.py`/`jobs.py` 수정 후에는 **워커 재시작 필수** — 실행 중 프로세스는 옛 코드를 물고 있다.

---

## PostgREST 1000행 상한 — 전량 조회 지점 (2026-09-09)

이 프로젝트의 PostgREST 는 **max-rows=1000 하드 캡**이다. limit 을 3000 으로 줘도,
Range 헤더를 넓혀도, service_role 키로 요청해도 1000행만 온다. **오류도 경고도 없다.**

`reading_progress` 는 `lib/supabasePaged.ts` 로 해결했다. 아래는 같은 함정에 있으나
현재 행 수가 적어 아직 안 걸린 곳이다. 데이터가 늘면 조용히 잘린다.

| 위치 | 테이블 | 현재 행 수 |
|---|---|---|
| `app/api/verse-notes/route.ts` 41·52·75 | verse_notes / verse_note_amens | 26 / 2 |
| `app/api/admin/verse-notes/route.ts` 31·49 | verse_note_reports / verse_notes | 0 / 26 |
| `app/api/verse-notes/report/route.ts` 62 | verse_note_reports | 0 |
| `app/api/user-state/route.ts` 31 | user_state | 44 |

특히 `admin/verse-notes` 는 **전 사용자 메모를 모으는** 조회라 가장 먼저 닿는다.
고칠 때는 `fetchAllRows` 를 그대로 쓰면 된다.

## anon 키 노출 실태 (2026-09-09) — 별도 세션에서 처리

RLS 경고 36건과 별개로, **가장 위험한 건이 경고 목록 밖에 있다.**

```
public.users   정책 "Allow all" · roles={public} · cmd=ALL · using=true
  컬럼: email, password_hash, kakao_id, push_token …
  → anon 키로 읽기·쓰기·삭제 전부 가능
  → 정책이 "있으므로" rls_disabled 경고에 잡히지 않음
public.members  RLS 미적용 (314행)
  컬럼: resident_id(주민등록번호), phone, address, birth_date, notes
```

anon 키는 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 로 브라우저 번들에 그대로 실린다.

**조사 범위를 줄이는 사실**: 예봄성경의 anon 클라이언트가 실제로 접근하는 테이블은
`bible_verses` `hymns` `bible_audio` `scraps` `user_photos` `verse_notes`
`verse_note_amens` `verse_note_reports` `reading_progress` `user_state` **10개뿐**이다.
`members`·`attendance`·`prayer_*` 에 RLS 를 켜도 **예봄성경은 깨지지 않는다.**
깨질 수 있는 쪽은 saint / prayer 앱이므로 그쪽 영향 조사가 선행되어야 한다.

## 말씀의삶 — 보류 항목

- 그룹 이름 수정 · 멤버 강퇴 · 초대코드 재발급 (Phase 2)
- 다중 플랜(DB화) · 그룹 익명 모드 · 절 단위 판정 · 회차별 목표일
- 플랜 순 TTS 연속 재생 (책 경계를 넘는 자동 다음 장)

---

## 말씀의삶 §5.5 인수 조건 정정 필요 (2026-09-09)

지시서 v1.1 §5.5 는 단계 3 의 **진짜 인수 조건**을 이렇게 못박았다.

> **7회차 창세기 50장 → 출애굽기 1장** — 책 마지막 장 전이. 왕상 11장은 책 중간이라
> `canNextChapter` 가 true 여서 §4.6 결함을 통과시킨다. 이 항목이 진짜 인수 조건이다.

**이 항목이 더 이상 판별력이 없다.** 기본 장 이동이 책 경계를 넘게 되어(정경 순서),
플랜 모드가 아니어도 창세기 50장 → 출애굽기 1장으로 간다. 플랜 순서와 정경 순서가
그 지점에서 **같기** 때문이다.

판별력 있는 대체 항목 — 플랜 순서와 정경 순서가 **다른** 책 경계를 써야 한다.

| 지점 | 플랜 순서 | 정경 순서 |
|---|---|---|
| 34→35회차 **아가 8장** | 잠언 16장 | 이사야 1장 |
| 3→4회차 **욥기 42장** | 창세기 1장 | 시편 1장 |
| 34회차 왕상 11장 | 아가 1장 | 열왕기상 12장 (책 중간) |

**아가 8장 → 잠언 16장**을 §5.5 의 1순위 인수 조건으로 바꾸는 것을 권한다.
책 경계이면서 플랜/정경이 갈리는 유일한 조합이라, `canNextChapter` 결함과
플랜 오버라이드 누락을 **동시에** 잡는다.

