/**
 * 성경 레퍼런스 파서
 * 지원 형식:
 *   창세기 1:1 | 창 1:1 | 창1:1
 *   창1:1-3 (범위)
 *   창1:3,5 (개별)
 *   창1:1-3,7 (혼합)
 *   창세기 1장 1절 | 창세기 1장 1절-3절
 *   시23:1-6
 */

export interface ParsedReference {
  bookCode: string;
  chapter: number;
  verses: number[];
}

// 66권 약어 매핑 (한글 이름, 약어 → book_code)
const BOOK_ALIASES: Record<string, string> = {
  // ── 구약 ──
  창세기: "gen", 창: "gen",
  출애굽기: "exo", 출: "exo",
  레위기: "lev", 레: "lev",
  민수기: "num", 민: "num",
  신명기: "deu", 신: "deu",
  여호수아: "jos", 수: "jos",
  사사기: "jdg", 삿: "jdg",
  룻기: "rut", 룻: "rut",
  사무엘상: "1sa", 삼상: "1sa", "1사무엘": "1sa",
  사무엘하: "2sa", 삼하: "2sa", "2사무엘": "2sa",
  열왕기상: "1ki", 왕상: "1ki", "1열왕기": "1ki",
  열왕기하: "2ki", 왕하: "2ki", "2열왕기": "2ki",
  역대상: "1ch", 대상: "1ch", "1역대": "1ch",
  역대하: "2ch", 대하: "2ch", "2역대": "2ch",
  에스라: "ezr", 스: "ezr",
  느헤미야: "neh", 느: "neh",
  에스더: "est", 에스: "est",
  욥기: "job", 욥: "job",
  시편: "psa", 시: "psa",
  잠언: "pro", 잠: "pro",
  전도서: "ecc", 전: "ecc",
  아가: "sng", 아: "sng",
  이사야: "isa", 사: "isa",
  예레미야: "jer", 렘: "jer",
  예레미야애가: "lam", 애: "lam", 애가: "lam",
  에스겔: "ezk", 겔: "ezk",
  다니엘: "dan", 단: "dan",
  호세아: "hos", 호: "hos",
  요엘: "jol", 욜: "jol",
  아모스: "amo", 암: "amo",
  오바댜: "oba", 옵: "oba",
  요나: "jon", 욘: "jon",
  미가: "mic", 미: "mic",
  나훔: "nam", 나: "nam",
  하박국: "hab", 합: "hab",
  스바냐: "zep", 습: "zep",
  학개: "hag", 학: "hag",
  스가랴: "zec", 슥: "zec",
  말라기: "mal", 말: "mal",
  // ── 신약 ──
  마태복음: "mat", 마태: "mat", 마: "mat",
  마가복음: "mrk", 마가: "mrk", 막: "mrk",
  누가복음: "luk", 누가: "luk", 눅: "luk",
  요한복음: "jhn", 요: "jhn",
  사도행전: "act", 행: "act",
  로마서: "rom", 롬: "rom",
  고린도전서: "1co", 고전: "1co", "1고린도": "1co",
  고린도후서: "2co", 고후: "2co", "2고린도": "2co",
  갈라디아서: "gal", 갈: "gal",
  에베소서: "eph", 엡: "eph", 에베: "eph",
  빌립보서: "php", 빌: "php",
  골로새서: "col", 골: "col",
  데살로니가전서: "1th", 살전: "1th", "1데살": "1th",
  데살로니가후서: "2th", 살후: "2th", "2데살": "2th",
  디모데전서: "1ti", 딤전: "1ti", "1디모데": "1ti",
  디모데후서: "2ti", 딤후: "2ti", "2디모데": "2ti",
  디도서: "tit", 딛: "tit",
  빌레몬서: "phm", 몬: "phm",
  히브리서: "heb", 히: "heb",
  야고보서: "jas", 약: "jas",
  베드로전서: "1pe", 벧전: "1pe", "1베드로": "1pe",
  베드로후서: "2pe", 벧후: "2pe", "2베드로": "2pe",
  요한일서: "1jn", 요일: "1jn", "1요한": "1jn",
  요한이서: "2jn", 요이: "2jn", "2요한": "2jn",
  요한삼서: "3jn", 요삼: "3jn", "3요한": "3jn",
  유다서: "jud", 유: "jud",
  요한계시록: "rev", 계: "rev",
};

