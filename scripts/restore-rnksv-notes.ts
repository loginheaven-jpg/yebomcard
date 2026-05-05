/**
 * 새번역 (주: ...) 주석 복원 스크립트
 *
 * 대한성서공회 웹사이트에서 재크롤링하여 각주 텍스트를 추출하고
 * DB에 (주: ...) 형태로 복원한다.
 *
 * 실행: npx tsx scripts/restore-rnksv-notes.ts
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://iityjmjgnjtvqujpivjg.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BASE_URL = "https://www.bskorea.or.kr/bible/korbibReadpage.php";
const DELAY_MS = 1200;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BIBLE_BOOKS = [
  { code: "gen", chapters: 50 },{ code: "exo", chapters: 40 },{ code: "lev", chapters: 27 },
  { code: "num", chapters: 36 },{ code: "deu", chapters: 34 },{ code: "jos", chapters: 24 },
  { code: "jdg", chapters: 21 },{ code: "rut", chapters: 4 },{ code: "1sa", chapters: 31 },
  { code: "2sa", chapters: 24 },{ code: "1ki", chapters: 22 },{ code: "2ki", chapters: 25 },
  { code: "1ch", chapters: 29 },{ code: "2ch", chapters: 36 },{ code: "ezr", chapters: 10 },
  { code: "neh", chapters: 13 },{ code: "est", chapters: 10 },{ code: "job", chapters: 42 },
  { code: "psa", chapters: 150 },{ code: "pro", chapters: 31 },{ code: "ecc", chapters: 12 },
  { code: "sng", chapters: 8 },{ code: "isa", chapters: 66 },{ code: "jer", chapters: 52 },
  { code: "lam", chapters: 5 },{ code: "ezk", chapters: 48 },{ code: "dan", chapters: 12 },
  { code: "hos", chapters: 14 },{ code: "jol", chapters: 3 },{ code: "amo", chapters: 9 },
  { code: "oba", chapters: 1 },{ code: "jon", chapters: 4 },{ code: "mic", chapters: 7 },
  { code: "nam", chapters: 3 },{ code: "hab", chapters: 3 },{ code: "zep", chapters: 3 },
  { code: "hag", chapters: 2 },{ code: "zec", chapters: 14 },{ code: "mal", chapters: 4 },
  { code: "mat", chapters: 28 },{ code: "mrk", chapters: 16 },{ code: "luk", chapters: 24 },
  { code: "jhn", chapters: 21 },{ code: "act", chapters: 28 },{ code: "rom", chapters: 16 },
  { code: "1co", chapters: 16 },{ code: "2co", chapters: 13 },{ code: "gal", chapters: 6 },
  { code: "eph", chapters: 6 },{ code: "php", chapters: 4 },{ code: "col", chapters: 4 },
  { code: "1th", chapters: 5 },{ code: "2th", chapters: 3 },{ code: "1ti", chapters: 6 },
  { code: "2ti", chapters: 4 },{ code: "tit", chapters: 3 },{ code: "phm", chapters: 1 },
  { code: "heb", chapters: 13 },{ code: "jas", chapters: 5 },{ code: "1pe", chapters: 5 },
  { code: "2pe", chapters: 3 },{ code: "1jn", chapters: 5 },{ code: "2jn", chapters: 1 },
  { code: "3jn", chapters: 1 },{ code: "jud", chapters: 1 },{ code: "rev", chapters: 22 },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTML에서 절별 텍스트 + 각주 추출
 * 각주가 있으면 "(주: 각주텍스트)" 형태로 본문 뒤에 붙임
 */
function parseChapterWithNotes(html: string): Record<number, string> {
  const verses: Record<number, string> = {};

  // 태그 제거하되 구조 보존
  let text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a[^>]*>\[?\d+\)?<\/a>/gi, "")  // 각주 링크 번호 제거
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, "")
    .replace(/\[\d+\)/g, "")
    .replace(/[ \t]+/g, " ");

  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  let currentVerse = 0;
  let currentText = "";
  let currentNotes: string[] = [];

  for (const line of lines) {
    const verseMatch = line.match(/^(\d{1,3})\s+(.+)$/);

    if (verseMatch) {
      // 이전 절 저장
      if (currentVerse > 0 && currentText.trim()) {
        let finalText = currentText.trim();
        if (currentNotes.length > 0) {
          finalText += " (주: " + currentNotes.join(" ; ") + ")";
        }
        verses[currentVerse] = finalText;
      }
      currentVerse = parseInt(verseMatch[1]);
      currentText = verseMatch[2];
      currentNotes = [];
    } else if (currentVerse > 0) {
      // 각주 판별: 히, 또는, 칠십인역, 마소라, 70인역, 사마리아, 곧, 또, 한, 다른 등
      const isNote = /^(또는|히\s*,|칠십인역|마소라|70인역|사마리아|곧\s*,|다른|한\s)/.test(line);
      if (isNote) {
        currentNotes.push(line);
      } else if (line.length > 5) {
        currentText += " " + line;
      }
    }
  }

  // 마지막 절
  if (currentVerse > 0 && currentText.trim()) {
    let finalText = currentText.trim();
    if (currentNotes.length > 0) {
      finalText += " (주: " + currentNotes.join(" ; ") + ")";
    }
    verses[currentVerse] = finalText;
  }

  return verses;
}

async function main() {
  if (!SUPABASE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY 환경변수 필요");
    process.exit(1);
  }

  let totalUpdated = 0;
  let totalChapters = 0;
  const totalChaptersAll = BIBLE_BOOKS.reduce((s, b) => s + b.chapters, 0);

  for (const book of BIBLE_BOOKS) {
    for (let chap = 1; chap <= book.chapters; chap++) {
      totalChapters++;
      const url = `${BASE_URL}?version=SAENEW&book=${book.code}&chap=${chap}`;

      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.error(`[FAIL] ${book.code} ${chap}: HTTP ${res.status}`);
          continue;
        }

        const html = await res.text();
        const verses = parseChapterWithNotes(html);

        // 각주가 있는 절만: 기존 본문에 (주: ...) append
        for (const [v, fullText] of Object.entries(verses)) {
          if (!fullText.includes("(주: ")) continue;

          // (주: ...) 부분만 추출
          const noteMatch = fullText.match(/\(주:\s*[^)]+\)/);
          if (!noteMatch) continue;
          const note = noteMatch[0];

          // 현재 DB 텍스트 읽기
          const { data: row } = await supabase
            .from("bible_verses")
            .select("text")
            .eq("version", "rnksv")
            .eq("book_code", book.code)
            .eq("chapter", chap)
            .eq("verse", parseInt(v))
            .single();

          if (!row) continue;

          // 이미 (주: 가 있으면 스킵
          if (row.text.includes("(주:")) continue;

          // 기존 본문 뒤에 (주: ...) append
          const newText = row.text + " " + note;

          const { error } = await supabase
            .from("bible_verses")
            .update({ text: newText })
            .eq("version", "rnksv")
            .eq("book_code", book.code)
            .eq("chapter", chap)
            .eq("verse", parseInt(v));

          if (!error) totalUpdated++;
        }

        if (totalChapters % 50 === 0) {
          console.log(`[${totalChapters}/${totalChaptersAll}] ${book.code} ${chap}장 — 복원 ${totalUpdated}건`);
        }
      } catch (err) {
        console.error(`[ERR] ${book.code} ${chap}:`, err);
      }

      await sleep(DELAY_MS);
    }
  }

  console.log(`\n✅ 복원 완료: ${totalUpdated}건 (주: ...) 주석 복원`);
}

main().catch(console.error);
