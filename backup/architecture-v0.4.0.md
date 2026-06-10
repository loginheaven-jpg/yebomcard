# architecture.md — 예봄성경/카드 시스템 설계서

> **최종 수정**: 2026-06-11  
> **버전**: 0.5.0  
> **상태**: Phase 2a~3 리디자인 완료 + WEB 역본/음원 통합 완료

---

## ⚠️ 최신 단면은 docs/ 우선 참조

본 문서는 v0.4.0 기준의 메인 설계서이며 일부 섹션이 구체 디테일을 포함한다.
**2026-06 이후 도입된 핵심 변경은 다음 문서들에서 단일 소스로 관리**:

| 영역 | 문서 |
|---|---|
| 코딩 규칙·아키텍처 요약 | [AGENTS.md](AGENTS.md) |
| TTS 엔진/캐시/발음 정책 | [docs/TTS_PIPELINE.md](docs/TTS_PIPELINE.md) |
| 5탭 IA + 통합 SettingsSheet | [docs/IA_5TAB.md](docs/IA_5TAB.md) |
| Supabase 스키마 + 동기화 | [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md) |
| 보류·차기 검토 | [plan.md](plan.md) |

본 문서의 다음 섹션은 v0.4.0 기준 그대로 유지 — 외부 계약·핵심 비전 이해용.

---

## v0.5.0 변경 요약

- **하단 5탭 IA** 도입 (BottomTabBar) + 통합 SettingsSheet — 다수 FAB 제거 ([docs/IA_5TAB.md](docs/IA_5TAB.md))
- **WEB 역본** 31,098절 적재 + Williams 영문 음원 1189장 (Cloudflare R2) ([docs/TTS_PIPELINE.md](docs/TTS_PIPELINE.md), [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md))
- **영문 TTS** en-US/en-GB accent 분기 + voice 분기 (캐시 키 v5)
- **미니플레이어** single-toggle 패턴 (발음·음성 즉시 전환) + 0.7x 속도 추가
- **시스템 다크 추종** (FontContext) + 그립 드래그 시트 + 길게 누름→전체화면
- **스크랩 UNIQUE** constraint + version 동기화 정책 — 중복 row 차단
- **useSession race fix** — loading 가드 + bfcache 복원 시 재검증

---

## 1. 시스템 개요

### 1.1 서비스 정의
예봄카드는 성경 말씀을 검색하여 고품질 이미지 카드로 생성하는 웹 서비스다.
한글(개역개정/새번역)과 영문(KJV)을 고품질 배경 위에 배치하고,
3가지 추천 카드 중 선택하여 PNG로 다운로드할 수 있다.

### 1.2 핵심 사양
- **서비스명**: 예봄카드
- **워터마크**: 모든 카드 하단에 `Yebom Card`
- **카드 규격**: 1080×1350px (4:5) / 1080×1080px (1:1)
- **지원 성경**: 개역개정(nkrv) · 새번역(rnksv) · KJV(kjv)

---

## 2. 기술 스택

```
┌─────────────────────────────────────────┐
│              Client (Browser)           │
│  Next.js 14+ · TypeScript · Tailwind    │
│  html-to-image (PNG export)             │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│           Vercel (Hosting)              │
│  App Router · API Routes                │
│  /api/unsplash (프록시)                  │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│         Supabase (Backend)              │
│  PostgreSQL · bible_verses (93,042건)    │
│  pg_trgm 인덱스 · RLS (SELECT only)     │
│  Region: ap-south-1                      │
└─────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│         External APIs                   │
│  Unsplash (배경 사진 검색)               │
│  Anthropic Claude (AI 프롬프트 생성)     │
└─────────────────────────────────────────┘
```

---

## 3. 외부 서비스 연결 사양

### 3.1 Supabase (Database + Auth)

| 항목 | 값 |
|------|-----|
| **Project Name** | yebomsaint |
| **Project ID** | `iityjmjgnjtvqujpivjg` |
| **Region** | ap-south-1 (Mumbai) |
| **Project URL** | `https://iityjmjgnjtvqujpivjg.supabase.co` |
| **Legacy Anon Key** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...u5_KeGldwOYM` |
| **Publishable Key** | `sb_publishable_Jg8FZ3-m-Irv2XbYmLaLMQ_Oum7pBgK` |
| **DB Version** | PostgreSQL 17.6 |
| **RLS** | bible_verses: SELECT only (public) |

**환경변수**:
```env
NEXT_PUBLIC_SUPABASE_URL=https://iityjmjgnjtvqujpivjg.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpdHlqbWpnbmp0dnF1anBpdmpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2OTA5MjgsImV4cCI6MjA4MjI2NjkyOH0.u5_KeGldwOYM_JhUiBWqfRuTmCtgmxk_54UT2hi_MKw
```

**클라이언트 초기화**:
```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
```

**사용 가능한 쿼리** (RLS 허용 범위):
```typescript
// 장절 검색
const { data } = await supabase
  .from('bible_verses')
  .select('*')
  .eq('version', 'nkrv')
  .eq('book_code', 'psa')
  .eq('chapter', 23);

