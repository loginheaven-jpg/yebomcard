# gen_verses.py — 등록된 보이스로 성경 한 장을 "절 단위"로 생성한다.
#
#   python gen_verses.py --voice 리딩지저스 --version nkrv --book 1jn --chapter 1 --batch 2
#
# 산출물 (out/{version}_{book}_{chapter}/)
#   {version}_{book}_{ch:03d}_{verse:03d}.wav   절별 파일 (production 단위)
#   _merged.wav                                  이어듣기용 합본 (비교 청취용)
#   manifest.json                                절별 글자수/길이/생성시간/RTF
#
# 설계 메모
#  - 절이 길면 내부적으로 문장 분할해 생성 후 이어붙이되, **출력은 절당 1파일**로 유지.
#  - 배치는 "청크" 단위로 묶어 처리량을 올린다(장 전체를 한 번에 큐잉).
#  - 이미 생성된 절은 건너뛴다(--force 로 재생성). 전량 생성 시 재개 가능성 확보.
#  - 재현성을 위해 --seed 지원. 배치 생산에서는 고정 시드를 권장.

import argparse
import json
import re
import sys
import time
from pathlib import Path

import numpy as np
import requests
import soundfile as sf

import prosody

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).parent
VOICES = BASE / "voices"
OUTROOT = BASE / "out"
ENV_FILE = BASE.parent / ".env.local"

MODEL_PATH = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
SR_TARGET = 24000
MAX_LEN = 120
# 예봄성경 서버(app/api/tts/route.ts)와 동일한 정제 규칙 — 바꾸지 말 것
NOTE_RE = re.compile(r"\s*\(\s*주\s*[:：][\s\S]*$")

GEN_KWARGS = dict(
    max_new_tokens=2048,
    do_sample=True,
    top_k=50,
    top_p=1.0,
    temperature=0.9,
    repetition_penalty=1.05,
    subtalker_dosample=True,
    subtalker_top_k=50,
    subtalker_top_p=1.0,
    subtalker_temperature=0.9,
)


def load_env():
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
            if m:
                env[m.group(1)] = m.group(2).strip()
    return env


def fetch_verses(version, book, chapter):
    env = load_env()
    url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError(".env.local 에서 Supabase 정보를 못 읽었다")
    r = requests.get(
        f"{url}/rest/v1/bible_verses",
        params={"version": f"eq.{version}", "book_code": f"eq.{book}",
                "chapter": f"eq.{chapter}", "select": "verse,text", "order": "verse.asc"},
        headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=30)
    r.raise_for_status()
    return [(x["verse"], NOTE_RE.sub("", x["text"]).strip()) for x in r.json()]


