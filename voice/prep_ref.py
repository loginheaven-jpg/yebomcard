# prep_ref.py — 리딩지저스 녹음에서 참조 클립을 잘라 보이스로 등록하고,
#                비교용 원본 1장 구간도 함께 추출한다.
#
# 구간은 ASR(transcribe_full.py) 로 정렬해 "절 경계"에 맞춘 값이다.
#   참조 클립 : 9.74 ~ 34.58s  = 요한일서 1:1~1:2 (24.8초)
#   원본 1장  : 9.74 ~ 115.50s = 요한일서 1:1~1:10 (인트로/장 안내 제외)
#
# ref_text 는 ASR 결과가 아니라 **실제 개역 본문**을 쓴다. ASR 오인식이
# 참조 텍스트에 섞이면 클로닝 품질이 떨어지기 때문.

import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).parent
SRC = BASE / "리딩지저스.mp3"
TEXT = BASE / "text" / "1jn_nkrv.json"
VOICES = BASE / "voices"
COMPARE = BASE / "compare"

VOICE_NAME = "리딩지저스"
REF_START, REF_END = 9.74, 34.58      # 1:1 ~ 1:2
CH1_START, CH1_END = 9.74, 115.50     # 1:1 ~ 1:10
SR_TARGET = 24000


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=False)
    if r.returncode != 0:
        sys.stderr.write(r.stderr.decode("utf-8", "replace")[-800:])
        raise RuntimeError("ffmpeg 실패: " + " ".join(map(str, cmd[:6])))


def cut(src, dst, start, end, sr=SR_TARGET, mono=True, wav=True):
    cmd = ["ffmpeg", "-y", "-i", str(src), "-ss", str(start), "-to", str(end), "-ar", str(sr)]
    if mono:
        cmd += ["-ac", "1"]
    if wav:
        cmd += ["-c:a", "pcm_s16le"]
    cmd += [str(dst)]
    run(cmd)


def main():
    if not SRC.exists():
        print("원본 없음:", SRC); sys.exit(1)
    if not TEXT.exists():
        print("본문 JSON 없음:", TEXT); sys.exit(1)

    ch = json.loads(TEXT.read_text(encoding="utf-8"))
    ch1 = ch["1"]
    ref_text = (ch1[0] + " " + ch1[1]).strip()   # 1:1 + 1:2

    # 1) 참조 클립 → 보이스 등록
    vdir = VOICES / VOICE_NAME
    vdir.mkdir(parents=True, exist_ok=True)
    ref_wav = vdir / "ref.wav"
    cut(SRC, ref_wav, REF_START, REF_END)

    import soundfile as sf
    info = sf.info(str(ref_wav))
    (vdir / "meta.json").write_text(json.dumps({
        "name": VOICE_NAME,
        "ref_text": ref_text,
        "duration": round(info.duration, 2),
        "source": SRC.name,
        "range": [REF_START, REF_END],
        "note": "개역 요한일서 1:1-1:2 (ASR 정렬로 절 경계 맞춤, 텍스트는 DB 원문)",
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"[보이스] {VOICE_NAME} 등록")
    print(f"  ref.wav : {info.duration:.2f}초 / {info.samplerate}Hz / {info.channels}ch")
    print(f"  ref_text: {ref_text[:60]}... ({len(ref_text)}자)")

    # 2) 비교용 원본 1장 구간
    COMPARE.mkdir(parents=True, exist_ok=True)
    orig = COMPARE / "original_nkrv_1jn_001.mp3"
    cmd = ["ffmpeg", "-y", "-i", str(SRC), "-ss", str(CH1_START), "-to", str(CH1_END),
           "-ac", "1", "-b:a", "128k", str(orig)]
    run(cmd)
    oi = sf.info(str(orig)) if orig.suffix == ".wav" else None
    dur = CH1_END - CH1_START
    chars = sum(len(t) for t in ch1)
    print(f"[비교원본] {orig.name} — {dur:.1f}초 / 본문 {chars}자 / {chars/dur:.2f}자당초")


if __name__ == "__main__":
    main()
