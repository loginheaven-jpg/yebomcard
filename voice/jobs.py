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
def new_job(voice, title, items, temp=0.75, punct=True, batch=4, retry_max=3, seq=9999,
            upload_key=None):
    """items: [{key, ref, text, out}] — out 은 절별 wav 절대경로(str)

    upload_key: 예봄성경 성우 슬롯(예: "f4"). 주면 **합격한 절을 그때그때
    서버로 올린다** — 책 하나가 끝날 때까지 기다리지 않으므로, 며칠짜리 작업이
    중간에 끊겨도 그때까지 만든 음원은 이미 교인에게 서빙되고 있다."""
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
           "retry_max": retry_max, "seq": seq, "upload_key": upload_key,
           "items": prepared}
    save(job)
    start_worker()
    return jid


# ───────────────────────── 자동 업로드 ─────────────────────────
# 합격한 절을 예봄성경 공유 캐시로 보낸다. 키는 서버가 본문으로 계산하므로
# 로컬은 본문과 mp3 만 보내면 된다(로컬에 R2 비밀키가 없다).
UPLOAD_BATCH = 10


def _upload_ready(job):
    """아직 안 올린 합격 절을 골라 올린다. 실패는 다음 회차에 다시 시도한다."""
    key = job.get("upload_key")
    if not key:
        return
    ready = [i for i in job["items"] if i["status"] == "ok" and not i.get("uploaded")]
    if not ready:
        return
    try:
        import server
        if not server.enabled():
            return
    except Exception:
        return

    for n in range(0, len(ready), UPLOAD_BATCH):
        chunk = ready[n:n + UPLOAD_BATCH]
        payload = []
        for it in chunk:
            try:
                payload.append({"ref": it["ref"], "text": it["text"],
                                "mp3": engine.encode_mp3(it["out"])})
            except Exception as e:
                it["upload_error"] = str(e)[:120]
        if not payload:
            continue
        try:
            res = server.upload_verses(key, payload)
        except Exception as e:
            # 네트워크 장애로 생성을 멈추지는 않는다 — 다음 회차에 다시 올린다
            job["upload_error"] = str(e)[:200]
            return
        job.pop("upload_error", None)
        by_ref = {r["ref"]: r for r in res.get("results", [])}
        for it in chunk:
            r = by_ref.get(it["ref"])
            if r and r["status"] in ("uploaded", "exists"):
                it["uploaded"] = True
                it.pop("upload_error", None)
            elif r:
                it["upload_error"] = r.get("error", "")[:120]


# ───────────────────────── 보류 보고 / 재생성 요청 ─────────────────────────
# 검수는 자동이지만 **판단은 자동화되지 않는다**. 오탐("욥이"→"요비" 71%)과
# 진짜 오류(욥기 39:8 어순 뒤바뀜 67%)를 기계가 못 가른다 — 소리(자모)로 비교하면
# 오탐은 걷히지만 어순 오류도 88%로 통과해버린다.
# PC 가 여러 대면 그 판단거리가 각 PC 안에 흩어져 아무도 못 보므로 서버로 모은다.


def _report_held(job):
    key = job.get("upload_key")
    if not key:
        return
    held = [i for i in job["items"] if i["status"] == "held"]
    try:
        import server
        if not server.enabled():
            return
        items = []
        for it in held:
            mp3 = None
            try:
                if Path(it["out"]).exists():
                    mp3 = engine.encode_mp3(it["out"])   # 관리자가 들어보고 판단할 수 있게
            except Exception:
                pass
            items.append({
                "ref": it["ref"], "book": it["ref"].split(" ")[0],
                "text": it["text"], "asr": it.get("asr", ""),
                "ratio": it.get("ratio"), "reason": it.get("reason", ""),
                "audio_sec": it.get("audio_sec"), "tries": it.get("tries"),
                "mp3": mp3,
            })
        server.report_held(job["voice"], key, items)
        job.pop("held_report_error", None)
    except Exception as e:
        job["held_report_error"] = str(e)[:200]


def _apply_regen_requests(job):
    """관리자가 '재생성 요청'을 누른 절을 다시 큐에 올린다.
    tries=1 로 두어 첫 재생성부터 강제 분할이 걸리게 한다.

    한 요청은 **한 번만** 처리한다. 재생성이 또 실패해 다시 보류가 되면
    요청은 서버에 그대로 남아 있는데, 그걸 매번 다시 집으면 같은 절을
    무한히 반복 생성하게 된다(관리자가 판단을 바꿀 때까지 끝나지 않는다)."""
    if not job.get("upload_key"):
        return 0
    try:
        import server
        if not server.enabled():
            return 0
        wanted = {r["text"] for r in server.regen_requests()}
    except Exception:
        return 0
    already = set(job.get("regen_applied") or [])
    n = 0
    for it in job["items"]:
        if it["status"] == "held" and it["text"] in wanted and it["key"] not in already:
            it["status"] = "pending"
            it["tries"] = 1
            it["reason"] = "관리자 재생성 요청"
            it.pop("uploaded", None)
            already.add(it["key"])
            n += 1
    if n:
        job["regen_applied"] = sorted(already)
    return n


def upload_counts(job):
    """(올림, 올릴 것 남음) — UI/CLI 표시용"""
    key = job.get("upload_key")
    if not key:
        return 0, 0
    done = sum(1 for i in job["items"] if i.get("uploaded"))
    left = sum(1 for i in job["items"] if i["status"] == "ok" and not i.get("uploaded"))
    return done, left


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
                                          job["temp"], job["punct"], max_len=max_len,
                                          force=(tries0 >= 1))
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
                ok, ratio, reason, hyp = engine.qc(p, it["text"])
            except Exception as e:
                ok, ratio, reason, hyp = False, 0.0, f"검수 오류: {e}"[:120], ""
            it["ratio"] = round(ratio, 3)
            it["reason"] = reason
            it["asr"] = hyp          # 중앙 검수에서 원문과 나란히 봐야 판단이 된다

            if ok:
                it["status"] = "ok"
            elif it["tries"] >= job["retry_max"]:
                it["status"] = "held"          # 상한 초과 → 보류(사람이 판단)
            # else: pending 유지 → 다음 루프에서 재시도
        _upload_ready(job)
        save(job)

    if not _stop.is_set():
        _upload_ready(job)          # 마지막 배치까지 확실히 올리고 끝낸다
        # 관리자가 이미 재생성을 요청해 둔 절이 있으면 지금 처리하고 끝낸다
        if _apply_regen_requests(job):
            save(job)
            return _process(job)
        _report_held(job)
    job["status"] = "stopped" if _stop.is_set() else "done"
    save(job)


def _loop():
    while not _stop.is_set():
        # 진도표 순서(seq)를 우선 지킨다 — 파일명(시각)만으로는 같은 초에 만든
        # 작업들의 순서가 뒤섞인다. seq 동률이면 생성 시각 순.
        cands = []
        for j in JOBS.glob("*.json"):
            try:
                job = json.loads(j.read_text(encoding="utf-8"))
            except Exception:
                continue
            if job.get("status") in ("queued", "running"):
                cands.append((job.get("seq", 9999), job["id"], job))
        cands.sort(key=lambda x: (x[0], x[1]))
        nxt = cands[0][2] if cands else None
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
            it.pop("uploaded", None)   # 새로 만들면 다시 올려야 한다
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