def split_text(text, max_len=MAX_LEN):
    parts, buf = [], ""
    for chunk in re.split(r"(?<=[.!?。？！])\s+|\n+", text.strip()):
        chunk = chunk.strip()
        if not chunk:
            continue
        if len(buf) + len(chunk) <= max_len:
            buf = (buf + " " + chunk).strip()
        else:
            if buf:
                parts.append(buf)
            buf = chunk
    if buf:
        parts.append(buf)
    out = []
    for p in parts:
        while len(p) > max_len * 2:
            cut = p.rfind(" ", 0, max_len * 2)
            cut = cut if cut > max_len // 2 else max_len * 2
            out.append(p[:cut].strip())
            p = p[cut:].strip()
        if p:
            out.append(p)
    return out or [text.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", required=True)
    ap.add_argument("--version", default="nkrv")
    ap.add_argument("--book", default="1jn")
    ap.add_argument("--chapter", type=int, default=1)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--gap", type=float, default=0.35, help="합본에서 절 사이 쉼(초)")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--temp", type=float, default=0.75,
                    help="샘플링 온도 — 낮을수록 억양이 안정된다")
    ap.add_argument("--no-punct", action="store_true",
                    help="구두점 주입 끄기 (A/B 비교용)")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    gen_kwargs = dict(GEN_KWARGS)
    gen_kwargs["temperature"] = args.temp
    gen_kwargs["subtalker_temperature"] = args.temp

    vdir = VOICES / args.voice
    if not (vdir / "ref.wav").exists():
        print("보이스 없음:", vdir); sys.exit(1)
    meta = json.loads((vdir / "meta.json").read_text(encoding="utf-8"))

    verses = fetch_verses(args.version, args.book, args.chapter)
    if not verses:
        print("본문 없음"); sys.exit(1)

    outdir = OUTROOT / f"{args.version}_{args.book}_{args.chapter:03d}"
    outdir.mkdir(parents=True, exist_ok=True)

    def vpath(v):
        return outdir / f"{args.version}_{args.book}_{args.chapter:03d}_{v:03d}.wav"

    todo = [(v, t) for v, t in verses if args.force or not vpath(v).exists()]
    print(f"[대상] {args.version} {args.book} {args.chapter}장 — 전체 {len(verses)}절 / 생성 {len(todo)}절")
    if not todo:
        print("모두 생성되어 있다 (--force 로 재생성)"); return

    import torch
    from qwen_tts import Qwen3TTSModel
    if args.seed is not None:
        torch.manual_seed(args.seed)

    print("모델 로드 중...")
    t_load = time.time()
    tts = Qwen3TTSModel.from_pretrained(
        MODEL_PATH, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    print(f"  로드 {time.time()-t_load:.1f}초")

    prompt = tts.create_voice_clone_prompt(
        ref_audio=str(vdir / "ref.wav"), ref_text=meta["ref_text"])

    # 절 → 청크 평탄화 (절당 1파일 유지를 위해 소속 절을 기록)
    # 구두점은 **생성 입력에만** 주입한다. 원문(=공유 캐시 sha1 대상)은 불변.
    flat = []   # (verse, chunk_text)
    for v, t in todo:
        gen_text = t if args.no_punct else prosody.add_punct(t)
        for c in split_text(gen_text):
            flat.append((v, c))
    print(f"[청크] {len(flat)}개 (배치 {args.batch})")

    results = {}
    total_gen = 0.0
    sr = SR_TARGET
    t_all = time.time()

    for i in range(0, len(flat), args.batch):
        batch = flat[i:i + args.batch]
        texts = [c for _, c in batch]
        t0 = time.time()
        if len(texts) == 1:
            wavs, sr = tts.generate_voice_clone(
                text=texts[0], language="Korean", voice_clone_prompt=prompt, **gen_kwargs)
        else:
            wavs, sr = tts.generate_voice_clone(
                text=texts, language="Korean",
                voice_clone_prompt=prompt * len(texts), **gen_kwargs)
        dt = time.time() - t0
        total_gen += dt
        for (v, _), w in zip(batch, wavs):
            results.setdefault(v, []).append(np.asarray(w, dtype=np.float32))
        done = min(i + args.batch, len(flat))
        print(f"  {done}/{len(flat)} · {dt:.1f}초")

    # 절별 파일 기록
    manifest = []
    gap_in = np.zeros(int(sr * 0.15), dtype=np.float32)
    for v, t in todo:
        parts = results.get(v, [])
        if not parts:
            continue
        merged = parts[0]
        for p in parts[1:]:
            merged = np.concatenate([merged, gap_in, p])
        sf.write(str(vpath(v)), merged, sr)
        manifest.append({"verse": v, "chars": len(t),
                         "audio_sec": round(len(merged) / sr, 2),
                         "chunks": len(parts), "file": vpath(v).name})

    wall = time.time() - t_all
    audio_sec = sum(m["audio_sec"] for m in manifest)
    rtf = total_gen / audio_sec if audio_sec else 0
    cps = sum(m["chars"] for m in manifest) / audio_sec if audio_sec else 0

    # 합본 (비교 청취용)
    # 절 끝 성격에 따라 무음을 달리 준다 — 종결이면 길게, 다음 절로 이어지면 짧게
    allw = []
    for v, t in verses:
        p = vpath(v)
        if p.exists():
            w, _sr = sf.read(str(p), dtype="float32")
            allw.append(w)
            allw.append(np.zeros(int(sr * prosody.gap_after(t)), dtype=np.float32))
    if allw:
        sf.write(str(outdir / "_merged.wav"), np.concatenate(allw), sr)

    (outdir / "manifest.json").write_text(json.dumps({
        "voice": args.voice, "version": args.version, "book": args.book,
        "chapter": args.chapter, "batch": args.batch, "seed": args.seed,
        "temp": args.temp, "punct": not args.no_punct,
        "gen_sec": round(total_gen, 1), "wall_sec": round(wall, 1),
        "audio_sec": round(audio_sec, 1), "rtf": round(rtf, 3),
        "chars_per_sec": round(cps, 2), "verses": manifest,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n[결과] 절 {len(manifest)}개 · 오디오 {audio_sec:.1f}초 · 생성 {total_gen:.1f}초")
    print(f"  RTF {rtf:.2f} · 낭독속도 {cps:.2f}자/초")
    print(f"  새번역 전량(87.3시간 기준) 환산: {87.3*rtf/24:.1f}일")
    print(f"  출력: {outdir}")


if __name__ == "__main__":
    main()
