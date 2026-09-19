"use client";

/**
 * 성경 질문 — 네 목록 편집 (수퍼어드민 화면, 2026-09-19)
 *
 * docs/BIBLE_QA_DOCTRINE.md §B-11 — 자주 바뀌는 네 가지(이단 목록 · 가정교회 자료 · 위기 상담 창구 ·
 * 삶공부 과정 이름)는 DB 에 두고 목사님이 여기서 고친다. 고친 것은 **다음 질문부터 바로** 쓰인다.
 *
 * 화면의 `isSuperAdmin` 은 표시 제어일 뿐이다 — 실제 차단은 `/api/admin/qa-lists` 안의 게이트다.
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { isSuperAdmin } from "@/lib/admin";

type Kind = "heresy" | "housechurch" | "crisis" | "lifestudy";

interface Row {
  id: number;
  kind: Kind;
  sort_order: number;
  title: string;
  body: string | null;
  note: string | null;
  enabled: boolean;
  updated_at: string;
  updated_by: string | null;
}

interface Draft {
  title: string;
  body: string;
  note: string;
}

/** 목록마다 칸 이름과 쓰임 — 목사님이 읽고 바로 알 수 있게 쓴다 */
const KINDS: {
  key: Kind;
  label: string;
  titleLabel: string;
  bodyLabel: string | null;
  bodyPlaceholder: string;
  help: string[];
}[] = [
  {
    key: "heresy",
    label: "이단 목록",
    titleLabel: "단체 이름",
    bodyLabel: "무엇이 갈라지는가 (AI 에게 갑니다)",
    bodyPlaceholder: "예: 성경을 비유로 풀어 자기 단체를 실상이라 하고, 교주를 구원의 자리에 둔다",
    help: [
      "교인이 어떤 단체를 물으면 AI 는 이 목록에 있는 단체만 '교단이 이단·비기독교로 규정했다' 고 말합니다. 목록에 없는 단체·사람은 이단이라 말하지 않습니다.",
      "설명에 총회 회기·연도는 적지 마세요 — AI 가 틀리게 옮깁니다. 근거와 연도는 '근거·메모' 칸에 두면 사람만 봅니다.",
      "교인이 교주 이름으로 묻는 단체는 이름에 괄호로 넣어 두세요. 예: 다락방(류광수)",
    ],
  },
  {
    key: "housechurch",
    label: "가정교회 자료",
    titleLabel: "말",
    bodyLabel: "뜻 (AI 에게 갑니다)",
    bodyPlaceholder: "예: 집에서 모이는 그 공동체. 예배·교제·섬김·전도가 여기서 일어난다.",
    help: [
      "가정교회에 관한 질문에 AI 가 '우리 교회의 뜻' 으로 쓰는 말과 설명입니다. 여기 없는 것은 AI 가 지어내지 않고 목자·목녀나 교역자께 여쭤 보라고 합니다.",
      "AI 가 이 자료를 쓰는 규칙(다른 교회의 소그룹과 견주지 않기, 목장 편성·모임 시간 같은 교회 살림은 모른다고 하기 등)은 고정이라 여기서 바뀌지 않습니다.",
      "모두 끄거나 지우면 저장소 문서의 기본 자료를 씁니다.",
    ],
  },
  {
    key: "crisis",
    label: "위기 상담 창구",
    titleLabel: "창구 이름",
    bodyLabel: "번호 · 여는 시간 (화면에 보입니다)",
    bodyPlaceholder: "예: 109 · 24시간 365일",
    help: [
      "질문이 위기로 판정되면 AI 답 대신 이 창구들이 화면에 뜹니다. AI 에게는 가지 않습니다.",
      "'번호 · 여는 시간' 칸 맨 앞에 번호를 적어 주세요 — 교인이 누르면 그 번호로 전화가 걸립니다.",
      "모두 끄면 앱에 넣어 둔 기본 창구 7개가 뜹니다. 번호는 반년에 한 번 확인해 주세요.",
    ],
  },
  {
    key: "lifestudy",
    label: "삶공부 과정",
    titleLabel: "과정 이름",
    bodyLabel: null,
    bodyPlaceholder: "",
    help: [
      "질문에 이 과정 이름이 나오면 AI 에게 가정교회 자료를 함께 보냅니다. 예: 생명의삶",
      "이름만 씁니다. 교회에서 부르는 이름 그대로 적어 주세요.",
    ],
  },
];

const EMPTY: Draft = { title: "", body: "", note: "" };

