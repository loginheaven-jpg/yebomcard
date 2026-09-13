"use client";

/**
 * 음원 생성 현황 — PC 여러 대가 며칠씩 도는 일을 한 화면에서 본다.
 *
 * 각 PC 는 10초마다 자기 상태를 서버에 올린다(`voice/fleet.py`). 여기서는 그것을 모아 보여주고,
 * 지시를 걸고, 책 배분을 사람이 고친다 — **자동으로 나누되 최종 결정권은 사람에게** 둔다.
 * 지시는 즉시 반영되지 않는다(각 PC 가 10초 안에 가져간다) — 그래서 결과 줄을 함께 보여준다.
 */

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { isAdmin } from "@/lib/admin";

interface BookProgress {
  book: string;
  total: number;
  done: number;
  held: number;
  uploaded: number;
}
interface Pc {
  tokenId: string;
  label: string;
  host: string;
  gpu: string;
  codeVersion: string;
  voice: string;
  voiceKey: string;
  running: boolean;
  stale: boolean;
  note: string;
  jobTitle: string;
  batch: number;
  versesPerHour: number;
  queued: number;
  pending: number;
  okTotal: number;
  heldTotal: number;
  uploadedTotal: number;
  books: BookProgress[];
  leases: string[];
  lastError: string;
  at: string;
}
interface Lease {
  plan: string;
  book: string;
  tokenId: string;
  label: string;
  pcLabel: string;
  pinned: boolean;
  blocked: boolean;
  live: boolean;
  state: "taken" | "done";
  at: string;
}
interface Command {
  id: string;
  target: string;
  op: string;
  by: string;
  createdAt: string;
  status: string;
  result: string;
}
interface Total {
  pcs: number;
  livePcs: number;
  running: number;
  pending: number;
  ok: number;
  held: number;
  uploaded: number;
  versesPerHour: number;
  booksDone: number;
  booksTaken: number;
}

const REFRESH_MS = 10_000;

function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "?";
  const s = (Date.now() - t) / 1000;
  if (s < 90) return `${Math.round(s)}초 전`;
  if (s < 5400) return `${Math.round(s / 60)}분 전`;
  if (s < 172800) return `${(s / 3600).toFixed(1)}시간 전`;
  return `${Math.round(s / 86400)}일 전`;
}

/** 남은 절과 지금 속도로 언제 끝나는지 — 속도가 0이면 알 수 없다 */
function eta(pending: number, perHour: number): string {
  if (!pending) return "—";
  if (!perHour) return "속도 측정 중";
  const h = pending / perHour;
  if (h < 1) return `약 ${Math.round(h * 60)}분`;
  if (h < 48) return `약 ${h.toFixed(1)}시간`;
  return `약 ${(h / 24).toFixed(1)}일`;
}

