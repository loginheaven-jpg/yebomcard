# TTS 파이프라인 — 엔진·캐시·발음 정책

> 예봄성경의 TTS(텍스트 음성) 시스템 단일 참조 문서. 2026-06-11 기준.

---

## 1. 3단 폴백 구조

재생 시도 우선순위:

```
1순위: bible_audio 매핑 mp3 (사람 녹음)
        └ 통독성경(easy)·개역개정(nkrv) 한글: Supabase Storage
        └ WEB(Williams): Cloudflare R2 (pub-7f869002b64b...r2.dev)
        실패 시 ↓

2순위: Cloud TTS (GCP)
        └ Chirp3-HD (1차)
        └ Neural2 (Chirp 실패 시 폴백)
        실패 시 ↓

3순위: Web Speech API (브라우저 내장)
        └ 발화 voice 자동 선택 (한국어 우선)
```

진입 트리거: `lib/bibleAudio.ts` `lookupChapterAudio(version, bookCode, chapter)` → mp3 URL 또는 null. null 이면 TTS 합성 경로.

## 2. 언어·발음 분기

### `lang` 파라미터 (자동 결정)

`isEnglishVersion(version)` 함수가 판정:
- `nkrv` / `rnksv` / `easy` → `lang="ko"` → `ko-KR-*` voice
- `kjv` / `nirv` / `gnt` / `web` → `lang="en"` → `en-US-*` 또는 `en-GB-*` voice

### `accent` 파라미터 (사용자 선택)

영문 본문일 때만 의미. `localStorage["yebom_tts_english_accent"]` 영속.

| accent | voice (Chirp3-HD) | voice (Neural2 폴백) |
|---|---|---|
| `us` (기본) | `en-US-Chirp3-HD-Aoede/Charon` | `en-US-Neural2-F/D` |
| `gb` | `en-GB-Chirp3-HD-Aoede/Charon` | `en-GB-Neural2-A/B` |

### `voice` 파라미터 (성별)

| voice | ko-KR | en-US | en-GB |
|---|---|---|---|
| `female` (기본) | Aoede | Aoede | Aoede |
| `male` | Charon | Charon | Charon |

## 3. 캐시 키 v5

```ts
makeCacheKey({ version, bookCode, chapter, verse, voice, speed, accent })
// → `${version}-${book}-${ch}-${verse}-${voice}-${speed}-${accent}`
```

저장소: **IndexedDB** `yebom_tts_cache`, `DB_VERSION = 5`

### 정책
- 한국어 트랙: accent="ko" (고정 sentinel — 미국/영국 분기 무관)
- 영문 트랙: accent="us" 또는 "gb" (사용자 토글 즉시 반영)
- LRU evict: `MAX_ENTRIES=500`, 초과 시 `BATCH_EVICT=50` 개 제거

### DB_VERSION bump 시점
- v3→v4 (2026-06): 영문 ko-KR 합성 캐시 무효화 (en-US voice 도입)
- v4→v5 (2026-06): accent 키 필드 추가로 stale 캐시 회피

> **신규 분기 추가 시**: cacheKey 구성 변경 → `DB_VERSION` 반드시 bump.

## 4. 재생 속도 (7단계)

```
[0.7, 0.85, 1.0, 1.15, 1.5, 1.75, 2.0]
```

- 0.7x: 영문 청취 학습용 슬로우
- 1.0x: 기본
- 1.15x~2.0x: 빠른 청취

저장: `localStorage["yebom_tts_speed"]`.

## 5. 트랙 구조 (`TtsTrack`)

```ts
interface TtsTrack {
  text: string;
  ref: string;          // "시 121:5"
  version: string;
  bookCode: string;
  bookName: string;
  chapter: number;
  verse: number;        // 0 = 장 안내 announcement, -1 = 장 통째 mp3, 1+ = 절
  mp3Url?: string;      // bible_audio 매핑 있으면 채워짐 → TTS 합성 우회
}
```

### 장 안내 announcement (verse=0)

자동 삽입 — `injectChapterAnnouncements()`:
- 한국어: `"{bookName} {N}장"` → ko-KR voice
- 영문: `"{bookName} chapter {N}"` → en-US/en-GB voice

### 절 번호 prefix (옵션)

`readVerseNumber` 토글 시:
- 한국어: `"{N}절. {본문}"`
- 영문: `"Verse {N}. {본문}"`

## 6. 미니플레이어 UI 패턴

좌→우 순서:

```
[▶] [ref + N/M + 진행바]   [AI/녹음/Web]   [속도]   [발음]   [음성]   [⋮]   [✕]
                          ↑라벨           ↑버튼     ↑토글    ↑토글
```

### 컨트롤 노출 조건

| 조건 | 엔진 라벨 | 속도 | 발음 (US/UK) | 음성 (여/남) |
|---|---|---|---|---|
| 한국어 AI | AI | ✓ | – | ✓ |
| 영문 AI | AI | ✓ | ✓ | ✓ |
| 영문 mp3 녹음 (Williams) | 녹음 | ✓ | – | – |
| WebSpeech 폴백 | Web | ✓ | – | – |

### 토글 동작 (single button)

- 발음: "미국식" → 탭 → "영국식" 으로 즉시 전환. 캐시 키 다르므로 다음 트랙부터 새 fetch
- 음성: "여" → 탭 → "남" 으로 즉시 전환. 동일

설정창 segmented `[여성][남성]` 와 양방향 동기 (Context 단일 source).

## 7. WEB 영문 음원 (Williams + R2)

| 항목 | 값 |
|---|---|
| 낭독자 | David Williams (WEB Classic) |
| 출처 | AudioTreasure.com (Public Domain) |
| 호스팅 | Cloudflare R2 bucket `attached` |
| URL 패턴 | `https://pub-7f869002b64b4501aa6e28ee31b1bd6c.r2.dev/web/{book_code}/{NNN}.mp3` |
| 용량 | 1.33 GB / 1189 chapter |
| 비트레이트 | 48 kbps mono 44.1 kHz |
| 캐시 | `Cache-Control: public, max-age=31536000, immutable` |

### 적재 스크립트
- [scripts/upload-web-audio-r2.mjs](../scripts/upload-web-audio-r2.mjs) — AWS SDK v3, 병렬 8 connection
- [scripts/gen-manifest.mjs](../scripts/gen-manifest.mjs) — 매핑 manifest 생성
- [scripts/insert-web-audio-rows.mjs](../scripts/insert-web-audio-rows.mjs) — Supabase `bible_audio` upsert

## 8. API 경로

### `/api/tts` (POST)

```ts
body: {
  text: string;
  voice: "female" | "male";
  speed: number;       // 0.7 ~ 2.0
  lang?: "ko" | "en";  // 기본 "ko"
  accent?: "us" | "gb"; // lang="en" 일 때만 의미
}
response: audio/mpeg blob + X-TTS-Voice 헤더
```

GCP 서비스 계정 JWT 사용 — 사용자 세션과 무관 (공개 endpoint).

## 9. 보류·차기 (plan.md 부분 참조)

- 영문 TTS voice 분기 — **완료**
- KJV 데살로니가전·후 보충 — KJV 64권/66권 미완 (별건)
- 시편 표제 절 매칭 보정 (WEB은 표제 1절, KJV/nkrv 안 셈)
- AI recommend WEB 호환 (book_name → book_code 매칭)
- WebSpeech 폴백 영문 voice 분기 (현재 ko-KR 만)
