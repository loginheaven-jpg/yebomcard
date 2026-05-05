import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://iityjmjgnjtvqujpivjg.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpdHlqbWpnbmp0dnF1anBpdmpnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjY5MDkyOCwiZXhwIjoyMDgyMjY2OTI4fQ.P7zoXy1eje-V8RU6xkwhKDHWkxBkg1KZXSGjbJdVJXk";

const supabase = createClient(supabaseUrl, supabaseKey);

async function getRpc() {
  // pg_proc 쿼리는 REST API로 노출되지 않았을 수 있으므로 RPC를 통해 조회 시도
  // 또는 정보 스키마 조회
  // Supabase REST API는 pg_catalog를 노출하지 않을 확률이 큼.
  // 대신 일반적인 SQL로 확인해야함.
}

getRpc();
