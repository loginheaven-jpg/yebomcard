# test_version.py — 역본(개역=고어 / 새번역=현대어)에 따라 어미 훼손률이 다른지 본다.
#
# 배경: 개역 "…하려 함이라" 가 "…하려 합니다" 로 정규화되는 현상 관측(보존 1/3).
#       전량 생성 대상 역본을 정하는 근거가 되므로 수치로 확인한다.
#
#   python test_version.py --n 4

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import requests
import soundfile as sf

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).parent
VOICES = BASE / "voices"
TMP = BASE / "_ver_test"
ENV_FILE = BASE.parent / ".env.local"
MODEL_PATH = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
NOTE_RE = re.compile(r"\s*\(\s*주\s*[:：][\s\S]*$")
NORM = re.compile(r"[\s.,!?·\"'“”‘’()\[\]:;]")


def fetch(version, book, chapter, verses):
    env = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            env[m.group(1)] = m.group(2).strip()
    r = requests.get(
        f"{env['NEXT_PUBLIC_SUPABASE_URL']}/rest/v1/bible_verses",
        params={"version": f"eq.{version}", "book_code": f"eq.{book}",
                "chapter": f"eq.{chapter}", "select": "verse,text", "order": "verse.asc"},
        headers={"apikey": env["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
                 "Authorization": f"Bearer {env['NEXT_PUBLIC_SUPABASE_ANON_KEY']}"}, timeout=30)
    r.raise_for_status()
    d = {x["verse"]: NOTE_RE.sub("", x["text"]).strip() for x in r.json()}
    return [(v, d[v]) for v in verses if v in d]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="리딩지저스")
    ap.add_argument("--n", type=int, default=4)
    ap.add_argument("--temp", type=float, default=0.75)
    ap.add_argument("--verses", default="3,4,5")
    args = ap.parse_args()

    TMP.mkdir(exist_ok=True)
    want = [int(x) for x in args.verses.split(",")]
    sets = {"개역(nkrv)": fetch("nkrv", "1jn", 1, want),
            "새번역(rnksv)": fetch("rnksv", "1jn", 1, want)}

    vdir = VOICES / args.voice
    meta = json.loads((vdir / "meta.json").read_text(encoding="utf-8"))

    import torch
    from qwen_tts import Qwen3TTSModel
    tts = Qwen3TTSModel.from_pretrained(
        MODEL_PATH, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    prompt = tts.create_voice_clone_prompt(
        ref_audio=str(vdir / "ref.wav"), ref_text=meta["ref_text"])
    gk = dict(max_new_tokens=2048, do_sample=True, top_k=50, top_p=1.0,
              temperature=args.temp, repetition_penalty=1.05,
              subtalker_dosample=True, subtalker_top_k=50, subtalker_top_p=1.0,
              subtalker_temperature=args.temp)

    from faster_whisper import WhisperModel
    asr = WhisperModel("small", device="cuda", compute_type="float16")

    print(f"반복 {args.n}회 · temp {args.temp}\n")
    summary = {}
    for vername, rows in sets.items():
        tot = hit = 0
        print(f"===== {vername} =====")
        for vno, src in rows:
            tail = src.strip()[-5:]
            ok_n = 0
            bad = []
            for i in range(args.n):
                wavs, sr = tts.generate_voice_clone(
                    text=src, language="Korean", voice_clone_prompt=prompt, **gk)
                f = TMP / f"{vername[:2]}_{vno}_{i}.wav"
                sf.write(str(f), np.asarray(wavs[0], dtype=np.float32), sr)
                segs, _ = asr.transcribe(str(f), language="ko", vad_filter=False)
                hyp = " ".join(s.text.strip() for s in segs).strip()
                if NORM.sub("", tail) in NORM.sub("", hyp):
                    ok_n += 1
                else:
                    bad.append(hyp)
            tot += args.n
            hit += ok_n
            print(f"  {vno}절 어미'{tail}' 보존 {ok_n}/{args.n}   ({src[:34]}…)")
            for b in bad[:2]:
                print(f"       X {b}")
        summary[vername] = (hit, tot)
        print()

    print("===== 요약 =====")
    for k, (h, t) in summary.items():
        print(f"  {k}: 어미 보존 {h}/{t} = {h/t*100:.0f}%")


if __name__ == "__main__":
    main()
