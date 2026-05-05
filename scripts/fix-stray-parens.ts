import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://iityjmjgnjtvqujpivjg.supabase.co",
  process.env.SK!
);

async function main() {
  const { data, error } = await supabase
    .from("bible_verses")
    .select("id, text")
    .eq("version", "rnksv")
    .like("text", "%.)")
    .limit(1000);

  if (error || !data) {
    console.error("조회 실패:", error);
    return;
  }
  console.log(`대상: ${data.length}건`);

  let fixed = 0;
  for (const row of data) {
    let t = row.text as string;
    if (!t.endsWith(".)")) continue;

    // (주: ...) 안의 )는 보존
    const noteStart = t.lastIndexOf("(주:");
    if (noteStart !== -1 && t.indexOf(")", noteStart) === t.length - 1) continue;

    const newText = t.slice(0, -1);
    const { error: uerr } = await supabase
      .from("bible_verses")
      .update({ text: newText })
      .eq("id", row.id);

    if (!uerr) fixed++;
  }
  console.log(`완료: ${fixed}건 수정`);
}
main().catch(console.error);
