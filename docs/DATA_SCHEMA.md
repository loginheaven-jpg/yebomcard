# Supabase 스키마 + 동기화 정책

> 데이터 모델 단일 참조 문서. 2026-06-11 기준.

---

## 1. `bible_verses` — 본문

총 ~218,500 row (7 version × 약 31,000절). PK `id`.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | int (seq) | PK |
| `version` | varchar(10) | nkrv / rnksv / easy / kjv / nirv / gnt / web |
| `book_code` | varchar(10) | USFM 3자 소문자 (gen, exo, ... rev). Lamentations=lam, Song of Solomon=sng |
| `book_name` | varchar(20) | 한글 또는 영문 책명 (version 따라) |
| `book_abbr` | varchar(5) | 책 약어 |
| `book_order` | smallint | 1~66 |
| `testament` | varchar(5) | "old" / "new" |
| `chapter` | smallint |  |
| `verse` | smallint |  |
| `text` | text |  |

**UNIQUE**: `(version, book_code, chapter, verse)` — upsert 충돌 키.

### version 별 카운트 (2026-06-11)

| version | rows | 비고 |
|---|---|---|
| nkrv | 31,101 | 개역개정 |
| easy | 31,100 | 통독성경 (쉬운성경) |
| rnksv | 31,075 | 새번역 |
| nirv | 31,058 | NIrV |
| **kjv** | **30,966** | **KJV — 데살로니가전·후 누락 (1th/2th, 별건)** |
| gnt | 30,170 | GNT |
| **web** | **31,098** | **World English Bible (Classic, Yahweh 표기)** |

## 2. `bible_audio` — 장 단위 음원 매핑

총 3,567 row (3 version × 1,189 chapter). PK `id`.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | int (seq) | PK |
| `version` | varchar | easy / nkrv / web |
| `book_code` | varchar |  |
| `chapter` | smallint |  |
| `audio_url` | text | 전체 URL |
| `duration_ms` | int | nullable |
| `file_bytes` | int | nullable |
| `narrator` | varchar | 낭독자 (예: "쉬운성경(통독성경)", "David Williams (WEB)") |
| `created_at` | timestamptz | default now() |

**UNIQUE**: `(version, book_code, chapter)`.

### 호스팅

| version | 호스팅 | URL 패턴 |
|---|---|---|
| easy | Supabase Storage | `{supabase}/storage/v1/object/public/bible-audio/easy/{book_code}/{NNN}.mp3` |
| nkrv | Supabase Storage | `{supabase}/storage/v1/object/public/bible-audio/nkrv/{book_code}/{NNN}.mp3` |
| **web** | **Cloudflare R2** | `https://pub-7f869002b64b4501aa6e28ee31b1bd6c.r2.dev/web/{book_code}/{NNN}.mp3` |

## 3. `scraps` — 사용자 스크랩

PK `id`. **UNIQUE** `scraps_unique_per_user(user_id, book_code, chapter, verse_start, version)` — 2026-06-10 추가.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | int (seq) | PK |
| `user_id` | text | saint.yebom.org user_id |
| `user_name` | text |  |
| `book_code` | varchar |  |
| `chapter` | smallint |  |
| `verse_start` | smallint | UNIQUE 키 일부 |
| `verse_end` | smallint | 범위 확장만 (UNIQUE 키 아님) |
| `version` | varchar | UNIQUE 키 일부 |
| `reference` | text | 표시용 "레위기 4장 1절" |
| `preview` | text | 본문 일부 (40자) |
| `image_url` | text | 카드 이미지 URL (옵션) |
| `created_at` | timestamptz |  |

### 동기화 정책

API `POST /api/scrap` 는 **SELECT-then-UPDATE/INSERT** 패턴:
1. (user_id, book_code, chapter, verse_start, version) 존재 확인
2. 있으면 verse_end/reference/preview/image_url/created_at 갱신 (UPDATE)
3. 없으면 신규 INSERT
4. UNIQUE constraint 가 race condition 차단 (DB 레벨 backstop)

### handleSelectScrap 의 version 동기화 의무

`app/page.tsx` 의 `handleSelectScrap`:
- 스크랩 클릭 시 selectedVerses 설정 + **mainVersion 도 scrap.version 으로 동기화**
- 이 동기화 누락 시: 사용자가 절 추가 → 다른 version 으로 저장 → UNIQUE 키 달라 새 row → 중복

## 4. `bookmarks` (localStorage)

서버 저장 아님 — `localStorage["yebom_bookmarks"]` JSON 배열.

```ts
{
  id: string;
  book_name: string;
  book_code: string;
  chapter: number;
  savedAt: number;
}
```

`최근` 항목은 자동 갱신, 수동 책갈피는 사용자 추가.

## 5. `user_photos` — 카드 배경 이미지

API `/api/photos`:
- POST: 업로드 (Supabase Storage `user-photos` bucket)
- GET: 사용자 업로드 목록
- 인증 필요 (401 fail)

| 컬럼 | 비고 |
|---|---|
| `id` | PK |
| `user_id` | saint.yebom.org user_id |
| `storage_path` | bucket 내 경로 |
| `created_at` |  |

## 6. iron-session 쿠키

`SessionData` (lib/auth/session.ts):
```ts
{
  isLoggedIn: boolean;
  user_id: string;
  name: string;
  // ... saint.yebom.org 에서 전달
}
```

TTL: 7일. 만료 시 다음 페이지 로드의 `/api/auth/session` 이 `{ session: null }` 반환.

## 7. RLS 정책

- `scraps`: 자신 데이터만 SELECT/INSERT/UPDATE/DELETE (server-side service role 우회 권장)
- `bible_verses`, `bible_audio`: public READ (anon key OK)
- `user_photos`: 자신 데이터만 접근

## 8. 마이그레이션 이력

| 일자 | 변경 |
|---|---|
| 2026-06-10 | `scraps_unique_per_user` UNIQUE 추가 + 기존 중복 row 정리 (20+ 그룹) |
| 2026-06-10 | WEB 역본 적재 (`bible_verses` + `bible_audio` 1189 row) |
| 2026-05 | (선) bible_verses 3개 한국어 역본 (nkrv/rnksv/easy) — `성경데이터확장문서.md` |

## 9. BibleVersion 신규 추가 체크리스트

신규 영문/한글 역본 도입 시:
1. **DB**: `bible_verses` 적재 (Supabase Dashboard CSV Import 권장)
2. **타입**: `lib/types.ts` `EnglishVersion` / `KoreanVersion` 확장
3. **라벨**: `lib/versions.ts` `getVersionLabel` 매핑 추가
4. **isEnglishVersion**: 영문이면 `lib/versions.ts` 의 함수 갱신
5. **UI 셀렉터**: `SearchPanel` 6개 배열 + `FullscreenReader` + `WorshipBible` 일관 갱신
6. **음원** (옵션): `bible_audio` row 추가, R2 또는 Supabase Storage 업로드
7. **캐시**: 필요 시 `ttsCache.ts` `DB_VERSION` bump

이 체크리스트는 [AGENTS.md](../AGENTS.md) 의 "위험 패턴" 표와 연계.
