"""새번역 각주 잔재 7절 정정 계획을 만든다 — scripts/data/rnksv-footnote-fix-2.json (2026-09-11)

  python scripts/make-rnksv-footnote-fix-2.py
  node scripts/fix-rnksv-stray-parens.mjs --plan scripts/data/rnksv-footnote-fix-2.json          # dry-run
  node scripts/fix-rnksv-stray-parens.mjs --plan scripts/data/rnksv-footnote-fix-2.json --apply  # 적용

2026-09-09 의 짝 없는 ')' 일괄 정정(rnksv-paren-fix.json)에서 빠진 절들이다. 음원 생성기가 '주석 잔재 의심'
으로 보류해 둔 것 가운데 본문 최신화로 풀리지 않은 것 — DB 본문 자체에 각주 조각이 남아 있다.
지휘부 승인(2026-09-11). 사사기 6:24 는 지휘부가 직접 고쳤다(괄호 문장을 대괄호로) — 여기서 다루지 않는다.

**DB 원문 기준으로 만든다.** 원문은 '본문 + (주: …)' 인데, 각주 조각은 본문 쪽 끝에 있다.
본문 쪽만 표시한 끝에서 자르고 뒤의 '(주: …)' 편집자 주석은 그대로 붙인다 — 주석은 화면에 보이는
정상 주석이고 낭독에서만 빠진다. (처음엔 생성기가 주석을 떼고 읽은 본문으로 만들어 적용 스크립트가
'DB 와 다름'으로 전부 건너뛰었다.)
적용 스크립트가 다시 검사한다(삭제만 · 괄호 균형 · DB 원문이 before 와 같을 때만).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "voice"))
sys.stdout.reconfigure(encoding="utf-8")
import engine  # noqa: E402

# (책 코드, 책 이름, 장, 절, 본문 쪽에서 남길 끝) — 끝 표시 뒤(주석 앞까지)는 각주 조각
CUTS = [
    ("deu", "신명기", 19, 6, "거리가 너무 멀어서는 안 됩니다."),
    ("deu", "신명기", 32, 15, "구원자를 업신여겼다."),
    ("jos", "여호수아", 2, 10, "우리가 들었기 때문입니다."),
    ("1sa", "사무엘상", 1, 16, "이처럼 기도를 드리고 있습니다.\""),
    ("1sa", "사무엘상", 2, 12, "그들은 주님을 무시하였다."),
    ("1sa", "사무엘상", 13, 21, "삼분의 일 세겔이 들었다."),
    ("2sa", "사무엘하", 17, 25, "스루야의 여동생이다."),
]

apply = []
for code, name, ch, v, keep_end in CUTS:
    rows = engine._sb({"version": "eq.rnksv", "book_code": f"eq.{code}",
                       "chapter": f"eq.{ch}", "verse": f"eq.{v}", "select": "text"})
    if len(rows) != 1:
        sys.exit(f"{name} {ch}:{v} — DB 줄 수 {len(rows)} (1 이어야 함)")
    before = rows[0]["text"]
    m = engine.NOTE_RE.search(before)
    body, note = (before[: m.start()], before[m.start():]) if m else (before, "")
    i = body.find(keep_end)
    if i < 0 or body.count(keep_end) != 1:
        sys.exit(f"{name} {ch}:{v} — 본문 쪽에서 끝 표시를 한 번만 찾지 못함: {keep_end!r}")
    new_body = body[: i + len(keep_end)]
    after = new_body + note
    apply.append({
        "ref": f"{name} {ch}:{v}", "book": code, "chapter": ch, "verse": v,
        "before": before, "after": after, "removed": body[len(new_body):],
        "verdict": "각주 잔재", "why": "본문 끝에 각주 조각(짝 없는 괄호·번역 설명)이 남음 — 뒤의 (주: …) 는 유지",
    })
    print(f"{name} {ch}:{v} — 지움: {body[len(new_body):]!r} · 주석 유지: {note[:30]!r}")

out = ROOT / "scripts" / "data" / "rnksv-footnote-fix-2.json"
out.write_text(json.dumps({
    "source": "2026-09-11 음원 보류(주석 잔재) 가운데 본문 최신화로 풀리지 않은 8절 — 지휘부 승인, 사사기 6:24 는 지휘부가 직접 수정",
    "apply": apply, "skip": [],
}, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"계획 {len(apply)}건 → {out.relative_to(ROOT)}")
