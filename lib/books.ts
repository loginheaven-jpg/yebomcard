export interface BookInfo {
  code: string;
  nameKr: string;
  nameEn: string;
  order: number;
  testament: "old" | "new";
}

export const BOOKS: BookInfo[] = [
  // 구약 (Old Testament) — 39권
  { code: "gen", nameKr: "창세기", nameEn: "Genesis", order: 1, testament: "old" },
  { code: "exo", nameKr: "출애굽기", nameEn: "Exodus", order: 2, testament: "old" },
  { code: "lev", nameKr: "레위기", nameEn: "Leviticus", order: 3, testament: "old" },
  { code: "num", nameKr: "민수기", nameEn: "Numbers", order: 4, testament: "old" },
  { code: "deu", nameKr: "신명기", nameEn: "Deuteronomy", order: 5, testament: "old" },
  { code: "jos", nameKr: "여호수아", nameEn: "Joshua", order: 6, testament: "old" },
  { code: "jdg", nameKr: "사사기", nameEn: "Judges", order: 7, testament: "old" },
  { code: "rut", nameKr: "룻기", nameEn: "Ruth", order: 8, testament: "old" },
  { code: "1sa", nameKr: "사무엘상", nameEn: "1 Samuel", order: 9, testament: "old" },
  { code: "2sa", nameKr: "사무엘하", nameEn: "2 Samuel", order: 10, testament: "old" },
  { code: "1ki", nameKr: "열왕기상", nameEn: "1 Kings", order: 11, testament: "old" },
  { code: "2ki", nameKr: "열왕기하", nameEn: "2 Kings", order: 12, testament: "old" },
  { code: "1ch", nameKr: "역대상", nameEn: "1 Chronicles", order: 13, testament: "old" },
  { code: "2ch", nameKr: "역대하", nameEn: "2 Chronicles", order: 14, testament: "old" },
  { code: "ezr", nameKr: "에스라", nameEn: "Ezra", order: 15, testament: "old" },
  { code: "neh", nameKr: "느헤미야", nameEn: "Nehemiah", order: 16, testament: "old" },
  { code: "est", nameKr: "에스더", nameEn: "Esther", order: 17, testament: "old" },
  { code: "job", nameKr: "욥기", nameEn: "Job", order: 18, testament: "old" },
  { code: "psa", nameKr: "시편", nameEn: "Psalms", order: 19, testament: "old" },
  { code: "pro", nameKr: "잠언", nameEn: "Proverbs", order: 20, testament: "old" },
  { code: "ecc", nameKr: "전도서", nameEn: "Ecclesiastes", order: 21, testament: "old" },
  { code: "sng", nameKr: "아가", nameEn: "Song of Solomon", order: 22, testament: "old" },
  { code: "isa", nameKr: "이사야", nameEn: "Isaiah", order: 23, testament: "old" },
  { code: "jer", nameKr: "예레미야", nameEn: "Jeremiah", order: 24, testament: "old" },
  { code: "lam", nameKr: "예레미야애가", nameEn: "Lamentations", order: 25, testament: "old" },
  { code: "ezk", nameKr: "에스겔", nameEn: "Ezekiel", order: 26, testament: "old" },
  { code: "dan", nameKr: "다니엘", nameEn: "Daniel", order: 27, testament: "old" },
  { code: "hos", nameKr: "호세아", nameEn: "Hosea", order: 28, testament: "old" },
  { code: "jol", nameKr: "요엘", nameEn: "Joel", order: 29, testament: "old" },
  { code: "amo", nameKr: "아모스", nameEn: "Amos", order: 30, testament: "old" },
  { code: "oba", nameKr: "오바댜", nameEn: "Obadiah", order: 31, testament: "old" },
  { code: "jon", nameKr: "요나", nameEn: "Jonah", order: 32, testament: "old" },
  { code: "mic", nameKr: "미가", nameEn: "Micah", order: 33, testament: "old" },
  { code: "nam", nameKr: "나훔", nameEn: "Nahum", order: 34, testament: "old" },
  { code: "hab", nameKr: "하박국", nameEn: "Habakkuk", order: 35, testament: "old" },
  { code: "zep", nameKr: "스바냐", nameEn: "Zephaniah", order: 36, testament: "old" },
  { code: "hag", nameKr: "학개", nameEn: "Haggai", order: 37, testament: "old" },
  { code: "zec", nameKr: "스가랴", nameEn: "Zechariah", order: 38, testament: "old" },
  { code: "mal", nameKr: "말라기", nameEn: "Malachi", order: 39, testament: "old" },
  // 신약 (New Testament) — 27권
  { code: "mat", nameKr: "마태복음", nameEn: "Matthew", order: 40, testament: "new" },
  { code: "mrk", nameKr: "마가복음", nameEn: "Mark", order: 41, testament: "new" },
  { code: "luk", nameKr: "누가복음", nameEn: "Luke", order: 42, testament: "new" },
  { code: "jhn", nameKr: "요한복음", nameEn: "John", order: 43, testament: "new" },
  { code: "act", nameKr: "사도행전", nameEn: "Acts", order: 44, testament: "new" },
  { code: "rom", nameKr: "로마서", nameEn: "Romans", order: 45, testament: "new" },
  { code: "1co", nameKr: "고린도전서", nameEn: "1 Corinthians", order: 46, testament: "new" },
  { code: "2co", nameKr: "고린도후서", nameEn: "2 Corinthians", order: 47, testament: "new" },
  { code: "gal", nameKr: "갈라디아서", nameEn: "Galatians", order: 48, testament: "new" },
  { code: "eph", nameKr: "에베소서", nameEn: "Ephesians", order: 49, testament: "new" },
  { code: "php", nameKr: "빌립보서", nameEn: "Philippians", order: 50, testament: "new" },
  { code: "col", nameKr: "골로새서", nameEn: "Colossians", order: 51, testament: "new" },
  { code: "1th", nameKr: "데살로니가전서", nameEn: "1 Thessalonians", order: 52, testament: "new" },
  { code: "2th", nameKr: "데살로니가후서", nameEn: "2 Thessalonians", order: 53, testament: "new" },
  { code: "1ti", nameKr: "디모데전서", nameEn: "1 Timothy", order: 54, testament: "new" },
  { code: "2ti", nameKr: "디모데후서", nameEn: "2 Timothy", order: 55, testament: "new" },
  { code: "tit", nameKr: "디도서", nameEn: "Titus", order: 56, testament: "new" },
  { code: "phm", nameKr: "빌레몬서", nameEn: "Philemon", order: 57, testament: "new" },
  { code: "heb", nameKr: "히브리서", nameEn: "Hebrews", order: 58, testament: "new" },
  { code: "jas", nameKr: "야고보서", nameEn: "James", order: 59, testament: "new" },
  { code: "1pe", nameKr: "베드로전서", nameEn: "1 Peter", order: 60, testament: "new" },
  { code: "2pe", nameKr: "베드로후서", nameEn: "2 Peter", order: 61, testament: "new" },
  { code: "1jn", nameKr: "요한일서", nameEn: "1 John", order: 62, testament: "new" },
  { code: "2jn", nameKr: "요한이서", nameEn: "2 John", order: 63, testament: "new" },
  { code: "3jn", nameKr: "요한삼서", nameEn: "3 John", order: 64, testament: "new" },
  { code: "jud", nameKr: "유다서", nameEn: "Jude", order: 65, testament: "new" },
  { code: "rev", nameKr: "요한계시록", nameEn: "Revelation", order: 66, testament: "new" },
];

export const OLD_TESTAMENT = BOOKS.filter((b) => b.testament === "old");
export const NEW_TESTAMENT = BOOKS.filter((b) => b.testament === "new");

export function getBookByCode(code: string): BookInfo | undefined {
  return BOOKS.find((b) => b.code === code);
}
