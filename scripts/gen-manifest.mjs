// upload-web-audio-r2.mjs 가 manifest 를 못 만든 버그 보완용.
// 로컬 파일 + 매핑으로 manifest 재생성.

import { readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { config } from "dotenv";

config({ path: ".env.local" });
const { R2_PUBLIC_BASE } = process.env;

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
const SINGLE = new Set(["31_Obadiah", "57_Philemon", "63_2John", "64_3John", "65_Jude"]);

function parseFn(filename) {
  const base = filename.replace(/\.mp3$/, "");
  const prefixes = Object.entries(BOOK_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, code] of prefixes) {
    if (base === prefix) {
      if (SINGLE.has(prefix)) return { bookCode: code, chapter: 1 };
      continue;
    }
    if (base.startsWith(prefix + "_")) {
      const rest = base.slice(prefix.length + 1);
      if (/^\d+$/.test(rest)) return { bookCode: code, chapter: parseInt(rest, 10) };
    }
    if (prefix === "25_Lam" && base.startsWith(prefix)) {
      const rest = base.slice(prefix.length);
      if (/^\d+$/.test(rest)) return { bookCode: code, chapter: parseInt(rest, 10) };
    }
  }
  return null;
}

const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".mp3"));
const manifest = [];
for (const f of files) {
  const p = parseFn(f);
  if (!p) continue;
  const chPad = String(p.chapter).padStart(3, "0");
  manifest.push({
    version: "web",
    book_code: p.bookCode,
    chapter: p.chapter,
    audio_url: `${R2_PUBLIC_BASE}/web/${p.bookCode}/${chPad}.mp3`,
    file_bytes: statSync(join(SOURCE_DIR, f)).size,
    narrator: "David Williams (WEB)",
  });
}
manifest.sort((a, b) => a.book_code.localeCompare(b.book_code) || a.chapter - b.chapter);
writeFileSync("web-audio-manifest.json", JSON.stringify(manifest, null, 2));
console.log(`manifest 작성: ${manifest.length} rows`);
console.log("samples:", manifest.slice(0, 3));
