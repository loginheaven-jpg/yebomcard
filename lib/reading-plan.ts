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
