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

### DB 본문 자체가 오염된 절 — 음원이 아니라 본문 문제 (2026-09-09)

보류 사유가 `짝 없는 괄호`인 절들은 TTS 결함이 아니라 **새번역 본문에 주석·소제목이
섞여 들어간 것**이다. 화면에서도 그대로 보이므로 낭독만의 문제가 아니다.

전권 스캔 결과 **상호참조 괄호가 절 본문에 들어간 절은 3건**뿐이다(31,075절 중):

| 절 | 섞여 들어간 것 |
|---|---|
| 마가복음 6:6 | 소제목 `열두 제자를 선교에 파송하시다(마 10:1; 5-15; 눅 9:1-6)` 가 절 중간에 |
| 사무엘상 13:1 | 각주 `'은 앞의 10단위가 빠져 있는 것임…(행 13…` |
| 열왕기상 5:16 | 각주 `(주: 칠십인역에는 '삼천육백'(대하 2:2; 18에서도)` |

3건이라 **일괄 수정보다 개별 확인이 맞다.** 원문 대조 없이 자르면 본문을 훼손한다.
UPDATE 하면 sha1 이 바뀌어 해당 절 음원은 자동 무효화되고 다음 생성 때 다시 만들어진다.
→ **지휘부 판단 대기.** 손대지 않는 선택지도 유효하다(빈도 3건, 낭독 시 어색할 뿐 오독은 아님).

이와 별개로 **짝 없는 `)` 절 345건** 중 211건은 `prosody.strip_orphan_paren` 이
자동 정리하고, 남은 134건은 사람이 봐야 한다(위 3건 포함).

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