export default function VoiceFleetPage() {
  const { session, loading } = useSession();
  const admin = isAdmin(session);

  const [total, setTotal] = useState<Total | null>(null);
  const [pcs, setPcs] = useState<Pc[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, l] = await Promise.all([
        fetch("/api/voice-studio/fleet").then((r) => r.json()),
        fetch("/api/voice-studio/lease").then((r) => r.json()),
      ]);
      if (f?.total) setTotal(f.total);
      if (Array.isArray(f?.pcs)) setPcs(f.pcs);
      if (Array.isArray(l?.leases)) setLeases(l.leases);
    } catch {
      /* 잠깐 안 되는 것은 다음 차례에 다시 본다 */
    }
  }, []);

  const loadLog = useCallback(async () => {
    try {
      const r = await fetch("/api/voice-studio/commands").then((x) => x.json());
      if (Array.isArray(r?.commands)) setCommands(r.commands.slice(0, 30));
    } catch {
      /* 무시 */
    }
  }, []);

  useEffect(() => {
    if (!admin) return;
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [admin, load]);

  useEffect(() => {
    if (!admin || !showLog) return;
    loadLog();
    const t = setInterval(loadLog, REFRESH_MS);
    return () => clearInterval(t);
  }, [admin, showLog, loadLog]);

  const send = useCallback(
    async (op: string, target: string, args: Record<string, unknown> = {}) => {
      setBusy(true);
      try {
        const r = await fetch("/api/voice-studio/commands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op, target, args }),
        });
        const d = await r.json();
        setMsg(d.ok ? "지시를 걸었습니다 — 각 PC 가 10초 안에 가져갑니다." : d.error || "실패");
        if (d.ok) setShowLog(true);
      } catch {
        setMsg("지시를 걸지 못했습니다");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const leaseAction = useCallback(
    async (book: string, plan: string, action: string, tokenId?: string) => {
      setBusy(true);
      try {
        const r = await fetch("/api/voice-studio/lease", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ book, plan, action, tokenId }),
        });
        const d = await r.json();
        setMsg(d.ok ? `${book} — ${action} 했습니다` : d.error || "실패");
        await load();
      } catch {
        setMsg("바꾸지 못했습니다");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (loading) return <main className="p-6 text-sm text-[var(--ink-faint)]">불러오는 중…</main>;
  if (!admin) {
    return (
      <main className="p-6">
        <p className="text-sm text-[var(--ink-soft)]">관리자만 볼 수 있습니다.</p>
        <a href="/" className="text-sm underline">
          돌아가기
        </a>
      </main>
    );
  }

  const taken = leases.filter((l) => l.state === "taken");
  const done = leases.filter((l) => l.state === "done");

  return (
    <main className="max-w-4xl mx-auto px-4 py-5 pb-24">
      <header className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-lg font-bold">음원 생성 현황</h1>
        <a href="/" className="text-sm text-[var(--ink-faint)] underline">
          닫기
        </a>
      </header>

      {total && (
        <section className="rounded-xl border border-[var(--line)] p-3 mb-4 text-sm">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="살아 있는 PC" value={`${total.livePcs}/${total.pcs}`} />
            <Stat label="시간당" value={`${total.versesPerHour.toLocaleString()}절`} />
            <Stat label="남은 절" value={total.pending.toLocaleString()} />
            <Stat label="끝날 때까지" value={eta(total.pending, total.versesPerHour)} />
            <Stat label="합격 누계" value={total.ok.toLocaleString()} />
            <Stat label="업로드" value={total.uploaded.toLocaleString()} />
            <Stat label="보류" value={total.held.toLocaleString()} />
            <Stat label="책" value={`끝남 ${total.booksDone} · 맡은 중 ${total.booksTaken}`} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn onClick={() => send("stop", "*")} disabled={busy} tone="stop">
              모두 멈춤
            </Btn>
            <Btn onClick={() => send("resume", "*")} disabled={busy}>
              모두 다시 켬
            </Btn>
            <Btn onClick={() => setShowLog((v) => !v)} disabled={busy}>
              {showLog ? "지시 기록 접기" : "지시 기록"}
            </Btn>
          </div>
          {msg && <p className="mt-2 text-xs text-[var(--ink-faint)]">{msg}</p>}
        </section>
      )}

      {showLog && (
        <section className="rounded-xl border border-[var(--line)] p-3 mb-4 text-xs">
          <h2 className="font-semibold mb-2 text-sm">지시 기록</h2>
          {commands.length === 0 && <p className="text-[var(--ink-faint)]">아직 없습니다.</p>}
          {commands.map((c) => (
            <div key={c.id} className="flex gap-2 py-0.5 border-b border-[var(--line)] last:border-0">
              <span className="text-[var(--ink-faint)] w-20 shrink-0">{ago(c.createdAt)}</span>
              <span className="font-medium w-24 shrink-0">{c.op}</span>
              <span className="w-16 shrink-0">{c.status}</span>
              <span className="text-[var(--ink-faint)] truncate">{c.result}</span>
            </div>
          ))}
        </section>
      )}

      <h2 className="text-sm font-semibold mb-2">생성 PC</h2>
      {pcs.length === 0 && (
        <p className="text-sm text-[var(--ink-faint)] mb-4">
          아직 보고한 PC 가 없습니다. 생성 PC 에서 스튜디오를 켜면 10초 안에 나타납니다.
        </p>
      )}
      <div className="space-y-3 mb-5">
        {pcs.map((p) => (
          <article key={p.tokenId} className="rounded-xl border border-[var(--line)] p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  p.stale ? "bg-gray-400" : p.running ? "bg-green-500" : "bg-amber-500"
                }`}
                aria-hidden
              />
              <strong className="text-sm">{p.label}</strong>
              <span className="text-xs text-[var(--ink-faint)]">
                {p.stale ? `응답 없음 · ${ago(p.at)}` : p.running ? "가동중" : "정지"}
              </span>
              <span className="text-xs text-[var(--ink-faint)] ml-auto">
                {p.voice || "보이스 없음"}
                {p.voiceKey ? ` (${p.voiceKey})` : ""} · 배치 {p.batch || "—"} ·{" "}
                {p.versesPerHour.toLocaleString()}절/시간
              </span>
            </div>
            <p className="mt-1.5 text-sm">{p.note || (p.jobTitle ? p.jobTitle : "쉬는 중")}</p>
            <p className="text-xs text-[var(--ink-faint)]">
              남은 절 {p.pending.toLocaleString()} · 대기 작업 {p.queued} · 보류 {p.heldTotal} ·
              업로드 {p.uploadedTotal.toLocaleString()} · {p.gpu}
            </p>
            {p.leases.length > 0 && (
              <p className="text-xs text-[var(--ink-faint)]">맡은 책: {p.leases.join(", ")}</p>
            )}
            {p.lastError && <p className="text-xs text-red-600 mt-1">! {p.lastError}</p>}
            {p.books.slice(0, 6).map((b) => (
              <div key={b.book} className="mt-1.5">
                <div className="flex justify-between text-xs">
                  <span>{b.book}</span>
                  <span className="text-[var(--ink-faint)]">
                    {b.done}/{b.total} · 보류 {b.held}
                  </span>
                </div>
                <div className="h-1.5 rounded bg-[var(--line)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--amber-600,#b45309)]"
                    style={{ width: `${Math.min(100, (100 * b.done) / Math.max(1, b.total))}%` }}
                  />
                </div>
              </div>
            ))}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Btn onClick={() => send("stop", p.tokenId)} disabled={busy} tone="stop">
                멈춤
              </Btn>
              <Btn onClick={() => send("resume", p.tokenId)} disabled={busy}>
                다시 켬
              </Btn>
              {[4, 8].map((n) => (
                <Btn key={n} onClick={() => send("set_batch", p.tokenId, { batch: n })} disabled={busy}>
                  배치 {n}
                </Btn>
              ))}
            </div>
          </article>
        ))}
      </div>

      <h2 className="text-sm font-semibold mb-1">책 배분</h2>
      <p className="text-xs text-[var(--ink-faint)] mb-2">
        진도표 순서로 PC 가 알아서 빌려 갑니다. <strong>고정</strong>하면 그 PC 가 계속 맡고(꺼져도
        풀리지 않음), <strong>차단</strong>하면 아무도 가져가지 않습니다. <strong>회수</strong>는 지금
        임대를 풀어 다른 PC 가 가져가게 합니다.
      </p>
      {taken.length === 0 && done.length === 0 && (
        <p className="text-sm text-[var(--ink-faint)]">아직 배분된 책이 없습니다.</p>
      )}
      <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)] text-sm">
        {[...taken, ...done].map((l) => (
          <div key={`${l.plan}/${l.book}`} className="flex items-center gap-2 px-3 py-1.5 flex-wrap">
            <span className="font-medium w-20">{l.book}</span>
            <span className="text-xs w-14 text-[var(--ink-faint)]">
              {l.state === "done" ? "끝남" : "맡은 중"}
            </span>
            <span className="text-xs w-28 truncate">{l.pcLabel || l.label || "—"}</span>
            {l.pinned && <Tag>고정</Tag>}
            {l.blocked && <Tag>차단</Tag>}
            {!l.live && !l.blocked && <Tag>임대 끊김</Tag>}
            <span className="ml-auto flex gap-1.5">
              {l.pinned ? (
                <Btn onClick={() => leaseAction(l.book, l.plan, "unpin")} disabled={busy}>
                  고정 해제
                </Btn>
              ) : (
                l.tokenId && (
                  <Btn
                    onClick={() => leaseAction(l.book, l.plan, "pin", l.tokenId)}
                    disabled={busy}
                  >
                    고정
                  </Btn>
                )
              )}
              <Btn
                onClick={() => leaseAction(l.book, l.plan, l.blocked ? "unblock" : "block")}
                disabled={busy}
              >
                {l.blocked ? "차단 해제" : "차단"}
              </Btn>
              <Btn onClick={() => leaseAction(l.book, l.plan, "release")} disabled={busy} tone="stop">
                회수
              </Btn>
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-[var(--ink-faint)]">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--line)] text-[var(--ink-soft)]">
      {children}
    </span>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "stop";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2.5 py-1 rounded-lg text-xs font-medium border disabled:opacity-50 ${
        tone === "stop"
          ? "border-red-300 text-red-700 dark:text-red-400"
          : "border-[var(--line)] text-[var(--ink-soft)]"
      }`}
    >
      {children}
    </button>
  );
}
