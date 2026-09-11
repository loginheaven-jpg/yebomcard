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

import shutil
import json
import threading
import time
import uuid
from pathlib import Path

import soundfile as sf

import engine
import prosody

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
            upload_key=None, replace=False):
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
           "replace": bool(replace),   # 구방식 교체 작업 — 이미 있는 절도 다시 만들어 덮어쓴다
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
            res = server.upload_verses(key, payload, replace=bool(job.get("replace")))
        except Exception as e:
            # 네트워크 장애로 생성을 멈추지는 않는다 — 다음 회차에 다시 올린다
            job["upload_error"] = str(e)[:200]
            return
        job.pop("upload_error", None)
        by_ref = {r["ref"]: r for r in res.get("results", [])}
        for it in chunk:
            r = by_ref.get(it["ref"])
            if r and r["status"] in ("uploaded", "replaced", "exists"):
                it["uploaded"] = True
                it.pop("upload_error", None)
            elif r:
                it["upload_error"] = r.get("error", "")[:120]


# ───────────────────────── 보류 보고 / 재생성 요청 ─────────────────────────
# 검수는 자동이지만 **판단은 자동화되지 않는다**. 오탐("욥이"→"요비" 71%)과
# 진짜 오류(욥기 39:8 어순 뒤바뀜 67%)를 기계가 못 가른다 — 소리(자모)로 비교하면
# 오탐은 걷히지만 어순 오류도 88%로 통과해버린다.
# PC 가 여러 대면 그 판단거리가 각 PC 안에 흩어져 아무도 못 보므로 서버로 모은다.


# 보류를 언제 보고하는가 — 작업이 끝날 때만 보고하면 늦다.
# 전권 작업(20,530절)은 며칠이 걸리는데, 그동안 쌓인 보류 절을 아무도 못 본다.
# 새 보류가 생기고 마지막 보고로부터 이만큼 지났으면 중간에도 보고한다.
HELD_REPORT_INTERVAL = 600     # 초 — 보류 수가 바뀌었을 때 보고하는 최소 간격
HELD_REFRESH_INTERVAL = 1800   # 초 — 바뀐 것이 없어도 이 간격으로는 다시 보고한다
_last_held_report = {}         # job id → (시각, 보고한 보류 수)


def _report_held_if_due(job):
    """진행 중에도 주기적으로 보고한다.

    보류 수가 바뀌면 10분 간격으로, 그대로여도 30분마다 한 번은 보고한다 — 음원 올리기가
    실패했거나 다른 작업의 보류가 바뀐 경우가 다음 보고에서 스스로 메워진다."""
    if not job.get("upload_key"):
        return
    held = sum(1 for i in job["items"] if i["status"] == "held")
    at, n = _last_held_report.get(job["id"], (0.0, -1))
    age = time.time() - at
    if age < HELD_REPORT_INTERVAL or (held == n and age < HELD_REFRESH_INTERVAL):
        return
    _report_held(job)
    _last_held_report[job["id"]] = (time.time(), held)


def _report_held(job):
    """이 PC 의 보류를 **작업 전부에서** 모아 보고한다.

    서버는 PC 마다 목록을 통째로 갈아끼운다. 예전엔 지금 작업의 보류만 보내서, 보류 0 인 책이
    끝나면 앞 책의 보류가 관리자 화면에서 사라졌다(2026-09-10 갈 3:7). 같은 성우·슬롯의 작업을 다 모은다.
    음원은 여기서 싣지 않는다 — server.report_held 가 서버에 없는 것만 한 건씩 올린다."""
    key = job.get("upload_key")
    if not key:
        return
    held, seen, found_self = [], set(), False
    for j in list_jobs():
        if j.get("id") == job["id"]:
            j, found_self = job, True    # 진행 중인 작업은 메모리 사본이 최신이다
        if j.get("upload_key") != key or j.get("voice") != job.get("voice"):
            continue
        for it in j.get("items", []):
            if it.get("status") == "held" and it["text"] not in seen:
                seen.add(it["text"])
                held.append(it)
    if not found_self:
        held += [it for it in job["items"] if it["status"] == "held" and it["text"] not in seen]
    try:
        import server
        if not server.enabled():
            return
        items = [{
            "ref": it["ref"], "book": it["ref"].split(" ")[0],
            "text": it["text"], "asr": it.get("asr", ""),
            "ratio": it.get("ratio"), "reason": it.get("reason", ""),
            "audio_sec": it.get("audio_sec"), "tries": it.get("tries"),
            "out": it.get("out"),        # 관리자가 들어보고 판단할 수 있게 — 서버에 없을 때만 올라간다
        } for it in held]
        server.report_held(job["voice"], key, items)
        job.pop("held_report_error", None)
    except Exception as e:
        job["held_report_error"] = str(e)[:200]


