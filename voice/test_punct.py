# test_punct.py — 구두점(특히 문장 끝 마침표)이 개역체 어미를 훼손하는지 검증한다.
#
# 가설: 절 끝에 마침표를 붙이면 모델이 "…함이라" 를 현대 종결형 "…합니다" 로
#       정규화해 버린다(성경 본문 훼손). 표본을 늘려 재현되는지 본다.
#
#   python test_punct.py --n 3

import argparse
import json
import re
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).parent
VOICES = BASE / "voices"
TMP = BASE / "_punct_test"
MODEL_PATH = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"

import prosody

NORM = re.compile(r"[\s.,!?·\"'“”‘’()\[\]:;]")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="리딩지저스")
    ap.add_argument("--n", type=int, default=3, help="변형별 반복 생성 수")
    ap.add_argument("--temp", type=float, default=0.75)
    args = ap.parse_args()

    TMP.mkdir(exist_ok=True)
    ch1 = json.loads((BASE / "text" / "1jn_nkrv.json").read_text(encoding="utf-8"))["1"]
    # 1절: 쉼표가 들어가는 절 / 4절: 쉼표 없이 마침표만 붙는 절(어미 훼손 관측된 곳)
    targets = {1: ch1[0], 4: ch1[3]}

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

    variants = {
        "A_원문그대로": lambda t: t,
        "C_구두점주입": prosody.add_punct,
    }

    print(f"반복 {args.n}회 · temp {args.temp}\n")
    for vno, src in targets.items():
        print(f"── {vno}절 ──")
        print(f"   원문: {src}")
        tail = src.strip()[-4:]
        for vname, fn in variants.items():
            text = fn(src)
            hits = 0
            outs = []
            for i in range(args.n):
                wavs, sr = tts.generate_voice_clone(
                    text=text, language="Korean", voice_clone_prompt=prompt, **gk)
                w = np.asarray(wavs[0], dtype=np.float32)
                f = TMP / f"v{vno}_{vname}_{i}.wav"
                sf.write(str(f), w, sr)
                segs, _ = asr.transcribe(str(f), language="ko", vad_filter=False)
                hyp = " ".join(s.text.strip() for s in segs).strip()
                ok = NORM.sub("", tail) in NORM.sub("", hyp)
                hits += ok
                outs.append(("O" if ok else "X", hyp))
            print(f"   [{vname}] 입력: {text}")
            print(f"      어미'{tail}' 보존 {hits}/{args.n}")
            for mark, h in outs:
                print(f"        {mark} {h}")
        print()


if __name__ == "__main__":
    main()
