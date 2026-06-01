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

export async function POST(req: NextRequest) {
  try {
    const { text, speed, voice, pitch, volumeGainDb } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    if (new TextEncoder().encode(text).length > 5000) {
      return NextResponse.json(
        { error: "text too long (max 5000 bytes)" },
        { status: 400 },
      );
    }

    // Chirp 3 HD voices — Neural2 보다 자연스러움. pitch 파라미터는 미지원.
    const voiceName =
      voice === "male" ? "ko-KR-Chirp3-HD-Charon" : "ko-KR-Chirp3-HD-Aoede";
    const isChirp = voiceName.includes("Chirp");
    const token = await getAccessToken();

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
        input: { text },
        voice: { languageCode: "ko-KR", name: voiceName },
        audioConfig,
      }),
    });
    if (!apiResponse.ok) {
      return NextResponse.json(
        { error: `TTS API error: ${apiResponse.status}` },
        { status: 500 },
      );
    }
    const data = await apiResponse.json();
    const audioContent = data.audioContent;
    if (!audioContent) {
      return NextResponse.json(
        { error: "No audio content returned" },
        { status: 500 },
      );
    }
    const buffer = Buffer.from(audioContent, "base64");
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "TTS generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
