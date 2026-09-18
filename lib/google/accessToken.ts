/**
 * 구글 서비스 계정 액세스 토큰 — 서버 전용
 *
 * 원래 `app/api/tts/route.ts` 안에만 있던 것을 꺼냈다. 설교 들여오기도 같은 열쇠로
 * 드라이브를 읽어야 해서다(`docs/BIBLE_QA_SERMONS.md`) — **새 비밀값을 만들지 않는다.**
 * 바뀌는 것은 scope 하나뿐이다.
 *
 * 토큰은 scope 별로 따로 캐시한다. 한 칸에 담으면 TTS 가 드라이브 토큰을 쓰거나
 * 그 반대가 되어, 권한이 모자라다는 오류가 엉뚱한 곳에서 난다.
 */
import * as crypto from "crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Cloud TTS 등 GCP API 일반 */
export const SCOPE_CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";
/** 드라이브 **읽기만**. 설교 .txt 를 가져오는 데 이것으로 충분하다. */
export const SCOPE_DRIVE_READONLY = "https://www.googleapis.com/auth/drive.readonly";

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

export function getServiceAccount(): ServiceAccountCredentials {
  if (process.env.GCP_SERVICE_ACCOUNT_JSON) {
    const json = Buffer.from(process.env.GCP_SERVICE_ACCOUNT_JSON, "base64").toString("utf-8");
    const parsed = JSON.parse(json);
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  }
  const clientEmail = process.env.GCP_CLIENT_EMAIL ?? "";
  let privateKey = "";
  if (process.env.GCP_PRIVATE_KEY_BASE64) {
    privateKey = Buffer.from(process.env.GCP_PRIVATE_KEY_BASE64, "base64").toString("utf-8");
  } else {
    privateKey = process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? "";
  }
  return { client_email: clientEmail, private_key: privateKey };
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const cache = new Map<string, { token: string; expiresAt: number }>();

export async function getGoogleAccessToken(scope: string): Promise<string> {
  const hit = cache.get(scope);
  if (hit && Date.now() < hit.expiresAt) return hit.token;

  const { client_email, private_key } = getServiceAccount();
  if (!client_email || !private_key) {
    throw new Error("GCP credentials not configured");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: client_email, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const signInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = base64url(sign.sign(private_key));
  const jwt = `${signInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status}`);
  }
  const data = await res.json();
  const entry = {
    token: data.access_token as string,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  cache.set(scope, entry);
  return entry.token;
}
