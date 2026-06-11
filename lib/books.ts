export interface BookInfo {
  code: string;
  nameKr: string;
  abbr: string;
  nameEn: string;
  order: number;
  testament: "old" | "new";
}

export const BOOKS: BookInfo[] = [
  // 구약 (Old Testament) — 39권
  { code: "gen", nameKr: "창세기", abbr: "창", nameEn: "Genesis", order: 1, testament: "old" },
  { code: "exo", nameKr: "출애굽기", abbr: "출", nameEn: "Exodus", order: 2, testament: "old" },
  { code: "lev", nameKr: "레위기", abbr: "레", nameEn: "Leviticus", order: 3, testament: "old" },
  { code: "num", nameKr: "민수기", abbr: "민", nameEn: "Numbers", order: 4, testament: "old" },
  { code: "deu", nameKr: "신명기", abbr: "신", nameEn: "Deuteronomy", order: 5, testament: "old" },
  { code: "jos", nameKr: "여호수아", abbr: "수", nameEn: "Joshua", order: 6, testament: "old" },
  { code: "jdg", nameKr: "사사기", abbr: "삿", nameEn: "Judges", order: 7, testament: "old" },
  { code: "rut", nameKr: "룻기", abbr: "룻", nameEn: "Ruth", order: 8, testament: "old" },
  { code: "1sa", nameKr: "사무엘상", abbr: "삼상", nameEn: "1 Samuel", order: 9, testament: "old" },
  { code: "2sa", nameKr: "사무엘하", abbr: "삼하", nameEn: "2 Samuel", order: 10, testament: "old" },
  { code: "1ki", nameKr: "열왕기상", abbr: "왕상", nameEn: "1 Kings", order: 11, testament: "old" },
  { code: "2ki", nameKr: "열왕기하", abbr: "왕하", nameEn: "2 Kings", order: 12, testament: "old" },
  { code: "1ch", nameKr: "역대상", abbr: "대상", nameEn: "1 Chronicles", order: 13, testament: "old" },
  { code: "2ch", nameKr: "역대하", abbr: "대하", nameEn: "2 Chronicles", order: 14, testament: "old" },
  { code: "ezr", nameKr: "에스라", abbr: "스", nameEn: "Ezra", order: 15, testament: "old" },
  { code: "neh", nameKr: "느헤미야", abbr: "느", nameEn: "Nehemiah", order: 16, testament: "old" },
  { code: "est", nameKr: "에스더", abbr: "에스", nameEn: "Esther", order: 17, testament: "old" },
  { code: "job", nameKr: "욥기", abbr: "욥", nameEn: "Job", order: 18, testament: "old" },
  { code: "psa", nameKr: "시편", abbr: "시", nameEn: "Psalms", order: 19, testament: "old" },
  { code: "pro", nameKr: "잠언", abbr: "잠", nameEn: "Proverbs", order: 20, testament: "old" },
  { code: "ecc", nameKr: "전도서", abbr: "전", nameEn: "Ecclesiastes", order: 21, testament: "old" },
  { code: "sng", nameKr: "아가", abbr: "아", nameEn: "Song of Solomon", order: 22, testament: "old" },
  { code: "isa", nameKr: "이사야", abbr: "사", nameEn: "Isaiah", order: 23, testament: "old" },
  { code: "jer", nameKr: "예레미야", abbr: "렘", nameEn: "Jeremiah", order: 24, testament: "old" },
  { code: "lam", nameKr: "예레미야애가", abbr: "애", nameEn: "Lamentations", order: 25, testament: "old" },
  { code: "ezk", nameKr: "에스겔", abbr: "겔", nameEn: "Ezekiel", order: 26, testament: "old" },
  { code: "dan", nameKr: "다니엘", abbr: "단", nameEn: "Daniel", order: 27, testament: "old" },
  { code: "hos", nameKr: "호세아", abbr: "호", nameEn: "Hosea", order: 28, testament: "old" },
  { code: "jol", nameKr: "요엘", abbr: "욜", nameEn: "Joel", order: 29, testament: "old" },
  { code: "amo", nameKr: "아모스", abbr: "암", nameEn: "Amos", order: 30, testament: "old" },
  { code: "oba", nameKr: "오바댜", abbr: "옵", nameEn: "Obadiah", order: 31, testament: "old" },
  { code: "jon", nameKr: "요나", abbr: "욘", nameEn: "Jonah", order: 32, testament: "old" },
  { code: "mic", nameKr: "미가", abbr: "미", nameEn: "Micah", order: 33, testament: "old" },
  { code: "nam", nameKr: "나훔", abbr: "나", nameEn: "Nahum", order: 34, testament: "old" },
  { code: "hab", nameKr: "하박국", abbr: "합", nameEn: "Habakkuk", order: 35, testament: "old" },
  { code: "zep", nameKr: "스바냐", abbr: "습", nameEn: "Zephaniah", order: 36, testament: "old" },
  { code: "hag", nameKr: "학개", abbr: "학", nameEn: "Haggai", order: 37, testament: "old" },
  { code: "zec", nameKr: "스가랴", abbr: "슥", nameEn: "Zechariah", order: 38, testament: "old" },
  { code: "mal", nameKr: "말라기", abbr: "말", nameEn: "Malachi", order: 39, testament: "old" },
  // 신약 (New Testament) — 27권
  { code: "mat", nameKr: "마태복음", abbr: "마", nameEn: "Matthew", order: 40, testament: "new" },
  { code: "mrk", nameKr: "마가복음", abbr: "막", nameEn: "Mark", order: 41, testament: "new" },
  { code: "luk", nameKr: "누가복음", abbr: "눅", nameEn: "Luke", order: 42, testament: "new" },
  { code: "jhn", nameKr: "요한복음", abbr: "요", nameEn: "John", order: 43, testament: "new" },
  { code: "act", nameKr: "사도행전", abbr: "행", nameEn: "Acts", order: 44, testament: "new" },
  { code: "rom", nameKr: "로마서", abbr: "롬", nameEn: "Romans", order: 45, testament: "new" },
  { code: "1co", nameKr: "고린도전서", abbr: "고전", nameEn: "1 Corinthians", order: 46, testament: "new" },
  { code: "2co", nameKr: "고린도후서", abbr: "고후", nameEn: "2 Corinthians", order: 47, testament: "new" },
  { code: "gal", nameKr: "갈라디아서", abbr: "갈", nameEn: "Galatians", order: 48, testament: "new" },
  { code: "eph", nameKr: "에베소서", abbr: "엡", nameEn: "Ephesians", order: 49, testament: "new" },
  { code: "php", nameKr: "빌립보서", abbr: "빌", nameEn: "Philippians", order: 50, testament: "new" },
  { code: "col", nameKr: "골로새서", abbr: "골", nameEn: "Colossians", order: 51, testament: "new" },
  { code: "1th", nameKr: "데살로니가전서", abbr: "살전", nameEn: "1 Thessalonians", order: 52, testament: "new" },
  { code: "2th", nameKr: "데살로니가후서", abbr: "살후", nameEn: "2 Thessalonians", order: 53, testament: "new" },
  { code: "1ti", nameKr: "디모데전서", abbr: "딤전", nameEn: "1 Timothy", order: 54, testament: "new" },
  { code: "2ti", nameKr: "디모데후서", abbr: "딤후", nameEn: "2 Timothy", order: 55, testament: "new" },
  { code: "tit", nameKr: "디도서", abbr: "딛", nameEn: "Titus", order: 56, testament: "new" },
  { code: "phm", nameKr: "빌레몬서", abbr: "몬", nameEn: "Philemon", order: 57, testament: "new" },
  { code: "heb", nameKr: "히브리서", abbr: "히", nameEn: "Hebrews", order: 58, testament: "new" },
  { code: "jas", nameKr: "야고보서", abbr: "약", nameEn: "James", order: 59, testament: "new" },
  { code: "1pe", nameKr: "베드로전서", abbr: "벧전", nameEn: "1 Peter", order: 60, testament: "new" },
  { code: "2pe", nameKr: "베드로후서", abbr: "벧후", nameEn: "2 Peter", order: 61, testament: "new" },
  { code: "1jn", nameKr: "요한일서", abbr: "요일", nameEn: "1 John", order: 62, testament: "new" },
  { code: "2jn", nameKr: "요한이서", abbr: "요이", nameEn: "2 John", order: 63, testament: "new" },
  { code: "3jn", nameKr: "요한삼서", abbr: "요삼", nameEn: "3 John", order: 64, testament: "new" },
  { code: "jud", nameKr: "유다서", abbr: "유", nameEn: "Jude", order: 65, testament: "new" },
  { code: "rev", nameKr: "요한계시록", abbr: "계", nameEn: "Revelation", order: 66, testament: "new" },
];

