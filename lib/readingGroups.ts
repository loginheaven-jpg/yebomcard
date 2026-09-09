/**
 * 말씀의삶 그룹 — 서버 공용 로직.
 *
 * 세 라우트(목록·참여·순위)가 같은 조회를 반복하므로 여기 모은다.
 * 이 파일은 서버 전용이다 — supabaseAdmin(service_role)을 쓴다.
 */

import { cookies } from "next/headers";
import { unsealData } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchAllRows } from "@/lib/supabasePaged";
import { YEBOM91, computeUnitProgress } from "@/lib/plans/yebom91";
import { CHAPTER_COUNTS } from "@/lib/books";

export const PLAN_ID = "yebom91";

/** 그룹 라우트 4개가 공유하는 세션 판독 (다른 라우트들의 getSession 과 동일 동작) */
export async function readSession(): Promise<SessionData | null> {
  try {
    const cookieStore = await cookies();
    const sealed = cookieStore.get(sessionOptions.cookieName);
    if (!sealed) return null;
    const session = await unsealData<SessionData>(sealed.value, {
      password: sessionOptions.password,
    });
    return session?.isLoggedIn ? session : null;
  } catch {
    return null;
  }
}

/**
 * 초대코드 문자 — 혼동되는 O·0·I·1 을 뺀 32자.
 * 교인이 눈으로 읽고 손으로 입력하는 값이라, 공간(32^6 ≈ 10억)보다 오독 방지가 중요하다.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeInviteCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

/** 입력된 코드를 정규화 — 대소문자 무시, 공백·하이픈 제거 */
export function normalizeCode(raw: string): string {
  return (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export interface GroupRow {
  id: number;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
}

export interface MemberRow {
  group_id: number;
  user_id: string;
  user_name: string | null;
}

/** 내가 속한 그룹 목록 */
export async function myGroups(userId: string): Promise<GroupRow[]> {
  const { data: mine } = await supabaseAdmin
    .from("reading_group_members")
    .select("group_id")
    .eq("user_id", userId);
  const ids = (mine || []).map((m) => m.group_id);
  if (ids.length === 0) return [];
  const { data } = await supabaseAdmin
    .from("reading_groups")
    .select("id, name, invite_code, created_by, created_at")
    .in("id", ids)
    .order("created_at");
  return (data || []) as GroupRow[];
}

export async function groupMembers(groupId: number): Promise<MemberRow[]> {
  const { data } = await supabaseAdmin
    .from("reading_group_members")
    .select("group_id, user_id, user_name")
    .eq("group_id", groupId);
  return (data || []) as MemberRow[];
}

export interface Standing {
  user_id: string;
  user_name: string;
  doneCount: number;
  /** 통독 진도(장) — 카드 부제용 */
  readChapters: number;
}

// 순위는 60초 캐시한다. 멤버 전원의 진도를 매번 읽는 조회라 화면을 열 때마다 돌 필요가 없다.
// 지금 규모(1인 평균 28장)에서는 성능 문제가 아니지만, 통독이 진행되면 커진다.
const standingsCache = new Map<number, { at: number; rows: Standing[] }>();
const CACHE_MS = 60_000;

/**
 * 그룹 순위 — 완료 회차 내림차순, **동률은 이름 가나다순.**
 *
 * `read_at` 을 정렬키로 쓰지 않는다. reading-progress POST 가 재열람마다 read_at 을
 * 갱신하므로 그것은 "마지막으로 연 시각"이고, 이미 읽은 장을 한 번 다시 열면 순위가 뒤집힌다.
 * 이름순은 단순하고 조작이 불가능하다.
 */
export async function groupStandings(groupId: number, now: number): Promise<Standing[]> {
  const hit = standingsCache.get(groupId);
  if (hit && now - hit.at < CACHE_MS) return hit.rows;

  const members = await groupMembers(groupId);
  if (members.length === 0) return [];
  const ids = members.map((m) => m.user_id);

  // **페이지네이션 필수** — 멤버 합계가 1,000행을 넘는 순간 경고 없이 잘린다.
  const progress = await fetchAllRows<{ user_id: string; book_code: string; chapter: number }>(
    (from, to) =>
      supabaseAdmin
        .from("reading_progress")
        .select("user_id, book_code, chapter")
        .in("user_id", ids)
        .order("id")
        .range(from, to),
  );
  const checks = await fetchAllRows<{ user_id: string; seq: number }>((from, to) =>
    supabaseAdmin
      .from("reading_unit_checks")
      .select("user_id, seq")
      .in("user_id", ids)
      .eq("plan_id", PLAN_ID)
      .order("id")
      .range(from, to),
  );

  const readBy = new Map<string, Record<string, Set<number>>>();
  for (const r of progress) {
    const max = CHAPTER_COUNTS[r.book_code];
    if (!max || r.chapter < 1 || r.chapter > max) continue; // 알 수 없는 코드·범위 밖은 제외
    const m = readBy.get(r.user_id) ?? {};
    (m[r.book_code] ??= new Set()).add(r.chapter);
    readBy.set(r.user_id, m);
  }
  const manualBy = new Map<string, Set<number>>();
  for (const c of checks) {
    const s = manualBy.get(c.user_id) ?? new Set<number>();
    s.add(c.seq);
    manualBy.set(c.user_id, s);
  }

  const rows: Standing[] = members.map((m) => {
    const rb = readBy.get(m.user_id) ?? {};
    const p = computeUnitProgress(YEBOM91, rb, manualBy.get(m.user_id) ?? new Set());
    return {
      user_id: m.user_id,
      user_name: m.user_name || "이름 없음",
      doneCount: p.doneCount,
      readChapters: Object.values(rb).reduce((n, s) => n + s.size, 0),
    };
  });

  rows.sort(
    (a, b) => b.doneCount - a.doneCount || a.user_name.localeCompare(b.user_name, "ko"),
  );
  standingsCache.set(groupId, { at: now, rows });
  return rows;
}

/** 그룹이 바뀌면(참여·탈퇴) 캐시를 버린다 */
export function invalidateStandings(groupId: number): void {
  standingsCache.delete(groupId);
}
