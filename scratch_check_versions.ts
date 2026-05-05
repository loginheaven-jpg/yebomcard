import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://iityjmjgnjtvqujpivjg.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpdHlqbWpnbmp0dnF1anBpdmpnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjY5MDkyOCwiZXhwIjoyMDgyMjY2OTI4fQ.P7zoXy1eje-V8RU6xkwhKDHWkxBkg1KZXSGjbJdVJXk";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkVersions() {
  const { data, error } = await supabase
    .from("bible_verses")
    .select("version")
    .limit(1000); // 1000개 정도면 중복 제거해서 종류 파악 가능할듯.
    // 또는 group by를 못하니까 set으로 묶기
    
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  const versions = new Set(data.map(d => d.version));
  console.log("현재 DB에 있는 번역본:", Array.from(versions));
}

checkVersions();
