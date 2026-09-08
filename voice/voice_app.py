# voice_app.py — 커스텀 보이스 낭독 파일럿
#
# 기능
#   1) 음원 업로드 → 커스텀 보이스 등록 (여러 개 저장, 재시작해도 유지)
#   2) 임의 텍스트를 등록한 보이스로 낭독
#   3) 예봄성경 DB에서 성경 본문을 불러와 절 단위 낭독
#
# 설치
#   pip install gradio soundfile numpy requests
#   (torch, qwen-tts, ffmpeg 는 이미 설치되어 있어야 한다)
#
# 실행
#   python voice_app.py       →  브라우저에서 http://127.0.0.1:7860

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import gradio as gr
import numpy as np
import requests
import soundfile as sf

BASE = Path(__file__).parent
VOICES = BASE / "voices"
OUTPUTS = BASE / "outputs"
VOICES.mkdir(exist_ok=True)
OUTPUTS.mkdir(exist_ok=True)

MODEL_PATH = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
SR_TARGET = 24000
REF_MAX_SEC = 30

SUPABASE_URL = "https://iityjmjgnjtvqujpivjg.supabase.co"
SUPABASE_ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpdHlqbWpnbmp0dnF1anBpdmpnIiwicm9sZSI6"
    "ImFub24iLCJpYXQiOjE3NjY2OTA5MjgsImV4cCI6MjA4MjI2NjkyOH0."
    "u5_KeGldwOYM_JhUiBWqfRuTmCtgmxk_54UT2hi_MKw"
)
SB_HEADERS = {"apikey": SUPABASE_ANON, "Authorization": f"Bearer {SUPABASE_ANON}"}

# 예봄성경 서버와 동일한 정제 규칙 — 바꾸지 말 것
NOTE_RE = re.compile(r"\s*\(\s*주\s*[:：][\s\S]*$")

VERSIONS = {"새번역": "rnksv", "개역개정": "nkrv", "KJV": "kjv", "WEB": "web"}

_tts = None
_books_cache = {}


# ────────────────────────── 모델 ──────────────────────────
def get_tts():
    global _tts
    if _tts is None:
        import torch
        from qwen_tts import Qwen3TTSModel

        if not torch.cuda.is_available():
            raise RuntimeError(
                "CUDA 를 못 찾는다. CPU 전용 torch 가 깔려 있다.\n"
                "pip install torch torchaudio --index-url "
                "https://download.pytorch.org/whl/cu126"
            )
        _tts = Qwen3TTSModel.from_pretrained(
            MODEL_PATH,
            device_map="cuda:0",
            dtype=torch.bfloat16,
            attn_implementation="sdpa",
        )
    return _tts


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


