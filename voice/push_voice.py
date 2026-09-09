# push_voice.py — 이 PC 의 보이스를 예봄성경 서버에 등록한다(관리자 전용).
#
#   python push_voice.py --voice 영희 --voice-key f4 --gender female
#
# 왜 필요한가
#   참조 클립이 1초라도 다르면 음색이 미묘하게 달라져 **책마다 목소리가 바뀐다**.
#   듣기 전에는 알아채기 어렵고, 알아챘을 땐 이미 수천 절을 만든 뒤다.
#   그래서 새 PC 가 클립을 다시 자르지 않고 **같은 파일을 받아가게** 한다.
#
# 인증
#   이건 관리자 세션이 필요하다(기기 토큰으로는 안 된다 — 보이스 복제 데이터를
#   등록·교체하는 일이라 사람이 로그인한 상태여야 한다).
#   브라우저에서 예봄성경에 로그인한 뒤, 개발자도구 > 애플리케이션 > 쿠키에서
#   `saint_record_session` 값을 복사해 --session 으로 넘긴다.

import argparse
import base64
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import requests

import engine
import server


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", required=True, help="이 PC 의 보이스 이름 (voices/ 아래)")
    ap.add_argument("--voice-key", default=None,
                    help="예봄성경 성우 슬롯 (예: f4=영희). 지정하면 생성분이 이 슬롯으로 자동 업로드된다")
    ap.add_argument("--gender", default=None, choices=["male", "female"])
    ap.add_argument("--session", default=None,
                    help="예봄성경 로그인 쿠키(saint_record_session) 값")
    ap.add_argument("--base", default=None, help="서버 주소 (기본: studio.json 또는 https://bible.yebom.org)")
    a = ap.parse_args()

    ref = Path(engine.voice_ref(a.voice))
    meta = engine.voice_meta(a.voice)
    if not ref.exists():
        print(f"참조음이 없습니다: {ref}"); sys.exit(1)
    if not meta.get("ref_text"):
        print(f"meta.json 에 ref_text 가 없습니다: {a.voice}"); sys.exit(1)

    conf = server.config()
    base = (a.base or (conf or {}).get("base") or "https://bible.yebom.org").rstrip("/")
    if not a.session:
        print("--session 이 필요합니다.")
        print("  예봄성경에 관리자로 로그인 → 개발자도구(F12) → 애플리케이션 → 쿠키")
        print("  → saint_record_session 값을 복사해 --session 으로 넘기세요.")
        sys.exit(1)

    wav = ref.read_bytes()
    fp = engine.voice_fingerprint(a.voice)
    print(f"보이스 {a.voice} · 지문 {fp} · 참조음 {len(wav):,} bytes")
    print(f"참조 텍스트: {meta['ref_text'][:60]}...")
    print(f"→ {base}")

    r = requests.post(
        f"{base}/api/voice-studio/voices",
        json={
            "name": a.voice,
            "refText": meta["ref_text"],
            "refWavBase64": base64.b64encode(wav).decode("ascii"),
            "gender": a.gender or meta.get("gender"),
            "voiceKey": a.voice_key or meta.get("voiceKey"),
        },
        cookies={"saint_record_session": a.session},
        timeout=180,
    )
    if not r.ok:
        detail = ""
        try:
            detail = r.json().get("error", "")
        except Exception:
            detail = (r.text or "")[:200]
        print(f"실패 {r.status_code}: {detail}")
        if r.status_code == 403:
            print("  관리자 계정으로 로그인한 쿠키인지 확인하세요.")
        sys.exit(1)

    v = r.json()["voice"]
    print(f"등록 완료 — 서버 지문 {v['fingerprint']}")
    if v["fingerprint"] != fp:
        print(f"  [경고] 로컬 지문({fp})과 다릅니다. 규칙이 어긋났을 수 있습니다.")
    else:
        print("  로컬 지문과 일치 — 새 PC 가 같은 음색으로 생성합니다.")


if __name__ == "__main__":
    main()
