/**
 * 오늘의 말씀 — 신규 사용자(recent/bookmarks 둘 다 없음) 환영 화면에서 사용.
 * KST(UTC+9) 기준 YYYYMMDD를 길이로 나눈 결정적 인덱스 — 같은 날엔 모두에게 동일 구절.
 */

export interface VerseOfDayEntry {
  book_code: string;
  book_name: string;
  chapter: number;
  verse: number;
}

export const VERSE_OF_DAY: VerseOfDayEntry[] = [
  { book_code: "psa", book_name: "시편", chapter: 23, verse: 1 },
  { book_code: "jhn", book_name: "요한복음", chapter: 3, verse: 16 },
  { book_code: "php", book_name: "빌립보서", chapter: 4, verse: 13 },
  { book_code: "isa", book_name: "이사야", chapter: 41, verse: 10 },
  { book_code: "rom", book_name: "로마서", chapter: 8, verse: 28 },
  { book_code: "pro", book_name: "잠언", chapter: 3, verse: 5 },
  { book_code: "psa", book_name: "시편", chapter: 121, verse: 1 },
  { book_code: "mat", book_name: "마태복음", chapter: 11, verse: 28 },
  { book_code: "jer", book_name: "예레미야", chapter: 29, verse: 11 },
  { book_code: "rom", book_name: "로마서", chapter: 12, verse: 2 },
  { book_code: "psa", book_name: "시편", chapter: 46, verse: 1 },
  { book_code: "jhn", book_name: "요한복음", chapter: 14, verse: 27 },
  { book_code: "php", book_name: "빌립보서", chapter: 4, verse: 6 },
  { book_code: "isa", book_name: "이사야", chapter: 40, verse: 31 },
  { book_code: "psa", book_name: "시편", chapter: 1, verse: 1 },
  { book_code: "pro", book_name: "잠언", chapter: 16, verse: 3 },
  { book_code: "mat", book_name: "마태복음", chapter: 6, verse: 33 },
  { book_code: "rom", book_name: "로마서", chapter: 5, verse: 8 },
  { book_code: "jhn", book_name: "요한복음", chapter: 1, verse: 1 },
  { book_code: "psa", book_name: "시편", chapter: 119, verse: 105 },
  { book_code: "gal", book_name: "갈라디아서", chapter: 5, verse: 22 },
  { book_code: "ecc", book_name: "전도서", chapter: 3, verse: 1 },
  { book_code: "psa", book_name: "시편", chapter: 27, verse: 1 },
  { book_code: "isa", book_name: "이사야", chapter: 26, verse: 3 },
  { book_code: "mat", book_name: "마태복음", chapter: 5, verse: 16 },
  { book_code: "rom", book_name: "로마서", chapter: 15, verse: 13 },
  { book_code: "1co", book_name: "고린도전서", chapter: 13, verse: 13 },
  { book_code: "psa", book_name: "시편", chapter: 90, verse: 12 },
  { book_code: "pro", book_name: "잠언", chapter: 4, verse: 23 },
  { book_code: "deu", book_name: "신명기", chapter: 31, verse: 6 },
];

export function todaysVerseIndex(): number {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const ymd =
    kst.getUTCFullYear() * 10000 +
    (kst.getUTCMonth() + 1) * 100 +
    kst.getUTCDate();
  return ymd % VERSE_OF_DAY.length;
}
