# align_head.py — 녹음 앞부분을 ASR 로 훑어 인트로 유무와 1:1 시작 지점을 찾는다.
# 참조 클립(ref)을 "절 경계"에 맞춰 자르기 위한 정렬 용도. ref_text 는 ASR 이 아니라
# 실제 개역 본문을 쓸 것이므로, 여기서는 타임스탬프만 정확하면 된다.

import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).parent
SRC = BASE / "리딩지저스.mp3"
TMP = BASE / "_head.wav"
HEAD_SEC = 150

def main():
    if not SRC.exists():
        print("원본 mp3 없음:", SRC); sys.exit(1)

    # whisper 입력용 16k mono
    cmd = ["ffmpeg", "-y", "-i", str(SRC), "-t", str(HEAD_SEC),
           "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(TMP)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("ffmpeg 실패\n", r.stderr[-800:]); sys.exit(1)

    from faster_whisper import WhisperModel
    print("모델 로드 중(최초 1회 다운로드)...")
    model = WhisperModel("small", device="cuda", compute_type="float16")

    segments, info = model.transcribe(str(TMP), language="ko", vad_filter=False)
    print(f"언어={info.language} / 앞 {HEAD_SEC}초 전사\n")
    for s in segments:
        print(f"[{s.start:7.2f} → {s.end:7.2f}]  {s.text.strip()}")

if __name__ == "__main__":
    main()