// 키워드 검색 (pg_trgm 인덱스 활용)
const { data } = await supabase
  .from('bible_verses')
  .select('*')
  .eq('version', 'nkrv')
  .ilike('text', '%사랑%')
  .order('book_order')
  .limit(50);

// 한/영 병기 (2회 조회 후 클라이언트 조인)
const [kr, en] = await Promise.all([
  supabase.from('bible_verses').select('*')
    .eq('version', 'nkrv').eq('book_code', code).eq('chapter', ch).eq('verse', vs).single(),
  supabase.from('bible_verses').select('*')
    .eq('version', 'kjv').eq('book_code', code).eq('chapter', ch).eq('verse', vs).single(),
]);
```

### 3.2 Unsplash (배경 사진 검색)

| 항목 | 값 |
|------|-----|
| **Base URL** | `https://api.unsplash.com` |
| **Access Key** | `Thm9XkyaPp-K9iTPi91KnwBsLY-Hnz6jeKGIC00mjMA` |
| **Rate Limit (Demo)** | 50 requests/hour |
| **Rate Limit (Production)** | 5,000 requests/hour (승인 신청 필요) |
| **응답 형식** | JSON |
| **이미지 URL** | 핫링크 필수 (직접 호스팅 금지) |

**환경변수** (서버 전용 — NEXT_PUBLIC 아님):
```env
UNSPLASH_ACCESS_KEY=Thm9XkyaPp-K9iTPi91KnwBsLY-Hnz6jeKGIC00mjMA
```