function fmt(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

const inputCls =
  "w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-[13px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[var(--amber)]";

export default function AdminQaListsPage() {
  const { session, loading } = useSession();
  const superAdmin = isSuperAdmin(session);

  const [kind, setKind] = useState<Kind>("heresy");
  const [items, setItems] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // 고치는 중인 줄과 그 글
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  // 새 줄
  const [adding, setAdding] = useState<Draft>(EMPTY);

  const meta = KINDS.find((k) => k.key === kind)!;
  const rows = items.filter((r) => r.kind === kind);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/qa-lists");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || `불러오지 못했습니다 (${res.status})`);
        return;
      }
      setItems(d.items || []);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (superAdmin) load();
  }, [superAdmin, load]);

  /** 보내고, 실패하면 이유를 보이고, 성공하면 다시 읽는다 */
  async function send(method: "POST" | "PATCH" | "DELETE", body?: object, query = ""): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/qa-lists${query}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || `저장하지 못했습니다 (${res.status})`);
        return false;
      }
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: number) {
    if (!draft.title.trim()) {
      setError("이름을 적어 주세요");
      return;
    }
    const ok = await send("PATCH", {
      id,
      title: draft.title,
      ...(meta.bodyLabel ? { body: draft.body } : {}),
      note: draft.note,
    });
    if (ok) {
      setEditing(null);
      flash("저장했습니다. 다음 질문부터 쓰입니다.");
    }
  }

  async function add() {
    if (!adding.title.trim()) {
      setError("이름을 적어 주세요");
      return;
    }
    const ok = await send("POST", {
      kind,
      title: adding.title,
      body: meta.bodyLabel ? adding.body : null,
      note: adding.note,
    });
    if (ok) {
      setAdding(EMPTY);
      flash("더했습니다. 다음 질문부터 쓰입니다.");
    }
  }

  async function remove(row: Row) {
    if (
      !window.confirm(
        `'${row.title}' 을(를) 지울까요? 되돌릴 수 없습니다.\n잠시 빼 두려면 지우지 말고 '끄기' 를 누르세요.`,
      )
    ) {
      return;
    }
    if (await send("DELETE", undefined, `?id=${row.id}`)) flash("지웠습니다.");
  }

  // 로딩을 먼저 본다 — 순서를 바꾸면 새로고침마다 '전용 페이지' 가 번쩍인다.
  if (loading) return <div className="p-6 text-sm text-gray-500">확인 중…</div>;
  if (!superAdmin) {
    return <div className="p-6 text-sm text-red-600">이 화면은 수퍼어드민만 쓸 수 있습니다.</div>;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 pb-24">
      <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">성경 질문 목록 편집</h1>
      <p className="text-xs text-gray-400 mb-3">
        성경 질문의 AI 답과 위기 화면이 쓰는 네 목록입니다. 고친 것은 <b>다음 질문부터 바로</b> 쓰이고,
        고친 사람과 시각이 남습니다.
      </p>

      <div className="flex flex-wrap gap-1.5 mb-3" role="tablist" aria-label="목록">
        {KINDS.map((k) => {
          const all = items.filter((r) => r.kind === k.key);
          const on = all.filter((r) => r.enabled).length;
          return (
            <button
              key={k.key}
              role="tab"
              aria-selected={kind === k.key}
              onClick={() => {
                setKind(k.key);
                setEditing(null);
                setAdding(EMPTY);
                setError(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                kind === k.key
                  ? "bg-[var(--amber)] text-white"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
              }`}
            >
              {k.label}
              {loaded && (
                <span className="ml-1 opacity-75 tabular-nums">
                  {on}
                  {all.length !== on ? `/${all.length}` : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <ul className="mb-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/40 px-3 py-2 space-y-1 list-disc list-inside text-[12px] leading-relaxed text-amber-900 dark:text-amber-200">
        {meta.help.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>

      {error && <div className="mb-2 text-[12.5px] text-red-600">{error}</div>}

      {!loaded ? (
        <div className="text-sm text-gray-500">불러오는 중…</div>
      ) : (
        <div className="space-y-2">
          {rows.length === 0 && (
            <p className="text-[12.5px] text-gray-400">아직 없습니다. 아래에서 더해 주세요.</p>
          )}
          {rows.map((row, i) => {
            const isEditing = editing === row.id;
            return (
              <div
                key={row.id}
                className={`rounded-xl border p-3 ${
                  row.enabled
                    ? "border-[var(--line)] dark:border-gray-700 bg-white dark:bg-gray-800"
                    : "border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40"
                }`}
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <label className="block text-[11px] font-semibold text-gray-500">
                      {meta.titleLabel}
                      <input
                        id={`edit-title-${row.id}`}
                        value={draft.title}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                        className={`${inputCls} mt-0.5`}
                      />
                    </label>
                    {meta.bodyLabel && (
                      <label className="block text-[11px] font-semibold text-gray-500">
                        {meta.bodyLabel}
                        <textarea
                          id={`edit-body-${row.id}`}
                          value={draft.body}
                          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                          rows={3}
                          className={`${inputCls} mt-0.5 resize-y`}
                        />
                      </label>
                    )}
                    <label className="block text-[11px] font-semibold text-gray-500">
                      근거 · 메모 (사람만 봅니다)
                      <textarea
                        id={`edit-note-${row.id}`}
                        value={draft.note}
                        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                        rows={2}
                        className={`${inputCls} mt-0.5 resize-y`}
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(row.id)}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--amber)] text-white disabled:opacity-50"
                      >
                        저장
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 w-5 text-right text-[11px] text-gray-400 tabular-nums pt-0.5">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-[13.5px] font-semibold ${
                            row.enabled ? "text-gray-900 dark:text-gray-100" : "text-gray-400 line-through"
                          }`}
                        >
                          {row.title}
                          {!row.enabled && (
                            <span className="ml-1.5 no-underline inline-block text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500">
                              꺼 둠
                            </span>
                          )}
                        </p>
                        {meta.bodyLabel && row.body && (
                          <p className="mt-0.5 text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                            {row.body}
                          </p>
                        )}
                        {row.note && (
                          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-400 whitespace-pre-wrap">
                            근거 · 메모 — {row.note}
                          </p>
                        )}
                        <p className="mt-1 text-[10.5px] text-gray-400">
                          {fmt(row.updated_at)}
                          {row.updated_by ? ` · ${row.updated_by}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 mt-2 pl-7 text-[11.5px]">
                      <button
                        onClick={() => {
                          setEditing(row.id);
                          setDraft({ title: row.title, body: row.body ?? "", note: row.note ?? "" });
                          setError(null);
                        }}
                        disabled={busy}
                        className="font-semibold text-[var(--amber-deep)] disabled:opacity-50"
                      >
                        고치기
                      </button>
                      <button
                        onClick={async () => {
                          if (await send("PATCH", { id: row.id, enabled: !row.enabled })) {
                            flash(row.enabled ? "껐습니다. 다음 질문부터 빠집니다." : "켰습니다. 다음 질문부터 쓰입니다.");
                          }
                        }}
                        disabled={busy}
                        className="text-gray-600 dark:text-gray-300 disabled:opacity-50"
                      >
                        {row.enabled ? "끄기" : "켜기"}
                      </button>
                      <button
                        onClick={() => send("PATCH", { id: row.id, move: "up" })}
                        disabled={busy || i === 0}
                        aria-label="위로"
                        className="text-gray-500 disabled:opacity-30"
                      >
                        ▲ 위로
                      </button>
                      <button
                        onClick={() => send("PATCH", { id: row.id, move: "down" })}
                        disabled={busy || i === rows.length - 1}
                        aria-label="아래로"
                        className="text-gray-500 disabled:opacity-30"
                      >
                        ▼ 아래로
                      </button>
                      <span className="flex-1" />
                      <button
                        onClick={() => remove(row)}
                        disabled={busy}
                        className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                      >
                        지우기
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* 새 줄 */}
          <div className="rounded-xl border border-[var(--amber)]/50 bg-amber-50/40 dark:bg-amber-950/10 p-3 space-y-2">
            <p className="text-[12px] font-semibold text-[var(--amber-deep)] dark:text-amber-300">
              {meta.label}에 더하기
            </p>
            <label className="block text-[11px] font-semibold text-gray-500">
              {meta.titleLabel}
              <input
                id={`add-title-${kind}`}
                value={adding.title}
                onChange={(e) => setAdding({ ...adding, title: e.target.value })}
                className={`${inputCls} mt-0.5`}
              />
            </label>
            {meta.bodyLabel && (
              <label className="block text-[11px] font-semibold text-gray-500">
                {meta.bodyLabel}
                <textarea
                  id={`add-body-${kind}`}
                  value={adding.body}
                  onChange={(e) => setAdding({ ...adding, body: e.target.value })}
                  rows={3}
                  placeholder={meta.bodyPlaceholder}
                  className={`${inputCls} mt-0.5 resize-y`}
                />
              </label>
            )}
            <label className="block text-[11px] font-semibold text-gray-500">
              근거 · 메모 (사람만 봅니다)
              <textarea
                id={`add-note-${kind}`}
                value={adding.note}
                onChange={(e) => setAdding({ ...adding, note: e.target.value })}
                rows={2}
                className={`${inputCls} mt-0.5 resize-y`}
              />
            </label>
            <button
              onClick={add}
              disabled={busy || !adding.title.trim()}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[var(--amber)] text-white disabled:opacity-40"
            >
              더하기
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-gray-900 text-white text-xs shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
