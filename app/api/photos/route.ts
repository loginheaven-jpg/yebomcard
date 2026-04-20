import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const BUCKET = "user-photos";

async function getSession(): Promise<SessionData | null> {
  try {
    const cookieStore = await cookies();
    const sealed = cookieStore.get(sessionOptions.cookieName);
    if (!sealed) return null;
    const session = await unsealData<SessionData>(sealed.value, {
      password: sessionOptions.password,
    });
    return session?.isLoggedIn ? session : null;
  } catch {
    return null;
  }
}

// GET /api/photos — 사용자의 업로드 사진 목록
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ photos: [] });

  const { data, error } = await supabaseAdmin
    .from("user_photos")
    .select("id, public_url, size_bytes, created_at")
    .eq("user_id", session.user_id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ photos: data || [] });
}

// POST /api/photos — 업로드 (multipart/form-data, field: file)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "5MB 이하만 업로드 가능합니다" }, { status: 400 });
  }

  // 확장자 결정
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const uuid = crypto.randomUUID();
  const storagePath = `${session.user_id}/${uuid}.${ext}`;

  // Storage 업로드
  const bytes = await file.arrayBuffer();
  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  // public URL 가져오기
  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = urlData.publicUrl;

  // 메타데이터 저장
  const { data: row, error: insertError } = await supabaseAdmin
    .from("user_photos")
    .insert({
      user_id: session.user_id,
      storage_path: storagePath,
      public_url: publicUrl,
      size_bytes: file.size,
    })
    .select("id, public_url, size_bytes, created_at")
    .single();

  if (insertError) {
    // 롤백: 파일 삭제
    await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ photo: row });
}

// DELETE /api/photos?id=xxx — 삭제
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id가 필요합니다" }, { status: 400 });

  // 본인 사진인지 확인 + storage_path 조회
  const { data: row, error: selectError } = await supabaseAdmin
    .from("user_photos")
    .select("storage_path, user_id")
    .eq("id", id)
    .single();
  if (selectError || !row) return NextResponse.json({ error: "사진을 찾을 수 없습니다" }, { status: 404 });
  if (row.user_id !== session.user_id) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }

  // Storage 삭제
  await supabaseAdmin.storage.from(BUCKET).remove([row.storage_path]);
  // 메타 삭제
  await supabaseAdmin.from("user_photos").delete().eq("id", id);

  return NextResponse.json({ ok: true });
}
