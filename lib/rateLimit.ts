/**
 * 아주 작은 호출 제한 — **인증 없이 외부 유료 API 를 부르는 라우트**의 비용 남용을 막는 최소 안전장치.
 *
 * 카드 만들기의 AI 배경·삽화 생성, 이미지 정리, 주제 추천, 사진 검색은 로그인 없이도 쓸 수 있어야 해서
 * (교인 대부분이 비로그인으로 카드부터 만든다) 인증을 걸지 않았다. 대신 한 사람이 무한정 태우지 못하게
 * 주소(IP)마다 창 단위로 횟수를 센다.
 *
 * 한계를 분명히 해 둔다. 세는 곳이 **서버 인스턴스 메모리**라 인스턴스가 여럿이면 실제 한도는 그 배수가
 * 되고, 인스턴스가 자면 초기화된다. 공유 저장소에 세려면 테이블이 필요한데 지금은 스키마를 건드리지
 * 않기로 했다. 목적은 '무제한'을 '느슨한 상한'으로 바꾸는 것이다 — 자동화된 남용은 이 선에서 걸린다.
 */

import { NextResponse } from "next/server";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
/** 메모리가 무한정 늘지 않게 — 넘으면 지난 창부터 버린다 */
const MAX_KEYS = 5000;

function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return ip;
}

function prune(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size > MAX_KEYS) buckets.clear(); // 그래도 크면 통째로 비운다(한도가 잠시 느슨해질 뿐)
}

/**
 * 넘었으면 429 응답, 아니면 null. 라우트 맨 앞에서 부른다.
 * @param name  라우트 구분용 이름(같은 주소라도 라우트별로 따로 센다)
 * @param limit 창 하나에서 허용할 횟수
 * @param windowMs 창 길이
 */
export function rateLimit(
  req: Request,
  name: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) prune(now);

  const key = `${name}:${clientKey(req)}`;
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  bucket.count += 1;
  if (bucket.count <= limit) return null;

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return NextResponse.json(
    { error: "요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
