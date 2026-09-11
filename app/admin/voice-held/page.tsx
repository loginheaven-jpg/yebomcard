"use client";

/**
 * 보류 절 검수 — 여러 PC 가 만든 문제 절을 한 곳에서 듣고 판단한다.
 *
 * 검수(탐지)는 자동이지만 판단은 자동화되지 않는다. "욥이 대답하였다"가 71% 로
 * 떨어진 건 ASR 이 "요비"로 들은 오탐이고, 욥기 39:8 의 67% 는 어순이 뒤바뀐
 * 진짜 오류다. 원문·ASR 을 나란히 보고, 애매하면 들어 보고 정한다.
 */

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { isAdmin } from "@/lib/admin";

interface HeldItem {
  id: string;
  voiceKey: string;
  voice: string;
  ref: string;
  book: string;
  text: string;
  asr: string;
  ratio: number;
  reason: string;
  audioSec: number;
  tries: number;
  device: string;
  reportedAt: string;
  hasAudio: boolean;
  /** "ns1" 이면 새 방식. 비었거나 없으면 구방식 음원(옛 PC 코드의 보고도 여기에 든다) */
  method?: string;
}
interface HeldAction {
  id: string;
  action: "use" | "regen" | "discard";
  by: string;
  at: string;
}

/** 본문에 주석 조각(짝 없는 괄호)이 남아 **만들지 않은** 보류인가 — 이것만 '본문을 고쳐야' 한다 */
const isNoteResidue = (it: HeldItem) => /주석 잔재/.test(it.reason || "");
/**
 * 구방식(2026-09-10 이전, 절 끝이 잘림) 음원인가. 이런 음원을 '이대로 사용'하면 지금 시각으로 서버에 올라가
 * 새 방식 파일로 분류되고, 나중의 구방식 교체에서 빠져 잘린 끝이 영영 남는다 — 재생성만 허용한다.
 */
const isOldMethod = (it: HeldItem) => it.method !== "ns1";
/**
 * 판단한 음원의 지문 — 서버가 판단 기록에 남기고, 그 절을 다시 만들어 지문이 바뀌면 판단을 버린다
 * (held/route.ts · held/tasks). 옛 음원에 한 '이대로 사용'이 새 음원에 적용되는 일을 막는다.
 */
const decisionFp = (it: HeldItem) => `${it.audioSec}|${it.asr}`;

