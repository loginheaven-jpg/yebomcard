# jobs.py — 생성 작업 큐 (백그라운드 워커 + 상태 파일 + QC 재시도)
#
# 왜 필요한가
#  * 성경 범위를 고르면 수천~수만 절이 된다(새번역 전량 ≈ 3.5일).
#    UI 를 닫거나 PC 를 재부팅해도 이어져야 하므로 상태를 파일(JSON)로 둔다.
#  * 생성 실패는 확률적이다(같은 절도 뽑을 때마다 다름) → 절마다 QC 를 붙이고
#    불합격이면 자동 재시도, 상한을 넘으면 "보류"로 빼고 계속 진행한다.
#    (붙잡고 있으면 전량 작업이 멈춘다)
#
# 상태 파일: jobs/{job_id}.json

import json
import threading
import time
import uuid
from pathlib import Path

import soundfile as sf

import engine

JOBS = engine.JOBS
_stop = threading.Event()
_worker = None
_cur = {"job": None, "note": ""}


# ───────────────────────── 저장/조회 ─────────────────────────
def _path(jid):
    return JOBS / f"{jid}.json"


def save(job):
    _path(job["id"]).write_text(json.dumps(job, ensure_ascii=False, indent=1), encoding="utf-8")


def load(jid):
    p = _path(jid)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def list_jobs():
    out = []
    for p in sorted(JOBS.glob("*.json"), reverse=True):
        try:
            j = json.loads(p.read_text(encoding="utf-8"))
            out.append(j)
        except Exception:
            pass
    return out


def counts(job):
    ok = sum(1 for i in job["items"] if i["status"] == "ok")
    held = sum(1 for i in job["items"] if i["status"] == "held")
    pend = sum(1 for i in job["items"] if i["status"] == "pending")
    return ok, held, pend


# ───────────────────────── 작업 생성 ─────────────────────────
def new_job(voice, title, items, temp=0.75, punct=True, batch=4, retry_max=3):
    """items: [{key, ref, text, out}] — out 은 절별 wav 절대경로(str)"""
    jid = time.strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:4]
    prepared = []
    for it in items:
        exists = Path(it["out"]).exists()
        prepared.append({
            "key": it["key"], "ref": it["ref"], "text": it["text"], "out": it["out"],
            # 이미 만들어 둔 파일은 건너뛴다(재개)
            "status": "ok" if exists else "pending",
            "tries": 0, "ratio": None, "reason": "기존 파일" if exists else "",
            "audio_sec": None,
        })
    job = {"id": jid, "voice": voice, "title": title, "created": time.strftime("%Y-%m-%d %H:%M:%S"),
           "status": "queued", "temp": temp, "punct": punct, "batch": batch,
           "retry_max": retry_max, "items": prepared}
    save(job)
    start_worker()
    return jid


# ───────────────────────── 워커 ─────────────────────────
def _process(job):
    job["status"] = "running"
    save(job)
    voice, batch = job["voice"], max(1, int(job["batch"]))

    while not _stop.is_set():
        pend = [i for i in job["items"] if i["status"] == "pending"]
        if not pend:
            break
        # 같은 재시도 회차끼리 묶는다 — 회차가 오를수록 더 잘게 쪼개 잘림을 피한다
        tries0 = pend[0]["tries"]
        group = [i for i in pend if i["tries"] == tries0][:batch]
        max_len = max(40, engine.MAX_LEN // (1 + tries0))
        _cur["note"] = (f"{group[0]['ref']} 외 {len(group)-1}건" if len(group) > 1
                        else group[0]["ref"]) + (f" (재시도{tries0})" if tries0 else "")
        try:
            wavs, sr = engine.synth_batch([g["text"] for g in group], voice,
                                          job["temp"], job["punct"], max_len=max_len)
        except Exception as e:
            job["status"] = "error"
            job["error"] = str(e)[:500]
            save(job)
            return

        for it, w in zip(group, wavs):
            it["tries"] += 1
            p = Path(it["out"])
            p.parent.mkdir(parents=True, exist_ok=True)
            sf.write(str(p), w, sr)
            it["audio_sec"] = round(len(w) / sr, 2)
            try:
                ok, ratio, reason, _hyp = engine.qc(p, it["text"])
            except Exception as e:
                ok, ratio, reason = False, 0.0, f"검수 오류: {e}"[:120]
            it["ratio"] = round(ratio, 3)
            it["reason"] = reason
            if ok:
                it["status"] = "ok"
            elif it["tries"] >= job["retry_max"]:
                it["status"] = "held"          # 상한 초과 → 보류(사람이 판단)
            # else: pending 유지 → 다음 루프에서 재시도
        save(job)

    job["status"] = "stopped" if _stop.is_set() else "done"
    save(job)


def _loop():
    while not _stop.is_set():
        nxt = None
        for j in sorted(JOBS.glob("*.json")):
            try:
                job = json.loads(j.read_text(encoding="utf-8"))
            except Exception:
                continue
            if job.get("status") in ("queued", "running"):
                nxt = job
                break
        if not nxt:
            _cur["job"] = None
            _cur["note"] = ""
            time.sleep(1.5)
            continue
        _cur["job"] = nxt["id"]
        _process(nxt)
    _cur["job"] = None


def start_worker():
    global _worker
    if _worker and _worker.is_alive():
        return
    _stop.clear()
    _worker = threading.Thread(target=_loop, daemon=True)
    _worker.start()


def stop_worker():
    _stop.set()


def worker_alive():
    return bool(_worker and _worker.is_alive()) and not _stop.is_set()


def current():
    return dict(_cur)


# ───────────────────────── 재생성 ─────────────────────────
def regenerate(jid, keys):
    """보류/불합격 절만 다시 큐에 올린다."""
    job = load(jid)
    if not job:
        return 0
    n = 0
    for it in job["items"]:
        if it["key"] in keys:
            it["status"] = "pending"
            it["tries"] = 0
            it["reason"] = ""
            n += 1
    if n:
        job["status"] = "queued"
        save(job)
        start_worker()
    return n


def requeue(jid):
    """중단된 작업을 이어서 진행."""
    job = load(jid)
    if not job:
        return False
    if job["status"] in ("stopped", "error", "done"):
        job["status"] = "queued"
        save(job)
    _stop.clear()
    start_worker()
    return True