def _held_tasks():
    """관리자 판단 — {'regenerate': [...], 'decided': [...]}. 서버가 안 되면 None."""
    try:
        import server
        if not server.enabled():
            return None
        return server.held_tasks()
    except Exception:
        return None


def _apply_admin_tasks(tasks, job):
    """관리자 판단을 작업 하나에 반영한다. 반환: (다시 만들 절 수, 이대로 쓰기로 한 절 수)

    재생성 요청 — 다시 큐에 올린다. tries=1 로 두어 첫 재생성부터 강제 분할이 걸리게 한다.
      한 요청은 **한 번만** 처리한다. 재생성이 또 실패해 다시 보류가 되면 요청은 서버에
      그대로 남아 있는데, 그걸 매번 다시 집으면 같은 절을 무한히 반복 생성하게 된다.
    이대로 사용 — 서버가 보관 음원을 이미 올렸다. 여기서는 합격·업로드됨으로 표시만 한다.
      그래야 생성 탭의 보류 숫자가 관리자 화면의 '판단 대기'와 맞는다.
    비워 둠 — 손대지 않는다(보류로 남는다)."""
    regen = {r["text"] for r in tasks.get("regenerate", [])}
    use = {d["text"] for d in tasks.get("decided", []) if d.get("action") == "use"}
    already = set(job.get("regen_applied") or [])
    n_regen = n_use = 0
    for it in job["items"]:
        if it["status"] != "held":
            continue
        if it["text"] in regen and it["key"] not in already:
            it["status"] = "pending"
            it["tries"] = 1
            it["reason"] = "관리자 재생성 요청"
            it.pop("uploaded", None)
            already.add(it["key"])
            n_regen += 1
        elif it["text"] in use:
            it["status"] = "ok"
            it["uploaded"] = True
            it["reason"] = "관리자 판단: 이대로 사용 (서버가 올림)"
            n_use += 1
    if n_regen:
        job["regen_applied"] = sorted(already)
    return n_regen, n_use


def _apply_regen_requests(job):
    """작업이 끝날 때 — 이 작업에 걸린 관리자 판단을 반영한다. 다시 만들 절 수를 돌려준다."""
    if not job.get("upload_key"):
        return 0
    tasks = _held_tasks()
    return _apply_admin_tasks(tasks, job)[0] if tasks else 0


ADMIN_SYNC_INTERVAL = 600      # 초
_last_admin_sync = [0.0]


def _sync_admin_if_due(job):
    """관리자 판단을 **이 PC 의 작업 전부에** 주기적으로 반영한다.

    예전엔 작업이 끝날 때 그 작업 것만 봤다. 그래서 이미 끝난 책의 보류는 재생성을 요청해도
    다시 만들어지지 않았고, 구약 전체를 한 작업으로 도는 PC 는 요청이 며칠 뒤에야 처리됐다.
    끝난 작업에 다시 만들 절이 생기면 큐에 올린다 — 워커는 지금 작업을 마친 뒤 진도표 순서로 집는다."""
    key = job.get("upload_key")
    if not key or time.time() - _last_admin_sync[0] < ADMIN_SYNC_INTERVAL:
        return
    _last_admin_sync[0] = time.time()
    tasks = _held_tasks()
    if not tasks:
        return
    changed = False
    for j in list_jobs():
        if j.get("upload_key") != key or j.get("voice") != job.get("voice"):
            continue
        if j.get("id") == job["id"]:
            r, u = _apply_admin_tasks(tasks, job)   # 진행 중인 작업은 메모리 사본을 고친다 — 곧 저장된다
            changed |= bool(r or u)
            continue
        r, u = _apply_admin_tasks(tasks, j)
        if r or u:
            if r and j.get("status") == "done":
                j["status"] = "queued"
            save(j)
            changed = True
    if changed:
        _report_held(job)       # 판단이 반영된 절은 보류 목록에서 빠진다


