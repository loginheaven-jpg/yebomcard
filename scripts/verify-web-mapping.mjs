// Dry-run: 1189 mp3 파일명 → (book_code, chapter) 매핑 검증.
// 누락·중복·범위 초과 확인.

import { readdirSync, statSync } from "fs";
import { join } from "path";

const SOURCE_DIR = "bible/web-williams";

const BOOK_MAP = {
  "01_Genesis": "gen", "02_Exodus": "exo", "03_Leviticus": "lev", "04_Numbers": "num",
  "05_Deuteronomy": "deu", "06_Joshua": "jos", "07_Judges": "jdg", "08_Ruth": "rut",
  "09_1Samuel": "1sa", "10_2Samuel": "2sa", "11_1Kings": "1ki", "12_2Kings": "2ki",
  "13_1Chronicles": "1ch", "14_2Chronicles": "2ch", "15_Ezra": "ezr", "16_Nehemiah": "neh",
  "17_Esther": "est", "18_Job": "job", "19_Psalm": "psa", "20_Prov": "pro",
  "21_Ecclesiastes": "ecc", "22_Song_of_Solomon": "sng", "23_Isaiah": "isa", "24_Jeremiah": "jer",
  "25_Lam": "lam", "26_Ezekiel": "ezk", "27_Daniel": "dan", "28_Hosea": "hos",
  "29_Joel": "jol", "30_Amos": "amo", "31_Obadiah": "oba", "32_Jonah": "jon",
  "33_Micah": "mic", "34_Nahum": "nam", "35_Habakkuk": "hab", "36_Zephaniah": "zep",
  "37_Haggai": "hag", "38_Zechariah": "zec", "39_Malachi": "mal",
  "40_Matt": "mat", "41_Mark": "mrk", "42_Luke": "luk", "43_John": "jhn",
  "44_Acts": "act", "45_Romans": "rom", "46_1Cor": "1co", "47_2Cor": "2co",
  "48_Gal": "gal", "49_Ephesians": "eph", "50_Philippians": "php", "51_Colossians": "col",
  "52_1Thessa": "1th", "53_2Thessa": "2th", "54_1Timothy": "1ti", "55_2Timothy": "2ti",
  "56_Titus": "tit", "57_Philemon": "phm", "58_Hebrews": "heb", "59_James": "jas",
  "60_1Peter": "1pe", "61_2Peter": "2pe", "62_1John": "1jn", "63_2John": "2jn",
  "64_3John": "3jn", "65_Jude": "jud", "66_Revelation": "rev",
};

const SINGLE_CHAPTER_BOOKS = new Set(["31_Obadiah", "57_Philemon", "63_2John", "64_3John", "65_Jude"]);

// 책별 예상 chapter 수 (KJV/WEB 공통)
const EXPECTED_CHAPTERS = {
  gen: 50, exo: 40, lev: 27, num: 36, deu: 34, jos: 24, jdg: 21, rut: 4,
  "1sa": 31, "2sa": 24, "1ki": 22, "2ki": 25, "1ch": 29, "2ch": 36, ezr: 10, neh: 13,
  est: 10, job: 42, psa: 150, pro: 31, ecc: 12, sng: 8, isa: 66, jer: 52,
  lam: 5, ezk: 48, dan: 12, hos: 14, jol: 3, amo: 9, oba: 1, jon: 4,
  mic: 7, nam: 3, hab: 3, zep: 3, hag: 2, zec: 14, mal: 4,
  mat: 28, mrk: 16, luk: 24, jhn: 21, act: 28, rom: 16, "1co": 16, "2co": 13,
  gal: 6, eph: 6, php: 4, col: 4, "1th": 5, "2th": 3, "1ti": 6, "2ti": 4,
  tit: 3, phm: 1, heb: 13, jas: 5, "1pe": 5, "2pe": 3, "1jn": 5, "2jn": 1,
  "3jn": 1, jud: 1, rev: 22,
};

function parseFileName(filename) {
  const base = filename.replace(/\.mp3$/, "");
  const prefixes = Object.entries(BOOK_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, code] of prefixes) {
    if (base === prefix) {
      if (!SINGLE_CHAPTER_BOOKS.has(prefix)) return null;
      return { bookCode: code, chapter: 1 };
    }
    if (base.startsWith(prefix + "_")) {
      const rest = base.slice(prefix.length + 1);
      const ch = parseInt(rest, 10);
      if (!isNaN(ch) && /^\d+$/.test(rest)) return { bookCode: code, chapter: ch };
    }
    if (prefix === "25_Lam" && base.startsWith(prefix)) {
      const rest = base.slice(prefix.length);
      const ch = parseInt(rest, 10);
      if (!isNaN(ch) && /^\d+$/.test(rest)) return { bookCode: code, chapter: ch };
    }
  }
  return null;
}

const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".mp3"));
console.log(`Total files: ${files.length}`);

const byBook = {};
const unmapped = [];
const duplicates = [];

for (const f of files) {
  const p = parseFileName(f);
  if (!p) { unmapped.push(f); continue; }
  const key = `${p.bookCode}:${p.chapter}`;
  if (byBook[key]) duplicates.push({ file: f, prevFile: byBook[key], key });
  byBook[key] = f;
}

console.log(`Mapped: ${Object.keys(byBook).length}`);
console.log(`Unmapped: ${unmapped.length}`, unmapped.slice(0, 10));
console.log(`Duplicates: ${duplicates.length}`, duplicates.slice(0, 5));

// 책별 chapter 검증
let missing = 0;
let extra = 0;
for (const [code, expectedCh] of Object.entries(EXPECTED_CHAPTERS)) {
  for (let ch = 1; ch <= expectedCh; ch++) {
    if (!byBook[`${code}:${ch}`]) {
      console.log(`MISSING: ${code} ch=${ch}`);
      missing++;
    }
  }
  // extra chapter
  for (const k of Object.keys(byBook)) {
    if (k.startsWith(`${code}:`)) {
      const ch = parseInt(k.split(":")[1], 10);
      if (ch > expectedCh) {
        console.log(`EXTRA: ${code} ch=${ch}`);
        extra++;
      }
    }
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`Total files: ${files.length}`);
console.log(`Mapped to (book,chapter): ${Object.keys(byBook).length}`);
console.log(`Missing: ${missing}`);
console.log(`Extra: ${extra}`);
console.log(`Duplicates: ${duplicates.length}`);
console.log(`Unmapped: ${unmapped.length}`);

// 총 크기
const totalBytes = files.reduce((sum, f) => sum + statSync(join(SOURCE_DIR, f)).size, 0);
console.log(`Total size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
