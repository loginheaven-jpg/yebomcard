# bench.py — 음원 생성 속도 측정 (PC 끼리 비교용). 작업·업로드와 무관하다.
#
#   python bench.py          고정 새번역 8절로 배치 1·4·8 을 차례로 잰다(배치 1 은 앞 4절만)
#   python bench.py --pair   같은 GPU 에 생성 줄기 2개를 동시에 띄워(각 배치 4) 합계 속도·그래픽 메모리를 잰다
#
# 생성(스튜디오 창·명령줄 워커)이 돌고 있으면 먼저 멈추고 잰다 — 같은 GPU 에 모델이 두 벌 올라가면 메모리가
# 모자라거나 둘 다 느려져 비교가 되지 않는다. 결과는 화면과 bench/ 폴더(JSON)에 남는다.
#
# 무엇을 재나: 우리 엔진은 GPU 보다 CPU 코어 하나가 속도를 정한다(소리 1초에 순차 계산 약 200번 — 조각마다
# 파이썬이 GPU 에 작은 일을 넘긴다). 그래서 배치(한 번에 만드는 절 수)를 늘리거나 줄기를 늘리면 같은 CPU 로
# 더 많이 만들 수 있는지, 그때 그래픽 메모리(12GB)가 버티는지를 본다.

import argparse
import json
import os
import platform
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).parent
OUTDIR = BASE / "bench"

# 고정 본문 — 두 PC 가 같은 글자를 만들어야 비교가 된다(DB 가 정정돼도 이 글자 그대로). 모두 한 번에 만드는 길이(120자 이하)
TEXTS = [
    ("요한복음 3:16", "하나님께서 세상을 이처럼 사랑하셔서 외아들을 주셨으니, 이는 그를 믿는 사람마다 멸망하지 않고 영생을 얻게 하려는 것이다."),
    ("로마서 8:28", "하나님을 사랑하는 사람들, 곧 하나님의 뜻대로 부르심을 받은 사람들에게는, 모든 일이 서로 협력해서 선을 이룬다는 것을 우리는 압니다."),
    ("마태복음 11:28", "\"수고하며 무거운 짐을 진 사람은 모두 내게로 오너라. 내가 너희를 쉬게 하겠다."),
    ("시편 23:4", "내가 비록 죽음의 그늘 골짜기로 다닐지라도, 주님께서 나와 함께 계시고, 주님의 막대기와 지팡이로 나를 보살펴 주시니, 내게는 두려움이 없습니다."),
    ("이사야 40:31", "오직 주님을 소망으로 삼는 사람은 새 힘을 얻으리니, 독수리가 날개를 치며 솟아오르듯 올라갈 것이요, 뛰어도 지치지 않으며, 걸어도 피곤하지 않을 것이다."),
    ("요한복음 14:6", "예수께서 그에게 말씀하셨다. \"나는 길이요, 진리요, 생명이다. 나를 거치지 않고서는, 아무도 아버지께로 갈 사람이 없다."),
    ("고린도전서 13:4", "사랑은 오래 참고, 친절합니다. 사랑은 시기하지 않으며, 뽐내지 않으며, 교만하지 않습니다."),
    ("잠언 3:5", "너의 마음을 다하여 주님을 의뢰하고, 너의 명철을 의지하지 말아라."),
]
WARMUP = "태초에 하나님이 천지를 창조하셨다."   # 첫 호출은 준비 시간이 섞이므로 버리는 한 번


def cpu_name():
    try:
        import winreg
        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        return winreg.QueryValueEx(k, "ProcessorNameString")[0].strip()
    except Exception:
        return platform.processor() or "?"


def pc_name():
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command",
                              "$c=Get-CimInstance Win32_ComputerSystem; \"$($c.Manufacturer) $($c.Model)\""],
                             capture_output=True, text=True, timeout=60).stdout.strip()
        return out or platform.node()
    except Exception:
        return platform.node()


def gpu_mem():
    """(사용 MiB, 전체 MiB, 이름) — nvidia-smi 기준(모든 프로세스 합계)"""
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total,name",
                              "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=30).stdout
        used, total, name = [x.strip() for x in out.splitlines()[0].split(",", 2)]
        return int(used), int(total), name
    except Exception:
        return -1, -1, "?"