def book_progress(job):
    """책별 집계. 작업 하나에 수십 권이 들어가면 총계만으로는 아무것도 알 수 없다.

    절 참조("출애굽기 3:14")에서 책 이름을 뽑아 원래 순서대로 묶는다.
    반환: {books:[{name,total,ok,held,uploaded,pending,last}], current, done_books, total_books}
    """
    order, per = [], {}
    for it in job["items"]:
        b = (it.get("ref") or " ").split(" ")[0]
        if b not in per:
            per[b] = {"name": b, "total": 0, "ok": 0, "held": 0,
                      "uploaded": 0, "pending": 0, "last": None}
            order.append(b)
        d = per[b]
        d["total"] += 1
        st = it["status"]
        if st == "ok":
            d["ok"] += 1
            d["last"] = it.get("ref")
        elif st == "held":
            d["held"] += 1
            d["last"] = it.get("ref")
        else:
            d["pending"] += 1
        if it.get("uploaded"):
            d["uploaded"] += 1

    current = None
    for b in order:
        if per[b]["pending"] and current is None:
            current = per[b]
    return {
        "books": [per[b] for b in order],
        "current": current,
        "done_books": sum(1 for b in order if not per[b]["pending"]),
        "total_books": len(order),
    }


def book_rows(job):
    """책별 진행 표 — [책, 상태, 진행, 보류, 업로드, 마지막 절]"""
    p = book_progress(job)
    cur = p["current"]
    rows = []
    for b in p["books"]:
        done = b["ok"] + b["held"]
        pct = done * 100 // b["total"] if b["total"] else 0
        if not b["pending"]:
            state = "완료"
        elif cur and b["name"] == cur["name"]:
            state = "진행중"
        elif done:
            state = "일부"
        else:
            state = "대기"
        rows.append([b["name"], state, f"{done}/{b['total']} ({pct}%)",
                     b["held"], b["uploaded"], b["last"] or ""])
    return rows


def where(job):
    """진행 위치 한 줄 — '출애굽기 320/1213 · 3/38권'"""
    p = book_progress(job)
    c = p["current"]
    if p["total_books"] <= 1:
        if not c:
            b = p["books"][0] if p["books"] else None
            return f"{b['name']} 완료" if b else ""
        return f"{c['name']} {c['ok'] + c['held']}/{c['total']}"
    if not c:
        return f"완료 · {p['total_books']}권"
    return (f"{c['name']} {c['ok'] + c['held']}/{c['total']}"
            f" · {p['done_books']}/{p['total_books']}권")


def upload_counts(job):
    """(올림, 올릴 것 남음) — UI/CLI 표시용"""
    key = job.get("upload_key")
    if not key:
        return 0, 0
    done = sum(1 for i in job["items"] if i.get("uploaded"))
    left = sum(1 for i in job["items"] if i["status"] == "ok" and not i.get("uploaded"))
    return done, left


def _skip_already_made(job):
    """다른 PC 가 이미 만든 절은 건너뛴다.

    책 하나를 시작할 때 서버에 "이미 있는 절 목록" 을 한 번만 물어본다.
    절마다 물으면 왕복이 수만 번이고, 작업을 걸 때 미리 물어보면 며칠 뒤 만들 책까지
    그 시점 기준으로 판정해 그 사이 다른 PC 가 만든 것을 놓친다.

    서버가 안 되면 아무것도 건너뛰지 않는다 — **절대 멈추지 않는다**."""
    key = job.get("upload_key")
    if not key:
        return 0
    if job.get("replace"):
        return _skip_already_replaced(job, key)
    try:
        import server
        have = server.cache_index(key)
    except Exception:
        have = None
    if not have:
        return 0
    n = 0
    for it in job["items"]:
        if it["status"] != "pending":
            continue
        if engine.text_hash(it["text"]) in have:
            it["status"] = "ok"
            it["uploaded"] = True          # 서버에 이미 있으니 올릴 것도 없다
            it["reason"] = "이미 서버에 있음"
            n += 1
    return n


