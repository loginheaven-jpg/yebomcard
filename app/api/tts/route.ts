import { NextRequest, NextResponse } from "next/server";
import * as crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTS_API_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cachedToken: { token: string; expiresAt: number } | null = null;

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

function getCredentials(): ServiceAccountCredentials {
  if (process.env.GCP_SERVICE_ACCOUNT_JSON) {
    const json = Buffer.from(
      process.env.GCP_SERVICE_ACCOUNT_JSON,
      "base64",
    ).toString("utf-8");
    const parsed = JSON.parse(json);
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  }
  const clientEmail = process.env.GCP_CLIENT_EMAIL ?? "";
  let privateKey = "";
  if (process.env.GCP_PRIVATE_KEY_BASE64) {
    privateKey = Buffer.from(
      process.env.GCP_PRIVATE_KEY_BASE64,
      "base64",
    ).toString("utf-8");
  } else {
    privateKey = process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? "";
  }
  return { client_email: clientEmail, private_key: privateKey };
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }
  const { client_email, private_key } = getCredentials();
  if (!client_email || !private_key) {
    throw new Error("GCP credentials not configured");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = base64url(sign.sign(private_key));
  const jwt = `${signInput}.${signature}`;

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenResponse.ok) {
    throw new Error(`Token exchange failed: ${tokenResponse.status}`);
  }
  const tokenData = await tokenResponse.json();
  cachedToken = {
    token: tokenData.access_token,
    expiresAt: Date.now() + (tokenData.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

// ── ElevenLabs 한국어 온디맨드 (rnksv 등) ──────────────────────────────
// Vercel 배포 시 ELEVENLABS_API_KEY 환경변수 필요(로컬은 .env.local 의 11LABS 도 인식).
const EL_API_KEY = process.env.ELEVENLABS_API_KEY || process.env["11LABS"] || "";
const NT_CODES = new Set([
  "mat","mrk","luk","jhn","act","rom","1co","2co","gal","eph","php","col",
  "1th","2th","1ti","2ti","tit","phm","heb","jas","1pe","2pe","1jn","2jn","3jn","jud","rev",
]);
// 구약: Hunmin(남)/Sian(여) · 신약: 천장성(남)/김미연(여)
function elevenVoiceId(bookCode: string, isMale: boolean): string {
  const isNT = NT_CODES.has((bookCode || "").toLowerCase());
  if (isNT) return isMale ? "657hGmxIvJTkmFa17K9v" : "vDA1h0ZXkQiojUReMmR9";
  return isMale ? "MpbDJfQJUYUnp0i1QvOZ" : "5n5gqmaQi9Ewevrz7bOS";
}
async function synthElevenLabs(text: string, bookCode: string, isMale: boolean, speed: number): Promise<ArrayBuffer | null> {
  if (!EL_API_KEY) return null;
  const voiceId = elevenVoiceId(bookCode, isMale);
  const spd = Math.min(1.2, Math.max(0.7, speed || 1)); // ElevenLabs speed 범위 0.7~1.2
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": EL_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true, speed: spd },
      }),
    });
    if (!r.ok) { console.error("[ElevenLabs]", r.status, (await r.text()).slice(0, 150)); return null; }
    return await r.arrayBuffer(); // ArrayBuffer 는 BodyInit — NextResponse 에 그대로 전달 가능
  } catch (e) {
    console.error("[ElevenLabs] exception", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { text, speed, voice, lang, accent, pitch, volumeGainDb, bookCode } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    // TTS 입력 정제: 새번역(rnksv) 등 편집자 주석 "(주: …)"은 화면엔 두되 낭독에서만 제외.
    // 주석은 절 끝에 오므로 "(주:"부터 끝까지 제거. "( 셀라 )"·본문 괄호는 보존.
    const ttsText = text.replace(/\s*\(\s*주\s*[:：][\s\S]*$/, "").trim() || text;
    if (new TextEncoder().encode(ttsText).length > 5000) {
      return NextResponse.json(
        { error: "text too long (max 5000 bytes)" },
        { status: 400 },
      );
    }

    const isMale = voice === "male";
    const isEng = lang === "en";

    // 한국어 온디맨드(주로 rnksv): ElevenLabs 한국어 성우 1순위 — 구약 Hunmin/Sian · 신약 천장성/김미연
    // (남/녀 토글 유지). 키 없음·실패 시 아래 GCP(Neural2→WaveNet)로 폴백.
    if (!isEng) {
      const el = await synthElevenLabs(ttsText, bookCode || "", isMale, speed ?? 1);
      if (el) {
        return new NextResponse(el, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "public, max-age=86400",
            "X-TTS-Voice": `el:${elevenVoiceId(bookCode || "", isMale)}`,
          },
        });
      }
      console.error("[TTS] ElevenLabs 미설정/실패 → GCP 폴백");
    }

    const isGb = isEng && accent === "gb";
    const languageCode = isEng ? (isGb ? "en-GB" : "en-US") : "ko-KR";
    // 영문: Chirp3-HD(녹음급) 1순위 → Neural2 폴백. 한국어: Chirp 가 띄어쓰기/억양을 흘려
    // 읽어 실용성↓ → Neural2 1순위 → WaveNet 폴백 (한국어 전용 모델이라 끊어읽기 정확)
    const candidates = isEng
      ? (isGb
          ? (isMale
              ? ["en-GB-Chirp3-HD-Charon", "en-GB-Neural2-B"]
              : ["en-GB-Chirp3-HD-Aoede", "en-GB-Neural2-A"])
          : (isMale
              ? ["en-US-Chirp3-HD-Charon", "en-US-Neural2-D"]
              : ["en-US-Chirp3-HD-Aoede", "en-US-Neural2-F"]))
      : (isMale
          ? ["ko-KR-Neural2-C", "ko-KR-Wavenet-C"]
          : ["ko-KR-Neural2-A", "ko-KR-Wavenet-A"]);

    const token = await getAccessToken();

    let audioContent: string | null = null;
    let usedVoice = "";
    let lastError = "";

    for (const voiceName of candidates) {
      const isChirp = voiceName.includes("Chirp");
      const audioConfig: Record<string, unknown> = {
        audioEncoding: "MP3",
        speakingRate: speed ?? 1.0,
        volumeGainDb: volumeGainDb ?? 0,
      };
      if (!isChirp) {
        audioConfig.pitch = pitch ?? 0;
      }

      const apiResponse = await fetch(TTS_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: { text: ttsText },
          voice: { languageCode, name: voiceName },
          audioConfig,
        }),
      });

      if (apiResponse.ok) {
        const data = await apiResponse.json();
        if (data.audioContent) {
          audioContent = data.audioContent;
          usedVoice = voiceName;
          break;
        }
        lastError = `voice ${voiceName}: empty audio`;
        continue;
      }

      const errBody = await apiResponse.text();
      lastError = `voice ${voiceName}: ${apiResponse.status} ${errBody.slice(0, 200)}`;
      console.error("[TTS]", lastError);
      // 다음 후보로 폴백
    }

    if (!audioContent) {
      return NextResponse.json(
        { error: "All voice candidates failed", detail: lastError },
        { status: 500 },
      );
    }

    const buffer = Buffer.from(audioContent, "base64");
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
        "X-TTS-Voice": usedVoice,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "TTS generation failed";
    console.error("[TTS] exception:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
