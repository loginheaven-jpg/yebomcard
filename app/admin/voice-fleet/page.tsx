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
  polite: boolean;
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
  takenBy?: string[];
  doneBy?: string[];
  result: string;
}
interface ProgressBook {
  code: string;
  name: string;
  testament: "old" | "new";
  total: number;
  done: number;
  legacy: number;
}
interface Progress {
  voiceKey: string;
  at: string;
  tookMs: number;
  total: number;
  done: number;
  legacy: number;
  books: ProgressBook[];
  cached?: boolean;
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
  const [prog, setProg] = useState<Progress | null>(null);
  const [progBusy, setProgBusy] = useState(false);
  const [showBooks, setShowBooks] = useState(false);

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

  /**
   * 성경 전체 진도를 **누를 때만** 잰다. 셈은 서버가 하므로 생성 PC 는 느려지지 않지만,
   * 본문 3만 절을 훑는 일이라 몇 초가 걸린다 — 실시간으로 되풀이할 일이 아니다.
   */
  const measure = useCallback(async () => {
    setProgBusy(true);
    try {
      const r = await fetch("/api/voice-studio/progress?fresh=1").then((x) => x.json());
      if (r?.error) setMsg(r.error);
      else setProg(r);
    } catch {
      setMsg("진도를 재지 못했습니다");
    } finally {
      setProgBusy(false);
    }
  }, []);

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

