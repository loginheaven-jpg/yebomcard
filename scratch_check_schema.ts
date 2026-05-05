import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://iityjmjgnjtvqujpivjg.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpdHlqbWpnbmp0dnF1anBpdmpnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjY5MDkyOCwiZXhwIjoyMDgyMjY2OTI4fQ.P7zoXy1eje-V8RU6xkwhKDHWkxBkg1KZXSGjbJdVJXk";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
  const { data, error } = await supabase
    .from("scraps")
    .select("*")
    .limit(1);

  if (error) {
    console.error("Error:", error);
    return;
  }
  
  if (data.length > 0) {
    console.log("scraps 테이블 컬럼들 전체:", data[0]);
  } else {
    console.log("테이블이 비어있음");
  }
}

checkSchema();