def other_generators():
    """생성이 도는 파이썬(스튜디오 app.py · 명령줄 run_plan.py) — 이 측정과 그 자식은 뺀다"""
    cmd = ("Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and "
           "($_.CommandLine -like '*run_plan.py*' -or $_.CommandLine -like '*app.py*') -and "
           "$_.CommandLine -notlike '*--stop*' -and $_.CommandLine -notlike '*bench.py*' } | "
           "ForEach-Object { $_.ProcessId }")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", cmd],
                             capture_output=True, text=True, timeout=60).stdout
        return [int(x) for x in out.split() if x.strip().isdigit()]
    except Exception:
        return []


def pick_voice(engine, key):
    names = engine.list_voices()
    for n in names:
        if engine.voice_upload_key(n) == key:
            return n
    return names[0] if names else None


def load_all(voice_key):
    import numpy as np  # noqa: F401  (엔진이 쓴다 — 여기서 먼저 불러 시간을 모델 쪽에 섞지 않는다)
    import torch
    import engine
    import prosody
    voice = pick_voice(engine, voice_key)
    if not voice:
        raise SystemExit("보이스가 없습니다 — 스튜디오를 한 번 켜서 보이스를 받은 뒤 다시 하세요")
    t0 = time.perf_counter()
    tts = engine.get_tts()
    engine.get_asr()
    load_s = time.perf_counter() - t0
    meta = engine.voice_meta(voice)
    prompt = tts.create_voice_clone_prompt(ref_audio=engine.voice_ref(voice), ref_text=meta["ref_text"])
    kw = engine.gen_kwargs(0.75)
    texts = [prosody.add_punct(t) for _, t in TEXTS]   # 실제 작업처럼 구두점 보강을 거친다
    return torch, engine, tts, prompt, kw, texts, voice, load_s


def generate(tts, prompt, kw, chunk):
    if len(chunk) == 1:
        return tts.generate_voice_clone(text=chunk[0], language="Korean", voice_clone_prompt=prompt, **kw)
    return tts.generate_voice_clone(text=chunk, language="Korean", voice_clone_prompt=prompt * len(chunk), **kw)


def run_config(torch, tts, prompt, kw, texts, batch):
    import numpy as np
    torch.manual_seed(1234)
    torch.cuda.synchronize()
    torch.cuda.reset_peak_memory_stats()
    t0 = time.perf_counter()
    audio, outs = 0.0, []
    for i in range(0, len(texts), batch):
        wavs, sr = generate(tts, prompt, kw, texts[i:i + batch])
        for w in wavs:
            w = np.asarray(w, dtype=np.float32)
            audio += len(w) / sr
            outs.append((w, sr))
    torch.cuda.synchronize()
    wall = time.perf_counter() - t0
    return {
        "batch": batch, "verses": len(texts), "wall_s": round(wall, 1), "audio_s": round(audio, 1),
        "verses_per_hour": round(len(texts) * 3600 / wall),
        "sec_per_audio_sec": round(wall / audio, 2) if audio else None,
        "peak_alloc_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2),
    }, outs


def time_qc(engine, outs, texts):
    """받아쓰기 검수(실제 작업과 같은 engine.qc) — 한 절 평균 초"""
    import soundfile as sf
    tmp = Path(tempfile.mkdtemp(prefix="yebom_bench_"))
    t0 = time.perf_counter()
    for k, ((w, sr), text) in enumerate(zip(outs, texts)):
        p = tmp / f"{k}.wav"
        sf.write(str(p), w, sr)
        engine.qc(p, text)
    return round((time.perf_counter() - t0) / max(len(outs), 1), 2)


def line(r):
    return (f"배치 {r['batch']} ({r['verses']}절): 시간당 {r['verses_per_hour']}절 · "
            f"소리 1초에 {r['sec_per_audio_sec']}초 · 최대 메모리(모델 쪽) {r['peak_alloc_gb']}GB")


