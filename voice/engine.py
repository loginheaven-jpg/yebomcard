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
import os
import re
import shutil
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

# 생성 방식 — 음성 복제 기본값인 '본문 흘려 넣기'(non_streaming_mode=False)는 라이브러리 설명대로
# 흘려 넣기를 **흉내만 내는** 모드다. 참조 원고 + 대상 본문 + 끝 신호가 참조 음성 프레임 위에 겹쳐
# 놓이는데, 우리 본문은 그 안에 다 들어가 **대상 본문의 끝 신호가 참조 음성 한가운데에 찍힌다.**
# 모델이 어디서 끝나는지를 흐릿하게 알고 절 끝 음절을 짧게 맺는다.
#   실측(출 33:2·4·11 × 4회): 절 끝 중앙값 흘려 넣기 98ms(12회 중 9회 150ms 미만)
#                                         통째로 넣기 218ms(3회) · 절 안 문장끝 310ms
# 2026-09-10 부터 새 방식으로 만든다. 그 이전 음원 목록은 scripts/data/f4-legacy-streaming.json
# — 성경 전체를 새 방식으로 마친 뒤 그 목록의 절을 다시 만들어 교체한다.
NON_STREAMING = True
METHOD = "ns1"          # 작업 파일 항목에 남기는 생성 방식 표지 — 구방식 항목에는 표지가 없다
END_MIN_MS = 150        # 절 끝 음절 덩이가 이보다 짧으면 끝이 잘린 것으로 보고 다시 만든다

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


_sb_conf = None


def _sb_credentials():
    """(url, anon key). 이 저장소 안에서 돌 때는 .env.local, 설치된 PC 에서는 서버에서 받는다.

    Supabase anon 키는 이미 브라우저 번들에 들어 있는 **공개 키**라 이렇게 받아도 된다.
    이 덕분에 새 PC 에 .env.local 을 복사할 필요가 없다."""
    global _sb_conf
    if _sb_conf:
        return _sb_conf
    e = _env()
    url, key = e.get("NEXT_PUBLIC_SUPABASE_URL"), e.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not (url and key):
        try:
            import server
            rc = server.remote_config()
            if rc:
                url, key = rc.get("supabaseUrl"), rc.get("supabaseAnonKey")
        except Exception as ex:
            raise RuntimeError(f"성경 본문 접속 정보를 얻지 못했습니다: {ex}")
    if not (url and key):
        raise RuntimeError(
            ".env.local 도 서버 연동(studio.json)도 없어 성경 본문을 읽을 수 없습니다")
    # 값 끝에 줄바꿈이 섞여 오는 일이 있다(배포처 환경변수에 붙어 들어간 경우).
    # 그대로 두면 HTTP 헤더에 넣을 때 터진다 — 여기서 걷어낸다.
    _sb_conf = (url.strip(), key.strip())
    return _sb_conf


def _sb(params):
    url, key = _sb_credentials()
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


def note_residue(text):
    """주석 잔재를 짚는다 — 짝이 맞지 않는 닫는 괄호의 개수.

    편집자 주석은 괄호 안에 들어가고 낭독에서 제외해야 한다(NOTE_RE). 그런데
    여는 괄호가 빠진 채로 들어간 절이 있다. 그러면 주석이 본문으로 남아
    **소리 내어 읽힌다** — 실제로 욥기 1:5 가 그랬다.

    대조본 없이 판별할 수 있는 객관적 기준이 이것이다: 여는 괄호가 사라지면
    닫는 ')' 만 남는다. 새번역 31,075절 중 16절이 여기 걸렸고, 반대로
    "또는 '이렇게 하자'" 처럼 본문에 있는 표현은 괄호가 맞아 걸리지 않는다."""
    depth = stray = 0
    for c in text or "":
        if c == "(":
            depth += 1
        elif c == ")":
            if depth:
                depth -= 1
            else:
                stray += 1
    return stray