# ────────────────────────── 보이스 관리 ──────────────────────────
def to_24k_mono(src, dst, max_sec=REF_MAX_SEC):
    """어떤 포맷이든 24kHz mono 16bit WAV 로 변환하고 앞부분만 남긴다."""
    cmd = ["ffmpeg", "-y", "-i", str(src), "-t", str(max_sec),
           "-ar", str(SR_TARGET), "-ac", "1", "-c:a", "pcm_s16le", str(dst)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not Path(dst).exists():
        raise RuntimeError(f"오디오 변환 실패\n{r.stderr[-500:]}")


def list_voices():
    return sorted([d.name for d in VOICES.iterdir()
                   if d.is_dir() and (d / "ref.wav").exists()])


def register_voice(name, audio_path, ref_text):
    if not name or not name.strip():
        return "보이스 이름을 입력할 것", gr.update()
    if not audio_path:
        return "음원 파일을 올릴 것", gr.update()
    if not ref_text or not ref_text.strip():
        return "참조 텍스트가 비어 있다. 올린 음원에서 실제로 읽은 문장을 그대로 적을 것", gr.update()

    name = re.sub(r"[^\w가-힣\-]", "_", name.strip())
    vdir = VOICES / name
    vdir.mkdir(exist_ok=True)
    ref = vdir / "ref.wav"

    try:
        to_24k_mono(audio_path, ref)
    except Exception as e:
        shutil.rmtree(vdir, ignore_errors=True)
        return f"실패: {e}", gr.update()

    info = sf.info(str(ref))
    (vdir / "meta.json").write_text(
        json.dumps({"name": name, "ref_text": ref_text.strip(),
                    "duration": round(info.duration, 2)},
                   ensure_ascii=False, indent=2), encoding="utf-8")

    msg = f"'{name}' 등록 완료 — {info.duration:.1f}초 / {info.samplerate}Hz mono"
    if info.duration < 5:
        msg += "\n주의: 5초 미만이면 품질이 떨어진다. 10~30초를 권장한다"
    return msg, gr.update(choices=list_voices(), value=name)


def load_voice(name):
    vdir = VOICES / name
    meta = json.loads((vdir / "meta.json").read_text(encoding="utf-8"))
    return str(vdir / "ref.wav"), meta["ref_text"]


def voice_preview(name):
    if not name:
        return None, ""
    ref, txt = load_voice(name)
    return ref, txt


# ────────────────────────── 생성 ──────────────────────────
def split_text(text, max_len=120):
    """긴 텍스트를 문장 단위로 나눈다. 한 조각이 너무 길면 쉼표에서 더 자른다."""
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
            cut = p.rfind(",", 0, max_len * 2)
            cut = cut if cut > max_len // 2 else max_len * 2
            out.append(p[:cut + 1].strip())
            p = p[cut + 1:].strip()
        if p:
            out.append(p)
    return out or [text.strip()]


def synth(lines, voice_name, batch_size, gap_sec, progress):
    """여러 줄을 생성해 하나로 이어붙인다. (wav, sr, 통계) 반환."""
    tts = get_tts()
    ref_audio, ref_text = load_voice(voice_name)
    prompt = tts.create_voice_clone_prompt(ref_audio=ref_audio, ref_text=ref_text)

    chunks, total_gen = [], 0.0
    sr = SR_TARGET
    done = 0

    for i in range(0, len(lines), batch_size):
        batch = lines[i:i + batch_size]
        progress((done, len(lines)), desc=f"{done}/{len(lines)} 생성 중")

        t0 = time.time()
        wavs, sr = tts.generate_voice_clone(
            text=batch if len(batch) > 1 else batch[0],
            language="Korean",
            voice_clone_prompt=prompt * len(batch) if len(batch) > 1 else prompt,
            **GEN_KWARGS,
        )
        total_gen += time.time() - t0

        for w in wavs:
            chunks.append(np.asarray(w, dtype=np.float32))
        done += len(batch)

    gap = np.zeros(int(sr * gap_sec), dtype=np.float32)
    merged = chunks[0]
    for c in chunks[1:]:
        merged = np.concatenate([merged, gap, c])

    audio_sec = len(merged) / sr
    rtf = total_gen / audio_sec if audio_sec else 0
    stats = (f"조각 {len(chunks)}개 · 오디오 {audio_sec:.1f}초 · "
             f"생성 {total_gen:.1f}초 · 배수 {rtf:.2f}\n"
             f"이 속도면 새번역 전량(84시간)은 약 {84 * rtf / 24:.1f}일")
    return merged, sr, stats


def read_text(voice_name, text, batch_size, gap_sec, progress=gr.Progress()):
    if not voice_name:
        return None, "보이스를 먼저 등록하고 선택할 것"
    if not text or not text.strip():
        return None, "낭독할 텍스트가 비어 있다"

    lines = split_text(text)
    try:
        wav, sr, stats = synth(lines, voice_name, int(batch_size), gap_sec, progress)
    except Exception as e:
        return None, f"생성 실패: {e}"

    out = OUTPUTS / f"{voice_name}_{int(time.time())}.wav"
    sf.write(str(out), wav, sr)
    return str(out), stats


# ────────────────────────── 성경 ──────────────────────────
def sb_get(params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/bible_verses",
                     params=params, headers=SB_HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def get_books(version_label):
    v = VERSIONS[version_label]
    if v in _books_cache:
        return _books_cache[v]
    rows = sb_get({"version": f"eq.{v}", "select": "book_code,book_name,book_order",
                   "order": "book_order.asc", "chapter": "eq.1", "verse": "eq.1"})
    books = [(f"{r['book_name']}", r["book_code"]) for r in rows]
    _books_cache[v] = books
    return books


def on_version_change(version_label):
    try:
        books = get_books(version_label)
    except Exception as e:
        return gr.update(), f"책 목록 조회 실패: {e}"
    return gr.update(choices=[b[0] for b in books],
                     value=books[0][0] if books else None), ""


def fetch_passage(version_label, book_label, chapter, v_from, v_to):
    v = VERSIONS[version_label]
    books = get_books(version_label)
    code = dict(books).get(book_label)
    if not code:
        return "", "책을 선택할 것"

    params = {"version": f"eq.{v}", "book_code": f"eq.{code}",
              "chapter": f"eq.{int(chapter)}",
              "select": "chapter,verse,text", "order": "verse.asc"}
    rows = sb_get(params)
    if not rows:
        return "", f"{book_label} {chapter}장을 찾지 못했다"

    vf, vt = int(v_from or 0), int(v_to or 0)
    if vf:
        rows = [r for r in rows if r["verse"] >= vf]
    if vt:
        rows = [r for r in rows if r["verse"] <= vt]

    lines = [NOTE_RE.sub("", r["text"]).strip() for r in rows]
    body = "\n".join(lines)
    info = f"{book_label} {chapter}장 · {len(lines)}절 · {sum(len(l) for l in lines)}자"
    return body, info


# ────────────────────────── UI ──────────────────────────
with gr.Blocks(title="커스텀 보이스 낭독 파일럿") as demo:
    gr.Markdown("# 커스텀 보이스 낭독 파일럿\n"
                "내 목소리를 등록하고, 임의 텍스트나 성경 본문을 그 목소리로 낭독한다.")

    with gr.Tab("1. 보이스 등록"):
        gr.Markdown(
            "음원을 올리고 **그 음원에서 실제로 읽은 문장**을 그대로 적는다. "
            "10~30초를 권장한다. 30초를 넘으면 앞부분만 쓴다."
        )
        with gr.Row():
            with gr.Column():
                in_name = gr.Textbox(label="보이스 이름", placeholder="예: 목사님")
                in_audio = gr.Audio(label="음원 파일", type="filepath")
                in_reftext = gr.Textbox(label="참조 텍스트 (음원에서 읽은 문장 그대로)",
                                        lines=3)
                btn_reg = gr.Button("보이스 등록", variant="primary")
            with gr.Column():
                out_reg = gr.Textbox(label="결과", lines=4)

    with gr.Tab("2. 텍스트 낭독"):
        with gr.Row():
            with gr.Column(scale=3):
                dd_voice = gr.Dropdown(label="보이스", choices=list_voices(),
                                       value=(list_voices() or [None])[0])
                tb_text = gr.Textbox(label="낭독할 텍스트", lines=10,
                                     placeholder="여기에 낭독할 내용을 붙여넣는다")
                with gr.Row():
                    sl_batch = gr.Slider(1, 8, value=2, step=1,
                                         label="배치 크기 (VRAM 부족하면 1로)")
                    sl_gap = gr.Slider(0.0, 1.5, value=0.4, step=0.1,
                                       label="조각 사이 쉼 (초)")
                btn_read = gr.Button("낭독 생성", variant="primary")
            with gr.Column(scale=2):
                out_audio = gr.Audio(label="결과", type="filepath")
                out_stats = gr.Textbox(label="처리 정보", lines=4)
        with gr.Accordion("선택한 보이스 확인", open=False):
            prev_audio = gr.Audio(label="참조 음원", type="filepath")
            prev_text = gr.Textbox(label="참조 텍스트")

    with gr.Tab("3. 성경 낭독"):
        gr.Markdown("예봄성경 데이터베이스에서 본문을 불러온다.")
        with gr.Row():
            dd_ver = gr.Dropdown(label="역본", choices=list(VERSIONS.keys()),
                                 value="새번역")
            dd_book = gr.Dropdown(label="책", choices=[])
            nb_ch = gr.Number(label="장", value=23, precision=0)
            nb_vf = gr.Number(label="시작 절 (0=처음)", value=0, precision=0)
            nb_vt = gr.Number(label="끝 절 (0=끝)", value=0, precision=0)
        btn_fetch = gr.Button("본문 불러오기")
        tb_passage = gr.Textbox(label="본문", lines=10)
        tb_info = gr.Textbox(label="정보")
        gr.Markdown("불러온 본문을 **2번 탭**에 붙여넣어 낭독한다.")

    # 이벤트
    btn_reg.click(register_voice, [in_name, in_audio, in_reftext],
                  [out_reg, dd_voice])
    dd_voice.change(voice_preview, dd_voice, [prev_audio, prev_text])
    btn_read.click(read_text, [dd_voice, tb_text, sl_batch, sl_gap],
                   [out_audio, out_stats])
    dd_ver.change(on_version_change, dd_ver, [dd_book, tb_info])
    btn_fetch.click(fetch_passage, [dd_ver, dd_book, nb_ch, nb_vf, nb_vt],
                    [tb_passage, tb_info])
    demo.load(on_version_change, dd_ver, [dd_book, tb_info])


if __name__ == "__main__":
    demo.launch(server_name="127.0.0.1", server_port=7860, inbrowser=True)