def header():
    import torch
    used, total, gname = gpu_mem()
    return {
        "pc": pc_name(), "cpu": cpu_name(), "gpu": gname, "gpu_total_mib": total,
        "python": platform.python_version(), "torch": torch.__version__,
        "at": time.strftime("%Y-%m-%d %H:%M:%S"), "gpu_used_before_mib": used,
    }


def save(result, tag):
    OUTDIR.mkdir(exist_ok=True)
    p = OUTDIR / f"{time.strftime('%Y%m%d_%H%M%S')}_{tag}.json"
    p.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return p


# ───────────────────────── 한 줄기 ─────────────────────────
def main_single(a):
    info = header()
    print(f"\n[속도 측정] {info['pc']} · {info['cpu']} · {info['gpu']} "
          f"· 파이썬 {info['python']} · torch {info['torch']}", flush=True)
    torch, engine, tts, prompt, kw, texts, voice, load_s = load_all(a.voice_key)
    used_after, total, _ = gpu_mem()
    print(f"  보이스 {voice} · 모델 불러오기 {load_s:.0f}초 · 그래픽 메모리 {used_after / 1024:.1f}/{total / 1024:.0f}GB",
          flush=True)
    generate(tts, prompt, kw, [WARMUP])
    runs, qc_s = [], None
    for b in a.batches:
        sub = texts[:4] if b == 1 else texts
        r, outs = run_config(torch, tts, prompt, kw, sub, b)
        r["gpu_used_mib"] = gpu_mem()[0]
        runs.append(r)
        print("  " + line(r), flush=True)
        if qc_s is None and b >= 4:
            qc_s = time_qc(engine, outs, sub)
            print(f"  받아쓰기 검수: 한 절 평균 {qc_s}초", flush=True)
    result = {**info, "mode": "single", "voice": voice, "load_s": round(load_s),
              "gpu_used_after_load_mib": used_after, "runs": runs, "qc_s_per_verse": qc_s}
    p = save(result, "single")
    print(f"  결과 파일: {p}\n", flush=True)


# ───────────────────────── 두 줄기 동시 ─────────────────────────
def main_child(a):
    """--pair 가 띄우는 자식 — 모델을 올린 뒤 신호 파일을 기다렸다가 다른 줄기와 동시에 시작한다"""
    res = {"tag": a.tag}
    try:
        torch, engine, tts, prompt, kw, texts, voice, load_s = load_all(a.voice_key)
        generate(tts, prompt, kw, [WARMUP])
        Path(a.sync + f".ready{a.tag}").write_text("1")
        t_wait = time.time()
        while not Path(a.sync + ".go").exists():
            if time.time() - t_wait > 1800:
                raise RuntimeError("시작 신호를 받지 못했습니다")
            time.sleep(0.2)
        start = time.time()
        r, outs = run_config(torch, tts, prompt, kw, texts, a.batch)
        r["started_at"], r["ended_at"] = start, time.time()
        r["qc_s_per_verse"] = time_qc(engine, outs, texts)
        res.update(r)
    except BaseException as e:   # 메모리 부족도 결과로 남긴다 — 그것이 곧 '두 줄기가 안 들어간다'는 답이다
        res["error"] = f"{type(e).__name__}: {str(e)[:300]}"
    Path(a.result).write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")


