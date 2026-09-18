/**
 * 설교 들여오기 — 날마다 한 번 (docs/BIBLE_QA_SERMONS.md §4)
 *
 * **주 1회가 아니라 하루 1회다.** 설교 .txt 가 올라오는 요일이 월·화·수로 흩어져 있어
 * (2026-09-18 확인), 주 1회로 못 박으면 늦게 올라온 주는 꼬박 한 주를 기다린다.
 * 드라이브 목록 조회는 하루 한 번이면 값이 없다.
 *
 * 질문 응답 속도와는 **상관이 없다** — Vercel 은 라우트마다 별개 함수로 내고,
 * cron 은 이 라우트의 평범한 호출 한 번이다. `/api/bible-qa` 의 길에 끼어들지 않는다.
 *
 * 누가 아무 때나 부르지 못하게 `CRON_SECRET` 으로 막는다. 수퍼어드민은 손으로도 돌릴 수 있다 —
 * 주일 저녁에 기다리지 않도록.
 */
import { NextRequest, NextResponse } from "next/server";
import { ingestSermons } from "@/lib/sermons/ingest";
import { requireFreshAdmin } from "@/lib/auth/verifySession";
import { isSuperAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** 50편을 처음 들여올 때는 파일마다 내려받기+파싱이 붙는다. 넉넉히 둔다. */
export const maxDuration = 300;

/**
 * Vercel cron 은 `Authorization: Bearer $CRON_SECRET` 을 실어 보낸다.
 * `CRON_SECRET` 이 없으면 **수퍼어드민만** 부를 수 있게 해 둔다 —
 * 아무나 부를 수 있게 열어 두는 것보다 낫다(들여오기는 멱등이지만 드라이브를 긁는다).
 */
async function allowed(request: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth === `Bearer ${secret}`) return true;
  }
  const gate = await requireFreshAdmin();
  return gate.ok && isSuperAdmin(gate.session);
}

export async function GET(request: NextRequest) {
  if (!(await allowed(request))) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "1";
  const trigger = request.headers.get("authorization") ? "cron" : "manual";

  const result = await ingestSermons({ trigger, force });
  // 실패가 있어도 200 으로 돌려준다 — cron 이 재시도해도 같은 파일에서 또 멈춘다.
  // 대신 결과에 그대로 담아 관리자 화면에서 보이게 한다.
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
