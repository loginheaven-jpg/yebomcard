# server.py — 예봄성경 서버와 통신하는 얇은 클라이언트.
#
# 이 파일이 있어서 로컬 PC 에 비밀키가 하나도 없다:
#   * 성경 본문   → 서버가 내려준 공개 anon 키로 Supabase 직접 조회
#   * 음원 업로드 → 서버에 본문+mp3 를 보내면 서버가 R2 에 쓴다
#   * 보이스      → 서버가 참조음을 내려준다 (PC 마다 다시 자르지 않게)
#
# 예전 방식(각 PC 에 R2 비밀키 복사)은 PC 가 늘수록 키가 퍼지고 한 대만
# 분실돼도 저장소 전체가 노출됐다. 이제는 토큰 하나만 폐기하면 끝난다.
#
# 접속 정보는 bootstrap.py 가 남긴 studio.json 에서 읽는다.
# 개발 중인 이 저장소에서 그냥 돌릴 때는 studio.json 이 없어도 되고,
# 그 경우 조용히 "서버 연동 없음" 으로 동작한다(로컬 .env.local 사용).

import hashlib
import base64
import json
import os
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
_conf = None


def config():
    """{'base':…, 'token':…} 또는 연동 정보가 없으면 None"""
    global _conf
    if _conf is not None:
        return _conf or None

    base = os.environ.get("YEBOM_BASE")
    token = os.environ.get("YEBOM_TOKEN")
    if not (base and token):
        for p in (HERE / "studio.json", Path.home() / "YebomVoice" / "studio.json"):
            if p.exists():
                try:
                    d = json.loads(p.read_text(encoding="utf-8"))
                    base, token = d.get("base"), d.get("token")
                    break
                except Exception:
                    pass
    _conf = {"base": base.rstrip("/"), "token": token} if base and token else {}
    return _conf or None


def enabled():
    return config() is not None


def _headers():
    return {"Authorization": f"Bearer {config()['token']}"}


class ServerError(RuntimeError):
    pass


def _raise(r):
    detail = ""
    try:
        detail = r.json().get("error", "")
    except Exception:
        detail = (r.text or "")[:200]
    if r.status_code == 401:
        raise ServerError(
            f"서버가 이 PC 를 인정하지 않습니다({detail}). "
            "예봄성경 설정에서 설치 파일을 새로 받아 주세요."
        )
    raise ServerError(f"서버 오류 {r.status_code} — {detail}")


def remote_config():
    """서버 설정(Supabase 공개 키 등). 연동 없으면 None"""
    if not enabled():
        return None
    r = requests.get(f"{config()['base']}/api/voice-studio/config", headers=_headers(), timeout=30)
    if not r.ok:
        _raise(r)
    return r.json()


def list_voices():
    if not enabled():
        return []
    r = requests.get(f"{config()['base']}/api/voice-studio/voices", headers=_headers(), timeout=60)
    if not r.ok:
        _raise(r)
    return r.json().get("voices", [])


def fetch_voice(name):
    """(meta:dict, ref_wav:bytes)"""
    if not enabled():
        raise ServerError("서버 연동이 설정되지 않았습니다")
    r = requests.get(
        f"{config()['base']}/api/voice-studio/voices/{requests.utils.quote(name)}",
        headers=_headers(), timeout=120,
    )
    if not r.ok:
        _raise(r)
    d = r.json()
    return d["meta"], base64.b64decode(d["refWavBase64"])


def upload_verses(voice_key, items, replace=False, timeout=180):
    """items: [{'ref':…, 'text': 원문(정제 전 그대로), 'mp3': bytes}]

    키는 **서버가** 본문으로 계산한다. 로컬이 계산한 키는 보내지 않는다 —
    로컬 코드가 어긋나 엉뚱한 키로 올라가면 조용히 캐시 미스가 나기 때문이다.
    반환: {'uploaded':n,'exists':n,'failed':n,'results':[…]}
    """
    if not enabled():
        raise ServerError("서버 연동이 설정되지 않았습니다 (studio.json 없음)")
    payload = {
        "voiceKey": voice_key,
        "replace": bool(replace),   # 구방식 교체 — 서버가 구방식 파일일 때만 덮어쓴다
        "items": [
            {
                "ref": it["ref"],
                "text": it["text"],
                "mp3Base64": base64.b64encode(it["mp3"]).decode("ascii"),
            }
            for it in items
        ],
    }
    r = requests.post(
        f"{config()['base']}/api/voice-studio/upload",
        headers={**_headers(), "Content-Type": "application/json"},
        data=json.dumps(payload), timeout=timeout,
    )
    if not r.ok:
        _raise(r)
    return r.json()