/** 앱에서 들어온 음원 다시 만들기 요청 (lib/voiceStudio/verseRegen.ts) */
interface RegenReq {
  id: string;
  ref: string;
  reason: string;
  by: string;
  at: string;
  status: "pending" | "claimed" | "done" | "held";
  doneAt?: string;
  detail?: string;
}
const REGEN_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "대기", cls: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  claimed: { label: "만드는 중", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  done: { label: "완료", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  held: { label: "보류", cls: "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400" },
};

const ACTION_LABEL: Record<string, string> = {
  use: "이대로 사용",
  regen: "재생성 요청",
  discard: "비워 둠",
};

export default function VoiceHeldPage() {
  const { session, loading } = useSession();
  const admin = isAdmin(session);
  const [items, setItems] = useState<HeldItem[]>([]);
  const [actions, setActions] = useState<Record<string, HeldAction>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [showDone, setShowDone] = useState(false);
  /** 본문이 정정되어 볼 필요가 없어진 보류 수 — 목록이 왜 줄었는지 알려준다 */
  const [stale, setStale] = useState(0);
  const [regenReqs, setRegenReqs] = useState<RegenReq[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/voice-studio/held");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "불러오기 실패");
      const d = await res.json();
      setItems(d.items || []);
      setActions(d.actions || {});
      setStale(d.stale || 0);
      const r2 = await fetch("/api/voice-studio/verse-regen").catch(() => null);
      if (r2?.ok) setRegenReqs(((await r2.json()).items || []) as RegenReq[]);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (admin) load();
  }, [admin, load]);

  async function act(it: HeldItem, action: "use" | "regen" | "discard") {
    setBusy(it.id);
    setError("");
    try {
      const res = await fetch("/api/voice-studio/held/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: it.id,
          action,
          voiceKey: it.voiceKey,
          text: it.text,
          device: it.device,
          fp: decisionFp(it),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "처리 실패");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
    } finally {
      setBusy("");
    }
  }

  async function undo(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/voice-studio/held/action?id=${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy("");
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">확인 중…</div>;
  if (!admin)
    return <div className="p-6 text-sm text-red-600">관리자(운영자·수퍼어드민) 전용 페이지입니다.</div>;

  const pending = items.filter((i) => !actions[i.id]);
  const done = items.filter((i) => actions[i.id]);
  const shown = showDone ? done : pending;

  return (
    <div className="max-w-2xl mx-auto p-4 pb-24">
      <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">보류 절 검수</h1>
      <p className="text-xs text-gray-400 mb-4 leading-relaxed">
        생성 PC 들이 검수에서 걸러낸 절입니다. <b>여기 있는 절은 예봄성경에 올라가지 않았습니다</b> —
        판단하실 때까지 그 절만 다른 목소리로 읽힙니다.
      </p>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setShowDone(false)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border ${
            !showDone
              ? "bg-[var(--amber)] text-white border-transparent"
              : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700"
          }`}
        >
          판단 대기 {pending.length}
        </button>
        <button
          onClick={() => setShowDone(true)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border ${
            showDone
              ? "bg-[var(--amber)] text-white border-transparent"
              : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700"
          }`}
        >
          처리됨 {done.length}
        </button>
        <button
          onClick={load}
          className="ml-auto px-3 py-1.5 text-xs rounded-lg border bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700"
        >
          새로고침
        </button>
      </div>

      {stale > 0 && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
          본문이 정정되어 볼 필요가 없어진 보류 <b>{stale}건</b>은 목록에서 감췄습니다.
          그 절들은 정정된 본문으로 다시 만들어집니다.
        </p>
      )}

      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

      {!loaded ? (
        <div className="text-sm text-gray-500">불러오는 중…</div>
      ) : shown.length === 0 ? (
        <div className="text-sm text-gray-500">
          {showDone ? "처리된 항목이 없습니다." : "판단할 절이 없습니다. 전부 정상입니다."}
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map((it) => {
            const a = actions[it.id];
            const cps = it.audioSec > 0 ? it.text.length / it.audioSec : 0;
            return (
              <li
                key={it.id}
                className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-white dark:bg-gray-800"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-400 mb-2">
                  <span className="font-bold text-gray-800 dark:text-gray-200">{it.ref}</span>
                  <span>· {it.voice}</span>
                  <span>· {it.audioSec.toFixed(1)}초</span>
                  <span className={cps > 14 ? "text-red-600 font-semibold" : ""}>
                    · {cps.toFixed(1)}자/초
                  </span>
                  {it.hasAudio && isOldMethod(it) && (
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-semibold">
                      구방식 음원
                    </span>
                  )}
                  <span className="ml-auto font-semibold text-amber-600 dark:text-amber-400">
                    {(it.ratio * 100).toFixed(0)}%
                  </span>
                </div>

                <div className="text-[11px] text-gray-400 mb-0.5">원문</div>
                <p className="text-sm text-gray-900 dark:text-gray-100 mb-2 break-words">{it.text}</p>
                <div className="text-[11px] text-gray-400 mb-0.5">받아쓴 것 (ASR)</div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2 break-words">
                  {it.asr || <span className="italic">(없음)</span>}
                </p>
                <div className="text-[11px] text-gray-400 mb-2">사유: {it.reason}</div>

                {/* 음원이 없는 이유는 둘이다. 주석 잔재라 만들지 않았거나, 만들었는데 아직 서버에 안 올라왔거나.
                    예전엔 둘 다 '괄호' 안내를 띄워서, 받아쓰기 불일치 보류까지 본문 문제로 보였다(욥 39:8). */}
                {!it.hasAudio && !isNoteResidue(it) && (
                  <div className="mb-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                      <b>음원이 아직 서버에 없어 들어볼 수 없습니다.</b> 만든 PC 가 다음 보고 때 올립니다(30분 안).
                      <br />
                      기다리지 않으려면 <b>재생성 요청</b> — 그 PC 가 새로 만들어 검수를 다시 거칩니다.
                    </p>
                  </div>
                )}

                {!it.hasAudio && isNoteResidue(it) && (
                  <div className="mb-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
                    <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                      <b>음원이 없습니다 — 본문을 고쳐야 합니다.</b>
                      <br />
                      본문에 짝이 맞지 않는 괄호가 남아 있어 <b>생성하지 않았습니다</b>. 그대로 만들면
                      주석 조각을 소리 내어 읽습니다. 들어볼 것이 없으므로 판단이 아니라{" "}
                      <b>본문 수정</b>이 필요합니다.
                      <br />
                      본문을 고치면 키가 바뀌어 다음 생성 때 자동으로 만들어집니다 —
                      여기서 누를 것은 없습니다.
                    </p>
                  </div>
                )}

                {it.hasAudio && isOldMethod(it) && (
                  <div className="mb-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                    <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                      <b>옛 방식으로 만든 음원입니다</b> — 절 끝(나눠 만든 경우 문장 끝마다)이 짧게 잘립니다.
                      내용이 맞아도 <b>재생성 요청</b>으로 새 방식으로 다시 만들어 주세요. 이대로 쓰면 나중에 교체되지 않습니다.
                    </p>
                  </div>
                )}

                {it.hasAudio && (
                  <audio
                    controls
                    preload="none"
                    className="w-full h-9 mb-2"
                    src={`/api/voice-studio/held/audio?id=${it.id}&device=${it.device}`}
                  />
                )}

                {a ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                      {ACTION_LABEL[a.action]}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {a.by} · {new Date(a.at).toLocaleString("ko-KR")}
                    </span>
                    <button
                      disabled={busy === it.id}
                      onClick={() => undo(it.id)}
                      className="ml-auto px-2.5 py-1 text-[11px] rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 disabled:opacity-50"
                    >
                      되돌리기
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={busy === it.id || !it.hasAudio || isOldMethod(it)}
                      onClick={() => act(it, "use")}
                      title={
                        !it.hasAudio
                          ? "들어볼 음원이 아직 없습니다"
                          : isOldMethod(it)
                            ? "옛 방식 음원은 이대로 쓸 수 없습니다 — 재생성 요청"
                            : ""
                      }
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                    >
                      이대로 사용
                    </button>
                    <button
                      disabled={busy === it.id || isNoteResidue(it)}
                      onClick={() => act(it, "regen")}
                      title={isNoteResidue(it) ? "본문을 고치면 자동으로 다시 만들어집니다" : ""}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--amber)] text-white hover:brightness-95 disabled:opacity-40"
                    >
                      재생성 요청
                    </button>
                    <button
                      disabled={busy === it.id}
                      onClick={() => act(it, "discard")}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:brightness-95 disabled:opacity-50"
                    >
                      비워 둠
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {regenReqs.length > 0 && (
        <section className="mt-6">
          {/* 할 일 목록이 아니라 요청 기록이다 — 완료는 흐리게(이미 새 음원으로 바뀜) */}
          <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">음원 다시 만들기 기록</h2>
          <ul className="space-y-1.5">
            {regenReqs.slice(0, 30).map((r) => (
              <li
                key={r.id}
                className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 ${
                  r.status === "done" ? "opacity-60" : ""
                }`}
              >
                <span className="font-semibold text-gray-800 dark:text-gray-200">{r.ref}</span>
                <span className="text-gray-400">{r.reason}</span>
                <span className="ml-auto text-[11px] text-gray-400">
                  {new Date(r.doneAt || r.at).toLocaleString("ko-KR", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className={`px-1.5 py-0.5 rounded font-semibold ${REGEN_BADGE[r.status]?.cls || ""}`}>
                  {REGEN_BADGE[r.status]?.label || r.status}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-gray-400 leading-relaxed">
            본문에서 절을 골라 ‘음원 다시 만들기’를 누르거나 새번역 본문을 고치면 생깁니다. 생성 PC 가 10분 안에
            가져가 새로 만들어 기존 음원을 바꾸고, 받아쓰기에 떨어지면 위 보류 목록으로 옵니다.
            ‘완료’는 이미 새 음원으로 바뀐 기록이라 따로 할 일이 없습니다.
          </p>
        </section>
      )}

      <section className="mt-6 text-[11px] text-gray-400 leading-relaxed border-t border-gray-200 dark:border-gray-700 pt-3">
        <p className="mb-1">
          <b>이대로 사용</b> — 들어보니 멀쩡한 경우(새 방식 음원만). 서버가 보관 중인 음원을 바로 올립니다.
          생성 PC 가 꺼져 있어도 즉시 반영됩니다.
        </p>
        <p className="mb-1">
          <b>재생성 요청</b> — 진짜 오류인 경우. 그 절을 만든 PC 가 작업 중에 가져가 다시 만듭니다.
        </p>
        <p>
          <b>비워 둠</b> — 그대로 둡니다. 그 절만 다른 목소리(Chirp 여성)로 읽힙니다.
        </p>
      </section>
    </div>
  );
}
