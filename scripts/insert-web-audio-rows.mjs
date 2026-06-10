// manifest 1189행 → bible_audio 테이블 upsert.
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key, { auth: { persistSession: false } });

const manifest = JSON.parse(readFileSync("web-audio-manifest.json", "utf-8"));
console.log(`Inserting ${manifest.length} rows...`);

const BATCH = 250;
let total = 0;
let errors = 0;
for (let i = 0; i < manifest.length; i += BATCH) {
  const slice = manifest.slice(i, i + BATCH);
  const { error, count } = await supabase
    .from("bible_audio")
    .upsert(slice, { onConflict: "version,book_code,chapter", count: "exact" });
  if (error) {
    console.error(`[ERR batch ${i / BATCH + 1}]`, error.message);
    errors++;
  } else {
    total += slice.length;
    console.log(`[OK batch ${i / BATCH + 1}] ${slice.length} rows upserted (cumulative ${total})`);
  }
}

console.log(`\n[DONE] total=${total}, errors=${errors}`);

const { count: finalCount } = await supabase
  .from("bible_audio")
  .select("*", { count: "exact", head: true })
  .eq("version", "web");
console.log(`Final web row count: ${finalCount}`);
