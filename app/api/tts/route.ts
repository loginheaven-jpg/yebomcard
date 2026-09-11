import { NextRequest, NextResponse } from "next/server";
import * as crypto from "crypto";
import { markEngineDown, clearEngineDown, isEngineDown } from "@/lib/tts/engineHealth";
import { getR2Audio, putR2Audio } from "@/lib/tts/r2Cache";
// 정제/키 규칙은 lib/tts/verseText 한 곳에 둔다 — 로컬 스튜디오(voice/engine.py)와
// 문자 단위로 같아야 하고, 어긋나면 에러 없이 조용히 캐시 미스가 난다.
import { cleanForTts, ttsCacheKey } from "@/lib/tts/verseText";

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

// ── 한국어 AI 성우 — 성우별 엔진 라우팅 ──────────────────────────────
// m1 천사장/f1 김단아 = ElevenLabs, m2 쾌활/f2 생생 = GCP Chirp3-HD(새번역·개역·통독),
// m3 Watson/m4 Garret/m5 Daddy(클론)/f3 Cindy = Supertone(2026-09-11 선택 목록에선 뺌), f4 영희 = 사전 생성 음원만.
// 고른 성우로 못 읽으면 영희 → 김단아 → GCP(Chirp→Neural2→WaveNet) 순으로 대신 읽는다(KOREAN_STAND_INS).
// Vercel 배포 시 ELEVENLABS_API_KEY / SUPERTONE_API_KEY 환경변수 필요(로컬은 .env.local).
const EL_API_KEY = process.env.ELEVENLABS_API_KEY || process.env["11LABS"] || "";
const SUPERTONE_API_KEY = process.env.SUPERTONE_API_KEY || "";
const SUPERTONE_TTS_URL = "https://supertoneapi.com/v1/text-to-speech";

type KoreanVoiceEngine = "eleven" | "chirp" | "supertone";
interface KoreanVoiceConfig {
  engine: KoreanVoiceEngine;
  gender: "male" | "female"; // GCP 폴백 성별
  elevenId?: string; // engine=eleven
  chirpName?: string; // engine=chirp (GCP Chirp3-HD 음성 이름)
  supId?: string; // engine=supertone (voice_id)
  supModel?: string; // sona_speech_2 | supertonic_api_3(클론)
  supStyle?: string; // 클론 보이스는 style 미지정 (있으면 400)
  /**
   * 라이브 합성 엔진이 없고 **사전 생성 음원만** 있는 성우(영희).
   * 두 가지가 달라진다:
   *  1) 캐시 미스면 생성 단계 없이 곧장 대신 읽을 성우로 넘어간다(KOREAN_STAND_INS).
   *  2) 이 성우의 키에는 **라이브 산출물을 절대 저장하지 않는다.**
   *     저장하면 나중에 올라올 진짜 음원이 "이미 있음"으로 건너뛰어져 영영 반영되지 않는다.
   */
  pregenerated?: boolean;
}
const KOREAN_VOICE_CONFIG: Record<string, KoreanVoiceConfig> = {
  m1: { engine: "eleven", gender: "male", elevenId: "657hGmxIvJTkmFa17K9v" }, // 천사장
  m2: { engine: "chirp", gender: "male", chirpName: "ko-KR-Chirp3-HD-Charon" }, // Charon
  m3: { engine: "supertone", gender: "male", supId: "95be956023597487733bbb", supModel: "sona_speech_2", supStyle: "neutral" }, // Watson
  m4: { engine: "supertone", gender: "male", supId: "ff700760946618e1dcf7bd", supModel: "sona_speech_2", supStyle: "neutral" }, // Garret
  m5: { engine: "supertone", gender: "male", supId: "qpmBg3YZ249rKgdPLGp75w", supModel: "supertonic_api_3" }, // Daddy(클론, style 없음)
  // 김단아 — elevenId 를 바꾸면 TtsContext STAND_IN_TAGS.f1 도 같이 바꾼다(기기가 대신 읽은 음원을 가리는 표지)
  f1: { engine: "eleven", gender: "female", elevenId: "vDA1h0ZXkQiojUReMmR9" }, // 김단아
  f2: { engine: "chirp", gender: "female", chirpName: "ko-KR-Chirp3-HD-Aoede" }, // Aoede
  f3: { engine: "supertone", gender: "female", supId: "39f27eaab088024ff6f9ac", supModel: "sona_speech_2", supStyle: "neutral" }, // Cindy
  // 영희 — 커스텀 클론(로컬 GPU 사전 생성). 라이브 합성 엔진이 없다.
  // 캐시에 있으면 그것을 서빙하고, 아직 안 만든 절은 김단아(f1)가 대신 읽는다(KOREAN_STAND_INS).
  f4: { engine: "eleven", gender: "female", pregenerated: true },
};

