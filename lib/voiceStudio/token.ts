/**
 * 음원 생성 PC(로컬 스튜디오)용 기기 토큰 — 서버 전용.
 *
 * 왜 세션 쿠키를 안 쓰는가: 로컬 스튜디오는 브라우저가 아니라 파이썬 프로세스이고,
 * 며칠씩 무인으로 돌아간다. 7일짜리 세션 쿠키로는 중간에 끊긴다.
 *
 * 구조: `vs1.<payload>.<sig>` — SESSION_SECRET 으로 HMAC-SHA256 서명.
 * 서버에 발급 목록을 두지 않으므로 DB 마이그레이션이 필요 없다. 대신 폐기는
 * R2 의 폐기 목록(voice-studio/revoked.json)으로 처리한다 — PC 를 회수하거나
 * 설치 파일이 유출됐을 때 토큰 id 하나만 넣으면 즉시 막힌다.
 */

import crypto from "crypto";
import { studioGetJson, studioPutJson } from "./r2";

const PREFIX = "vs1";
const REVOKED_KEY = "voice-studio/revoked.json";
const TTL_DAYS = 180;

export interface StudioToken {
  /** 토큰 고유 id — 폐기 목록에 넣을 때 쓰는 값 */
  id: string;
  /** 발급받은 관리자 이메일 (누가 설치했는지 추적용) */
  sub: string;
  iat: number;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET 미설정 — 기기 토큰을 발급할 수 없습니다");
  return s;
}

function sign(payload: string): string {
  return b64url(crypto.createHmac("sha256", secret()).update(payload).digest());
}

export function issueToken(email: string): { token: string; claims: StudioToken } {
  const now = Math.floor(Date.now() / 1000);
  const claims: StudioToken = {
    id: crypto.randomBytes(9).toString("hex"),
    sub: email,
    iat: now,
    exp: now + TTL_DAYS * 86400,
  };
  const payload = b64url(Buffer.from(JSON.stringify(claims), "utf8"));
  return { token: `${PREFIX}.${payload}.${sign(payload)}`, claims };
}

// 폐기 목록은 매 요청마다 R2 를 때리지 않도록 60초 캐시.
// (폐기 반영이 최대 1분 늦는다 — 유출 대응에는 충분하고 업로드 경로가 느려지지 않는다)
let revokedCache: { at: number; ids: Set<string> } | null = null;

async function revokedIds(): Promise<Set<string>> {
  if (revokedCache && Date.now() - revokedCache.at < 60_000) return revokedCache.ids;
  const data = await studioGetJson<{ ids?: string[] }>(REVOKED_KEY);
  const ids = new Set(data?.ids || []);
  revokedCache = { at: Date.now(), ids };
  return ids;
}

export async function revokeToken(id: string): Promise<void> {
  const data = (await studioGetJson<{ ids?: string[] }>(REVOKED_KEY)) || {};
  const ids = new Set(data.ids || []);
  ids.add(id);
  await studioPutJson(REVOKED_KEY, { ids: [...ids] });
  revokedCache = null;
}

/** 유효하면 claims, 아니면 null. 서명·만료·폐기 여부를 모두 본다. */
export async function verifyToken(token: string | null | undefined): Promise<StudioToken | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, payload, sig] = parts;

  const expected = sign(payload);
  // 타이밍 공격 방지 — 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  let claims: StudioToken;
  try {
    claims = JSON.parse(unb64url(payload).toString("utf8"));
  } catch {
    return null;
  }
  if (!claims?.id || !claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
  if ((await revokedIds()).has(claims.id)) return null;
  return claims;
}

/** Authorization: Bearer <token> 헤더에서 토큰을 꺼내 검증 */
export async function verifyRequest(req: Request): Promise<StudioToken | null> {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return verifyToken(m?.[1]);
}
