/**
 * GET /api/voice-studio/held/tasks — 이 PC 가 다시 만들어야 할 절 (기기 토큰).
 *
 * 관리자가 "재생성 요청"을 누르면 여기 나타난다. 생성 PC 는 작업 도중 주기적으로
 * 확인해 해당 절을 다시 만든다 — 관리자가 PC 앞에 갈 필요가 없다.
 *
 * 재생성에 성공하면 그 절은 그 PC 의 보류 목록에서 빠지고 자동 업로드된다.
 *
 * decided — '이대로 사용'·'비워 둠' 판단. PC 가 다시 만들 일은 없지만, 알려 줘야 PC 의 작업
 * 파일에서 '이대로 사용' 절이 보류로 남지 않는다(생성 탭 보류 숫자가 관리자 화면과 어긋났다).
 */

import { NextResponse } from "next/server";
import { requireDevice } from "@/lib/voiceStudio/auth";
import { studioList, studioGetJson } from "@/lib/voiceStudio/r2";
import { actionIsCurrent, type HeldItem, type HeldAction } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HELD = "voice-studio/held/";
const ACTIONS = "voice-studio/held-actions/";

export async function GET(req: Request) {
  const gate = await requireDevice(req);
  if (!gate.ok) return gate.res;

  const device = gate.claims.id;
  const index = await studioGetJson<{ items?: HeldItem[] }>(`${HELD}${device}/index.json`);
  const mine = index?.items || [];
  if (mine.length === 0) return NextResponse.json({ regenerate: [], decided: [] });

  const actionKeys = await studioList(ACTIONS);
  const wanted = new Set(
    actionKeys
      .map((k) => k.key.slice(ACTIONS.length).replace(/\.json$/, ""))
      .filter(Boolean),
  );

  const regenerate: { id: string; ref: string; text: string }[] = [];
  const decided: { id: string; ref: string; text: string; action: "use" | "discard" }[] = [];
  for (const it of mine) {
    if (!wanted.has(it.id)) continue;
    const a = await studioGetJson<HeldAction>(`${ACTIONS}${it.id}.json`);
    // 판단 뒤에 다시 만들어 음원이 바뀌었으면 옛 음원에 대한 판단이다 — PC 에 주지 않는다
    if (!actionIsCurrent(a ?? undefined, it)) continue;
    if (a?.action === "regen") regenerate.push({ id: it.id, ref: it.ref, text: it.text });
    else if (a?.action === "use" || a?.action === "discard") {
      decided.push({ id: it.id, ref: it.ref, text: it.text, action: a.action });
    }
  }

  return NextResponse.json({ regenerate, decided }, { headers: { "Cache-Control": "no-store" } });
}
