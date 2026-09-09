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

## 5b. 로그인 전용 기능 테이블 (2026-06-11 신설)

DDL: [scripts/migration-login-features.sql](../scripts/migration-login-features.sql). 모두 `scraps` 패턴.
공통: `user_id`(text, saint.yebom.org), 쓰기는 SELECT-then-UPDATE/INSERT(또는 upsert), API 는 `supabaseAdmin`(service_role)로만 접근.

### `reading_progress` — 통독 진도 (A)
1행=1장. `(user_id, book_code, chapter, version, read_at)`. **UNIQUE** `(user_id, book_code, chapter)` — 어느 역본으로 읽든 1독 1회(version 키 제외). SearchPanel 3초 트리거가 `markChapterRead`. 진도% = `computeProgress` (총 1189장, [lib/books.ts](../lib/books.ts) `CHAPTER_COUNTS`).

### `verse_notes` — 묵상 노트·하이라이트 (B)
1행=1절. `(user_id, user_name, book_code, chapter, verse, color?, note?, version, created_at, updated_at)`. **UNIQUE** `(user_id, book_code, chapter, verse)`. color·note 둘 다 비면 **행 삭제**. 색 4종(노랑/분홍/파랑/초록, [lib/verse-notes.ts](../lib/verse-notes.ts) `HIGHLIGHT_COLORS`). GET 은 `?book=&chapter=` 장 단위 페치.

### `user_state` — 기기간 동기화 (E)
KV. PK `(user_id, key)`, `value jsonb`, `updated_at`. key=`bookmarks`(union 머지) / `recent`(마지막 위치, last-write-wins). [lib/userSync.ts](../lib/userSync.ts). 카드갤러리(C)는 기존 `scraps` 재사용(신규 테이블 없음).

## 5c. 말씀의삶 — 성경읽기진도표 테이블 (2026-09-09 신설)

DDL: [scripts/migration-reading-plan.sql](../scripts/migration-reading-plan.sql),
[scripts/migration-reading-groups.sql](../scripts/migration-reading-groups.sql). 설계는 [READING_PLAN.md](READING_PLAN.md).

**세 테이블 모두 진도를 저장하지 않는다.** 회차 완료는 기존 `reading_progress`(장 단위)에서
`computeUnitProgress`([lib/plans/yebom91.ts](../lib/plans/yebom91.ts))로 **매번 파생 계산**한다.
저장하면 두 값이 갈라지고, 갈라지면 어느 쪽이 맞는지 알 수 없다.

### `reading_unit_checks` — 회차 수동 체크
1행=1회차. `(user_id, plan_id, seq, checked_at)`. **UNIQUE** `(user_id, plan_id, seq)`.
자동 판정이 알 수 없는 것 하나 — **"종이 성경으로 읽었다"** 만 담는다.
조회 시 `plan_id` 필터를 반드시 건다(default 는 INSERT 때만 걸리므로, 플랜이 늘면 섞인다).

### `reading_groups` — 함께 읽기 그룹
`(id, name, invite_code, plan_id, created_by, created_at)`. **UNIQUE** `invite_code`.
초대코드는 서버 생성 — 혼동되는 `O·0·I·1` 을 뺀 32자 알파벳 6자리([lib/readingGroups.ts](../lib/readingGroups.ts) `CODE_ALPHABET`), 충돌 시 3회 재시도.
클라이언트가 코드를 정하게 두면 남의 모임 이름을 선점할 수 있다.

### `reading_group_members` — 소속
PK `(group_id, user_id)` — 복합 PK 가 곧 "한 그룹에 한 번만" 제약이다.
`user_name` 은 참여 시점의 세션 표시 이름 사본(`verse_notes` 패턴 — 교인 계정 테이블이 이 프로젝트에 없어 조인할 곳이 없다).
`reading_group_members_user_idx` 는 "내가 속한 그룹" 조회용 — PK 선두가 `group_id` 라 `user_id` 단독 조회를 커버하지 못한다.

**순위 조회는 반드시 페이지네이션한다**(`fetchAllRows`). 멤버 전원의 `reading_progress` 를 IN 으로 읽는데,
합계가 1,000행을 넘는 순간 PostgREST 가 경고 없이 자르고 **잘린 부분집합으로 순위가 계산된다.**
1인 평균 28장이므로 36명이면 닿는다.

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
- `reading_progress`, `verse_notes`, `user_state`, `reading_unit_checks`, `reading_groups`, `reading_group_members`: **RLS enable + 정책 없음** → anon/authenticated 직접 접근 전면 차단. 앱이 iron-session(Supabase Auth 미사용)이라 `auth.uid()` 가 항상 null. API 의 `supabaseAdmin`(service_role)만 우회하며 항상 `user_id` 스코프

## 8. 마이그레이션 이력

| 일자 | 변경 |
|---|---|
| 2026-09-09 | 말씀의삶 그룹 2종 신설 (`reading_groups`/`reading_group_members`) — `scripts/migration-reading-groups.sql` |
| 2026-09-09 | 말씀의삶 회차 수동 체크 (`reading_unit_checks`) — `scripts/migration-reading-plan.sql` |
| 2026-06-11 | 로그인 전용 기능 테이블 3종 신설 (`reading_progress`/`verse_notes`/`user_state`) — `scripts/migration-login-features.sql` |
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