/**
 * 책 이름/약어 → book_code 변환
 * 긴 이름부터 먼저 매칭 (예: "사도행전" vs "사")
 */
function resolveBookCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 정확히 일치
  if (BOOK_ALIASES[trimmed]) {
    return BOOK_ALIASES[trimmed];
  }

  // 부분 매칭: 입력이 키의 시작부분인 경우 (예: "창세" → "창세기")
  // 긴 키부터 매칭하여 가장 정확한 결과 반환
  const keys = Object.keys(BOOK_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (key.startsWith(trimmed) || trimmed.startsWith(key)) {
      return BOOK_ALIASES[key];
    }
  }

  return null;
}

/**
 * 절 번호 문자열 파싱
 * "1" → [1]
 * "1-3" → [1,2,3]
 * "3,5" → [3,5]
 * "1-3,7" → [1,2,3,7]
 * "1절-3절" → [1,2,3]
 */
function parseVerses(input: string): number[] {
  const clean = input.replace(/절/g, "").trim();
  if (!clean) return [];

  const parts = clean.split(",").map((p) => p.trim());
  const result: number[] = [];

  for (const part of parts) {
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-").map((s) => s.trim());
      const start = parseInt(startStr);
      const end = parseInt(endStr);
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        for (let i = start; i <= end; i++) {
          result.push(i);
        }
      }
    } else {
      const num = parseInt(part);
      if (!isNaN(num)) {
        result.push(num);
      }
    }
  }

  return [...new Set(result)].sort((a, b) => a - b);
}

/**
 * 메인 파서
 * "창1:1-3" → { bookCode: "gen", chapter: 1, verses: [1,2,3] }
 */
export function parseReference(input: string): ParsedReference | null {
  const text = input.trim();
  if (!text) return null;

  // 숫자로 시작하는 책 (삼상, 왕상 등은 한글이므로 해당 안됨)
  // 단, "1사무엘", "2고린도" 등 숫자+한글 형태 처리
  // 책 이름 부분과 장절 부분을 분리
  // 전략: 뒤에서부터 "장절" 패턴을 찾고 나머지가 책 이름

  // 패턴 1: 한글장절 형식 — "창세기 1장 1절-3절" or "창세기 1장 1절"
  const koreanPattern =
    /^(.+?)\s*(\d+)\s*장\s*(\d+(?:\s*절)?(?:\s*[-~]\s*\d+(?:\s*절)?)?(?:\s*,\s*\d+(?:\s*절)?)*)\s*절?\s*$/;
  const koreanMatch = text.match(koreanPattern);
  if (koreanMatch) {
    const bookCode = resolveBookCode(koreanMatch[1]);
    if (bookCode) {
      const chapter = parseInt(koreanMatch[2]);
      const verses = parseVerses(koreanMatch[3]);
      if (chapter && verses.length > 0) {
        return { bookCode, chapter, verses };
      }
    }
  }

  // 패턴 2: 콜론 형식 — "창1:1-3" or "창세기 1:3,5"
  const colonPattern =
    /^(.+?)\s*(\d+)\s*[:：]\s*(\d+(?:\s*[-~]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-~]\s*\d+)?)*)\s*$/;
  const colonMatch = text.match(colonPattern);
  if (colonMatch) {
    const bookCode = resolveBookCode(colonMatch[1]);
    if (bookCode) {
      const chapter = parseInt(colonMatch[2]);
      const verses = parseVerses(colonMatch[3]);
      if (chapter && verses.length > 0) {
        return { bookCode, chapter, verses };
      }
    }
  }

  return null;
}

/**
 * 파싱 결과를 사람이 읽을 수 있는 형태로 변환 (디버깅/미리보기용)
 */
export function formatParsedReference(ref: ParsedReference): string {
  const versePart =
    ref.verses.length === 1
      ? `${ref.verses[0]}절`
      : formatVerseRange(ref.verses);
  return `${ref.bookCode} ${ref.chapter}장 ${versePart}`;
}

function formatVerseRange(verses: number[]): string {
  if (verses.length === 0) return "";
  const ranges: string[] = [];
  let start = verses[0];
  let end = verses[0];

  for (let i = 1; i < verses.length; i++) {
    if (verses[i] === end + 1) {
      end = verses[i];
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      start = verses[i];
      end = verses[i];
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(",") + "절";
}