function ttsAudioResponse(
  body: ArrayBuffer | Buffer,
  voiceTag: string,
  cache: "hit" | "miss" = "miss",
): NextResponse {
  return new NextResponse(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=86400",
      "X-TTS-Voice": voiceTag,
      "X-TTS-Cache": cache, // hit = R2 공유 캐시 서빙(합성 안 함), miss = 신규 합성
    },
  });
}

async function synthElevenLabs(text: string, voiceId: string, speed: number): Promise<ArrayBuffer | null> {
  if (!EL_API_KEY || !voiceId) return null;
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
    if (!r.ok) {
      console.error("[ElevenLabs]", r.status, (await r.text()).slice(0, 150));
      if ([401, 402, 403, 429].includes(r.status)) markEngineDown("elevenlabs"); // 쿼터/인증/레이트 → 브레이커
      return null;
    }
    clearEngineDown("elevenlabs"); // 성공 → 복구
    return await r.arrayBuffer(); // ArrayBuffer 는 BodyInit — NextResponse 에 그대로 전달 가능
  } catch (e) {
    console.error("[ElevenLabs] exception", e instanceof Error ? e.message : e);
    markEngineDown("elevenlabs"); // 네트워크/타임아웃 → 브레이커
    return null;
  }
}

// Supertone 은 요청당 300자 제한 → 문장 단위로 분할해 각각 합성 후 이어붙임.
// 한 문장도 300자 초과면 길이로 하드 분할(성경 단문에선 사실상 발생 안 함).
function splitForSupertone(text: string, max = 300): string[] {
  const t = text.trim();
  if (t.length <= max) return [t];
  const sentences = t.match(/[^.!?。？！]+[.!?。？！]*\s*/g) ?? [t];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max) {
      if (cur.trim()) { chunks.push(cur.trim()); cur = ""; }
      if (s.length > max) {
        for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max).trim());
      } else {
        cur = s;
      }
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