def _skip_already_replaced(job, key):
    """교체 작업 — 그 사이 이미 새 방식으로 바뀐 절(다른 PC 가 교체했거나 본문이 바뀌어 새 키가 된 절)은
    건너뛴다. 서버에 '아직 구방식인 목록' 을 책마다 한 번 묻는다.

    서버가 안 되면 아무것도 건너뛰지 않는다 — 다 만들어도 서버가 새 방식 파일은 덮어쓰지 않으므로
    낭비일 뿐 사고는 아니다."""
    try:
        import server
        legacy = server.cache_index(key, legacy=True)
    except Exception:
        legacy = None
    if legacy is None:
        return 0
    n = 0
    for it in job["items"]:
        if it["status"] != "pending":
            continue
        if engine.text_hash(it["text"]) not in legacy:
            it["status"] = "ok"
            it["uploaded"] = True
            it["reason"] = "이미 새 방식으로 교체됨"
            n += 1
    return n


def _flag_note_residue(job):
    """주석이 본문에 섞여 들어간 절은 만들지 않고 보류한다.

    만들어 버리면 주석을 소리 내어 읽는 음원이 되고, 검수는 통과한다 —
    잘못된 원문과 음원이 일치하기 때문이다(욥기 1:5 가 그랬다).
    사람이 본문을 고쳐야 하는 일이므로 중앙 검수로 올린다."""
    n = 0
    for it in job["items"]:
        if it["status"] != "pending":
            continue
        # 끝의 고아 괄호 하나뿐이라 지워도 문장이 온전한 절은 막지 않는다.
        # (prosody.clean_for_tts 가 생성 입력에서 그 괄호를 떼어낸다)
        stray = engine.note_residue(prosody.strip_orphan_paren(it["text"]))
        if stray:
            it["status"] = "held"
            it["reason"] = f"본문에 주석 잔재 의심(짝 없는 괄호 {stray}개) — 본문 확인 필요"
            it["ratio"] = None
            n += 1
    return n


# ───────────────────────── 워커 ─────────────────────────
_BEST_KEYS = ("best_end_ms", "best_ratio", "best_asr", "best_audio_sec", "end_retry")


def _best_path(p):
    return p.with_name(p.stem + ".best.wav")


def _drop_best(it, p):
    bp = _best_path(p)
    if bp.exists():
        bp.unlink()
    for k in _BEST_KEYS:
        it.pop(k, None)


def _accept_best(it, p):
    """끝이 가장 긴 시도를 쓴다 — 절 끝 검사로 다시 만들다 재시도 상한에 닿았을 때의 마무리."""
    bp = _best_path(p)
    if bp.exists() and it.get("best_end_ms", -1) > it.get("end_ms", -1):
        shutil.copyfile(bp, p)
        it["end_ms"] = it["best_end_ms"]
        it["ratio"] = it.get("best_ratio", it.get("ratio"))
        it["asr"] = it.get("best_asr", it.get("asr", ""))
        it["audio_sec"] = it.get("best_audio_sec", it.get("audio_sec"))
    _drop_best(it, p)
    it["status"] = "ok"
    it["reason"] = f"절 끝 짧음({it.get('end_ms', 0):.0f}ms) — 가장 나은 시도 사용"


