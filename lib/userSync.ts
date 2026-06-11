import {
  readBookmarks,
  readRecent,
  overwriteBookmarks,
  overwriteRecent,
  type Bookmark,
  type BiblePosition,
} from "./bookmark";

// ─── 기기간 동기화 (서버 기반, user_state 테이블) ───
// 책갈피 + 마지막 위치(recent)를 클라우드에 미러링해 기기 바꿔도 이어보기.
// (TTS 재생 위치는 영속 상태가 없어 "마지막 본 위치"로 갈음 — 통독 진도(A)와 보완)

const BOOKMARKS_KEY = "bookmarks";
const RECENT_KEY = "recent";
const MAX_BOOKMARKS = 30;

interface StateRow {
  key: string;
  value: unknown;
  updated_at: string;
}

async function fetchUserState(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch("/api/user-state");
    if (!res.ok) return {};
    const { state } = await res.json();
    const map: Record<string, unknown> = {};
    for (const row of (state as StateRow[]) || []) map[row.key] = row.value;
    return map;
  } catch {
    return {};
  }
}

export async function pushUserState(key: string, value: unknown): Promise<boolean> {
  try {
    const res = await fetch("/api/user-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function pushBookmarks(list: Bookmark[]) {
  pushUserState(BOOKMARKS_KEY, list);
}
export function pushRecent(pos: BiblePosition) {
  pushUserState(RECENT_KEY, pos);
}

/**
 * 로그인 시 기기간 동기화.
 * - bookmarks: 로컬 ∪ 클라우드 (id union, 같은 id 면 savedAt 최신 우선) → 로컬·클라우드 양쪽 반영.
 *   union 이라 다른 기기에서 추가한 책갈피가 사라지지 않음.
 * - recent(마지막 위치): savedAt 기준 last-write-wins.
 * 반환: 동기화 후 최신 { bookmarks, recent } — 호출자가 상태 갱신.
 */
export async function syncOnLogin(): Promise<{
  bookmarks: Bookmark[];
  recent: BiblePosition | null;
}> {
  const cloud = await fetchUserState();

  // ── bookmarks union by id ──
  const localBm = readBookmarks();
  const cloudBm = Array.isArray(cloud[BOOKMARKS_KEY]) ? (cloud[BOOKMARKS_KEY] as Bookmark[]) : [];
  const byId = new Map<string, Bookmark>();
  for (const b of [...cloudBm, ...localBm]) {
    if (!b || !b.book_code) continue;
    const id = b.id || `${b.book_code}-${b.chapter}-${b.version}`;
    const prev = byId.get(id);
    if (!prev || (b.savedAt || 0) > (prev.savedAt || 0)) byId.set(id, b);
  }
  const mergedBm = [...byId.values()]
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
    .slice(0, MAX_BOOKMARKS);
  overwriteBookmarks(mergedBm);
  pushBookmarks(mergedBm);

  // ── recent last-write-wins ──
  const localRecent = readRecent();
  const cloudRecent = (cloud[RECENT_KEY] as BiblePosition | undefined) || null;
  let recent = localRecent;
  if (cloudRecent && (!localRecent || (cloudRecent.savedAt || 0) > (localRecent.savedAt || 0))) {
    overwriteRecent(cloudRecent);
    recent = cloudRecent;
  } else if (localRecent) {
    pushRecent(localRecent);
  }

  return { bookmarks: mergedBm, recent };
}
