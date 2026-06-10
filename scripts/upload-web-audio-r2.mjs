/**
 * WEB(World English Bible) chapter mp3 → Cloudflare R2 업로드.
 *
 * 입력: c:/dev/yebomcard/bible/web-williams/*.mp3 (AudioTreasure Williams 1189 파일)
 * 출력: R2 bucket 의 web/{book_code}/{NNN}.mp3 (3-digit zero-pad chapter)
 *
 * 실행: node scripts/upload-web-audio-r2.mjs
 *
 * 환경변수 (.env.local 에 둠):
 *   R2_ACCOUNT_ID            (https://{ACCOUNT_ID}.r2.cloudflarestorage.com)
 *   R2_ACCESS_KEY_ID         (R2 API Token Access Key)
 *   R2_SECRET_ACCESS_KEY     (R2 API Token Secret Key)
 *   R2_BUCKET                (예: yebom-bible-audio)
 *   R2_PUBLIC_BASE           (예: https://pub-xxxxx.r2.dev — 업로드 후 audio_url 생성용)
 */

import { readFileSync, statSync, existsSync } from "fs";
import { join } from "path";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { config } from "dotenv";

config({ path: ".env.local" });

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_BASE,
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error("[ERROR] R2_* env 변수가 .env.local 에 설정되지 않음.");
  process.exit(1);
}

const SOURCE_DIR = "bible/web-williams";
const CONCURRENCY = 8;

// AudioTreasure 파일명 prefix → 우리 DB book_code 매핑 (1jn / 2jn 등 USFM 소문자)
const BOOK_MAP = {
  // OT
  "01_Genesis": "gen",
  "02_Exodus": "exo",
  "03_Leviticus": "lev",
  "04_Numbers": "num",
  "05_Deuteronomy": "deu",
  "06_Joshua": "jos",
  "07_Judges": "jdg",
  "08_Ruth": "rut",
  "09_1Samuel": "1sa",
  "10_2Samuel": "2sa",
  "11_1Kings": "1ki",
  "12_2Kings": "2ki",
  "13_1Chronicles": "1ch",
  "14_2Chronicles": "2ch",
  "15_Ezra": "ezr",
  "16_Nehemiah": "neh",
  "17_Esther": "est",
  "18_Job": "job",
  "19_Psalm": "psa",
  "20_Prov": "pro",
  "21_Ecclesiastes": "ecc",
  "22_Song_of_Solomon": "sng",
  "23_Isaiah": "isa",
  "24_Jeremiah": "jer",
  "25_Lam": "lam",
  "26_Ezekiel": "ezk",
  "27_Daniel": "dan",
  "28_Hosea": "hos",
  "29_Joel": "jol",
  "30_Amos": "amo",
  "31_Obadiah": "oba",
  "32_Jonah": "jon",
  "33_Micah": "mic",
  "34_Nahum": "nam",
  "35_Habakkuk": "hab",
  "36_Zephaniah": "zep",
  "37_Haggai": "hag",
  "38_Zechariah": "zec",
  "39_Malachi": "mal",
  // NT
  "40_Matt": "mat",
  "41_Mark": "mrk",
  "42_Luke": "luk",
  "43_John": "jhn",
  "44_Acts": "act",
  "45_Romans": "rom",
  "46_1Cor": "1co",
  "47_2Cor": "2co",
  "48_Gal": "gal",
  "49_Ephesians": "eph",
  "50_Philippians": "php",
  "51_Colossians": "col",
  "52_1Thessa": "1th",
  "53_2Thessa": "2th",
  "54_1Timothy": "1ti",
  "55_2Timothy": "2ti",
  "56_Titus": "tit",
  "57_Philemon": "phm",
  "58_Hebrews": "heb",
  "59_James": "jas",
  "60_1Peter": "1pe",
  "61_2Peter": "2pe",
  "62_1John": "1jn",
  "63_2John": "2jn",
  "64_3John": "3jn",
  "65_Jude": "jud",
  "66_Revelation": "rev",
};

// 단일장 책은 챕터 suffix 없음 (예: 57_Philemon.mp3)
const SINGLE_CHAPTER_BOOKS = new Set(["31_Obadiah", "57_Philemon", "63_2John", "64_3John", "65_Jude"]);

