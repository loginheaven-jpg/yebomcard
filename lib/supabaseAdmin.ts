import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 서버사이드 전용 Supabase 클라이언트 (service_role key)
 * Lazy 초기화 — 빌드 시점(page data 수집)에 env var 없어도 에러 안 남
 */
let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("Supabase 환경변수가 설정되지 않았습니다 (SUPABASE_SERVICE_ROLE_KEY)");
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

// Proxy로 모든 호출을 lazy하게 전달
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop: keyof SupabaseClient) {
    const c = getClient();
    const value = c[prop];
    return typeof value === "function" ? value.bind(c) : value;
  },
});