def _judge(job, it, p, w, sr, ok):
    """받아쓰기 결과와 절 끝 길이로 절의 다음 상태를 정한다.

    절 끝 검사: 받아쓰기는 통과했는데 끝 음절이 짧게 잘렸으면(engine.END_MIN_MS 미만) 다시
    만든다. 끝이 가장 긴 시도는 따로 보관해 두었다가, 상한에 닿으면 그것을 쓴다 —
    **보류하지 않는다.** 내용은 맞고 끝맺음만 아쉬운 것이라 사람이 판단할 일이 아니다.
    """
    last = it["tries"] >= job["retry_max"]
    if ok:
        end_ms = engine.final_syllable_ms(w, sr)
        it["end_ms"] = round(end_ms)
        if end_ms >= engine.END_MIN_MS:
            _drop_best(it, p)
            it["status"] = "ok"
            return
        if end_ms > it.get("best_end_ms", -1):
            shutil.copyfile(p, _best_path(p))
            it["best_end_ms"] = round(end_ms)
            it["best_ratio"] = it.get("ratio")
            it["best_asr"] = it.get("asr", "")
            it["best_audio_sec"] = it.get("audio_sec")
        if last:
            _accept_best(it, p)
        else:
            it["end_retry"] = True
            it["reason"] = f"절 끝 짧음({end_ms:.0f}ms<{engine.END_MIN_MS}) — 다시 만듦"
            it["status"] = "pending"
        return
    # 받아쓰기 불합격 — 다음 재시도는 본문을 더 잘게 쪼개는 기존 경로로 간다
    it["end_retry"] = False
    if last:
        if _best_path(p).exists():
            it["end_ms"] = -1          # 앞서 받아쓰기를 통과한 시도가 있으면 반드시 그것을 쓴다
            _accept_best(it, p)
        else:
            it["status"] = "held"      # 상한 초과 → 보류(사람이 판단)
    else:
        it["status"] = "pending"