// Supertone 합성. 재생 속도는 voice_settings.speed 로 전달(최상위 speed 는 무시됨).
async function synthSupertone(text: string, cfg: KoreanVoiceConfig, speed: number): Promise<Buffer | null> {
  if (!SUPERTONE_API_KEY || !cfg.supId) return null;
  const spd = Math.min(2, Math.max(0.5, speed || 1)); // Supertone speed 범위 0.5~2
  const chunks = splitForSupertone(text, 300);
  try {
    const parts: Buffer[] = [];
    for (const chunk of chunks) {
      const body: Record<string, unknown> = {
        text: chunk,
        language: "ko",
        model: cfg.supModel || "sona_speech_2",
        output_format: "mp3",
        voice_settings: { speed: spd },
      };
      if (cfg.supStyle) body.style = cfg.supStyle; // 클론(supStyle 없음)은 생략해야 성공
      const r = await fetch(`${SUPERTONE_TTS_URL}/${cfg.supId}?output_format=mp3`, {
        method: "POST",
        headers: { "x-sup-api-key": SUPERTONE_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        console.error("[Supertone]", r.status, (await r.text()).slice(0, 150));
        if ([401, 402, 403, 429].includes(r.status)) markEngineDown("supertone"); // 크레딧/인증/레이트 → 브레이커
        return null;
      }
      parts.push(Buffer.from(await r.arrayBuffer()));
    }
    clearEngineDown("supertone"); // 성공 → 복구
    return parts.length === 1 ? parts[0] : Buffer.concat(parts);
  } catch (e) {
    console.error("[Supertone] exception", e instanceof Error ? e.message : e);
    markEngineDown("supertone"); // 네트워크/타임아웃 → 브레이커
    return null;
  }
}

/**
 * 고른 성우로 못 읽을 때 **대신 읽을 성우** — 앞에서부터. 영희(사전 생성 음원만) → 김단아(ElevenLabs).
 * 모든 성우가 같은 규칙: 고른 성우(음원 → 생성) → 영희 음원 → 김단아(음원 → 생성) → GCP(고른 성우의 성별).
 * 한 요청에서 이 목록을 한 번 훑을 뿐 성우끼리 서로를 통째로 부르지 않으므로, 영희↔김단아처럼
 * 서로를 대신해도 돌고 돌지 않는다. 기기는 이 성우들의 음원 표지(TtsContext STAND_IN_TAGS)로
 * 대신 읽은 음원을 가려 저장하지 않는다 — 여기에 성우를 더하면 거기에도 더한다.
 */
const KOREAN_STAND_INS = ["f4", "f1"] as const;

/** 성우의 라이브 엔진으로 합성 — 엔진이 없거나(영희) 차단 중이거나 실패하면 null */
async function synthLive(text: string, cfg: KoreanVoiceConfig): Promise<{ body: Buffer; tag: string } | null> {
  if (cfg.pregenerated) return null;
  if (cfg.engine === "eleven") {
    if (isEngineDown("elevenlabs")) {
      console.error("[TTS] ElevenLabs down(브레이커) → 다음 순서");
      return null;
    }
    const el = await synthElevenLabs(text, cfg.elevenId ?? "", 1);
    return el ? { body: Buffer.from(el), tag: `el:${cfg.elevenId}` } : null;
  }
  if (cfg.engine === "supertone") {
    if (isEngineDown("supertone")) {
      console.error("[TTS] Supertone down(브레이커) → 다음 순서");
      return null;
    }
    const sup = await synthSupertone(text, cfg, 1);
    return sup ? { body: sup, tag: `sup:${cfg.supId}` } : null;
  }
  return null;
}

/**
 * 한국어 Chirp3-HD 는 쉼표를 무시한다(2025-08 Google 개발자 포럼 보고, 고친다는 약속 없음) — 쉼표에서 안 쉬고
 * 엉뚱한 곳에서 쉬어 띄어쓰기가 어색하게 들린다. markup 입력의 쉼 표시로 쉼표마다 쉬게 한다
 * (2026-09-11 새번역 7절 시험: 쉼표마다 0.4~0.6초, 엉뚱한 쉼 사라짐). 마침표에서는 원래 쉰다.
 * 본문의 [ ](새번역 88절, 예: 마 18:15 "[너에게]")는 쉼 표시와 문법이 겹쳐 괄호 글자만 뺀다(말은 그대로 읽는다).
 */
const KO_CHIRP_COMMA_PAUSE = "[pause short]";
function koChirpMarkup(text: string): string {
  return text.replace(/[[\]]/g, "").replace(/[,，]\s*(?=\S)/g, `, ${KO_CHIRP_COMMA_PAUSE} `);
}

/**
 * 공유 캐시(R2)의 성우 칸. 생생·쾌활(Chirp 가 자기 엔진)은 쉼표 쉼(koChirpMarkup) 전 음원이 옛 칸(f2/m2)에 남아 있어
 * 새 칸("f2-p"·"m2-p")에 새로 만든다 — 기기 캐시도 같은 이유로 칸 이름이 다르다(TtsContext cacheVoiceSlot).
 */
function koVoiceCacheSlot(kv: string): string {
  return KOREAN_VOICE_CONFIG[kv]?.engine === "chirp" ? `${kv}-p` : kv;
}

export async function POST(req: NextRequest) {
  try {
    // speed 는 더 이상 서버에서 사용 안 함 — 합성은 항상 1.0x, 재생 속도는 클라이언트 playbackRate.
    const { text, voice, lang, accent, pitch, volumeGainDb, koreanVoice } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    // TTS 입력 정제: 새번역(rnksv) 등 편집자 주석 "(주: …)"은 화면엔 두되 낭독에서만 제외.
    const ttsText = cleanForTts(text);
    if (new TextEncoder().encode(ttsText).length > 5000) {
      return NextResponse.json(
        { error: "text too long (max 5000 bytes)" },
        { status: 400 },
      );
    }

    const isMale = voice === "male";
    const isEng = lang === "en";

    // ── 공유 캐시(R2) 조회 — hit 시 합성 없이 서빙. 콘텐츠 주소화(본문 sha1)로 절·성우당 전역 1회만 합성 ──
    const voiceKey = isEng
      ? `${accent === "gb" ? "gb" : "us"}-${isMale ? "male" : "female"}`
      : koVoiceCacheSlot(koreanVoice || "m1");
    const r2Key = ttsCacheKey(ttsText, voiceKey, isEng ? "en" : "ko");
    const cachedR2 = await getR2Audio(r2Key);
    if (cachedR2) {
      return ttsAudioResponse(cachedR2.buffer, cachedR2.voice || "r2", "hit");
    }

    // 한국어: 고른 성우(음원 → 생성) → 대신 읽을 성우(영희 음원 → 김단아 음원 → 김단아 생성) → 아래 GCP.
    // 각 단계를 한 번씩만 시도한다(KOREAN_STAND_INS). 생성에 성공하면 **그 성우의 키로** 저장한다 —
    // 그 성우의 진짜 음원이라 같은 절을 그 성우로 듣는 사람과 공유된다. 영희는 생성 단계가 없어 영희 키엔
    // 라이브 산출물이 절대 들어가지 않는다. GCP 폴백 산출물은 저장하지 않는다(엔진이 돌아오면 진짜 음색으로).
    let koreanCfg: KoreanVoiceConfig | null = null;
    if (!isEng) {
      const kv = koreanVoice || "m1";
      koreanCfg = KOREAN_VOICE_CONFIG[kv] ?? KOREAN_VOICE_CONFIG.m1;
      // Chirp 가 1순위인 옛 성우(생생·활력)는 아래 GCP 가 곧 자기 엔진이다
      if (koreanCfg.engine !== "chirp") {
        const order: string[] = [kv, ...KOREAN_STAND_INS.filter((v) => v !== kv)];
        for (const [i, v] of order.entries()) {
          const key = i === 0 ? r2Key : ttsCacheKey(ttsText, v, "ko");
          if (i > 0) {
            const hit = await getR2Audio(key); // 고른 성우의 음원은 위에서 이미 봤다
            if (hit) return ttsAudioResponse(hit.buffer, hit.voice || "r2", "hit");
          }
          const live = await synthLive(ttsText, i === 0 ? koreanCfg : KOREAN_VOICE_CONFIG[v]);
          if (live) {
            void putR2Audio(key, live.body, live.tag);
            return ttsAudioResponse(live.body, live.tag);
          }
        }
      }
    }

    const isGb = isEng && accent === "gb";
    const languageCode = isEng ? (isGb ? "en-GB" : "en-US") : "ko-KR";
    // 한국어 폴백 성별은 성우 config 기준(클라이언트 voice 슬롯과 동일하지만 명시적으로).
    const koMale = koreanCfg ? koreanCfg.gender === "male" : isMale;
    // 한국어 폴백 순서: GCP Chirp3-HD(음질 우선) → Neural2 → WaveNet.
    // m2/f2 는 Chirp 가 1순위이기도 하며(위에서 primary 시도 안 함) 여기서 첫 후보로 처리됨.
    const koChirp = koMale ? "ko-KR-Chirp3-HD-Charon" : "ko-KR-Chirp3-HD-Aoede";
    const koNeural = koMale ? "ko-KR-Neural2-C" : "ko-KR-Neural2-A";
    const koWave = koMale ? "ko-KR-Wavenet-C" : "ko-KR-Wavenet-A";
    // 영문: Chirp3-HD(녹음급) 1순위 → Neural2 폴백.
    const candidates = isEng
      ? (isGb
          ? (isMale
              ? ["en-GB-Chirp3-HD-Charon", "en-GB-Neural2-B"]
              : ["en-GB-Chirp3-HD-Aoede", "en-GB-Neural2-A"])
          : (isMale
              ? ["en-US-Chirp3-HD-Charon", "en-US-Neural2-D"]
              : ["en-US-Chirp3-HD-Aoede", "en-US-Neural2-F"]))
      : [koChirp, koNeural, koWave];

    const token = await getAccessToken();

    let audioContent: string | null = null;
    let usedVoice = "";
    let lastError = "";

    for (const voiceName of candidates) {
      const isChirp = voiceName.includes("Chirp");
      const audioConfig: Record<string, unknown> = {
        audioEncoding: "MP3",
        speakingRate: 1.0, // 항상 1.0x 합성 — 재생 속도는 클라이언트 playbackRate
        volumeGainDb: volumeGainDb ?? 0,
      };
      if (!isChirp) {
        audioConfig.pitch = pitch ?? 0;
      }

      const synth = (input: Record<string, string>) =>
        fetch(TTS_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ input, voice: { languageCode, name: voiceName }, audioConfig }),
        });
      // 한국어 Chirp 는 쉼표마다 쉼 표시를 넣어 보낸다(koChirpMarkup). 거절되면 그냥 글자로 다시
      const markup = isChirp && !isEng ? koChirpMarkup(ttsText) : null;
      let apiResponse = await synth(markup ? { markup } : { text: ttsText });
      if (markup && apiResponse.status === 400) {
        console.error("[TTS] Chirp 쉼 표시 거절 → 글자로 다시", (await apiResponse.text()).slice(0, 150));
        apiResponse = await synth({ text: ttsText });
      }

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
    // canonical(요청 성우의 1순위 산출물)만 공유 캐시에 저장 — 영문/한국어 Chirp(m2·f2)는 Chirp 가 1순위.
    // 한국어 eleven/supertone 이 여기까지 온 건 폴백이므로 캐시 안 함(엔진 복구 시 진짜 음색으로 재합성).
    const canonical = isEng || koreanCfg?.engine === "chirp";
    if (canonical) void putR2Audio(r2Key, buffer, usedVoice);
    return ttsAudioResponse(buffer, usedVoice);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "TTS generation failed";
    console.error("[TTS] exception:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
