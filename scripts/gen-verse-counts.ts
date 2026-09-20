/**
 * 장별 절 수 표를 만든다 — `lib/plans/verseCounts.ts`
 *
 * 진도표를 **절 수 기준으로 고르게** 나누려면(지휘부 2026-09-20) 장마다 절이 몇 개인지 알아야 한다.
 * 시편 119(176절)와 시편 117(2절)을 같은 한 장으로 세면 회차마다 분량이 크게 들쭉날쭉해진다.
 *
 * 질문마다 DB 를 부르지 않도록 **한 번 뽑아 정적 파일로 둔다**(약 1,189개 숫자, 8KB 안팎).
 * 본문이 바뀔 일은 거의 없지만, 역본을 새로 넣거나 절 분할이 달라지면 다시 돌린다:
 *
 *   npx tsc -p tsconfig.verify.json && node -r ./scripts/verify-alias.cjs .verify/scripts/gen-verse-counts.js
 *
 * 기준 역본은 **새번역(rnksv)** 이다 — 앱의 기본 역본이고 절 분할이 개역과 거의 같다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BOOKS, CHAPTER_COUNTS } from "../lib/books";

const VERSION = "rnksv";
const OUT = path.join(process.cwd(), "lib", "plans", "verseCounts.ts");

function loadEnv(): Record<string, string> {
  const raw = readFileSync(path.join(process.cwd(), ".env.local"), "utf-8");
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 가 필요합니다");

  // PostgREST 는 group by 를 못 하므로 (책, 장, 절)만 훑어 센다. 1000행씩 끊어 읽는다.
  const counts = new Map<string, number>();
  let from = 0;
  for (;;) {
    const res = await fetch(
      `${url}/rest/v1/bible_verses?select=book_code,chapter,verse&version=eq.${VERSION}` +
        `&order=book_code.asc,chapter.asc,verse.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` } },
    );
    if (!res.ok) throw new Error(`본문을 읽지 못했습니다 (${res.status})`);
    const rows = (await res.json()) as { book_code: string; chapter: number; verse: number }[];
    if (rows.length === 0) break;
    for (const r of rows) {
      const k = `${r.book_code}:${r.chapter}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    process.stdout.write(`\r읽은 절 ${from + rows.length}`);
    if (rows.length < 1000) break;
    from += 1000;
  }
  process.stdout.write("\n");

  // 책 순서대로 배열에 담는다 — [1장 절수, 2장 절수, …]
  const table: Record<string, number[]> = {};
  const missing: string[] = [];
  for (const book of BOOKS) {
    const chapters = CHAPTER_COUNTS[book.code] ?? 0;
    const arr: number[] = [];
    for (let ch = 1; ch <= chapters; ch++) {
      const n = counts.get(`${book.code}:${ch}`) ?? 0;
      if (n === 0) missing.push(`${book.code} ${ch}`);
      arr.push(n);
    }
    table[book.code] = arr;
  }
  if (missing.length > 0) {
    throw new Error(`절이 없는 장 ${missing.length}개: ${missing.slice(0, 10).join(", ")}`);
  }

  const total = Object.values(table).reduce((s, a) => s + a.reduce((x, y) => x + y, 0), 0);
  // 책 코드는 1sa · 2ki 처럼 숫자로 시작하는 것이 있어 **반드시 따옴표로 묶는다**
  // (TS 는 숫자로 시작하는 맨 이름을 키로 받지 않는다).
  const body = Object.entries(table)
    .map(([code, arr]) => `  "${code}": [${arr.join(", ")}],`)
    .join("\n");

  writeFileSync(
    OUT,
    `/**
 * 장별 절 수 — \`scripts/gen-verse-counts.ts\` 가 새번역(rnksv) 본문에서 뽑았다. **손으로 고치지 않는다.**
 *
 * 진도표를 절 수 기준으로 고르게 나누는 데 쓴다(\`lib/plans/builder.ts\`).
 * 장 수로만 나누면 시편 119(176절)와 시편 117(2절)이 같은 무게가 되어 회차 분량이 들쭉날쭉해진다.
 *
 * 실측: ${Object.keys(table).length}권 · ${Object.values(table).reduce((s, a) => s + a.length, 0)}장 · ${total.toLocaleString()}절
 */
export const VERSE_COUNTS: Record<string, number[]> = {
${body}
};

/** 한 장의 절 수. 모르는 책·장이면 0 이 아니라 **평균값(26)** 을 돌려준다 — 분배가 멈추지 않게. */
export function verseCount(book: string, chapter: number): number {
  const arr = VERSE_COUNTS[book];
  const n = arr?.[chapter - 1];
  return typeof n === "number" && n > 0 ? n : 26;
}
`,
    "utf-8",
  );
  console.log(`${OUT} — ${Object.keys(table).length}권 · ${total.toLocaleString()}절`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
