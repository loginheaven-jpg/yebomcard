# engine.py — 커스텀 보이스 낭독 엔진 코어 (UI/CLI 공용)
#
#  - 모델 싱글톤 (Qwen3-TTS / faster-whisper) : GPU 를 한 번만 점유
#  - 보이스 등록·조회
#  - 성경 본문 조회 (예봄성경 Supabase)
#  - 합성 + 품질검수(QC)
#
# 설계 원칙
#  * 본문 정제 규칙(NOTE_RE)은 예봄성경 서버와 **문자 단위로 동일**해야 한다.
#    공유 캐시 키가 sha1(정제본문) 이라 어긋나면 조용히 캐시 미스가 난다.
#  * 구두점 주입은 **생성 입력에만** 적용한다(원문 불변).

import hashlib
import json
import re
import subprocess
import threading
from pathlib import Path

import numpy as np
import requests
import soundfile as sf

import prosody

BASE = Path(__file__).parent
VOICES = BASE / "voices"
OUT = BASE / "out"
JOBS = BASE / "jobs"
ENV_FILE = BASE.parent / ".env.local"
for d in (VOICES, OUT, JOBS):
    d.mkdir(parents=True, exist_ok=True)

MODEL_PATH = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
ASR_MODEL = "small"
SR_TARGET = 24000
MAX_LEN = 120

# 예봄성경 app/api/tts/route.ts 와 동일 — 바꾸지 말 것
NOTE_RE = re.compile(r"\s*\(\s*주\s*[:：][\s\S]*$")
NORM_RE = re.compile(r"[\s.,!?·\"'“”‘’()\[\]:;]")

VERSIONS = {"새번역": "rnksv", "개역개정": "nkrv", "쉬운성경": "easy", "KJV": "kjv", "WEB": "web"}

# 파일럿 실측치 (배치 4, RTF 0.96~1.01 / 6.9자당초)
CPS = 6.9      # 생성 음성의 초당 글자수
RTF = 1.0      # 오디오 1초당 생성 소요 초

_lock = threading.Lock()
_tts = None
_asr = None
_books_cache = {}


# ───────────────────────── 환경/DB ─────────────────────────
def _env():
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$", line)
            if m:
                env[m.group(1)] = m.group(2).strip()
    return env


def _sb(params):
    e = _env()
    url, key = e.get("NEXT_PUBLIC_SUPABASE_URL"), e.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError(".env.local 에서 Supabase 정보를 못 읽었다")
    r = requests.get(f"{url}/rest/v1/bible_verses", params=params,
                     headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=30)
    r.raise_for_status()
    return r.json()


def get_books(version):
    """[(book_name, book_code, testament)] — 책 목록"""
    if version in _books_cache:
        return _books_cache[version]
    rows = _sb({"version": f"eq.{version}", "chapter": "eq.1", "verse": "eq.1",
                "select": "book_code,book_name,testament,book_order", "order": "book_order.asc"})
    books = [(r["book_name"], r["book_code"], r.get("testament") or "") for r in rows]
    _books_cache[version] = books
    return books


def get_chapters(version, book_code):
    rows = _sb({"version": f"eq.{version}", "book_code": f"eq.{book_code}",
                "verse": "eq.1", "select": "chapter", "order": "chapter.asc"})
    return [r["chapter"] for r in rows]


def get_verses(version, book_code, chapter):
    """[(verse, 정제본문)] — 서버와 동일 규칙으로 (주:…) 제거"""
    rows = _sb({"version": f"eq.{version}", "book_code": f"eq.{book_code}",
                "chapter": f"eq.{chapter}", "select": "verse,text", "order": "verse.asc"})
    return [(r["verse"], NOTE_RE.sub("", r["text"]).strip()) for r in rows]


def get_book_verses(version, book_code):
    """책 한 권을 한 번에 — [(chapter, verse, 정제본문)].
    PostgREST 기본 상한이 1000행이라 페이지네이션한다(시편 2461절 등)."""
    out, offset = [], 0
    while True:
        rows = _sb({"version": f"eq.{version}", "book_code": f"eq.{book_code}",
                    "select": "chapter,verse,text", "order": "chapter.asc,verse.asc",
                    "limit": 1000, "offset": offset})
        out += [(r["chapter"], r["verse"], NOTE_RE.sub("", r["text"]).strip()) for r in rows]
        if len(rows) < 1000:
            break
        offset += 1000
    return out


def cache_key(text, voice_key, lang="ko", ver="v1"):
    """예봄성경 R2 공유 캐시 키 — 서버 규칙과 동일해야 한다."""
    h = hashlib.sha1(text.encode("utf-8")).hexdigest()
    return f"tts/{ver}/{lang}/{voice_key}/{h}.mp3"