  // 살아 있는 PC 들이 서로 다른 코드를 물고 있으면 알려 준다 — 결과물만 봐서는 알 수 없다
  const codes = [...new Set(pcs.filter((p) => !p.stale && p.codeVersion).map((p) => p.codeVersion))];
  const mixedCode = codes.length > 1 ? codes.join(" / ") : "";

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
            <Btn onClick={() => send("restart", "*")} disabled={busy}>
              모두 스튜디오 다시 켜기
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
              <span className="w-20 shrink-0">
                {/* 모든 PC 대상 지시는 몇 대가 받을지 서버가 모르므로 끝나도 pending 으로 남는다 */}
                {c.target === "*"
                  ? `${c.doneBy?.length ?? 0}/${c.takenBy?.length ?? 0}대`
                  : c.status}
              </span>
              <span className="text-[var(--ink-faint)] truncate">{c.result}</span>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-xl border border-[var(--line)] p-3 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold">성경 전체 진도</h2>
          <span className="text-xs text-[var(--ink-faint)]">
            {prog ? `${new Date(prog.at).toLocaleString("ko-KR")} 기준` : "아직 재지 않았습니다"}
          </span>
          <span className="ml-auto flex gap-1.5">
            <Btn onClick={measure} disabled={progBusy}>
              {progBusy ? "재는 중…" : prog ? "다시 재기" : "진도 재기"}
            </Btn>
            {prog && (
              <Btn onClick={() => setShowBooks((v) => !v)}>
                {showBooks ? "책별 접기" : "책별로 보기"}
              </Btn>
            )}
          </span>
        </div>
        {!prog && (
          <p className="mt-1.5 text-xs text-[var(--ink-faint)]">
            누를 때만 그 시점을 잽니다. 셈은 서버가 하므로 생성 PC 속도에는 영향이 없습니다.
          </p>
        )}
        {prog && (
          <>
            <div className="mt-2 flex items-baseline gap-2">
              <strong className="text-lg">
                {Math.round((100 * prog.done) / Math.max(1, prog.total))}%
              </strong>
              <span className="text-sm text-[var(--ink-soft)]">
                {prog.done.toLocaleString()} / {prog.total.toLocaleString()}절
              </span>
              <span className="text-xs text-[var(--ink-faint)] ml-auto">
                남은 절 {(prog.total - prog.done).toLocaleString()}
                {prog.legacy > 0 && ` · 다시 만들 구방식 ${prog.legacy.toLocaleString()}`}
              </span>
            </div>
            <Bar done={prog.done} legacy={prog.legacy} total={prog.total} />
            {showBooks && (
              <div className="mt-3 space-y-1">
                {prog.books.map((b) => (
                  <div key={b.code}>
                    <div className="flex justify-between text-xs">
                      <span>{b.name}</span>
                      <span className="text-[var(--ink-faint)]">
                        {b.done}/{b.total}
                        {b.legacy > 0 && ` · 구방식 ${b.legacy}`}
                      </span>
                    </div>
                    <Bar done={b.done} legacy={b.legacy} total={b.total} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <h2 className="text-sm font-semibold mb-2">생성 PC</h2>
      {mixedCode && (
        <p className="text-xs text-amber-700 dark:text-amber-500 mb-2">
          PC 마다 스튜디오 코드가 다릅니다({mixedCode}). 검수 기준과 재시도 규칙이 코드에 있어,
          한 대만 옛 코드를 물고 있으면 그 PC 의 음원만 다른 규칙으로 만들어집니다 —
          그 PC 의 스튜디오를 껐다 켜면 서버와 맞춰집니다.
        </p>
      )}
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
                {p.versesPerHour.toLocaleString()}절/시간 · 코드 {p.codeVersion || "?"}
                {p.polite ? " · 양보 모드" : ""}
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
            <PcBooks books={p.books} />
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
              <Btn onClick={() => send("restart", p.tokenId)} disabled={busy}>
                다시 켜기
              </Btn>
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

/**
 * 진도 막대 — 만든 절 가운데 **구방식(다시 만들어야 할 것)** 은 옅게 그린다.
 * 둘을 한 색으로 칠하면 100% 로 보이는데 실제로는 절반을 다시 만들어야 하는 상태가 숨는다.
 */
function Bar({ done, legacy, total }: { done: number; legacy: number; total: number }) {
  const pct = (n: number) => `${Math.min(100, (100 * n) / Math.max(1, total))}%`;
  return (
    <div className="h-2 rounded bg-[var(--line)] overflow-hidden flex">
      <div className="h-full bg-emerald-600" style={{ width: pct(done - legacy) }} />
      <div className="h-full bg-emerald-600/35" style={{ width: pct(legacy) }} />
    </div>
  );
}

/**
 * 그 PC 가 맡은 책 — **진행중인 것만 막대로** 보여 주고, 끝난 책과 아직 시작 안 한 책은 이름만 줄지어 둔다.
 *
 * 예전엔 앞에서 여섯 권만 막대로 그렸는데 앞쪽은 대개 이미 끝난 책이라 **다 끝난 것처럼 보였다**
 * (2026-09-13 지휘부 지적 — 실제로는 37권 중 27권이 아직 시작도 안 한 상태였다).
 * 눈길이 가야 할 곳은 지금 움직이는 책이고, 나머지는 이름만 있으면 족하다.
 */
function PcBooks({ books }: { books: BookProgress[] }) {
  if (!books.length) return null;
  const running = books.filter((b) => b.done > 0 && b.done < b.total);
  const finished = books.filter((b) => b.done >= b.total);
  const waiting = books.filter((b) => b.done === 0 && b.total > 0);
  return (
    <div className="mt-2">
      {running.map((b) => (
        <div key={b.book} className="mt-1.5">
          <div className="flex justify-between text-xs">
            <span className="font-medium">{b.book}</span>
            <span className="text-[var(--ink-faint)]">
              {b.done}/{b.total}
              {b.held > 0 && ` · 보류 ${b.held}`}
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
      <BookNames label="끝남" tone="done" books={finished} />
      <BookNames label="대기" tone="wait" books={waiting} />
    </div>
  );
}

function BookNames({
  label,
  tone,
  books,
}: {
  label: string;
  tone: "done" | "wait";
  books: BookProgress[];
}) {
  if (!books.length) return null;
  return (
    <p className="mt-1.5 text-xs leading-5">
      <span className="text-[var(--ink-faint)]">
        {label} {books.length}권{" "}
      </span>
      <span className={tone === "done" ? "text-[var(--ink-soft)]" : "text-[var(--ink-faint)]"}>
        {tone === "done" ? "✓ " : ""}
        {books.map((b) => b.book).join(" · ")}
      </span>
    </p>
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
