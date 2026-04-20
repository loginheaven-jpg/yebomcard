import { createClient } from "@supabase/supabase-js";

/**
 * 서버사이드 전용 Supabase 클라이언트 (service_role key)
 * API Route에서만 사용. 절대 클라이언트로 노출 금지.
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