# ───────────────────────── 보이스 ─────────────────────────
def list_voices():
    return sorted([d.name for d in VOICES.iterdir()
                   if d.is_dir() and (d / "ref.wav").exists()])


def voice_meta(name):
    p = VOICES / name / "meta.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def voice_ref(name):
    return str(VOICES / name / "ref.wav")


def cut_audio(src, dst, start=None, end=None, sr=SR_TARGET):
    cmd = ["ffmpeg", "-y", "-i", str(src)]
    if start is not None:
        cmd += ["-ss", str(start)]
    if end is not None:
        cmd += ["-to", str(end)]
    cmd += ["-ar", str(sr), "-ac", "1", "-c:a", "pcm_s16le", str(dst)]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0 or not Path(dst).exists():
        raise RuntimeError("오디오 변환 실패: " + r.stderr.decode("utf-8", "replace")[-400:])


def register_voice(name, audio_path, ref_text, start=None, end=None, note=""):
    name = re.sub(r"[^\w가-힣 \-]", "_", (name or "").strip())
    if not name:
        raise ValueError("보이스 이름을 입력하세요")
    if not audio_path:
        raise ValueError("음원 파일을 올리세요")
    if not (ref_text or "").strip():
        raise ValueError("참조 텍스트가 비어 있습니다")
    vdir = VOICES / name
    vdir.mkdir(parents=True, exist_ok=True)
    ref = vdir / "ref.wav"
    cut_audio(audio_path, ref, start, end)
    info = sf.info(str(ref))
    if info.duration < 4:
        raise ValueError(f"참조 구간이 {info.duration:.1f}초로 너무 짧습니다 (10~30초 권장)")
    meta = {"name": name, "ref_text": ref_text.strip(),
            "duration": round(info.duration, 2), "range": [start, end], "note": note}
    (vdir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    return meta


def delete_voice(name):
    import shutil
    shutil.rmtree(VOICES / name, ignore_errors=True)


# ───────────────────────── 모델 ─────────────────────────
def get_tts():
    global _tts
    if _tts is None:
        import torch
        from qwen_tts import Qwen3TTSModel
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA 를 못 찾았습니다 (CPU 전용 torch 설치됨)")
        _tts = Qwen3TTSModel.from_pretrained(
            MODEL_PATH, device_map="cuda:0", dtype=torch.bfloat16,
            attn_implementation="sdpa")
    return _tts


def get_asr():
    global _asr
    if _asr is None:
        from faster_whisper import WhisperModel
        _asr = WhisperModel(ASR_MODEL, device="cuda", compute_type="float16")
    return _asr


def transcribe(path, with_ts=True):
    segs, _ = get_asr().transcribe(str(path), language="ko", vad_filter=False)
    out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs]
    return out if with_ts else " ".join(s["text"] for s in out).strip()


# ───────────────────────── 합성 ─────────────────────────
def split_text(text, max_len=MAX_LEN):
    parts, buf = [], ""
    for chunk in re.split(r"(?<=[.!?。？！])\s+|\n+", (text or "").strip()):
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
    return out or [(text or "").strip()]


def gen_kwargs(temp=0.75):
    return dict(max_new_tokens=2048, do_sample=True, top_k=50, top_p=1.0,
                temperature=temp, repetition_penalty=1.05,
                subtalker_dosample=True, subtalker_top_k=50, subtalker_top_p=1.0,
                subtalker_temperature=temp)


def synth_one(text, voice, temp=0.75, punct=True):
    """텍스트 하나를 합성해 (wav, sr) 반환. 길면 내부 분할 후 이어붙임."""
    with _lock:
        tts = get_tts()
        meta = voice_meta(voice)
        prompt = tts.create_voice_clone_prompt(
            ref_audio=voice_ref(voice), ref_text=meta["ref_text"])
        gen_text = prosody.add_punct(text) if punct else text
        chunks = split_text(gen_text)
        kw = gen_kwargs(temp)
        parts, sr = [], SR_TARGET
        for c in chunks:
            wavs, sr = tts.generate_voice_clone(
                text=c, language="Korean", voice_clone_prompt=prompt, **kw)
            parts.append(np.asarray(wavs[0], dtype=np.float32))
        if len(parts) == 1:
            return parts[0], sr
        gap = np.zeros(int(sr * 0.15), dtype=np.float32)
        merged = parts[0]
        for p in parts[1:]:
            merged = np.concatenate([merged, gap, p])
        return merged, sr


