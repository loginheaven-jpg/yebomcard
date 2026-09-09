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
}
interface HeldAction {
  id: string;
  action: "use" | "regen" | "discard";
  by: string;
  at: string;
}

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

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/voice-studio/held");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "불러오기 실패");
      const d = await res.json();
      setItems(d.items || []);
      setActions(d.actions || {});
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

                {!it.hasAudio && (
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
                      disabled={busy === it.id || !it.hasAudio}
                      onClick={() => act(it, "use")}
                      title={it.hasAudio ? "" : "음원이 없습니다 — 본문을 고쳐야 합니다"}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                    >
                      이대로 사용
                    </button>
                    <button
                      disabled={busy === it.id || !it.hasAudio}
                      onClick={() => act(it, "regen")}
                      title={it.hasAudio ? "" : "본문을 고치면 자동으로 다시 만들어집니다"}
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

      <section className="mt-6 text-[11px] text-gray-400 leading-relaxed border-t border-gray-200 dark:border-gray-700 pt-3">
        <p className="mb-1">
          <b>이대로 사용</b> — 들어보니 멀쩡한 경우. 서버가 보관 중인 음원을 바로 올립니다.
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
