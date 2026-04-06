import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: 커뮤니티 스크랩 (중복 많은순 > 최신순)
export async function GET() {
  let currentUserId = "";
  try {
    const cookieStore = await cookies();
    const sealed = cookieStore.get(sessionOptions.cookieName);
    if (sealed) {
      const session = await unsealData<SessionData>(sealed.value, {
        password: sessionOptions.password,
      });
      if (session?.isLoggedIn) currentUserId = session.user_id;
    }
  } catch {
    // 비로그인도 커뮤니티 스크랩 조회 가능
  }

  // 중복 많은순 > 최신순 집계 쿼리
  const { data, error } = await supabase.rpc("get_community_scraps", {
    p_exclude_user_id: currentUserId || "__none__",
  });

  if (error) {
    // RPC 없으면 직접 쿼리 fallback
    const { data: fallback } = await supabase
      .from("scraps")
      .select("*")
      .neq("user_id", currentUserId || "__none__")
      .order("created_at", { ascending: false })
      .limit(50);

    return NextResponse.json({ scraps: fallback || [] });
  }

  return NextResponse.json({ scraps: data || [] });
}