def main_pair(a):
    info = header()
    print(f"\n[속도 측정 — 생성 줄기 2개 동시] {info['pc']} · {info['cpu']} · {info['gpu']}", flush=True)
    OUTDIR.mkdir(exist_ok=True)
    sync = str(OUTDIR / f"sync_{os.getpid()}")
    for suffix in (".go", ".readyA", ".readyB"):
        Path(sync + suffix).unlink(missing_ok=True)
    procs, results, logs = [], [], []
    for tag in ("A", "B"):
        rp = OUTDIR / f"pair_{os.getpid()}_{tag}.json"
        lp = OUTDIR / f"pair_{os.getpid()}_{tag}.log"
        results.append(rp)
        logs.append(lp)
        procs.append(subprocess.Popen(
            [sys.executable, str(Path(__file__)), "--child", "--tag", tag, "--batch", str(a.pair_batch),
             "--sync", sync, "--result", str(rp), "--voice-key", a.voice_key],
            stdout=open(lp, "w", encoding="utf-8"), stderr=subprocess.STDOUT, cwd=str(BASE)))
    print(f"  모델 두 벌을 올리는 중… (각 배치 {a.pair_batch})", flush=True)
    t0 = time.time()
    while not all(Path(sync + f".ready{t}").exists() for t in "AB"):
        if any(p.poll() is not None for p in procs) or time.time() - t0 > 1800:
            break
        time.sleep(1)
    loaded_mib = gpu_mem()[0]
    peak_mib = loaded_mib
    if all(Path(sync + f".ready{t}").exists() for t in "AB"):
        print(f"  둘 다 올라감 · 그래픽 메모리 {loaded_mib / 1024:.1f}GB — 동시에 시작", flush=True)
        Path(sync + ".go").write_text("1")
    while any(p.poll() is None for p in procs):
        peak_mib = max(peak_mib, gpu_mem()[0])
        time.sleep(1)
    rows = []
    for rp, lp in zip(results, logs):
        try:
            rows.append(json.loads(rp.read_text(encoding="utf-8")))
        except Exception:
            tail = lp.read_text(encoding="utf-8", errors="replace")[-400:] if lp.exists() else ""
            rows.append({"error": f"결과 없음 — {tail}"})
    result = {**info, "mode": "pair", "batch": a.pair_batch, "gpu_used_loaded_mib": loaded_mib,
              "gpu_peak_mib": peak_mib, "streams": rows}
    errs = [r for r in rows if r.get("error")]
    if errs:
        for r in errs:
            print(f"  [실패] 줄기 {r.get('tag', '?')}: {r['error']}", flush=True)
    else:
        start = min(r["started_at"] for r in rows)
        end = max(r["ended_at"] for r in rows)
        total_verses = sum(r["verses"] for r in rows)
        combined = round(total_verses * 3600 / (end - start))
        result["combined_verses_per_hour"] = combined
        for r in rows:
            print(f"  줄기 {r['tag']}: 시간당 {r['verses_per_hour']}절 · 소리 1초에 {r['sec_per_audio_sec']}초 "
                  f"· 검수 한 절 {r['qc_s_per_verse']}초", flush=True)
        print(f"  합계: 시간당 {combined}절 · 그래픽 메모리 최대 {peak_mib / 1024:.1f}GB", flush=True)
    for suffix in (".go", ".readyA", ".readyB"):
        Path(sync + suffix).unlink(missing_ok=True)
    p = save(result, "pair")
    print(f"  결과 파일: {p}\n", flush=True)


def main():
    ap = argparse.ArgumentParser(description="음원 생성 속도 측정")
    ap.add_argument("--voice-key", default="f4")
    ap.add_argument("--batches", type=int, nargs="+", default=[1, 4, 8])
    ap.add_argument("--pair", action="store_true", help="같은 GPU 에 생성 줄기 2개를 동시에")
    ap.add_argument("--pair-batch", type=int, default=4)
    ap.add_argument("--force", action="store_true", help="생성이 돌고 있어도 잰다(비교가 틀어짐)")
    ap.add_argument("--child", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--tag", default="A", help=argparse.SUPPRESS)
    ap.add_argument("--batch", type=int, default=4, help=argparse.SUPPRESS)
    ap.add_argument("--sync", default="", help=argparse.SUPPRESS)
    ap.add_argument("--result", default="", help=argparse.SUPPRESS)
    a = ap.parse_args()
    if a.child:
        return main_child(a)
    busy = other_generators()
    if busy and not a.force:
        print(f"\n  생성이 돌고 있습니다(PID {', '.join(map(str, busy))}). 스튜디오 창이나 생성 창을 닫고 다시 하세요.\n"
              "  같은 GPU 에 모델이 두 벌 올라가면 메모리가 모자라거나 둘 다 느려져 비교가 되지 않습니다.\n")
        sys.exit(2)
    if a.pair:
        return main_pair(a)
    return main_single(a)


if __name__ == "__main__":
    main()
