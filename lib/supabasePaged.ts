/**
 * PostgREST 1000행 상한을 넘기는 조회 — 서버 전용.
 *
 * 이 프로젝트의 PostgREST 는 max-rows=1000 하드 캡이 걸려 있다. limit 을 3000 으로
 * 줘도, Range 헤더를 0-2499 로 줘도, service_role 키로 요청해도 1000행만 온다.
 * **오류도 경고도 없이 조용히 잘린다.**
 *
 *   GET /rest/v1/bible_verses?select=id&limit=3000  →  1000행
 *   GET /rest/v1/bible_verses?select=id&limit=1500  →  1000행   (실측)
 *
 * 통독 진도(reading_progress)가 여기 정면으로 걸린다. 성경 전체는 1,189장이므로
 * 완주자는 1,000행만 받아 189장이 사라진다. 게다가 재열람 때마다 read_at 이
 * 갱신되므로(app/api/reading-progress POST) **잘려나가는 대상이 매번 달라진다** —
 * 어제 욥기를 다시 열면 오늘은 다른 장이 사라진다. 진도가 흔들리는데 원인을 찾기 어렵다.
 *
 * 그래서 "전량이 필요한" 조회는 반드시 이 헬퍼를 거친다.
 */

const PAGE = 1000;

/** 안전장치 — 실수로 무한 루프가 나지 않도록. 1,189장 성경 기준 넉넉하다. */
const MAX_PAGES = 60;

/**
 * range 로 페이지를 넘겨가며 전량을 모은다.
 *
 * @param page (from, to) 를 받아 그 구간을 조회하는 함수.
 *             예: (from, to) => supabaseAdmin.from("reading_progress")
 *                   .select("book_code, chapter, read_at")
 *                   .eq("user_id", uid).order("read_at", { ascending: false })
 *                   .range(from, to)
 * @returns 모은 행 전체. 오류가 나면 그 지점까지 모은 것을 버리고 throw 한다
 *          (부분 결과를 전량인 척 돌려주면 잘림 버그를 그대로 재현하는 셈이다).
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE;
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`페이지 조회 실패(offset ${from}): ${error.message}`);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE) return out; // 마지막 페이지
  }
  // 여기 오면 6만 행을 넘긴 것 — 설계상 있을 수 없다. 조용히 자르지 말고 알린다.
  console.error(
    `[supabasePaged] ${MAX_PAGES}페이지(${MAX_PAGES * PAGE}행)를 넘었습니다. 조회 조건을 확인하세요.`,
  );
  return out;
}
