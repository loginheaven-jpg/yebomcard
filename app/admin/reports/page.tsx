"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "@/hooks/useSession";
import { isAdmin } from "@/lib/admin";

interface ReportItem {
  id: number;
  book_code: string;
  chapter: number;
  verse: number;
  note: string | null;
  user_name: string | null;
  group_id: string | null;
  visibility: string;
  hidden: boolean;
  report_count: number;
  reporters: string[];
  last_reported: string | null;
}

export default function AdminReportsPage() {
  const { session, loading } = useSession();
  const admin = isAdmin(session);
  const [items, setItems] = useState<ReportItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/verse-notes");
      if (res.ok) {
        const d = await res.json();
        setItems(d.items || []);
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (admin) load();
  }, [admin, load]);

  async function remove(id: number) {
    if (!window.confirm("이 메모를 영구 삭제할까요? (되돌릴 수 없음)")) return;
    setBusy(true);
    await fetch(`/api/admin/verse-notes?id=${id}`, { method: "DELETE" });
    setBusy(false);
    load();
  }
  async function restore(id: number) {
    setBusy(true);
    await fetch("/api/admin/verse-notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusy(false);
    load();
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">확인 중…</div>;
  if (!admin)
    return <div className="p-6 text-sm text-red-600">관리자(운영자·수퍼어드민) 전용 페이지입니다.</div>;

  return (
    <div className="max-w-2xl mx-auto p-4 pb-24">
      <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">신고된 메모 관리</h1>
      <p className="text-xs text-gray-400 mb-4">
        서로 다른 2명이 신고하면 자동 임시숨김(모두에게 안 보임). 검토 후 <b>삭제(영구)</b> 또는 <b>복원(기각)</b>.
      </p>

      {!loaded ? (
        <div className="text-sm text-gray-500">불러오는 중…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-500">신고된 메모가 없습니다.</div>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-white dark:bg-gray-800">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-400 mb-1.5">
                <span className="font-semibold text-gray-700 dark:text-gray-300">{it.user_name || "익명"}</span>
                <span>· {it.book_code} {it.chapter}:{it.verse}</span>
                <span>· 공개 {it.visibility}</span>
                {it.hidden && <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 font-semibold">임시숨김</span>}
                <span className="ml-auto font-semibold text-amber-600 dark:text-amber-400">신고 {it.report_count}건</span>
              </div>
              <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words mb-2">{it.note}</p>
              <div className="text-[10px] text-gray-400 mb-2">신고자: {it.reporters.join(", ") || "-"}</div>
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => restore(it.id)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:brightness-95 disabled:opacity-50"
                >
                  복원(기각)
                </button>
                <button
                  disabled={busy}
                  onClick={() => remove(it.id)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