// AudioTreasure 파일명 → { book_code, chapter }
// 패턴: (1) 표준 `{prefix}_{NN}.mp3` (Psalms 는 NNN)
//       (2) 단일장 책 `{prefix}.mp3` (Obadiah, Philemon, 2/3 John, Jude)
//       (3) Lamentations 특수 `25_Lam{N}.mp3` (구분자 없음, 1자리 chapter)
function parseFileName(filename) {
  const base = filename.replace(/\.mp3$/, "");
  // 가장 긴 prefix 부터 매칭 (1Cor 가 1Co 보다 먼저 매칭되도록)
  const prefixes = Object.entries(BOOK_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, code] of prefixes) {
    if (base === prefix) {
      if (!SINGLE_CHAPTER_BOOKS.has(prefix)) return null;
      return { bookCode: code, chapter: 1 };
    }
    // 표준 `prefix_chapter`
    if (base.startsWith(prefix + "_")) {
      const rest = base.slice(prefix.length + 1);
      const ch = parseInt(rest, 10);
      if (!isNaN(ch) && String(ch) === rest.replace(/^0+/, "") || String(ch).padStart(rest.length, "0") === rest) {
        return { bookCode: code, chapter: ch };
      }
    }
    // Lamentations 특수: `25_Lam` + 숫자 (구분자 없음)
    if (prefix === "25_Lam" && base.startsWith(prefix)) {
      const rest = base.slice(prefix.length);
      const ch = parseInt(rest, 10);
      if (!isNaN(ch) && String(ch) === rest) return { bookCode: code, chapter: ch };
    }
  }
  return null;
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch (e) {
    if (e.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

async function uploadFile(localPath, r2Key) {
  if (await objectExists(r2Key)) return { skipped: true, key: r2Key };
  const body = readFileSync(localPath);
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: body,
      ContentType: "audio/mpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return { uploaded: true, key: r2Key, bytes: body.length };
}

async function main() {
  if (!existsSync(SOURCE_DIR)) {
    console.error(`[ERROR] ${SOURCE_DIR} 없음. zip 압축 해제 먼저.`);
    process.exit(1);
  }
  const { readdirSync } = await import("fs");
  const allFiles = readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".mp3"));
  console.log(`[INFO] ${allFiles.length} mp3 파일 발견`);

  // 파일명 파싱 + 매핑 검증
  const tasks = [];
  const unmapped = [];
  for (const f of allFiles) {
    const parsed = parseFileName(f);
    if (!parsed) {
      unmapped.push(f);
      continue;
    }
    const chPadded = String(parsed.chapter).padStart(3, "0");
    const r2Key = `web/${parsed.bookCode}/${chPadded}.mp3`;
    const localPath = join(SOURCE_DIR, f);
    const size = statSync(localPath).size;
    tasks.push({ f, r2Key, localPath, size, ...parsed });
  }

  if (unmapped.length > 0) {
    console.error(`[WARN] 매핑 실패 ${unmapped.length}개:`, unmapped.slice(0, 5));
  }
  console.log(`[INFO] 업로드 대상 ${tasks.length}개, 총 ${(tasks.reduce((a, t) => a + t.size, 0) / 1024 / 1024).toFixed(1)} MB`);

  // 동시성 업로드
  let done = 0;
  let uploaded = 0;
  let skipped = 0;
  const errors = [];
  async function worker() {
    while (tasks.length > 0) {
      const t = tasks.shift();
      try {
        const r = await uploadFile(t.localPath, t.r2Key);
        if (r.skipped) skipped++;
        else uploaded++;
        done++;
        if (done % 50 === 0) console.log(`[PROGRESS] ${done} 완료 (uploaded=${uploaded} skipped=${skipped})`);
      } catch (e) {
        errors.push({ file: t.f, err: String(e).slice(0, 200) });
        console.error(`[ERROR] ${t.f}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`\n[DONE] uploaded=${uploaded} skipped=${skipped} errors=${errors.length}`);
  if (errors.length > 0) {
    console.log("[ERRORS]", errors);
    process.exit(1);
  }

  // INSERT SQL 생성용 매니페스트 출력
  const manifest = tasks.map((t) => ({
    version: "web",
    book_code: t.bookCode,
    chapter: t.chapter,
    audio_url: `${R2_PUBLIC_BASE}/web/${t.bookCode}/${String(t.chapter).padStart(3, "0")}.mp3`,
    file_bytes: t.size,
    narrator: "David Williams (WEB)",
  }));
  const { writeFileSync } = await import("fs");
  writeFileSync("web-audio-manifest.json", JSON.stringify(manifest, null, 2));
  console.log(`[INFO] web-audio-manifest.json 작성 (${manifest.length} rows) — INSERT 단계용`);
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
