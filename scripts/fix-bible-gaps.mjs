/**
 * 성경 구조적 누락 2건 보충 (service_role):
 *  1) 요나 book_code 표준화: jnh → jon (bible_verses + bible_audio)
 *     - 6역본+음원이 jnh, 앱·WEB은 jon → 앱에서 요나 미표시 버그. 표준 USFM jon 으로 통일.
 *  2) KJV 데살로니가전/후(1th, 2th) 보충: 공개도메인 KJV(bible-api.com)에서 받아 INSERT.
 *
 * 실행: node scripts/fix-bible-gaps.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function fixJonah() {
  console.log("\n[1] 요나 jnh → jon 표준화");
  const v = await supa.from("bible_verses").update({ book_code: "jon" }).eq("book_code", "jnh").select("id");
  if (v.error) throw new Error("bible_verses: " + v.error.message);
  console.log(`    bible_verses 갱신 ${v.data.length}행`);
  const a = await supa.from("bible_audio").update({ book_code: "jon" }).eq("book_code", "jnh").select("id");
  if (a.error) throw new Error("bible_audio: " + a.error.message);
  console.log(`    bible_audio 갱신 ${a.data.length}행`);
}

const KJV_BOOKS = [
  { code: "1th", name: "1 Thessalonians", abbr: "1Th", order: 52, chapters: 5 },
  { code: "2th", name: "2 Thessalonians", abbr: "2Th", order: 53, chapters: 3 },
];

async function fillKjvThess() {
  console.log("\n[2] KJV 데살로니가전/후 보충 (bible-api.com, public domain)");
  const rows = [];
  for (const b of KJV_BOOKS) {
    for (let ch = 1; ch <= b.chapters; ch++) {
      const url = `https://bible-api.com/${encodeURIComponent(b.name + " " + ch)}?translation=kjv`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${b.name} ${ch}: ${res.status}`);
      const json = await res.json();
      if (!json.verses || !json.verses.length) throw new Error(`${b.name} ${ch}: 빈 응답`);
      for (const v of json.verses) {
        rows.push({
          version: "kjv",
          book_code: b.code,
          book_name: b.name,
          book_abbr: b.abbr,
          book_order: b.order,
          testament: "new",
          chapter: v.chapter,
          verse: v.verse,
          text: String(v.text).trim(),
        });
      }
      console.log(`    ${b.name} ${ch}장: ${json.verses.length}절`);
    }
  }
  console.log(`    총 ${rows.length}절 수집 → INSERT`);
  // UNIQUE(version,book_code,chapter,verse) 충돌 시 무시 (멱등)
  const ins = await supa.from("bible_verses").upsert(rows, {
    onConflict: "version,book_code,chapter,verse",
    ignoreDuplicates: true,
  }).select("id");
  if (ins.error) throw new Error("insert: " + ins.error.message);
  console.log(`    INSERT 완료 (${ins.data?.length ?? 0}행 반영)`);
}

async function verify() {
  console.log("\n[검증]");
  const jon = await supa.from("bible_verses").select("version").eq("book_code", "jon");
  const jonVers = [...new Set((jon.data || []).map((r) => r.version))].sort();
  console.log(`    jon 보유 역본: ${jonVers.join(", ")} (${jonVers.length}개)`);
  const jnhLeft = await supa.from("bible_verses").select("id", { count: "exact", head: true }).eq("book_code", "jnh");
  console.log(`    잔존 jnh: ${jnhLeft.count ?? 0}행`);
  for (const code of ["1th", "2th"]) {
    const r = await supa.from("bible_verses").select("id", { count: "exact", head: true }).eq("version", "kjv").eq("book_code", code);
    console.log(`    KJV ${code}: ${r.count ?? 0}절`);
  }
  const kjvBooks = await supa.from("bible_verses").select("book_code").eq("version", "kjv");
  const distinct = new Set((kjvBooks.data || []).map((r) => r.book_code));
  console.log(`    KJV 책 수: ${distinct.size} (목표 66)`);
}

async function main() {
  await fixJonah();
  await fillKjvThess();
  await verify();
  console.log("\n[OK] 완료");
}
main().catch((e) => { console.error("[FATAL]", e); process.exit(1); });
