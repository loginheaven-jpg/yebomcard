"use client";

/**
 * 음원 생성 현황 — PC 여러 대가 며칠씩 도는 일을 한 화면에서 본다.
 *
 * 각 PC 는 10초마다 자기 상태를 서버에 올린다(`voice/fleet.py`). 여기서 그것을 모아 보여주고
 * 지시를 건다 — **자동으로 하되 최종 결정권은 사람에게** 둔다.
 * 지시는 즉시 반영되지 않는다(각 PC 가 10초 안에 가져간다) — 그래서 결과 줄을 함께 보여준다.
 *
 * 화면 순서는 **볼 일이 잦은 것부터**다:
 *   손봐야 할 것(있을 때만) → 전체 진도 → 요약·전체 조작 → PC 카드 → 책 배분(쓸 때만) → 지시 기록
 *
 * 2026-09-16 정리 — 쌓이기만 한 것을 걷어냈다:
 *   · 요약 8칸 → 4칸. '합격 누계' 와 '업로드' 가 사실상 같은 수였고, '책 끝남·맡은 중' 은
 *     임대를 쓸 때만 뜻이 있어 늘 0 이었다
 *   · 버튼 이름을 '무엇이 일어나는가' 로. '다시 켬'(생성 재개)과 '스튜디오 다시 켜기'
 *     (프로세스 재시작)는 말이 거의 같은데 전혀 다른 일이었다
 *   · '책 배분' 은 임대를 쓸 때만 보인다 — 실제 운영은 '책 맡기기' 로 직접 배정해 왔다
 *   · 명령줄에만 있던 것(책 맡기기·구방식 교체·PC 단위 배치·양보 모드)을 PC 카드로 올렸다
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/hooks/useSession";
import { isAdmin } from "@/lib/admin";

interface BookProgress {
  book: string;
  total: number;
  done: number;
  held: number;
  uploaded: number;
}
interface ReworkItem {
  ref: string;
  why: string;
  code?: string;
  chapter?: number;
  verse?: number;
}
interface ReworkKind {
  count: number;
  label: string;
  items: ReworkItem[];
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
  errorJobs: number;
  pending: number;
  okTotal: number;
  heldTotal: number;
  uploadedTotal: number;
  books: BookProgress[];
  rework: Record<string, ReworkKind>;
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
  /** 고를 수 있는 성우 — 하나뿐이면 선택칸을 띄우지 않는다 */
  voices?: { key: string; label: string }[];
}
interface Attention {
  count: number;
  stale: { label: string; tokenId: string; minutes: number }[];
  errors: { label: string; tokenId: string; jobs: number; message: string }[];
  idle: { label: string; tokenId: string }[];
  held: number;
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
const PROGRESS_REFRESH_MS = 5 * 60_000;

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
  const [attn, setAttn] = useState<Attention | null>(null);
  const [pcs, setPcs] = useState<Pc[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [prog, setProg] = useState<Progress | null>(null);
  const [progBusy, setProgBusy] = useState(false);
  const [showBooks, setShowBooks] = useState(false);
  /** 지금 보고 있는 성우 칸 — 사전 생성 성우가 여럿이 되면 고를 수 있다 */
  const [voiceKey, setVoiceKey] = useState("");
  /** 지금 '책 맡기기' 를 펼친 PC — 한 번에 한 대만 연다 */
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [f, l] = await Promise.all([
        fetch("/api/voice-studio/fleet").then((r) => r.json()),
        fetch("/api/voice-studio/lease").then((r) => r.json()),
      ]);
      if (f?.total) setTotal(f.total);
      if (f?.attention) setAttn(f.attention);
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
  const measure = useCallback(async (fresh = true, quiet = false) => {
    if (!quiet) setProgBusy(true);
    try {
      const q = new URLSearchParams();
      if (fresh) q.set("fresh", "1");
      if (voiceKey) q.set("voiceKey", voiceKey);
      const r = await fetch(`/api/voice-studio/progress?${q}`).then((x) => x.json());
      if (r?.error) {
        if (!quiet) setMsg(r.error);
      } else setProg(r);
    } catch {
      if (!quiet) setMsg("진도를 재지 못했습니다");
    } finally {
      if (!quiet) setProgBusy(false);
    }
  }, [voiceKey]);

  // 들어오면 한 번 잰다 — 예전에는 누르기 전까지 진도가 비어 있어서, 화면을 열어도
  // 제일 궁금한 숫자가 안 보였다. 서버가 1분 동안 같은 값을 돌려 쓰므로 대개 곧바로 온다.
  // 맨 위 요약의 '남은 절'·'이 속도면' 도 이 값으로 계산하므로, 화면을 켜 둔 채 멈춰 있지 않게
  // 몇 분마다 조용히 다시 받는다(돌려 쓰는 값이면 곧바로 온다).
  useEffect(() => {
    if (!admin) return;
    measure(false);
    const t = setInterval(() => measure(false, true), PROGRESS_REFRESH_MS);
    return () => clearInterval(t);
  }, [admin, measure]);

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

  /**
   * 조건으로 고른 절을 다시 만들라고 요청한다.
   *
   * 새 방식 음원을 덮어쓰는 길은 **'음원 다시 만들기' 요청 하나뿐**이다(upload 라우트가 그렇게 막는다).
   * 그래서 여기서도 그 길을 쓴다 — 생성 PC 가 10분 안에 가져가 먼저 만들고 기존 음원을 덮어쓴다.
   * 서버가 한 번에 50절까지만 받으므로, 가장 나쁜 것부터 그만큼씩 나눠 보낸다.
   */
  const sendRework = useCallback(
    async (label: string, items: ReworkItem[]) => {
      const verses = items
        .filter((i) => i.code && i.chapter && i.verse)
        .map((i) => ({ bookCode: i.code, chapter: i.chapter, verse: i.verse }));
      if (verses.length === 0) {
        setMsg("보낼 절이 없습니다");
        return;
      }
      if (!confirm(`${label} ${verses.length}절을 다시 만들까요?

생성 PC 가 10분 안에 가져가 먼저 만들고 기존 음원을 덮어씁니다.`)) return;
      setBusy(true);
      try {
        const r = await fetch("/api/voice-studio/verse-regen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verses, voiceKey: voiceKey || prog?.voiceKey }),
        });
        const d = await r.json();
        setMsg(d.ok ? `${d.created}절을 다시 만들기로 했습니다 — 10분 안에 시작합니다` : d.error || "실패");
      } catch {
        setMsg("요청을 보내지 못했습니다");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /**
   * 고른 책을 그 PC 에 맡긴다.
   *
   * 실제 운영은 임대(lease)가 아니라 이렇게 **직접 맡기는 방식**으로 해 왔다. 그런데 그 길이
   * 명령줄에만 있어서, 한 PC 가 자기 몫을 끝내면 지휘부가 화면에서 다음 일을 줄 수 없었다
   * (2026-09-16 정리). 책마다 작업 하나가 만들어지고, 워커가 진도표 순번이 앞선 것부터 집는다.
   */
  const assignBooks = useCallback(
    async (tokenId: string, label: string, books: string[]) => {
      if (books.length === 0) return;
      if (!confirm(`${label} 에 ${books.length}권을 맡길까요?

${books.join(" · ")}`)) return;
      setBusy(true);
      try {
        const r = await fetch("/api/voice-studio/commands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "queue_books", target: tokenId, args: { books } }),
        });
        const d = await r.json();
        setMsg(d.ok ? `${label} 에 ${books.length}권을 맡겼습니다 — 10초 안에 시작합니다` : d.error || "실패");
        if (d.ok) {
          setAssignTo(null);
          setPicked(new Set());
          setShowLog(true);
        }
      } catch {
        setMsg("맡기지 못했습니다");
      } finally {
        setBusy(false);
      }
    },
    [voiceKey, prog],
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
        <Link href="/" className="text-sm underline">
          돌아가기
        </Link>
      </main>
    );
  }

  // 살아 있는 PC 들이 서로 다른 코드를 물고 있으면 알려 준다 — 결과물만 봐서는 알 수 없다
  const codes = [...new Set(pcs.filter((p) => !p.stale && p.codeVersion).map((p) => p.codeVersion))];
  const mixedCode = codes.length > 1 ? codes.join(" / ") : "";

  // 아직 옛 방식으로 남은 절 — 구약/신약. 0 이면 그쪽 교체 버튼은 아예 감춘다
  // 다시 만들 후보는 PC 마다 자기 것만 안다(그 PC 작업 파일에만 있는 값이다).
  // 전체 그림은 여기서 합쳐 보여 주고, 실제로 누르는 것은 그 PC 카드에서 한다.
  const reworkAll = pcs.reduce(
    (s, p) => s + Object.values(p.rework || {}).reduce((x, v) => x + v.count, 0),
    0,
  );

  const legacyLeft = { old: 0, new: 0 };
  for (const b of prog?.books || []) legacyLeft[b.testament] += b.legacy;

  const taken = leases.filter((l) => l.state === "taken");
  const done = leases.filter((l) => l.state === "done");

  return (
    <main className="max-w-4xl mx-auto px-4 py-5 pb-24">
      <header className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-lg font-bold">음원 생성 현황</h1>
        <Link href="/" className="text-sm text-[var(--ink-faint)] underline">
          닫기
        </Link>
      </header>

      {attn && attn.count > 0 && (
        <section className="rounded-xl border border-amber-400/60 bg-amber-50/60 dark:bg-amber-900/15 p-3 mb-4">
          <h2 className="text-sm font-semibold mb-1.5">손봐야 할 것 {attn.count}건</h2>
          <ul className="space-y-1.5 text-sm">
            {attn.stale.map((s) => (
              <li key={s.tokenId} className="flex items-center gap-2 flex-wrap">
                <span>🔴 <strong>{s.label}</strong> 가 {s.minutes}분째 응답이 없습니다</span>
                <span className="text-xs text-[var(--ink-faint)]">
                  그 PC 에서 바탕화면 &apos;예봄성경 음원생성&apos; 을 다시 눌러 주세요
                </span>
              </li>
            ))}
            {attn.errors.map((e) => (
              <li key={e.tokenId} className="flex items-center gap-2 flex-wrap">
                <span>🟠 <strong>{e.label}</strong> 에 오류로 멈춘 작업 {e.jobs}건</span>
                {e.message && (
                  <span className="text-xs text-[var(--ink-faint)] truncate max-w-full">
                    {e.message}
                  </span>
                )}
                <Btn onClick={() => send("restart", e.tokenId)} disabled={busy}>
                  다시 켜기
                </Btn>
              </li>
            ))}
            {attn.idle.map((i) => (
              <li key={i.tokenId} className="flex items-center gap-2 flex-wrap">
                <span>🟡 <strong>{i.label}</strong> 가 할 일 없이 쉬고 있습니다</span>
                <span className="text-xs text-[var(--ink-faint)]">아래에서 책을 맡겨 주세요</span>
              </li>
            ))}
            {attn.held > 0 && (
              <li className="flex items-center gap-2 flex-wrap">
                <span>🟡 사람이 판단할 보류 절이 {attn.held}개 쌓였습니다</span>
                <a href="/admin/voice-held" className="text-xs underline">
                  보류 절 검수 열기
                </a>
              </li>
            )}
          </ul>
        </section>
      )}

      {total && (
        <section className="rounded-xl border border-[var(--line)] p-3 mb-4 text-sm">
          {/*
            칸을 넷으로 줄였다. 예전에는 여덟이었는데 '합격 누계' 와 '업로드' 가 사실상 같은 수였고,
            '책 끝남·맡은 중' 은 임대를 쓸 때만 뜻이 있어 늘 0 이었다(2026-09-16 정리).
          */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="일하는 PC" value={`${total.running}/${total.pcs}대`} />
            <Stat label="만드는 속도" value={`시간당 ${total.versesPerHour.toLocaleString()}절`} />
            {/*
              남은 절은 **서버 실측**(진도 API total − done)이다. 예전에는 PC 마다의 작업 파일 '남은 절' 을
              합쳤는데, 여러 PC 가 같은 책을 들고 있고 다른 PC 가 만든 절은 그 책에 닿아야 빠지므로
              실제의 두 배로 부풀어 있었다(2026-09-16: 합계 20,969 · 실측 10,669).
            */}
            <Stat
              label="성경 전체 남은 절"
              value={prog ? (prog.total - prog.done).toLocaleString() : "재는 중…"}
            />
            <Stat
              label="이 속도면"
              value={prog ? eta(prog.total - prog.done, total.versesPerHour) : "재는 중…"}
            />
          </div>
          {/* 버튼 이름은 '무엇이 일어나는가' 로 적는다 — '다시 켬'(생성 재개)과
              '스튜디오 다시 켜기'(프로세스 재시작)는 말이 거의 같은데 전혀 다른 일이었다 */}
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn onClick={() => send("stop", "*")} disabled={busy} tone="stop">
              모두 생성 멈춤
            </Btn>
            <Btn onClick={() => send("resume", "*")} disabled={busy}>
              모두 생성 이어가기
            </Btn>
            <Btn onClick={() => send("restart", "*")} disabled={busy}>
              모두 스튜디오 다시 시작
            </Btn>
            <Btn onClick={() => setShowLog((v) => !v)} disabled={busy}>
              {showLog ? "지시 기록 접기" : "지시 기록 보기"}
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
          <h2 className="text-sm font-semibold">
            성경 전체 진도
            {prog?.voiceKey && (
              <span className="ml-1.5 font-normal text-[var(--ink-faint)]">
                {prog.voices?.find((v) => v.key === prog.voiceKey)?.label || prog.voiceKey}
              </span>
            )}
          </h2>
          {/* 성우가 여럿일 때만 고르게 한다 — 하나뿐이면 고를 것이 없다 */}
          {(prog?.voices?.length ?? 0) > 1 && (
            <select
              value={voiceKey || prog?.voiceKey || ""}
              onChange={(e) => setVoiceKey(e.target.value)}
              className="text-xs rounded-lg border border-[var(--line)] bg-transparent px-1.5 py-1"
            >
              {prog?.voices?.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </select>
          )}
          <span className="text-xs text-[var(--ink-faint)]">
            {prog
              ? `${new Date(prog.at).toLocaleString("ko-KR")} 기준 (${ago(prog.at)})`
              : progBusy
                ? "재는 중…"
                : "아직 재지 않았습니다"}
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
            {reworkAll > 0 && (
              <p className="mt-1.5 text-xs text-[var(--ink-faint)]">
                이미 만든 절 가운데 <strong>다시 만들면 나아질 절 {reworkAll.toLocaleString()}개</strong>
                {" "}— 어느 PC 가 만든 것인지에 따라 아래 PC 카드에서 눌러 주세요
              </p>
            )}
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
            <div className="mt-2 flex flex-wrap gap-1.5 items-center">
              <Btn onClick={() => send(p.running ? "stop" : "resume", p.tokenId)} disabled={busy}
                   tone={p.running ? "stop" : undefined}>
                {p.running ? "생성 멈춤" : "생성 이어가기"}
              </Btn>
              <Btn onClick={() => send("restart", p.tokenId)} disabled={busy}>
                스튜디오 다시 시작
              </Btn>
              <span className="text-xs text-[var(--ink-faint)] ml-1">한 번에</span>
              {[2, 4, 8].map((n) => (
                <Btn
                  key={n}
                  onClick={() => send("set_batch", p.tokenId, { batch: n, pc_wide: true })}
                  disabled={busy || p.batch === n}
                >
                  {n}절씩
                </Btn>
              ))}
              <Btn onClick={() => send("polite", p.tokenId, { on: !p.polite })} disabled={busy}>
                {p.polite ? "양보 모드 끄기" : "양보 모드 켜기"}
              </Btn>
            </div>
            <p className="mt-1 text-[11px] text-[var(--ink-faint)] leading-relaxed">
              <b>생성 멈춤/이어가기</b> — 만들기를 잠시 멈추거나 다시 시작합니다(프로그램은 그대로).<br />
              <b>스튜디오 다시 시작</b> — 프로그램을 껐다 켭니다. <b>평소에는 누를 일이 없습니다</b>{" "}
              (새 코드는 30분마다 저절로 반영되고, 그래픽 오류도 스스로 회복합니다).
              그래도 이상하게 멈춰 있을 때 씁니다.<br />
              <b>한 번에 N절씩</b> — 그래픽 메모리가 모자라면 워커가 알아서 줄입니다.{" "}
              <b>양보 모드</b> — 사람이 함께 쓰는 PC 용(생성이 뒷자리로 물러납니다).
            </p>
            <Rework pc={p} busy={busy} onSend={sendRework} />

            <div className="mt-2 pt-2 border-t border-[var(--line)] flex flex-wrap gap-1.5 items-center">
              <Btn
                onClick={() => {
                  setPicked(new Set());
                  setAssignTo(assignTo === p.tokenId ? null : p.tokenId);
                  if (!prog) measure(false);
                }}
                disabled={busy}
              >
                {assignTo === p.tokenId ? "책 맡기기 닫기" : "책 맡기기 — 아직 안 만든 책 주기"}
              </Btn>
              {/*
                구방식 교체는 **남은 것이 있을 때만** 보여 준다. 2026-09-10 이전에 만든 음원을
                다시 만드는 일이라, 다 끝나면 영영 누를 일이 없는 버튼이다(구약은 이미 0 이 되었다).
              */}
              {(["구약", "신약"] as const).map((w) => {
                const n = legacyLeft[w === "구약" ? "old" : "new"];
                if (!n) return null;
                return (
                  <Btn
                    key={w}
                    onClick={() => {
                      if (!confirm(`${p.label} 에 ${w} 구방식 교체를 맡길까요?

아직 옛 방식으로 남은 ${n.toLocaleString()}절을 다시 만들어 덮어씁니다.`)) return;
                      send("queue_replace", p.tokenId, { which: w });
                    }}
                    disabled={busy}
                  >
                    {w} 구방식 교체 {n.toLocaleString()}절
                  </Btn>
                );
              })}
            </div>

            {assignTo === p.tokenId && (
              <BookPicker
                prog={prog}
                busy={busy || progBusy}
                picked={picked}
                onToggle={(name) =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (n.has(name)) n.delete(name);
                    else n.add(name);
                    return n;
                  })
                }
                onAssign={() => assignBooks(p.tokenId, p.label, [...picked])}
              />
            )}
          </article>
        ))}
      </div>

      {/*
        임대(lease) 배분 — **쓰고 있을 때만** 보여 준다. 실제 운영은 위의 '책 맡기기' 로 직접
        배정해 왔고, 그래서 이 자리는 늘 "아직 배분된 책이 없습니다" 만 떠 있었다(2026-09-16 정리).
        스튜디오에서 '전체 생성' 을 켜면 그때부터 여기에 나타난다.
      */}
      {leases.length > 0 && (
      <>
      <h2 className="text-sm font-semibold mb-1">책 배분 (자동 분담)</h2>
      <p className="text-xs text-[var(--ink-faint)] mb-2">
        진도표 순서로 PC 가 알아서 빌려 갑니다. <strong>고정</strong>하면 그 PC 가 계속 맡고(꺼져도
        풀리지 않음), <strong>차단</strong>하면 아무도 가져가지 않습니다. <strong>회수</strong>는 지금
        임대를 풀어 다른 PC 가 가져가게 합니다.
      </p>
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
      </>
      )}
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
/**
 * 다시 만들 후보 — 조건마다 몇 절인지 보여 주고, 눌러서 요청을 보낸다.
 *
 * 끝음절 잘림은 한때 전용 도구를 둘 만한 일이었지만 이제 아니다(고치기 전 14.16% → 1.23%).
 * 그래서 조건 하나짜리 화면이 아니라 **조건 목록**으로 둔다 — 나중에 다른 이유가 생겨도
 * `jobs.REWORK_KINDS` 에 한 줄만 더하면 여기에 저절로 나타난다.
 */
/**
 * 아직 안 만든 책을 골라 한 PC 에 맡긴다.
 *
 * 목록은 '성경 전체 진도' 측정값에서 온다 — 서버가 본문과 보관소를 맞춰 센 것이라 어느 PC 가
 * 무엇을 했든 정확하다. 아직 재지 않았으면 열 때 한 번 잰다(몇 초 걸린다).
 * 이미 다른 PC 가 맡고 있는 책을 또 줘도 사고는 아니다 — 책이 바뀔 때마다 서버에 다시 물어
 * 이미 만들어진 절은 건너뛴다. 다만 헛일이므로 지금 누가 무엇을 하는지 함께 보여 준다.
 */
function BookPicker({
  prog,
  busy,
  picked,
  onToggle,
  onAssign,
}: {
  prog: Progress | null;
  busy: boolean;
  picked: Set<string>;
  onToggle: (name: string) => void;
  onAssign: () => void;
}) {
  if (!prog) {
    return (
      <p className="mt-2 text-xs text-[var(--ink-faint)]">
        남은 책을 세는 중입니다… (몇 초 걸립니다)
      </p>
    );
  }
  const rest = prog.books.filter((b) => b.done < b.total);
  if (rest.length === 0) {
    return <p className="mt-2 text-xs text-[var(--ink-faint)]">남은 책이 없습니다.</p>;
  }
  const total = [...picked].reduce(
    (s, n) => s + (rest.find((b) => b.name === n)?.total ?? 0) - (rest.find((b) => b.name === n)?.done ?? 0),
    0,
  );
  return (
    <div className="mt-2 rounded-lg border border-[var(--line)] p-2">
      <p className="text-xs text-[var(--ink-faint)] mb-1.5">
        아직 안 만든 책 {rest.length}권 — 맡길 책을 고르세요
      </p>
      <div className="flex flex-wrap gap-1">
        {rest.map((b) => (
          <button
            key={b.code}
            type="button"
            onClick={() => onToggle(b.name)}
            className={`px-2 py-1 rounded-md text-xs border ${
              picked.has(b.name)
                ? "border-[var(--ink-soft)] bg-[var(--line)] font-medium"
                : "border-[var(--line)] text-[var(--ink-faint)]"
            }`}
          >
            {b.name} {(b.total - b.done).toLocaleString()}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Btn onClick={onAssign} disabled={busy || picked.size === 0}>
          {picked.size > 0 ? `${picked.size}권 (${total.toLocaleString()}절) 맡기기` : "책을 고르세요"}
        </Btn>
      </div>
    </div>
  );
}

function Rework({
  pc,
  busy,
  onSend,
}: {
  pc: Pc;
  busy: boolean;
  onSend: (label: string, items: ReworkItem[]) => void;
}) {
  const kinds = Object.entries(pc.rework || {}).filter(([, v]) => v.count > 0);
  if (kinds.length === 0) return null;
  return (
    <div className="mt-2 pt-2 border-t border-[var(--line)]">
      <p className="text-xs text-[var(--ink-faint)] mb-1">
        다시 만들 후보 — 이미 올라간 음원 중 흠이 있는 절입니다.{" "}
        <b>급하지 않습니다</b>: 지금 맡은 책을 다 만든 뒤에 누르셔도 됩니다
        (누르면 그 PC 가 하던 일을 잠시 비켜 이것부터 만듭니다).
      </p>
      {kinds.map(([kind, v]) => (
        <div key={kind} className="flex items-center gap-2 flex-wrap text-sm py-0.5">
          <span>
            {v.label} <strong>{v.count.toLocaleString()}절</strong>
          </span>
          {v.items[0] && (
            <span className="text-xs text-[var(--ink-faint)]">
              가장 나쁜 것: {v.items[0].ref} ({v.items[0].why})
            </span>
          )}
          <Btn onClick={() => onSend(v.label, v.items)} disabled={busy}>
            {v.count > v.items.length
              ? `가장 나쁜 ${v.items.length}절 다시 만들기`
              : `${v.count}절 다시 만들기`}
          </Btn>
        </div>
      ))}
    </div>
  );
}

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