**API Route 프록시** (키 노출 방지):
```typescript
// app/api/unsplash/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query') || 'nature';
  const perPage = searchParams.get('per_page') || '3';

  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait`,
    { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` } }
  );

  const data = await res.json();
  return Response.json(data.results?.map((img: any) => ({
    id: img.id,
    url: img.urls.regular,
    fullUrl: img.urls.full,
    color: img.color,
    blur_hash: img.blur_hash,
    download_location: img.links.download_location,
    credit: {
      name: img.user.name,
      profileUrl: `${img.user.links.html}?utm_source=yebom_card&utm_medium=referral`,
    },
  })) || []);
}
```

**필수 준수 사항** (Unsplash API Guidelines):
1. **Attribution 의무**: 카드 위 또는 아래에 "Photo by {사진작가} on Unsplash" 표시
2. **핫링크 필수**: `images.unsplash.com` URL 직접 사용, 자체 서버 호스팅 금지
3. **다운로드 추적**: 사용자가 카드를 다운로드할 때 `download_location` 엔드포인트 호출
4. **UTM 파라미터**: Unsplash 링크에 `?utm_source=yebom_card&utm_medium=referral` 추가

**Rate Limit 대응 전략**:
- Demo 50회/시간 → 검색 결과 클라이언트 캐싱 (useState)
- 동일 키워드 재검색 방지 (debounce 300ms + 결과 캐시)
- 향후 Production 승인 신청 (5,000회/시간)

### 3.3 Vercel (Hosting + Deployment)

| 항목 | 값 |
|------|-----|
| **Framework** | Next.js 14+ (App Router) |
| **배포 방식** | GitHub repo 연동 자동 배포 |
| **환경변수 설정** | Vercel Dashboard → Settings → Environment Variables |
| **도메인** | 기본 `*.vercel.app` → 추후 커스텀 도메인 연결 |

**Vercel 환경변수 설정** (배포 시 필수):
```
NEXT_PUBLIC_SUPABASE_URL        → Production/Preview/Development 모두
NEXT_PUBLIC_SUPABASE_ANON_KEY   → Production/Preview/Development 모두
UNSPLASH_ACCESS_KEY             → Production/Preview/Development 모두
```

**next.config.ts 이미지 도메인 허용**:
```typescript
// next.config.ts
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
};
export default nextConfig;
```

### 3.4 Google Fonts (웹폰트 CDN)

**import URL** (layout.tsx에서 사용):
```typescript
// app/layout.tsx
import { Noto_Serif_KR, Gothic_A1, Playfair_Display } from 'next/font/google';

const notoSerifKr = Noto_Serif_KR({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-noto-serif-kr',
});

const gothicA1 = Gothic_A1({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-gothic-a1',
});

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-playfair',
});
```

**참고**: Nanum Myeongjo, Nanum Pen Script는 next/font/google에서 지원한다. 다만 html-to-image 캡처 시 폰트 프리로드가 필요하다.

**html-to-image 폰트 대응**:
```typescript
// 캡처 전 폰트 로딩 완료 확인
await document.fonts.ready;
const dataUrl = await toPng(cardRef.current, {
  width: 1080,
  height: 1350,
  pixelRatio: 1,
  cacheBust: true,
  style: { transform: 'scale(1)', transformOrigin: 'top left' },
});
```

### 3.5 Anthropic Claude API (AI 프롬프트 생성 — Phase 1 P2)

| 항목 | 값 |
|------|-----|
| **용도** | 말씀 키워드 → CSS 아트 배경 프롬프트 생성 |
| **모델** | claude-sonnet-4-20250514 |
| **엔드포인트** | `https://api.anthropic.com/v1/messages` |
| **Phase** | Phase 1 P2 (MVP 이후 구현) |

**구현 방식**: React 아티팩트의 Anthropic API 내장 호출 사용. 별도 API 키 불필요.

```typescript
// Claude API를 사용한 CSS 아트 배경 생성 (artifact 내장)
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: `성경 말씀 "${verseText}"에 어울리는 CSS 그라데이션 배경을 생성해줘.
      JSON 형식으로만 응답해: {"gradient": "linear-gradient(...)", "textColor": "white"|"dark"}`
    }],
  }),
});
```

---

## 4. 데이터 아키텍처

### 4.1 bible_verses 테이블

```sql
CREATE TABLE bible_verses (
  id         serial PRIMARY KEY,
  version    varchar NOT NULL,     -- 'nkrv' | 'rnksv' | 'kjv'
  book_code  varchar NOT NULL,     -- 'gen' ~ 'rev'
  book_name  varchar NOT NULL,     -- 한글 또는 영문 책명
  book_abbr  varchar NOT NULL,     -- 약어
  book_order smallint NOT NULL,    -- 1~66
  testament  varchar NOT NULL,     -- 'old' | 'new'
  chapter    smallint NOT NULL,
  verse      smallint NOT NULL,
  text       text NOT NULL DEFAULT '',

  UNIQUE (version, book_code, chapter, verse)
);
```

### 4.2 인덱스

| 인덱스명 | 유형 | 대상 | 용도 |
|----------|------|------|------|
| bible_verses_pkey | B-tree | id | PK |
| bible_verses_version_book_code_chapter_verse_key | B-tree UNIQUE | (version, book_code, chapter, verse) | 중복 방지 + 장절 조회 |
| idx_bible_lookup | B-tree | (version, book_name, chapter, verse) | 책이름으로 조회 |
| idx_bible_abbr | B-tree | (version, book_abbr, chapter, verse) | 약어로 조회 |
| idx_bible_text_trgm | GIN (pg_trgm) | text | 키워드 검색 |
| idx_bible_bookname_trgm | GIN (pg_trgm) | book_name | 책이름 부분 검색 |

### 4.3 RLS 정책

| 테이블 | 정책명 | 역할 | 명령 | 조건 |
|--------|--------|------|------|------|
| bible_verses | bible_verses_read | public | SELECT | true |

INSERT/UPDATE/DELETE는 service_role 전용 (Management API).

### 4.4 데이터 현황

| 버전 | 건수 | 비고 |
|------|------|------|
| nkrv | 31,101 | 개역개정 |
| rnksv | 31,075 | 새번역 (일부 HTML 잔여물 있음 — 향후 정제 필요) |
| kjv | 30,966 | KJV 영문 (99.6%) |
| **합계** | **93,042** | |

### 4.5 한/영 매칭 쿼리

```sql
-- book_code + chapter + verse를 키로 한/영 JOIN
SELECT
  k.book_name AS kr_book,
  k.chapter, k.verse,
  k.text AS kr_text,
  e.book_name AS en_book,
  e.text AS en_text
FROM bible_verses k
JOIN bible_verses e
  ON  k.book_code = e.book_code
  AND k.chapter   = e.chapter
  AND k.verse     = e.verse
WHERE k.version = 'nkrv'
  AND e.version = 'kjv';
```

---

## 5. 사용자 흐름 (User Flow)

```
[1. 검색] → [2. 구절 선택] → [3. 카드 3종 추천] → [4. 커스터마이즈] → [5. 다운로드]
```

### 5.1 검색 (Step 1)

두 가지 검색 모드를 제공한다.

**장절 검색**: 책(드롭다운 66권) → 장(동적) → 절(동적)
```sql
-- 장 목록 조회
SELECT DISTINCT chapter FROM bible_verses
WHERE version = 'nkrv' AND book_code = 'psa'
ORDER BY chapter;

-- 절 목록 조회
SELECT DISTINCT verse FROM bible_verses
WHERE version = 'nkrv' AND book_code = 'psa' AND chapter = 23
ORDER BY verse;
```

**키워드 검색**: 텍스트 입력 → ILIKE 검색
```sql
SELECT book_name, chapter, verse, text
FROM bible_verses
WHERE version = 'nkrv' AND text ILIKE '%사랑%'
ORDER BY book_order, chapter, verse
LIMIT 50;
```

**버전 토글**: 개역개정(nkrv) ↔ 새번역(rnksv)

### 5.2 구절 확인 (Step 2)

선택된 구절의 한/영 본문을 동시 표시한다.

```
┌────────────────────────────┐
│  나는 여호와로 말미암아       │
│  즐거워하며 나의 구원의       │
│  하나님으로 말미암아          │
│  기뻐하리로다                │
│                            │
│  하박국 3장 18절             │
│                            │
│  Yet I will rejoice in the  │
│  LORD, I will joy in the    │
│  God of my salvation.       │
│                            │
│  Habakkuk 3:18             │
└────────────────────────────┘
```

### 5.3 카드 3종 추천 (Step 3)

| 탭 | 배경 소스 | 생성 방법 |
|------|-----------|-----------|
| 그라데이션 | **CSS 그라데이션** | 말씀 키워드 → 12종 프리셋 자동 매칭 |
| 사진 배경 | **Unsplash 사진** | 키워드 → 영문 변환 → API 검색 (page 랜덤화 + 새로고침) |
| 내 사진 | **사용자 업로드** | FileReader → base64 data URL → 오버레이 합성 |
| ~~AI 아트~~ | ~~AI 이미지 생성~~ | ~~AI Gateway → DALL-E/Imagen~~ (보류, 코드 유지) |

#### 5.3.1 키워드 추출 알고리즘

```
입력: 성경 구절 텍스트 (한글)
  ↓
[1] 사전 정의 키워드 매칭
    KEYWORD_BANK = {
      "평안": ["평안","안식","쉬","위로","편안"],
      "소망": ["소망","바람","희망","기다","기대"],
      "능력": ["능력","힘","강","권능","승리"],
      "사랑": ["사랑","자비","긍휼","은총"],
      "기쁨": ["기쁨","즐거","기뻐","찬양","감사"],
      "생명": ["생명","살","치유","회복","고치"],
      "믿음": ["믿","신뢰","의지"],
      "지혜": ["지혜","명철","총명","깨달"],
      "영광": ["영광","빛","광채","거룩"],
      "구원": ["구원","구속","해방","건지"],
    }
  ↓
[2] 매칭된 키워드 → 배경 소스별 추천
    - CSS: GRADIENT_PRESETS에서 매칭
    - Unsplash: KEYWORD_TO_UNSPLASH로 영문 변환 (page 파라미터로 새로고침)
    - 내 사진: 사용자 업로드 (FileReader → base64, 5MB 제한)
  ↓
[3] 탭 선택 → 카드 프리뷰 렌더링 (오버레이: 40~55%)
```

#### 5.3.2 CSS 그라데이션 프리셋 (12종)

```typescript
interface GradientPreset {
  name: string;
  gradient: string;
  keywords: string[];
  textColor: 'white' | 'dark';
}

const GRADIENT_PRESETS: GradientPreset[] = [
  { name: "새벽기도", gradient: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
    keywords: ["새벽","기도","경건"], textColor: "white" },
  { name: "봄날",     gradient: "linear-gradient(135deg, #a8e6cf, #dcedc1, #ffd3b6)",
    keywords: ["소망","새로움","기쁨"], textColor: "dark" },
  { name: "은혜",     gradient: "linear-gradient(135deg, #667eea, #764ba2)",
    keywords: ["은혜","영광","하늘"], textColor: "white" },
  { name: "석양",     gradient: "linear-gradient(135deg, #fa709a, #fee140)",
    keywords: ["감사","찬양"], textColor: "dark" },
  { name: "평안",     gradient: "linear-gradient(135deg, #a1c4fd, #c2e9fb)",
    keywords: ["평안","안식","위로"], textColor: "dark" },
  { name: "산위에서", gradient: "linear-gradient(135deg, #2c3e50, #4ca1af)",
    keywords: ["능력","힘","승리"], textColor: "white" },
  { name: "들꽃",     gradient: "linear-gradient(135deg, #f093fb, #f5576c)",
    keywords: ["사랑","아름다움"], textColor: "white" },
  { name: "순금",     gradient: "linear-gradient(135deg, #f7971e, #ffd200)",
    keywords: ["말씀","진리","보배"], textColor: "dark" },
  { name: "밤하늘",   gradient: "linear-gradient(135deg, #0c0c1d, #1a1a3e, #2d2d5e)",
    keywords: ["묵상","깊음"], textColor: "white" },
  { name: "초원",     gradient: "linear-gradient(135deg, #11998e, #38ef7d)",
    keywords: ["생명","치유","회복"], textColor: "white" },
  { name: "구름위",   gradient: "linear-gradient(135deg, #e0c3fc, #8ec5fc)",
    keywords: ["천국","영원"], textColor: "dark" },
  { name: "불기둥",   gradient: "linear-gradient(135deg, #eb3349, #f45c43)",
    keywords: ["열정","심판"], textColor: "white" },
];
```

#### 5.3.3 Unsplash 키워드 매핑

```typescript
const KEYWORD_TO_UNSPLASH: Record<string, string> = {
  "평안": "peaceful lake calm water",
  "소망": "sunrise golden light hope",
  "능력": "mountain summit majestic",
  "사랑": "flower garden warmth spring",
  "기쁨": "meadow spring sunshine field",
  "감사": "autumn harvest warm golden",
  "생명": "green forest fresh morning",
  "치유": "ocean waves serene healing",
  "묵상": "misty morning quiet forest",
  "영광": "golden sky clouds dramatic",
  "구원": "dramatic sky light breaking clouds",
  "믿음": "path road journey light",
  "지혜": "library ancient wisdom light",
};
```

### 5.4 커스터마이즈 (Step 4)

| 옵션 | 선택지 | 기본값 |
|------|--------|--------|
| 레이아웃 | 중앙 / 좌측 / 하단 | 중앙 |
| 서체 | Noto Serif KR / Nanum Myeongjo / Gothic A1 / Nanum Pen / Playfair Display | Noto Serif KR |
| 텍스트 색상 | 자동(배경대비) / 흰색 / 검정 | 자동 |
| 영문 표기 | 표시 / 숨김 | 표시 |
| 카드 비율 | 4:5 (1080×1350) / 1:1 (1080×1080) | 4:5 |

### 5.5 다운로드 (Step 5)

- html-to-image 라이브러리로 DOM → PNG 변환
- 다운로드 직전 `Yebom Card` 워터마크 자동 삽입
- 폰트 프리로드 완료 후 캡처 (한글 깨짐 방지)

---

## 6. 카드 디자인 시스템

### 6.1 레이아웃 3종

**A. 중앙 정렬 (기본)** — 크리스천투데이 스타일
```
┌─────────────────────┐
│                     │
│    [한글 말씀]       │  ← 중앙정렬, 세리프체
│    [장절 표기]       │  ← 작은 사이즈
│                     │
│    [영문 말씀]       │  ← 이탤릭
│    [영문 장절]       │  ← 작은 사이즈
│                     │
│          Yebom Card │  ← 워터마크
└─────────────────────┘
```

**B. 좌측 정렬** — 모던 스타일
```
┌─────────────────────┐
│                     │
│  [한글 말씀]         │  ← 좌측정렬
│  [장절 표기]         │
│                     │
│  [영문 말씀]         │
│  [영문 장절]         │
│                     │
│          Yebom Card │
└─────────────────────┘
```

**C. 하단 배치** — 풍경 사진 강조
```
┌─────────────────────┐
│                     │
│   (배경 사진 영역)    │
│                     │
│ ┌─────────────────┐ │
│ │ [반투명 오버레이] │ │
│ │ [한글 말씀]      │ │
│ │ [장절] · [영문]  │ │
│ └─────────────────┘ │
│          Yebom Card │
└─────────────────────┘
```

### 6.2 서체 시스템 (Google Fonts CDN)

| 서체 | 용도 | import |
|------|------|--------|
| Noto Serif Korean (400,700) | 한글 본문 기본 | `Noto+Serif+KR:wght@400;700` |
| Nanum Myeongjo (400,700) | 한글 문학적 | `Nanum+Myeongjo:wght@400;700` |
| Gothic A1 (400,600) | 한글 산세리프 | `Gothic+A1:wght@400;600` |
| Nanum Pen Script (400) | 한글 캘리 | `Nanum+Pen+Script` |
| Playfair Display (400i,700) | 영문 + 워터마크 | `Playfair+Display:ital,wght@0,700;1,400` |

### 6.3 텍스트 가독성

배경 사진 위 텍스트 가독성 확보를 위한 3중 장치:

```css
/* 1. 반투명 오버레이 */
.card-overlay {
  background: rgba(0, 0, 0, 0.35);
}

/* 2. 텍스트 그림자 */
.card-text {
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}

/* 3. 자동 색상 대비 (JS) */
function getTextColor(bgBrightness: number): string {
  return bgBrightness > 128 ? '#1a1a2e' : '#ffffff';
}
```

### 6.4 워터마크 사양

```css
.watermark {
  font-family: 'Playfair Display', serif;
  font-style: italic;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.6);
  position: absolute;
  bottom: 20px;
  right: 24px;
}
```

---

## 7. API 엔드포인트 요약

> 상세 연결 사양 및 코드는 **섹션 3. 외부 서비스 연결 사양** 참조.

| 엔드포인트 | 메서드 | 용도 | 인증 |
|-----------|--------|------|------|
| `/api/unsplash?query=...&per_page=3` | GET | Unsplash 사진 검색 프록시 | 서버 측 Access Key |
| `supabase.from('bible_verses').select(...)` | Client SDK | 성경 검색 (장절/키워드) | anon key (RLS) |
| `api.anthropic.com/v1/messages` | POST | AI CSS 아트 프롬프트 생성 | 아티팩트 내장 (Phase 1 P2) |

---

## 8. 프로젝트 구조

```
yebom-card/
├── app/
│   ├── layout.tsx              # 루트 레이아웃 (폰트, 메타데이터)
│   ├── page.tsx                # 메인 페이지
│   ├── globals.css             # Tailwind + 커스텀 스타일
│   └── api/
│       └── unsplash/route.ts   # Unsplash 프록시
├── components/
│   ├── SearchPanel.tsx         # 검색 UI (장절 + 키워드)
│   ├── VerseDisplay.tsx        # 선택된 구절 한/영 표시
│   ├── CardPreview.tsx         # 3종 카드 미리보기
│   ├── CardCustomizer.tsx      # 레이아웃/서체/색상 선택
│   ├── CardCanvas.tsx          # 최종 카드 렌더링 (캡처 대상 DOM)
│   └── DownloadButton.tsx      # PNG 다운로드 + 워터마크
├── lib/
│   ├── supabase.ts             # Supabase 클라이언트
│   ├── gradients.ts            # CSS 그라데이션 프리셋 12종
│   ├── keywords.ts             # 키워드 추출 + Unsplash 매핑
│   ├── books.ts                # 66권 목록 (book_code, 한글명, 영문명)
│   └── types.ts                # BibleVerse, CardConfig 등 타입
├── .env.local                  # 환경변수 (git 제외)
├── .gitignore
├── CLAUDE.md                   # Claude Code 실행 지침
├── architecture.md             # ← 이 파일
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 9. 구현 로드맵

### Phase 1: MVP (현재 → 1주)

| 우선순위 | 작업 | 상태 |
|---------|------|------|
| P0 | Supabase 연결 + 성경 검색 (장절 + 키워드) | 🔲 |
| P0 | 카드 프리뷰 — CSS 그라데이션 배경 | 🔲 |
| P0 | 카드 프리뷰 — Unsplash 사진 배경 | 🔲 |
| P0 | PNG 다운로드 + Yebom Card 워터마크 | 🔲 |
| P1 | 커스터마이즈 (레이아웃 3종, 서체 5종) | 🔲 |
| P1 | 반응형 모바일 UI | 🔲 |
| P2 | AI CSS 아트 배경 (Claude API) | 🔲 |

### Phase 2: 확장 (2~3주)

| 작업 | 설명 |
|------|------|
| Vercel 배포 | GitHub 연동 자동 배포 |
| 카드 공유 | 카카오톡/SNS 공유 버튼 |
| 즐겨찾기 | 로컬스토리지 기반 말씀 저장 |
| 다국어 UI | 한국어/영어 인터페이스 전환 |
| rnksv 데이터 정제 | HTML 잔여물 제거 |

### Phase 3: 고도화 (향후)

| 작업 | 설명 |
|------|------|
| AI 이미지 생성 | Google Imagen / DALL-E 연동 |
| 카드 템플릿 저장 | Supabase에 커스텀 템플릿 저장 |
| yebomsaint 앱 연동 | 기존 교회 관리 시스템과 통합 |
| PDF 고해상도 출력 | 인쇄용 300dpi 지원 |

---

## 10. 설계 결정 기록 (ADR)

### ADR-001: KJV를 영문 버전으로 선택
- **결정**: KJV (King James Version)
- **근거**: 퍼블릭 도메인, 저작권 무료, 데이터 확보 용이
- **대안 검토**: NIV(유료 라이선스), ESV(제한적 무료), WEB(현대 영어지만 인지도 낮음)

### ADR-002: html-to-image를 PNG 캡처 도구로 선택
- **결정**: html-to-image 라이브러리
- **근거**: DOM 기반 캡처, 설치 간편, 번들 사이즈 작음
- **리스크**: 한글 웹폰트 로딩 실패 시 깨짐 → 폰트 프리로드로 대응
- **대안 검토**: html2canvas(무거움), Puppeteer(서버 필요), Canvas API(구현 복잡)

### ADR-003: Unsplash API Key 서버 프록시
- **결정**: Next.js API Route로 프록시
- **근거**: Access Key를 클라이언트에 노출하지 않기 위함
- **구현**: /api/unsplash?query=... → 서버에서 Unsplash API 호출

### ADR-004: 검색에 pg_trgm 사용
- **결정**: PostgreSQL pg_trgm 확장 + GIN 인덱스
- **근거**: 한글 형태소 분석 없이도 부분 문자열 매칭 가능
- **한계**: 형태소 기반 검색 대비 정확도 낮음 (예: "사랑하" 검색 시 "사랑" 미매칭)
- **향후**: 한글 형태소 분석기(mecab) 도입 검토

---

## 11. 인프라 현황

### 완료된 작업

| # | 작업 | 일자 | 비고 |
|---|------|------|------|
| 1 | bible_verses 테이블 확인 | 2026-04-01 | nkrv 31,101 + rnksv 31,075 기존 |
| 2 | pg_trgm 검색 인덱스 생성 | 2026-04-01 | text GIN + book_name GIN |
| 3 | KJV 영문 데이터 입력 | 2026-04-01 | Edge Function으로 30,966절 입력 완료 |
| 4 | insert_kjv_bulk 함수 생성 | 2026-04-01 | anon 권한 회수 완료 |
| 5 | import-kjv Edge Function 보안 조치 | 2026-04-01 | verify_jwt=true 전환 + 로직 비활성화 완료 |
| 6 | CLAUDE.md 작성 | 2026-04-01 | Claude Code 실행 지침 |
| 7 | architecture.md 작성 | 2026-04-01 | 외부 서비스 연결 사양 포함 |
| 8 | env.local.template 생성 | 2026-04-01 | Supabase + Unsplash 키 포함 |

### 정리 필요 항목

- [ ] import-kjv Edge Function 삭제 (현재 비활성화 상태, 완전 삭제 권장)
- [ ] insert_kjv_bulk 함수 삭제 (더 이상 불필요)
- [ ] rnksv 데이터 HTML 잔여물 정제 (Phase 2)

---

## 12. 업그레이드 검토사항

### 12.1 AI 추천 피드백 루프
→ topic_verse_stats 테이블로 선택 히스토리 저장, AI 프롬프트에 인기 구절 힌트 제공.

### 12.2 스크랩 이미지 클라우드 저장

**개요**: PNG 다운로드 시 생성된 카드 이미지를 클라우드(Supabase Storage)에 저장하고, 스크랩 항목에 이미지 URL을 포함시켜 나중에 다시 볼 수 있도록 함.

**구현 방향**:
1. Supabase Storage 버킷 생성 (`card-images`)
2. PNG 다운로드 시 base64 → Blob → Storage 업로드
3. 반환된 public URL을 ScrapItem에 `imageUrl` 필드로 저장
4. 스크랩 목록에서 이미지 썸네일 표시

### 12.3 사용자 배경사진 클라우드 마이그레이션 (Supabase → Cloudflare R2)

**현재 (Phase 1)**: Supabase Storage에 사용자 업로드 배경사진 저장
- 버킷: `user-photos`, 메타데이터 테이블: `user_photos`
- 무료 1GB 저장 + 2GB/월 egress
- 예상 규모: 100명 × 5장 × 300KB = 150MB, 월 egress ~500MB → 무료 내 충분

**향후 (Phase 3, 확장 시)**: Cloudflare R2로 마이그레이션
- 트리거 조건:
  - Supabase 무료 티어 초과 (1GB 저장 또는 2GB egress)
  - 글로벌 사용자 증가로 CDN 필요
  - 이미지 조회 빈도 상승

**마이그레이션 이점**:
- R2 무료 10GB (Supabase 대비 10배)
- Egress 무료 무제한 (Supabase는 2GB 이후 $0.09/GB)
- 전세계 Cloudflare edge CDN (읽기 지연 20~50ms)
- 유료 확장 시 $0.015/GB (Supabase $0.021/GB 대비 저렴)

**마이그레이션 방식**:
1. yebomradio의 Cloudflare worker에 `/api/yebomcard/photos/*` 엔드포인트 추가
   - POST: 업로드 (R2 저장 + URL 반환)
   - GET: 사용자별 목록
   - DELETE: 파일 삭제
2. yebomcard API route가 yebomradio worker에 proxy (ADMIN_KEY Bearer 인증)
3. 기존 Supabase의 `user_photos` 레코드는 그대로 유지
4. 스키마 변경 없음 (`public_url` 필드에 Cloudflare URL 저장)
5. 배치 스크립트로 기존 Supabase Storage 파일을 R2로 복사 후 URL 업데이트

**인프라 공유**: yebomradio의 R2 버킷 `coachdb-files` 재사용, 경로는 `yebomcard/photos/{userId}/{uuid}.{ext}`

## 13. 최근 아키텍처 고도화 내역 (2026-05)

### 13.1 찬송가 가사 및 악보 이미지 연동 기능
- **통합 검색 및 가사 뷰어**: 장 번호, 한글 제목, 한글 가사를 기반으로 실시간 검색을 지원하는 `HymnModal` 구현.
- **악보 이미지 연동 (Supabase Storage)**: 
  - 로컬에 있던 645장의 찬송가 이미지를 Supabase `hymns` 버킷에 퍼블릭 업로드.
  - 별도의 DB 필드 추가 없이, `padStart(3, '0')` 함수를 이용해 장 번호(예: `001`)로 파일명을 동적 매핑하여 가져옴.
- **권한 제어 및 Fullscreen UX**:
  - `useSession` 훅을 이용하여 로그인(SSO 인증)된 사용자에게만 악보 뷰어 접근 허용.
  - 비로그인 사용자는 로그인 확인 팝업 후 중앙 SSO 화면으로 리다이렉트 처리.
  - 전체 화면 뷰어는 화면 아무 곳이나 탭하거나 하단의 글래스모피즘 닫기 버튼을 통해 손쉽게 닫을 수 있음.

### 13.2 글로벌 폰트 및 다크 모드 (테마) 컨텍스트
- **전역 FontContext 적용**: 기존에는 개별 컴포넌트(`HymnModal`, `FullscreenReader` 등)에서 별도로 관리되던 테마와 폰트 크기/종류를 글로벌 `FontContext`로 일원화.
- **글로벌 다크 모드 지원**: 
  - Tailwind CSS v4의 `dark:` 클래스 시스템을 전면 적용.
  - 전역 도구 모음(T 아이콘)에서 "어둡게" 선택 시, `document.documentElement.classList.add("dark")`를 통해 메인 검색 화면, 말씀 표시 화면, 카드 생성 화면 등 서비스 전체가 즉각적으로 다크 모드로 전환됨.
  - 모든 설정은 `localStorage`에 자동 저장되어 세션 간 유지됨.
  - 글로벌 도구 메뉴의 `z-index`를 150 이상으로 높여 어떤 모달 위에서도 접근 가능하도록 계층 조정.

### 13.3 글로벌 모달 스택 기반 하드웨어 뒤로가기 제어 (`useHardwareBack`)
- **문제점**: 안드로이드 기기의 물리적 뒤로가기 버튼을 누를 때, 여러 겹의 모달(예: 찬송가 모달 띄우고 그 위에 폰트 설정창 띄움)이 동시에 닫히는 이벤트 충돌 현상 발생.
- **개선안**: `useHardwareBack` 훅 내부에 모듈 수준의 글로벌 스택(`modalStack`)을 도입. 
- **결과**: 뒤로가기(`popstate`) 이벤트 발생 시 스택의 가장 최상단에 위치한 단일 모달만 안전하게 팝업을 닫도록 완벽하게 동기화.

### 13.4 다중 성경 버전 비교 (Main / Sub Version)
- **개선안**: 단일 버전만 조회하던 방식에서, `mainVersion`과 `subVersion` 상태를 동시에 관리하여 사용자가 한/영 또는 개역개정/새번역을 자유롭게 교차 비교하며 카드를 생성할 수 있도록 구조 개편.

---

## 변경 이력

| 버전 | 일자 | 변경 내용 |
|------|------|-----------|
| 0.1.0 | 2026-04-01 | 초기 설계서 작성 (예봄카드_세부설계서.md) |
| 0.2.0 | 2026-04-01 | architecture.md로 재구성, ADR 추가, 코드 예시 보강 |
| 0.3.0 | 2026-04-01 | **섹션 3 신설**: 외부 서비스 연결 사양 (Supabase/Unsplash/Vercel/Fonts/Claude API). 인프라 현황 최신화. Edge Function 보안 조치 반영 |
| 0.4.0 | 2026-05-06 | 찬송가 연동, 전역 폰트/테마 컨텍스트화, 글로벌 모달 스택, 메인/서브 다중 버전 지원 등 최신 아키텍처 고도화 내역 반영 |
