/**
 * 말씀의삶 — 회차 수동 체크 클라이언트 헬퍼.
 *
 * lib/reading-progress.ts 와 같은 관례: 실패 시 throw 하지 않고 빈 값/false 를 돌려준다.
 * 진도표는 비로그인에서도 열람되어야 하므로 화면이 오류로 무너지면 안 된다.
 */

/** 내가 종이로 읽었다고 표시한 회차 목록. 비로그인·실패 시 빈 배열 */
export async function fetchUnitChecks(): Promise<number[]> {
  try {
    const res = await fetch("/api/reading-plan/checks");
    if (!res.ok) return [];
    const { seqs } = await res.json();
    return Array.isArray(seqs) ? seqs : [];
  } catch {
    return [];
  }
}

/** 회차 체크/해제. 성공 여부만 돌려준다 */
export async function setUnitCheck(seq: number, checked: boolean): Promise<boolean> {
  try {
    const res = checked
      ? await fetch("/api/reading-plan/checks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seq }),
        })
      : await fetch(`/api/reading-plan/checks?seq=${seq}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── 그룹 (단계 4) ────────────────────────────────────────────
// 위와 달리 **생성·참여·탈퇴는 오류 문구를 그대로 돌려준다.**
// 조회는 조용히 실패해도 화면이 서지만, 쓰기는 왜 안 됐는지 알려야 다시 시도할 수 있다.

export interface ReadingGroup {
  id: number;
  name: string;
  inviteCode: string;
  memberCount: number;
  isOwner: boolean;
}

export interface GroupStanding {
  userId: string;
  name: string;
  doneCount: number;
  readChapters: number;
  rank: number;
  isMe: boolean;
}

/** 내가 속한 그룹 목록. 비로그인·실패 시 빈 배열 */
export async function fetchMyGroups(): Promise<ReadingGroup[]> {
  try {
    const res = await fetch("/api/reading-groups");
    if (!res.ok) return [];
    const { groups } = await res.json();
    return Array.isArray(groups) ? groups : [];
  } catch {
    return [];
  }
}

type GroupResult = { group: ReadingGroup } | { error: string };

async function postGroup(url: string, body: unknown): Promise<GroupResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || "요청에 실패했습니다" };
    return { group: json.group as ReadingGroup };
  } catch {
    return { error: "연결에 실패했습니다" };
  }
}

export function createGroup(name: string): Promise<GroupResult> {
  return postGroup("/api/reading-groups", { name });
}

export function joinGroup(code: string): Promise<GroupResult> {
  return postGroup("/api/reading-groups/join", { code });
}

/** 그룹 순위. 멤버가 아니면(403) null */
export async function fetchStandings(
  groupId: number,
): Promise<{ group: ReadingGroup; standings: GroupStanding[]; myRank: number | null } | null> {
  try {
    const res = await fetch(`/api/reading-groups/${groupId}/standings`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** 그룹 나가기. 성공 시 그룹이 지워졌는지(마지막 멤버였는지) 함께 알려준다 */
export async function leaveGroup(
  groupId: number,
): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/reading-groups/${groupId}/leave`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || "나가지 못했습니다" };
    return { ok: true, deleted: !!json.deleted };
  } catch {
    return { ok: false, error: "연결에 실패했습니다" };
  }
}

/**
 * 요약 스트립·완료 시트에 붙일 한 줄 — "첫 번째 그룹 N명 중 R번째".
 *
 * 그룹이 없으면 null. standings 는 서버에서 60초 캐시되므로 두 곳에서 불러도 부담이 없다.
 */
export async function fetchGroupSummary(): Promise<{
  name: string;
  memberCount: number;
  myRank: number;
} | null> {
  const groups = await fetchMyGroups();
  if (groups.length === 0) return null;
  const first = groups[0];
  const s = await fetchStandings(first.id);
  if (!s || s.myRank === null) return null;
  return { name: first.name, memberCount: s.standings.length, myRank: s.myRank };
}