def synth_batch(texts, voice, temp=0.75, punct=True, max_len=MAX_LEN):
    """여러 텍스트를 한 번에 합성(처리량↑). 분할이 필요한 긴 항목만 개별 처리.

    max_len 을 줄이면 더 잘게 쪼갠다 — 재시도 때 쓰면 '긴 입력에서 뒷문장이
    통째로 빠지는' 잘림(욥기 1:3에서 관측)을 회피할 수 있다.
    반환: (wav 리스트[입력 순서], sr)"""
    with _lock:
        tts = get_tts()
        meta = voice_meta(voice)
        prompt = tts.create_voice_clone_prompt(
            ref_audio=voice_ref(voice), ref_text=meta["ref_text"])
        kw = gen_kwargs(temp)
        prepared = [split_text(prosody.add_punct(t) if punct else t, max_len) for t in texts]
        results = [None] * len(texts)
        sr = SR_TARGET

        single = [i for i, p in enumerate(prepared) if len(p) == 1]
        multi = [i for i, p in enumerate(prepared) if len(p) > 1]

        if single:
            bt = [prepared[i][0] for i in single]
            if len(bt) == 1:
                wavs, sr = tts.generate_voice_clone(
                    text=bt[0], language="Korean", voice_clone_prompt=prompt, **kw)
            else:
                wavs, sr = tts.generate_voice_clone(
                    text=bt, language="Korean",
                    voice_clone_prompt=prompt * len(bt), **kw)
            for i, w in zip(single, wavs):
                results[i] = np.asarray(w, dtype=np.float32)

        for i in multi:
            parts = []
            for c in prepared[i]:
                wavs, sr = tts.generate_voice_clone(
                    text=c, language="Korean", voice_clone_prompt=prompt, **kw)
                parts.append(np.asarray(wavs[0], dtype=np.float32))
            gap = np.zeros(int(sr * 0.15), dtype=np.float32)
            m = parts[0]
            for p in parts[1:]:
                m = np.concatenate([m, gap, p])
            results[i] = m
        return results, sr


# ───────────────────────── 검수(QC) ─────────────────────────
# Whisper 는 한국어 수사를 아라비아 숫자로 받아쓴다("칠천"→"7천", "오백"→"500").
# 원문은 한글 수사이므로 그대로 비교하면 숫자 많은 절(욥기·민수기·역대기)이
# 전부 오탐으로 불합격 처리된다. ASR 쪽 숫자를 한글 수사로 되돌려 비교한다.
_SINO = "영일이삼사오육칠팔구"


def _sino(n: int) -> str:
    if n == 0:
        return "영"
    out = ""
    for val, name in ((10 ** 8, "억"), (10 ** 4, "만"), (1000, "천"), (100, "백"), (10, "십")):
        q, n = divmod(n, val)
        if q:
            out += (_sino(q) + name) if val >= 10 ** 4 else (("" if q == 1 else _SINO[q]) + name)
    if n:
        out += _SINO[n]
    return out


def num_to_kor(text: str) -> str:
    """ASR 결과의 아라비아 숫자를 한글 수사로 — '7천'→'칠천', '500'→'오백'"""
    t = re.sub(r"(?<=\d),(?=\d{3})", "", text or "")          # 3자리 쉼표 제거
    t = re.sub(r"(\d+)\s*([천백십만억])",
               lambda m: _sino(int(m.group(1))) + m.group(2), t)  # 7천 → 칠천
    t = re.sub(r"\d+", lambda m: _sino(int(m.group(0))), t)      # 500 → 오백
    return t



def qc(wav_path, src_text, min_ratio=0.85):
    """생성음을 ASR 로 되받아 원문과 대조. (ok, ratio, reason, asr_text)"""
    import difflib
    info = sf.info(str(wav_path))
    dur = info.duration
    chars = len(src_text)
    # 1) 길이 이상 — 너무 짧으면 잘림, 너무 길면 반복/늘어짐
    cps = chars / dur if dur > 0 else 0
    if dur < 0.4:
        return False, 0.0, "너무 짧음(잘림)", ""
    if cps > 14:
        return False, 0.0, f"오디오가 짧음({cps:.1f}자/초)", ""
    if cps < 3.0:
        return False, 0.0, f"오디오가 김({cps:.1f}자/초·반복 의심)", ""
    # 2) 본문 대조
    hyp = transcribe(wav_path, with_ts=False)
    a = NORM_RE.sub("", src_text)
    b = NORM_RE.sub("", num_to_kor(hyp))   # ASR 숫자 표기 차이를 흡수
    ratio = difflib.SequenceMatcher(None, a, b).ratio()
    if ratio < min_ratio:
        return False, ratio, f"본문 불일치({ratio*100:.0f}%)", hyp
    return True, ratio, "", hyp


def estimate(chars):
    """글자수 → (예상 오디오초, 예상 생성초)"""
    audio = chars / CPS if CPS else 0
    return audio, audio * RTF
