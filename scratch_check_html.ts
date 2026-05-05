import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://iityjmjgnjtvqujpivjg.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpdHlqbWpnbmp0dnF1anBpdmpnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjY5MDkyOCwiZXhwIjoyMDgyMjY2OTI4fQ.P7zoXy1eje-V8RU6xkwhKDHWkxBkg1KZXSGjbJdVJXk";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
  const { data, error } = await supabase
    .from("bible_verses")
    .select("id, book_name, chapter, verse, text")
    .eq("version", "rnksv");

  if (error) {
    console.error("Error:", error);
    return;
  }
  
  const anomalies = [];
  
  for (const row of data) {
    const text = row.text || "";
    const openCount = (text.match(/\(/g) || []).length;
    const closeCount = (text.match(/\)/g) || []).length;
    
    // 괄호 개수 불일치 또는 ') (' 패턴 확인
    if (openCount !== closeCount || text.includes(") (")) {
      anomalies.push({
        ref: `${row.book_name} ${row.chapter}:${row.verse}`,
        text: text
      });
    }
  }
  
  console.log(`총 ${anomalies.length}개의 비정상 괄호 데이터 발견`);
  console.log("예시 5개:");
  console.log(JSON.stringify(anomalies.slice(0, 5), null, 2));
}

checkData();