export const OLD_TESTAMENT = BOOKS.filter((b) => b.testament === "old");
export const NEW_TESTAMENT = BOOKS.filter((b) => b.testament === "new");

/**
 * 책별 장(chapter) 수 — 통독 진도 계산용.
 * 합계 1,189장 (구약 929 + 신약 260) — bible_audio 1,189장과 일치.
 */
export const CHAPTER_COUNTS: Record<string, number> = {
  gen: 50, exo: 40, lev: 27, num: 36, deu: 34, jos: 24, jdg: 21, rut: 4,
  "1sa": 31, "2sa": 24, "1ki": 22, "2ki": 25, "1ch": 29, "2ch": 36, ezr: 10,
  neh: 13, est: 10, job: 42, psa: 150, pro: 31, ecc: 12, sng: 8, isa: 66,
  jer: 52, lam: 5, ezk: 48, dan: 12, hos: 14, jol: 3, amo: 9, oba: 1, jon: 4,
  mic: 7, nam: 3, hab: 3, zep: 3, hag: 2, zec: 14, mal: 4,
  mat: 28, mrk: 16, luk: 24, jhn: 21, act: 28, rom: 16, "1co": 16, "2co": 13,
  gal: 6, eph: 6, php: 4, col: 4, "1th": 5, "2th": 3, "1ti": 6, "2ti": 4,
  tit: 3, phm: 1, heb: 13, jas: 5, "1pe": 5, "2pe": 3, "1jn": 5, "2jn": 1,
  "3jn": 1, jud: 1, rev: 22,
};

export const TOTAL_CHAPTERS = 1189;

export function getBookByCode(code: string): BookInfo | undefined {
  return BOOKS.find((b) => b.code === code);
}

/**
 * 책 이름(한글/영문/약어)으로 BookInfo 조회.
 * AI 추천 결과나 사용자 입력의 책명을 표준 book_code 로 변환할 때 사용.
 * 매칭 우선순위: nameKr → nameEn → abbr → code 자체
 */
export function getBookByName(name: string): BookInfo | undefined {
  if (!name) return undefined;
  const norm = name.trim();
  return (
    BOOKS.find((b) => b.nameKr === norm) ||
    BOOKS.find((b) => b.nameEn === norm) ||
    BOOKS.find((b) => b.nameEn.toLowerCase() === norm.toLowerCase()) ||
    BOOKS.find((b) => b.abbr === norm) ||
    BOOKS.find((b) => b.code === norm.toLowerCase())
  );
}