def _held_id(voice_key, text):
    """서버 heldId(held/route.ts) 와 같은 규칙 — 성우 슬롯 + 본문."""
    return hashlib.sha1(f"{voice_key} {text}".encode("utf-8")).hexdigest()


def report_held(voice, voice_key, items, timeout=120):
    """보류 절을 서버로 보고한다 — 여러 PC 의 문제 절을 한 곳에서 판단하기 위해.

    items: [{'ref','book','text','asr','ratio','reason','audio_sec','tries','out'(wav 경로|None)}]
    이 PC 의 목록을 통째로 갈아끼우므로, 해결된 절은 다음 보고에서 자동으로 빠진다.

    음원은 목록에 싣지 않고 **서버에 없는 것만 한 건씩** 올린다. 예전엔 목록에 전부 실어 보냈는데,
    보류가 스무 개를 넘으면 요청이 서버 한도(4.5MB)를 넘어 보고 전체가 거절됐다 — 새 PC 는
    2026-09-10 오후부터 보고가 끊겨 관리자 화면에 보류가 하나도 안 보였다.
    반환: {'reported': n, 'audio_uploaded': k}
    """
    if not enabled():
        return None
    payload = {
        "voice": voice,
        "voiceKey": voice_key,
        "items": [
            {
                "ref": it["ref"],
                "book": it.get("book", ""),
                "text": it["text"],
                "asr": it.get("asr", ""),
                "ratio": it.get("ratio") or 0,
                "reason": it.get("reason", ""),
                "audioSec": it.get("audio_sec") or 0,
                "tries": it.get("tries") or 0,
            }
            for it in items
        ],
    }
    r = requests.post(
        f"{config()['base']}/api/voice-studio/held",
        headers={**_headers(), "Content-Type": "application/json"},
        data=json.dumps(payload), timeout=timeout,
    )
    if not r.ok:
        _raise(r)
    missing = set(r.json().get("missingAudio") or [])
    sent = 0
    if missing:
        import engine    # mp3 인코딩(ffmpeg) — 필요할 때만 불러온다
        for it in items:
            out = it.get("out")
            if _held_id(voice_key, it["text"]) not in missing or not out or not Path(out).exists():
                continue
            a = requests.post(
                f"{config()['base']}/api/voice-studio/held/audio",
                headers={**_headers(), "Content-Type": "application/json"},
                data=json.dumps({
                    "voiceKey": voice_key,
                    "text": it["text"],
                    "mp3Base64": base64.b64encode(engine.encode_mp3(out)).decode("ascii"),
                }),
                timeout=timeout,
            )
            if a.ok:
                sent += 1
    return {"reported": len(items), "audio_uploaded": sent}


def held_tasks(timeout=60):
    """관리자 판단 — {'regenerate': [{'id','ref','text'}], 'decided': [{'id','ref','text','action'}]}

    decided 는 '이대로 사용'·'비워 둠' 처럼 PC 가 다시 만들 필요가 없는 판단이다(옛 서버는 주지 않는다)."""
    if not enabled():
        return {"regenerate": [], "decided": []}
    r = requests.get(f"{config()['base']}/api/voice-studio/held/tasks",
                     headers=_headers(), timeout=timeout)
    if not r.ok:
        _raise(r)
    d = r.json()
    return {"regenerate": d.get("regenerate", []), "decided": d.get("decided", [])}


def regen_requests(timeout=60):
    """관리자가 '재생성 요청'을 누른 절 목록. [{'id','ref','text'}]"""
    return held_tasks(timeout)["regenerate"]


def cache_index(voice_key, legacy=False, timeout=120):
    """이미 만들어진 절의 해시 집합. 서버가 안 되면 None(= 건너뛰기 판단 안 함).

    책 하나를 시작할 때 한 번 부른다. 이걸로 다른 PC 가 이미 만든 절을 피한다.
    실패해도 생성은 계속돼야 하므로 예외를 밖으로 던지지 않는다.

    legacy=True 면 **아직 구방식인 파일만** 받는다 — 교체할 절을 고를 때 쓴다."""
    if not enabled():
        return None
    try:
        r = requests.get(f"{config()['base']}/api/voice-studio/cache-index",
                         params={"voiceKey": voice_key, **({"legacy": "1"} if legacy else {})},
                         headers=_headers(), timeout=timeout)
        if not r.ok:
            return None
        return {h for h in r.text.split() if h}
    except Exception:
        return None
