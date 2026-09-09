# prosody.py — 개역 성경 본문의 "끊어 읽기" 보정.
#
# 배경: 개역 본문에는 구두점이 하나도 없다(1장 632자 중 0개).
#       TTS 모델이 어디서 끊을지 단서가 없어 억양·쉼이 임의로 나온다.
#       또 절 경계가 문장 경계와 일치하지 않는다(…것이요 / …거니와 는 다음 절로 이어짐).
#
# 여기서 하는 일
#   1) 연결어미 뒤에 쉼표를 넣어 구(句) 경계를 알려준다
#   2) 절 끝이 종결형이면 마침표, 연결형이면 쉼표로 닫아 하강 억양을 억제한다
#   3) 절 끝 성격에 따라 절 사이 무음 길이를 다르게 준다
#
# 중요: 이 변형은 **생성 입력에만** 쓴다. 예봄성경 공유 캐시 키는
#       원문(주석 제거 후) 기준 sha1 이므로 원문을 바꾸면 안 된다.

import re

# 절 끝 어미로 문장 종결 여부 판정 (개역체 기준)
#   종결: …바라 / …이시니라 / …함이라 / …것이니라 / …아니하니라  → 라, 다 로 끝남
#   연결: …거니와(와) / …것이요(요) / …하고(고) / …하며(며) / …하니(니) / …하면(면)
TERMINAL_TAIL = ("라", "다", "까", "냐", "자")
CONNECTIVE_TAIL = ("요", "와", "고", "며", "나", "니", "면", "만", "서")

# 구(句) 경계로 쓸 연결어미 — 뒤에 공백+더 있을 때만 쉼표를 넣는다.
# 과하게 넣으면 오히려 뚝뚝 끊기므로 보수적으로 고른다.
# "보고 들은", "듣고 본" 처럼 복합어를 끊지 않도록 보고/듣고 는 제외한다.
PHRASE_ENDINGS = ("이요", "바요", "하고", "하며", "이며",
                  "거니와", "지만", "하면", "이니", "하니", "으니", "하나")


# 절 양끝에 남은 편집용 대시 — 새번역 삽입구('— … —')의 닫는 기호가 절 끝에 남는 경우가 있다.
# TTS 입력에 그대로 들어가면 이상하게 읽히고 종결 판정도 틀어진다.
DASH_EDGE = re.compile(r"^\s*[-\u2013\u2014]+\s*|\s*[-\u2013\u2014]+\s*$")


def _unbalanced_close(t: str) -> int:
    """짝이 맞지 않는 닫는 괄호 개수"""
    depth = stray = 0
    for c in t:
        if c == "(":
            depth += 1
        elif c == ")":
            if depth:
                depth -= 1
            else:
                stray += 1
    return stray


# 끝의 고아 괄호를 지웠을 때 문장이 온전히 끝나는가.
# 작은따옴표(')로 끝나는 것은 "또는 '…'" 같은 주석 문구일 때가 많아 제외한다.
_SENT_END = re.compile(r'[.!?]["”]?$')


def strip_orphan_paren(text: str) -> str:
    """맨 끝의 짝 없는 ')' 하나만 지운다. 지워서 문장이 완결될 때만.

    새번역 31,075절 중 345절에 짝 없는 ')' 가 남아 있다(주석의 여는 괄호가 유실된 흔적).
    그중 211절은 그 괄호 하나만 군더더기이고 본문은 온전하다:

        …너희 이웃의 소유는 어떤 것도 탐내지 못한다.")   →   …못한다."

    이런 절까지 생성을 막으면 멀쩡한 본문에 구멍이 생긴다. 반대로 주석 문구가
    남아 있는 134절은 손대지 않는다 — 어디까지가 본문인지 기계가 알 수 없다.

        …말을 한다.' 또는 '주님께서 산에서 친히 보이신다')   ← 그대로 둔다
    """
    t = (text or "").rstrip()
    if not t.endswith(")"):
        return text
    cut = t[:-1].rstrip()
    if _unbalanced_close(cut) == 0 and _SENT_END.search(cut):
        return cut
    return text


def clean_for_tts(text: str) -> str:
    """생성 입력용 정리 — 공백 정규화 + 양끝 대시 제거 + 끝의 고아 괄호 제거.
    (원문은 바꾸지 않는다 — 공유 캐시 키는 원문 sha1 이다)"""
    t = re.sub(r"\s+", " ", (text or "").strip())
    t = DASH_EDGE.sub("", t)
    t = strip_orphan_paren(t)
    return t.strip()


def is_terminal(verse_text: str) -> bool:
    """문장이 끝났는가. 구두점이 있는 본문(새번역)은 부호로, 없는 본문(개역)은 어미로 판정."""
    t = clean_for_tts(verse_text)
    if not t:
        return True
    if t[-1] in ".!?":
        return True
    if t[-1] in ",;:":
        return False
    t = re.sub(r"[\"')\]\u201d\u2019]+$", "", t)  # 닫는 따옴표/괄호 제거 후 어미 판정
    if not t:
        return True
    if t.endswith(CONNECTIVE_TAIL) and not t.endswith(TERMINAL_TAIL):
        return False
    return t.endswith(TERMINAL_TAIL)


def add_punct(verse_text: str) -> str:
    """연결어미 뒤에 쉼표를 넣고, 절 끝을 종결/연결에 맞게 닫는다.

    이미 구두점이 있는 본문(새번역 등)은 **손대지 않는다** — 모델에 줄 끊어읽기
    단서가 이미 충분하고, 덧붙이면 '…합니다.,' 같은 이중 부호가 된다.
    """
    t = clean_for_tts(verse_text)
    if not t:
        return t
    if re.search(r"[.,!?;:]", t):
        return t

    words = t.split(" ")
    out = []
    for i, w in enumerate(words):
        out.append(w)
        if i == len(words) - 1:
            continue  # 절 끝은 아래에서 따로 처리
        if w.endswith(PHRASE_ENDINGS):
            out[-1] = w + ","
    t = " ".join(out)

    t = t.rstrip(",")  # 끝에 붙은 쉼표 정리
    t += "." if is_terminal(verse_text) else ","
    return t


def gap_after(verse_text: str, terminal_gap=0.55, connective_gap=0.15) -> float:
    """절 뒤에 둘 무음 길이 — 문장이 끝났으면 길게, 이어지면 짧게."""
    return terminal_gap if is_terminal(verse_text) else connective_gap


if __name__ == "__main__":
    import json
    import sys
    from pathlib import Path
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = Path(__file__).parent / "text" / "1jn_nkrv.json"
    ch1 = json.loads(p.read_text(encoding="utf-8"))["1"]
    for i, t in enumerate(ch1, 1):
        print(f"{i:2d}절 [{'종결' if is_terminal(t) else '연결'} / 쉼 {gap_after(t)}s]")
        print(f"   {add_punct(t)}")
