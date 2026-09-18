/**
 * 성경 질문 — 말로 묻기 (음성 → 글)
 *
 * 글을 잘 못 쓰시는 어르신도 물을 수 있어야 한다. 녹음을 게이트웨이의 STT 로 보내
 * 글로 바꿔 입력창에 넣어 준다 — **바로 질문으로 보내지 않는다.** 잘못 들었을 때
 * 교인이 고칠 수 있어야 하고, 무엇이 외부로 나가는지 눈으로 보고 누를 수 있어야 한다(§B-7).
 *
 * 게이트웨이 계약(2026-09-18 실측):
 *  - `POST /api/ai/stt` 은 **multipart/form-data** 다(base64 아님). 필드 `file`(필수) · `language` · `provider` · `caller`
 *  - **10MB 하드캡** — 넘으면 provider 를 부르기 전에 400 `FILE_TOO_LARGE`
 *    (가이드의 'whisper 최대 25MB' 는 틀렸다)
 *  - 브라우저 녹음(webm)은 **whisper 만** 받는다. CLOVA 로 보내면 포맷 때문에 실패한다
 *  - 오류 응답은 Chat 과 달리 `{error, code}` 다
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** 게이트웨이 왕복이 녹음 길이에 따라 길어진다. 기본 상한(10~15초)으로는 모자란다. */
export const maxDuration = 60;

const AI_GATEWAY_URL =
  process.env.AI_GATEWAY_URL || "https://ai-gateway20251125.up.railway.app";

/** 게이트웨이의 하드캡과 같은 값. 여기서 먼저 막아 헛왕복을 없앤다. */
const MAX_BYTES = 10 * 1024 * 1024;

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

export async function POST(request: NextRequest) {
  // 음성은 글보다 비싸다. 질문 상한보다 조금 더 조인다.
  const limited = rateLimit(request, "bible-qa-stt", 30, 10 * 60_000);
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  }

  const inForm = await request.formData().catch(() => null);
  const file = inForm?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "녹음이 비어 있습니다" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "녹음이 너무 깁니다. 조금 짧게 말씀해 주세요." },
      { status: 400 },
    );
  }

  const outForm = new FormData();
  outForm.append("file", file, file.name || "question.webm");
  outForm.append("language", "ko");
  // 브라우저 녹음(webm)은 whisper 만 받는다 — 기본값이 whisper 지만 명시해 둔다.
  outForm.append("provider", "whisper");
  outForm.append("caller", "yebom-card:qa-stt");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 45_000);
  try {
    const res = await fetch(`${AI_GATEWAY_URL}/api/ai/stt`, {
      method: "POST",
      body: outForm,
      signal: ac.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 게이트웨이의 code 를 교인에게 그대로 보이지 않는다.
      console.error("[bible-qa/stt] 실패", res.status, JSON.stringify(json).slice(0, 200));
      return NextResponse.json(
        { error: "말씀을 글로 바꾸지 못했습니다. 다시 한 번 말씀해 주세요." },
        { status: 502 },
      );
    }
    const text = typeof json.text === "string" ? json.text.trim() : "";
    if (!text) {
      return NextResponse.json(
        { error: "들리지 않았습니다. 조용한 곳에서 다시 말씀해 주세요." },
        { status: 422 },
      );
    }
    return NextResponse.json({ text, duration_sec: json.duration_sec ?? null });
  } catch (e) {
    const aborted = ac.signal.aborted;
    console.error("[bible-qa/stt] 오류", aborted ? "TIMEOUT" : String(e).slice(0, 200));
    return NextResponse.json(
      { error: aborted ? "시간이 오래 걸렸습니다. 다시 시도해 주세요." : "말씀을 글로 바꾸지 못했습니다." },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