def _process(job):
    job["status"] = "running"
    save(job)
    voice, batch = job["voice"], max(1, int(job["batch"]))

    # 시작할 때마다 본문을 최신 DB 로 맞춘다. 예전엔 '이어갈 때'(requeue·resume_all)만 맞춰서,
    # 끝난 책을 관리자 재생성 요청으로 다시 돌리면 정정 이전 본문으로 만들었다(요 1:42 — 편집자
    # 주석까지 읽음). 주석 잔재 판정보다 먼저 해야 고쳐진 본문이 다시 보류되지 않는다.
    try:
        if refresh_job_text(job):
            save(job)
    except Exception as e:
        print(f"[본문 최신화] 실패 — 옛 본문 그대로 진행: {e}", flush=True)

    flagged = _flag_note_residue(job)
    if flagged:
        _cur["note"] = f"주석 잔재 의심 {flagged}개 보류"
        save(job)

    skipped = _skip_already_made(job)
    if skipped:
        job["skipped_existing"] = skipped
        _cur["note"] = f"이미 있는 절 {skipped}개 건너뜀"
        save(job)

    while not _stop.is_set():
        pend = [i for i in job["items"] if i["status"] == "pending"]
        if not pend:
            break
        # 같은 재시도 회차끼리 묶는다 — 회차가 오를수록 더 잘게 쪼개 잘림을 피한다
        # 단 '절 끝만 짧아서' 다시 만드는 절은 본문을 더 쪼개지 않는다 — 쪼개면 절 중간에 쉼이
        # 끼어 호흡이 달라진다. 끝만 다시 뽑으면 되므로 처음과 같은 조건으로 만든다.
        key0 = (pend[0]["tries"], bool(pend[0].get("end_retry")))
        group = [i for i in pend if (i["tries"], bool(i.get("end_retry"))) == key0][:batch]
        tries0, end_retry = key0
        if end_retry:
            max_len, force = engine.MAX_LEN, False
        else:
            max_len, force = max(40, engine.MAX_LEN // (1 + tries0)), tries0 >= 1
        _cur["note"] = (f"{group[0]['ref']} 외 {len(group)-1}건" if len(group) > 1
                        else group[0]["ref"]) + (f" (재시도{tries0})" if tries0 else "")
        try:
            wavs, sr = engine.synth_batch([g["text"] for g in group], voice,
                                          job["temp"], job["punct"], max_len=max_len,
                                          force=force)
        except Exception as e:
            job["status"] = "error"
            job["error"] = str(e)[:500]
            save(job)
            return

        for it, w in zip(group, wavs):
            it["tries"] += 1
            it["method"] = engine.METHOD      # 어떤 방식으로 만들었는가 — 구방식 항목에는 이 표지가 없다
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

            _judge(job, it, p, w, sr, ok)
        _upload_ready(job)
        _report_held_if_due(job)
        _sync_admin_if_due(job)
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


def unfinished():
    """아직 안 끝난 작업들. PC 가 꺼졌다 켜졌을 때 이어갈 대상."""
    out = []
    for j in list_jobs():
        _ok, _held, pend = counts(j)
        if pend and j.get("status") in ("queued", "running", "stopped"):
            out.append(j)
    return out


def refresh_all_jobs():
    """모든 작업(끝난 것까지)의 본문을 최신 DB 로 맞춘다. 끝난 작업에 만들 절이 생기면 다시 큐에 올린다.

    보류가 풀리거나 낭독 내용이 달라진 절이 생기는데, unfinished() 는 pending 이 있어야 골라내므로
    끝난 작업은 영영 대상에서 빠진다 — 그러면 고쳐진 절의 음원이 끝내 안 생긴다.
    스튜디오(resume_all)와 run_plan 이 시작할 때 부른다. 반환: 다시 큐에 올린 작업 수"""
    n = 0
    for j in list_jobs():
        try:
            if not refresh_job_text(j):
                continue
        except Exception as e:
            print(f"[본문 최신화] '{j.get('title')}' 실패 — 건너뜀: {e}", flush=True)
            continue
        if j.get("status") == "done" and any(i.get("status") == "pending" for i in j.get("items", [])):
            j["status"] = "queued"
            n += 1
            print(f"[본문 최신화] '{j.get('title')}' 에 만들 절이 생겨 다시 큐에 올립니다", flush=True)
        save(j)
    return n


def resume_all():
    """중단된 작업을 모두 다시 큐에 올리고 워커를 켠다.

    PC 가 꺼지면 작업 파일에 status="running" 이 그대로 남는다. 워커는 그 상태도
    집어가지만, **앱이 켜질 때 워커 자체가 시작되지 않아** 사람이 '이어하기'를
    누르기 전까지 아무 일도 일어나지 않았다. 며칠짜리 작업에서는 치명적이다.

    반환: 이어갈 작업 수"""
    refresh_all_jobs()

    jobs_ = unfinished()
    for j in jobs_:
        if j.get("status") == "stopped":
            j["status"] = "queued"
            save(j)
    if jobs_:
        start_worker()
    return len(jobs_)


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


def refresh_job_text(job):
    """아직 안 만든 절의 본문을 지금 DB 값으로 맞춘다. 바뀐 절 수를 돌려준다.

    작업을 만들 때 본문을 통째로 복사해 둔다. 그래서 작업을 만든 **뒤에** 본문이
    고쳐지면(주석 잔재 정정 등) 작업 파일은 옛 본문을 계속 들고 있다. 그대로 만들면
    두 가지가 어긋난다.

      1) 화면에 보이는 본문과 다른 것을 읽는다
      2) 공유 캐시 키가 sha1(본문)이라 **키가 어긋나 앱에서 조용히 캐시 미스**가 난다.
         오류도 경고도 없이 그 절만 다른 성우로 읽힌다.

    며칠짜리 작업에서는 그 사이에 본문이 고쳐지는 일이 실제로 일어난다. 그래서
    이어갈 때마다 한 번 맞춘다. 이미 만든 절은 건드리지 않는다 — 그것들은 산출물이
    있고, 본문이 바뀌었다면 어차피 다시 만들어야 하므로 여기서 판단할 일이 아니다.

    **보류(held)도 함께 푼다.** 보류는 그때의 본문에 대한 판정이므로, 본문이 고쳐졌으면
    그 판정은 사라진 본문에 대한 것이 되어 더 이상 유효하지 않다. 풀지 않으면 그 절은
    영원히 보류로 남아 음원이 생기지 않는다 — 화면에는 멀쩡한 본문이 보이는데 낭독만
    다른 성우로 나가고, 아무도 이유를 모른다.

    본문이 그대로인 보류는 손대지 않는다. 그것이 사람이 들어보고 판단할 일이다.

    **이미 만든 절도 본다.** 본문이 바뀌었는데 그때 읽은 내용까지 달라졌다면(각주를 소리 내어
    읽은 경우) 그 음원은 사라진 본문을 읽고 있으므로 다시 만든다. 읽은 내용이 같으면
    — 끝의 고아 괄호처럼 생성 입력에서 이미 떨어져 나간 차이면 — 본문만 고쳐 두고
    다시 만들지 않는다. 음원은 멀쩡하고 캐시 키만 어긋난 것이라 재생성은 낭비다
    (scripts/rekey-tts-cache.mjs 가 복사로 해결한다).

    조회에 실패하면 아무것도 바꾸지 않는다. 옛 본문으로 만드는 것이 손해이긴 해도,
    반쯤 바뀐 작업 파일을 남기는 것보다는 낫다.
    """
    todo = [i for i in job.get("items", []) if i.get("status") in ("pending", "held", "ok")]
    if not todo:
        return 0

    # key 는 "{ver}_{code}_{ch:03d}_{v:03d}" — 책 단위로 묶어 한 번씩만 조회한다
    groups = {}
    for it in todo:
        parts = (it.get("key") or "").split("_")
        if len(parts) != 4:
            continue
        ver, code, ch, v = parts[0], parts[1], parts[2], parts[3]
        try:
            groups.setdefault((ver, code), []).append((int(ch), int(v), it))
        except ValueError:
            continue

    changed = 0
    released = 0
    remade = 0
    for (ver, code), lst in groups.items():
        try:
            rows = engine.get_book_verses(ver, code)
        except Exception as e:
            print(f"[본문 최신화] {ver}/{code} 조회 실패 — 건너뜀: {e}", flush=True)
            continue
        now = {(ch, v): t for ch, v, t in rows}
        for ch, v, it in lst:
            cur = now.get((ch, v))
            if not cur or cur == it.get("text"):
                continue
            was = it.get("status")
            spoken_changed = prosody.clean_for_tts(it.get("text") or "") != prosody.clean_for_tts(cur)
            it["text"] = cur
            changed += 1
            if was == "held":
                # 본문이 바뀌었으니 그때의 판정은 무효다. 다시 만들 기회를 준다.
                it["status"] = "pending"
                it["reason"] = ""
                it["ratio"] = None
                it["tries"] = 0
                released += 1
            elif was == "ok" and spoken_changed:
                # 이미 만든 절인데 **읽은 내용이 달라졌다** — 그 음원은 사라진 본문을 읽고 있다
                # (각주를 소리 내어 읽은 경우가 이것이다). 키만 옮기면 틀린 소리가 되므로
                # 다시 만든다.
                #
                # 읽은 내용이 같으면(끝의 고아 괄호처럼 생성 입력에서 이미 떨어져 나간 차이)
                # 본문만 고쳐 두고 다시 만들지 않는다 — 음원은 멀쩡하고 키만 어긋난 것이라
                # scripts/rekey-tts-cache.mjs 가 복사로 해결한다.
                it["status"] = "pending"
                it["reason"] = ""
                it["ratio"] = None
                it["tries"] = 0
                it.pop("uploaded", None)
                remade += 1
    if changed:
        msg = f"[본문 최신화] 절 {changed}건의 본문을 최신 DB 로 맞췄습니다"
        if released:
            msg += f" · 보류 {released}건 해제"
        if remade:
            msg += f" · 낭독 내용이 달라진 {remade}건 재생성"
        print(msg, flush=True)
    return changed


def requeue(jid):
    """중단된 작업을 이어서 진행. 이어가기 전에 본문을 최신 DB 로 맞춘다."""
    job = load(jid)
    if not job:
        return False
    changed = refresh_job_text(job)
    if job["status"] in ("stopped", "error", "done"):
        job["status"] = "queued"
        save(job)
    elif changed:
        save(job)
    _stop.clear()
    start_worker()
    return True
