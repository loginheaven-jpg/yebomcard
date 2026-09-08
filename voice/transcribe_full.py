# transcribe_full.py — 원본 전체를 1회 전사해 세그먼트를 JSON 으로 저장한다.
# 용도: (1) 참조 클립을 절 경계에 맞춰 자르기 (2) 장 경계 찾아 비교용 원본 구간 추출
# 주의: ref_text 는 ASR 이 아니라 실제 개역 본문을 쓴다. 여기서는 타임스탬프가 목적.

import json
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).parent
SRC = BASE / "리딩지저스.mp3"
WAV = BASE / "_full16k.wav"
OUT = BASE / "text" / "asr_segments.json"

def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if not WAV.exists():
        cmd = ["ffmpeg", "-y", "-i", str(SRC), "-ar", "16000", "-ac", "1",
               "-c:a", "pcm_s16le", str(WAV)]
        r = subprocess.run(cmd, capture_output=True, text=False)
        if r.returncode != 0:
            print("ffmpeg 실패"); sys.exit(1)

    from faster_whisper import WhisperModel
    model = WhisperModel("small", device="cuda", compute_type="float16")
    segments, info = model.transcribe(str(WAV), language="ko", vad_filter=False)

    segs = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
            for s in segments]
    OUT.write_text(json.dumps(segs, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"saved {len(segs)} segments -> {OUT}")
    print(f"last end = {segs[-1]['end'] if segs else 0}s")

if __name__ == "__main__":
    main()