def text_hash(text):
    """공유 캐시 키에 쓰는 본문 해시. 서버 규칙과 동일해야 한다."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def cache_key(text, voice_key, lang="ko", ver="v1"):
    """예봄성경 R2 공유 캐시 키 — 서버 규칙과 동일해야 한다."""
    return f"tts/{ver}/{lang}/{voice_key}/{text_hash(text)}.mp3"


# ───────────────────────── 보이스 ─────────────────────────
def list_voices():
    return sorted([d.name for d in VOICES.iterdir()
                   if d.is_dir() and (d / "ref.wav").exists()])


def voice_meta(name):
    p = VOICES / name / "meta.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def voice_ref(name):
    return str(VOICES / name / "ref.wav")


def voice_upload_key(name):
    """이 보이스가 예봄성경의 어느 성우 슬롯으로 올라가는지(예: 영희→f4).
    meta.json 에 voiceKey 가 없으면 None — 자동 업로드를 하지 않는다."""
    return (voice_meta(name) or {}).get("voiceKey") or None


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


def voice_fingerprint(name):
    """참조음+참조텍스트의 지문. **여러 PC 로 분담 생성할 때 필수 확인.**
    참조 클립이 1초라도 다르면 클론 음색이 미묘하게 달라져, 책마다 목소리가
    바뀌는 결과가 된다. 각 PC 에서 이 값이 같아야 한다."""
    h = hashlib.sha256()
    h.update((VOICES / name / "ref.wav").read_bytes())
    h.update(voice_meta(name).get("ref_text", "").encode("utf-8"))
    return h.hexdigest()[:16]


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
        # 새 PC 에서 새 방식이 적용됐는지 눈으로 확인하는 줄 — 설치본은 실행할 때 서버에서 코드를 받는다
        print(f"[생성 방식] {'본문 통째로 넣기' if NON_STREAMING else '본문 흘려 넣기(구방식)'}"
              f" · 절 끝 {END_MIN_MS}ms 미만이면 다시 만듦", flush=True)
    return _tts


def get_asr():
    """검수용 ASR. 기본은 GPU.

    생성이 도는 중에 재검수를 돌리면 VRAM 이 모자란다(3060 12GB 에서 생성만으로 98%).
    그럴 때 YEBOM_ASR_DEVICE=cpu 로 두면 느리지만 생성을 방해하지 않는다."""
    global _asr
    if _asr is None:
        from faster_whisper import WhisperModel
        dev = os.environ.get("YEBOM_ASR_DEVICE", "cuda").lower()
        _asr = (WhisperModel(ASR_MODEL, device="cpu", compute_type="int8") if dev == "cpu"
                else WhisperModel(ASR_MODEL, device="cuda", compute_type="float16"))
    return _asr


def transcribe(path, with_ts=True):
    segs, _ = get_asr().transcribe(str(path), language="ko", vad_filter=False)
    out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs]
    return out if with_ts else " ".join(s["text"] for s in out).strip()


# ───────────────────────── 합성 ─────────────────────────
SENT_RE = re.compile(r"(?<=[.!?。？！])\s+")


def comma_split(t, min_len=8):
    """쉼표로 쪼갠다. 쉼표는 **제 자리에 남겨야** 억양이 유지된다.

    짧은 토막은 버리지 않고 옆에 붙인다. 전에는 한 토막이라도 8자 미만이면 쪼개기를 통째로
    포기했는데, 그 때문에 고전 1:12('다름이 아니라,' 7자)가 한 조각으로 남아 가운데 두 구절이
    통째로 빠졌다. 쪼개는 목적은 **반복되는 구절이 서로 다른 조각에 들어가게** 하는 것이다."""
    segs = [s.strip() for s in (t or "").split(",") if s.strip()]
    if len(segs) < 2:
        return [(t or "").strip()]
    segs = [s + "," for s in segs[:-1]] + [segs[-1]]
    out = []
    for s in segs:
        if out and len(out[-1]) < min_len:
            out[-1] = (out[-1] + " " + s).strip()      # 앞 토막이 짧다 — 여기에 붙인다
        else:
            out.append(s)
    if len(out) > 1 and len(out[-1]) < min_len:
        tail = out.pop()
        out[-1] = (out[-1] + " " + tail).strip()       # 마지막이 짧다 — 앞에 붙인다
    return out


def force_split(text, fine=False):
    """길이와 무관하게 문장 → (안 되면) 쉼표 단위로 쪼갠다.

    구조가 반복되는 절에서 모델이 한쪽을 통째로 건너뛴다:
      "귀가 말을 알아듣지 못하겠느냐? 혀가 음식 맛을 알지 못하겠느냐?" → 앞 문장만
      "어찌하여 너는 ... 여기며, 어찌하여 우리를 ... 보느냐?"        → 뒷 절만
    36~40자라 max_len 분할(최소 40)이 걸리지 않으니 재시도 때 이걸로 강제한다.

    fine=True(마지막 시도) — 문장으로 나눈 뒤 **각 문장을 쉼표로 한 번 더** 쪼갠다.
    문장이 하나뿐인 열거(고전 1:12 '나는 바울 편이다', '나는 아볼로 편이다' …)나 문장 안에 열거가
    들어앉은 절(고전 6:9)은 문장 단위로만 나누면 반복이 한 조각에 남아 또 건너뛴다."""
    t = (text or "").strip()
    segs = [s.strip() for s in SENT_RE.split(t) if s.strip()]
    if len(segs) > 1:
        if not fine:
            return segs
        out = []
        for s in segs:
            out += comma_split(s)
        return out
    return comma_split(t)


def split_text(text, max_len=MAX_LEN, force=False, fine=False):
    if force:
        segs = force_split(text, fine)
        if len(segs) > 1:
            return segs
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
    # non_streaming_mode — 본문을 통째로 넣는다(위 NON_STREAMING 설명). 한 건씩·배치 모두 여기를 거친다.
    return dict(max_new_tokens=2048, do_sample=True, top_k=50, top_p=1.0,
                temperature=temp, repetition_penalty=1.05,
                subtalker_dosample=True, subtalker_top_k=50, subtalker_top_p=1.0,
                subtalker_temperature=temp,
                non_streaming_mode=NON_STREAMING)


PIECE_END_TRIES = 3   # 조각 끝이 짧을 때 그 조각을 뽑는 최대 횟수(처음 포함)


def _gen_piece(tts, text, prompt, kw):
    """나눠 만드는 절의 조각 하나 — 끝 음절이 END_MIN_MS 보다 짧으면 그 조각만 다시 뽑고 가장 긴 것을 쓴다.

    나눠 만들면 조각 끝마다 '절 끝'이 생긴다(모델에게는 조각 하나가 한 절이다). 새 방식에서도 끝이 짧게
    나오는 일이 있는데, 절 단위 끝 검사(jobs._judge)는 음원 전체의 마지막만, 받아쓰기 합격 때만 본다 —
    그래서 절 중간 문장끝이 잘린 채 남았다(2026-09-11 욥 39:8 30ms, 마 18:18 90ms). 조각은 짧아 다시
    뽑는 비용이 작다."""
    best, best_end, sr = None, -1.0, SR_TARGET
    for _ in range(PIECE_END_TRIES):
        wavs, sr = tts.generate_voice_clone(
            text=text, language="Korean", voice_clone_prompt=prompt, **kw)
        w = np.asarray(wavs[0], dtype=np.float32)
        e = final_syllable_ms(w, sr)
        if e > best_end:
            best, best_end = w, e
        if e >= END_MIN_MS:
            break
    return best, sr


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
            if len(chunks) > 1:
                w, sr = _gen_piece(tts, c, prompt, kw)   # 나눠 만들면 조각 끝마다 검사
            else:
                wavs, sr = tts.generate_voice_clone(
                    text=c, language="Korean", voice_clone_prompt=prompt, **kw)
                w = np.asarray(wavs[0], dtype=np.float32)
            parts.append(w)
        if len(parts) == 1:
            return parts[0], sr
        gap = np.zeros(int(sr * 0.15), dtype=np.float32)
        merged = parts[0]
        for p in parts[1:]:
            merged = np.concatenate([merged, gap, p])
        return merged, sr


def synth_batch(texts, voice, temp=0.75, punct=True, max_len=MAX_LEN, force=False, fine=False):
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
        prepared = [split_text(prosody.add_punct(t) if punct else t, max_len, force, fine)
                    for t in texts]
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
                w, sr = _gen_piece(tts, c, prompt, kw)   # 조각 끝마다 검사 — 절 중간 문장끝이 잘리지 않게
                parts.append(w)
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


# 고유어 수사 — 성경 본문은 나이·햇수에 이쪽을 쓴다("예순다섯 살", "백일흔다섯 해").
# Whisper 는 이걸 숫자로 받아쓰므로(65), 한자어(육십오)로만 되돌리면 영영 안 맞는다.
_NATIVE_ONES = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"]
_NATIVE_TENS = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"]


def _native(n: int) -> str:
    """1~99 는 고유어, 100 이상은 백 단위만 한자어로 얹는다(백일흔다섯)."""
    if n <= 0 or n >= 1000:
        return ""
    head = ""
    if n >= 100:
        h, n = divmod(n, 100)
        head = ("" if h == 1 else _SINO[h]) + "백"
    return head + _NATIVE_TENS[n // 10] + _NATIVE_ONES[n % 10]


def num_to_kor_native(text: str) -> str:
    """ASR 의 아라비아 숫자를 **고유어** 수사로 — '65'→'예순다섯', '175'→'백일흔다섯'"""
    t = re.sub(r"(?<=\d),(?=\d{3})", "", text or "")

    def sub(m):
        n = int(m.group(0))
        return _native(n) or m.group(0)

    return re.sub(r"\d+", sub, t)


def num_to_kor(text: str) -> str:
    """ASR 결과의 아라비아 숫자를 한글 수사로 — '7천'→'칠천', '500'→'오백'"""
    t = re.sub(r"(?<=\d),(?=\d{3})", "", text or "")          # 3자리 쉼표 제거
    t = re.sub(r"(\d+)\s*([천백십만억])",
               lambda m: _sino(int(m.group(1))) + m.group(2), t)  # 7천 → 칠천
    t = re.sub(r"\d+", lambda m: _sino(int(m.group(0))), t)      # 500 → 오백
    return t



def final_syllable_ms(wav, sr):
    """절 끝 음절 덩이 길이(ms) — 끝 글자가 짧게 잘렸는지 가늠한다.

    5ms 단위 세기에서 최대치의 4%를 넘는 **마지막 소리 덩이**의 길이다. 음절 경계를 정확히
    가르는 자는 아니지만(덩이가 이웃 음절과 붙기도 한다) 잘린 끝을 가려내기에는 충분했다 —
    구방식 절 끝 중앙값 98ms, 새 방식 218ms, 절 안 문장끝 310ms.
    """
    x = np.asarray(wav, dtype=np.float32)
    if x.ndim > 1:
        x = x[:, 0]
    n = max(1, int(sr * 0.005))
    m = len(x) // n
    if m == 0:
        return 0.0
    e = np.sqrt(np.mean(x[: m * n].reshape(m, n) ** 2, axis=1))
    v = e > e.max() * 0.04
    idx = np.where(v)[0]
    if len(idx) == 0:
        return 0.0
    end = int(idx[-1])
    start = end
    while start > 0 and v[start - 1]:
        start -= 1
    return (end - start + 1) * 5.0


def qc_threshold(n_chars, base=0.85):
    """짧은 절일수록 임계를 낮춘다.

    ASR 오차는 보통 1~2글자인데 짧은 절에서는 그 몇 글자가 일치율을 크게 떨어뜨린다.
    실측: "욥이 대답하였다"(9자) → ASR "요비 대답하였다" = 71%. 발화속도 7.5자/초로
    음원은 멀쩡한데 85% 기준으로는 불합격이 된다. 길이에 맞춰 기준을 조정한다."""
    if n_chars < 15:
        return min(base, 0.60)
    if n_chars < 30:
        return min(base, 0.72)
    if n_chars < 60:
        return min(base, 0.80)
    return base


# 연속으로 이만큼 빠지면 불합격. 일치율(%)만 보면 **긴 절에서 한 문장이 통째로 빠져도 몇 %밖에 안 깎여**
# 통과한다(창세기 1:16 '또 별들도 만드셨다' 가 빠졌는데 90%로 합격, 두 번이나). 지휘부 지시로 절대 기준을 넣는다.
#
# '합계' 가 아니라 '연속' 으로 세는 이유 — 실측(2026-09-12, 새 방식 5,553절):
#   합계 8자 이상 159절(2.9%) · 연속 8자 이상 55절(1.0%)
# 받아쓰기는 늘 한두 글자씩 틀리는데(태초에→대초의, 둘→돌) 긴 절에서 그것이 쌓여 합계를 부풀린다.
# 문장이 통째로 빠지면 한 자리에서 연달아 빠지므로 '연속' 이라야 실제 누락만 잡힌다.
#
# 8자인 이유 — 확인된 누락 중 가장 짧은 것이 8자('또 별들도 만드셨다')다. 10자로 하면 그 절이 다시 빠져나간다.
GAP_MAX = 8


def text_gap(src_norm, hyp_norm):
    """본문에서 받아쓰기와 못 맞춘 '연속' 구간 중 가장 긴 것 — (길이, 그 글자)"""
    import difflib
    sm = difflib.SequenceMatcher(None, src_norm, hyp_norm)
    gaps, pos = [], 0
    for b in sm.get_matching_blocks():
        if b.a > pos:
            gaps.append((pos, b.a))
        pos = b.a + b.size
    if pos < len(src_norm):
        gaps.append((pos, len(src_norm)))
    if not gaps:
        return 0, ""
    s, e = max(gaps, key=lambda g: g[1] - g[0])
    return e - s, src_norm[s:e]


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
    # Whisper 는 수사를 숫자로 받아쓴다. 한자어(육십오)와 고유어(예순다섯) 둘 다
    # 같은 수를 읽은 것이므로, 두 표기로 각각 대조해 더 나은 쪽을 택한다.
    # 한쪽만 보면 족보·나이가 많은 책(창세기 등)이 통째로 오탐이 된다.
    scored = [
        (difflib.SequenceMatcher(None, a, c).ratio(), c)
        for c in (NORM_RE.sub("", num_to_kor(hyp)), NORM_RE.sub("", num_to_kor_native(hyp)))
    ]
    ratio, best = max(scored, key=lambda x: x[0])
    thr = qc_threshold(len(a), min_ratio)
    if ratio < thr:
        return False, ratio, f"본문 불일치({ratio*100:.0f}%<{thr*100:.0f}%)", hyp
    # 3) 통째로 빠진 자리 — 일치율이 기준을 넘어도 한 자리에서 GAP_MAX 자 이상 빠졌으면 불합격.
    #    재시도는 본문을 조각으로 나눠 만들므로(tries 1 부터 force) 빠진 문장이 자기 조각을 갖게 된다.
    gap, piece = text_gap(a, best)
    if gap >= GAP_MAX:
        return False, ratio, f"본문 일부 빠짐(연속 {gap}자: {piece[:14]})", hyp
    return True, ratio, "", hyp


def estimate(chars):
    """글자수 → (예상 오디오초, 예상 생성초)"""
    audio = chars / CPS if CPS else 0
    return audio, audio * RTF


# ───────────────────────── mp3 인코딩 ─────────────────────────
# 예전에는 Node + @aws-sdk 로 인코딩·업로드를 했다. 새 PC 설치를 단순하게 하려고
# 파이썬으로 옮겼다 — 이제 로컬에 Node 도 R2 키도 필요 없다.
_ffmpeg = None


def ffmpeg_exe():
    """imageio-ffmpeg 가 가져온 실행파일을 우선 쓰고, 없으면 시스템 ffmpeg."""
    global _ffmpeg
    if _ffmpeg:
        return _ffmpeg
    try:
        import imageio_ffmpeg
        _ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        _ffmpeg = shutil.which("ffmpeg")
    if not _ffmpeg:
        raise RuntimeError("ffmpeg 를 찾지 못했습니다 — pip install imageio-ffmpeg")
    return _ffmpeg


def encode_mp3(wav_path, bitrate="96k"):
    """wav 파일 → mp3 bytes (모노). 공유 캐시에 올릴 형식."""
    out = subprocess.run(
        [ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(wav_path),
         "-ac", "1", "-b:a", bitrate, "-f", "mp3", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if out.returncode != 0 or not out.stdout:
        raise RuntimeError(f"mp3 인코딩 실패: {out.stderr.decode('utf-8', 'replace')[:200]}")
    return out.stdout
