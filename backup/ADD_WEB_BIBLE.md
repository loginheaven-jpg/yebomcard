# 작업 지시: WEB(World English Bible) 역본 적재

## 목적
예봄성경 `bible_verses` 테이블에 영어 공개도메인 역본 **WEB(World English Bible)** 을 추가한다.
`version='web'` 으로 31,098절(66권)을 적재한다.

## 배경 / 전제
- WEB은 퍼블릭 도메인이다(저작권 포기). KJV와 동일 파이프라인으로 다룬다.
- 입력 데이터 `web_verses.csv` 는 이미 정제되어 제공된다. 재다운로드·재크롤링 불필요.
- CSV 컬럼: `version, book_order, book_code, book_name, book_abbr, testament, chapter, verse, text`
  - `version` 은 전부 `web` 고정.
  - `book_order` 는 만국 공통 1~66(창세기=1 … 요한계시록=66). **이 값이 가장 신뢰할 수 있는 조인 키다.**
  - `book_code/book_name/book_abbr/testament` 는 표준값으로 채워져 있으나, 예봄 기존 약어 체계와 다를 수 있다(아래 1단계에서 검증·교정).

## ⚠️ 사전 결정 사항 — 신명 표기
이 CSV는 신명을 **"Yahweh"** 로 표기한다(예: "Yahweh is my shepherd").
기존 KJV 카드는 **"LORD"** 표기다. 한 화면에 영문 역본을 병기하면 표기가 불일치한다.
- 그대로 진행 → 그대로 적재.
- "LORD" 표기 원함 → 적재 보류하고 운영자에게 보고. WEB Updated(WEBU, LORD 표기) 에디션을 별도로 받아야 한다(eBible.org). 기계적 치환은 부정확하므로 권장하지 않는다.

---

## 1단계: 기존 약어 체계와 대조 (필수)
예봄의 영어 역본이 쓰는 `book_code` 가 CSV의 표준 약어와 같은지 먼저 확인한다.

```sql
-- 기존 KJV의 book_order → book_code 매핑 확인
SELECT DISTINCT book_order, book_code, book_name
FROM bible_verses
WHERE version = 'kjv'
ORDER BY book_order;
```

이 결과를 `web_verses.csv` 의 `(book_order, book_code)` 와 대조한다.
- **완전히 일치** → 2단계-A(직접 적재)로 진행.
- **하나라도 불일치** → 2단계-B(스테이징 조인)로 진행. CSV의 추정 약어를 버리고 기존 KJV 약어를 상속시킨다.

---

## 2단계-A: 약어 일치 시 — 직접 적재
Supabase 대시보드 → Table Editor → `bible_verses` → Import data from CSV 로 `web_verses.csv` 를 그대로 올린다.
(또는 psql: `\copy bible_verses(version,book_order,book_code,book_name,book_abbr,testament,chapter,verse,text) FROM 'web_verses.csv' WITH (FORMAT csv, HEADER true);`)

## 2단계-B: 약어 불일치 시 — 스테이징 조인 (권장·안전)
약어 추측에 의존하지 않고, 기존 KJV 메타데이터를 `book_order` 로 상속시킨다.

```sql
-- (1) 스테이징 임시 테이블
CREATE TEMP TABLE web_stage (
  version text, book_order smallint, book_code text, book_name text,
  book_abbr text, testament text, chapter smallint, verse smallint, text text
);
```

```sql
-- (2) web_verses.csv 를 web_stage 로 import
--     Table Editor import 또는 \copy 사용
```

```sql
-- (3) 기존 KJV의 책 메타데이터를 book_order로 상속하여 적재
INSERT INTO bible_verses (version, book_code, book_name, book_abbr, book_order, testament, chapter, verse, text)
SELECT 'web', k.book_code, k.book_name, k.book_abbr, k.book_order, k.testament,
       s.chapter, s.verse, s.text
FROM web_stage s
JOIN (
  SELECT DISTINCT book_order, book_code, book_name, book_abbr, testament
  FROM bible_verses WHERE version = 'kjv'
) k ON k.book_order = s.book_order;
```

> 주의: `book_name/book_abbr` 을 KJV가 영문으로 보유하므로 WEB도 동일 영문 책명을 갖게 된다. 의도된 동작이다.

---

## 3단계: 적재 검증
```sql
-- 총 절수 (기대값 31,098)
SELECT count(*) FROM bible_verses WHERE version = 'web';

-- 책별 장수·절수 (시편 150장, 이사야 66장, 요한계시록 22장 등)
SELECT book_order, book_name, max(chapter) AS chapters, count(*) AS verses
FROM bible_verses WHERE version = 'web'
GROUP BY book_order, book_name ORDER BY book_order;

-- 샘플 구절 정확성
SELECT book_name, chapter, verse, text
FROM bible_verses
WHERE version = 'web'
  AND (book_code, chapter, verse) IN (('jhn',3,16), ('psa',23,1), ('hab',3,18));
```

UNIQUE 제약 `(version, book_code, chapter, verse)` 은 `version='web'` 신규라 충돌하지 않는다.
RLS는 `bible_verses` 가 이미 `SELECT public` 이므로 web도 자동 노출된다. 별도 정책 불필요.

---

## 4단계: 프론트엔드 연동
1. **영문 역본 선택지에 WEB 추가**
   기존 KJV / NIrV / GNT 와 함께 `web` 을 옵션으로 노출. 라벨 예: "WEB (World English Bible)".

2. **한/영 병기 쿼리** — 기존 nkrv↔kjv 조인과 동일 패턴
   ```typescript
   const [kr, en] = await Promise.all([
     supabase.from('bible_verses').select('*')
       .eq('version','nkrv').eq('book_code',code).eq('chapter',ch).eq('verse',vs).single(),
     supabase.from('bible_verses').select('*')
       .eq('version','web').eq('book_code',code).eq('chapter',ch).eq('verse',vs).single(),
   ]);
   ```

3. **절 구분 차이 대비**
   WEB과 개역개정(nkrv)·KJV는 절 구분이 일부 미세하게 다를 수 있다(시편 표제, 합쳐진 절 등).
   한/영 병기에서 한쪽이 `null` 이면 카드가 깨지지 않도록 폴백 처리한다(영문 생략 또는 인접 절 표시).
   다음 쿼리로 nkrv 기준 매칭 안 되는 절을 미리 점검한다.
   ```sql
   SELECT n.book_code, n.chapter, n.verse
   FROM bible_verses n
   LEFT JOIN bible_verses w
     ON w.version='web' AND w.book_code=n.book_code
        AND w.chapter=n.chapter AND w.verse=n.verse
   WHERE n.version='nkrv' AND w.id IS NULL
   ORDER BY n.book_order, n.chapter, n.verse;
   ```

4. **저작권 표기**
   WEB은 퍼블릭 도메인이라 의무는 없으나, 출처 표기를 권장한다.
   "World English Bible (Public Domain)" 정도면 충분하다.
   단 "World English Bible" 명칭은 eBible.org 상표이므로, 텍스트를 임의 수정한 경우 그 명칭을 쓰지 않는다.

## 출력 보고
적재 완료 후 3단계 검증 쿼리 결과(총 절수·책별 집계·샘플)와 4-3 누락 절 목록을 운영자에게 보고한다.
