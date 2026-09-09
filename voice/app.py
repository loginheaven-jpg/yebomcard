# app.py — 커스텀 보이스 성경 낭독 스튜디오 (Gradio)
#
#   python app.py    →  http://127.0.0.1:7860
#
# 화면
#   1. 보이스   업로드 → 자동 전사(타임스탬프) → 구간 선택 → 참조텍스트(원문/ASR) → 저장
#   2. 생성     보이스 + 입력(성경범위 다중선택 / 직접입력 / 파일) → 작업 큐 → 진행률
#   3. 검수     절별 결과 · 보류 목록 · 재생성 · 합본
#
# 실제 합성/검수는 engine.py, 큐·재시도·재개는 jobs.py 가 담당한다.
# 이 파일은 그 위에 얹은 얇은 UI 층이다(전량 생성은 UI 없이 CLI 로도 가능).

import sys
from pathlib import Path

import gradio as gr
import numpy as np
import soundfile as sf

import engine
import jobs
import server

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).parent
TMP = BASE / "_ui"
TMP.mkdir(exist_ok=True)

VER_LABELS = list(engine.VERSIONS.keys())


# ═══════════════════ 공통 ═══════════════════
def _voices():
    return engine.list_voices()


def refresh_voices():
    v = _voices()
    return gr.update(choices=v, value=(v[0] if v else None))


# ═══════════════════ 1. 보이스 ═══════════════════
def ui_transcribe(audio):
    if not audio:
        return None, "음원을 먼저 올리세요"
    try:
        segs = engine.transcribe(audio, with_ts=True)
    except Exception as e:
        return None, f"전사 실패: {e}"
    rows = [[s["start"], s["end"], s["text"]] for s in segs]
    msg = (f"{len(segs)}개 구간. 표에서 시작/끝 시각을 보고 아래 구간을 정하세요.\n"
           "권장: 10~30초, 문장(절) 경계에 맞출 것. 앞부분에 인트로가 있으면 반드시 건너뛰세요.")
    return rows, msg


def ui_preview(audio, start, end):
    if not audio:
        return None, "음원을 먼저 올리세요"
    if end is None or start is None or end <= start:
        return None, "끝 시각이 시작 시각보다 커야 합니다"
    out = TMP / "ref_preview.wav"
    try:
        engine.cut_audio(audio, out, float(start), float(end))
    except Exception as e:
        return None, f"자르기 실패: {e}"
    d = sf.info(str(out)).duration
    warn = "" if 8 <= d <= 32 else "  ⚠ 10~30초를 권장합니다"
    return str(out), f"{d:.2f}초 구간{warn}"


def ui_asr_to_ref(rows, start, end):
    """선택 구간에 걸친 ASR 텍스트를 참조 텍스트로."""
    if not rows:
        return "", "먼저 자동 전사를 실행하세요"
    s, e = float(start or 0), float(end or 0)
    picked = [r[2] for r in rows if float(r[0]) >= s - 0.3 and float(r[1]) <= e + 0.3]
    if not picked:
        return "", "선택 구간에 걸친 전사가 없습니다"
    return " ".join(picked), "ASR 전사를 넣었습니다 — 오인식이 있으면 반드시 고치세요"


def ui_src_to_ref(ver_label, book_label, ch, v_from, v_to):
    """성경 원문을 참조 텍스트로 (ASR 오인식 방지 — 권장)."""
    try:
        ver = engine.VERSIONS[ver_label]
        books = engine.get_books(ver)
        code = {n: c for n, c, _ in books}.get(book_label)
        if not code:
            return "", "책을 선택하세요"
        vs = engine.get_verses(ver, code, int(ch))
        vf, vt = int(v_from or 0), int(v_to or 0)
        if vf:
            vs = [x for x in vs if x[0] >= vf]
        if vt:
            vs = [x for x in vs if x[0] <= vt]
        if not vs:
            return "", "해당 범위 본문이 없습니다"
        txt = " ".join(t for _, t in vs)
        return txt, f"{book_label} {ch}장 {vs[0][0]}~{vs[-1][0]}절 ({len(txt)}자)"
    except Exception as e:
        return "", f"조회 실패: {e}"


def ui_register(name, audio, ref_text, start, end):
    try:
        meta = engine.register_voice(name, audio, ref_text, float(start), float(end))
    except Exception as e:
        return f"실패: {e}", gr.update()
    return (f"'{meta['name']}' 등록 완료 — 참조 {meta['duration']}초 / 텍스트 {len(meta['ref_text'])}자",
            refresh_voices())


def ui_voice_info(name):
    if not name:
        return None, ""
    m = engine.voice_meta(name)
    return engine.voice_ref(name), f"{m.get('duration')}초 · 참조텍스트: {m.get('ref_text','')[:120]}"


def ui_delete_voice(name):
    if not name:
        return "선택된 보이스가 없습니다", gr.update()
    engine.delete_voice(name)
    return f"'{name}' 삭제됨", refresh_voices()


def ui_books(ver_label):
    ver = engine.VERSIONS[ver_label]
    try:
        books = engine.get_books(ver)
    except Exception as e:
        return gr.update(choices=[]), gr.update(choices=[]), f"책 목록 실패: {e}"
    names = [n for n, _, _ in books]
    return (gr.update(choices=names, value=(names[0] if names else None)),
            gr.update(choices=names, value=[]), "")


# ═══════════════════ 2. 생성 ═══════════════════
def _pick_books(ver_label, which):
    ver = engine.VERSIONS[ver_label]
    books = engine.get_books(ver)
    if which == "신약":
        return [n for n, _, t in books if t == "new"]
    if which == "구약":
        return [n for n, _, t in books if t == "old"]
    if which == "전체":
        return [n for n, _, _ in books]
    return []


def ui_select_group(ver_label, which):
    return gr.update(value=_pick_books(ver_label, which))


def build_items(voice, mode, ver_label, book_names, ch_from, ch_to, custom_text, file_obj):
    """작업 항목 [{key, ref, text, out}] 생성"""
    items = []
    if mode == "성경 범위":
        ver = engine.VERSIONS[ver_label]
        books = engine.get_books(ver)
        name2code = {n: c for n, c, _ in books}
        if not book_names:
            raise ValueError("책을 하나 이상 선택하세요")
        single = len(book_names) == 1
        for bn in book_names:
            code = name2code[bn]
            rows = engine.get_book_verses(ver, code)
            if single and ch_from and ch_to:
                rows = [r for r in rows if int(ch_from) <= r[0] <= int(ch_to)]
            for ch, v, t in rows:
                if not t:
                    continue
                stem = f"{ver}_{code}_{ch:03d}"
                out = engine.OUT / voice / stem / f"{stem}_{v:03d}.wav"
                items.append({"key": f"{stem}_{v:03d}", "ref": f"{bn} {ch}:{v}",
                              "text": t, "out": str(out)})
    else:
        if mode == "텍스트 파일":
            if not file_obj:
                raise ValueError("파일을 올리세요")
            custom_text = Path(file_obj).read_text(encoding="utf-8", errors="replace")
        if not (custom_text or "").strip():
            raise ValueError("텍스트가 비어 있습니다")
        lines = [l.strip() for l in custom_text.splitlines() if l.strip()]
        stem = "custom"
        for i, t in enumerate(lines, 1):
            out = engine.OUT / voice / stem / f"{stem}_{i:04d}.wav"
            items.append({"key": f"{stem}_{i:04d}", "ref": f"{i}행", "text": t, "out": str(out)})
    return items


def ui_estimate(voice, mode, ver_label, book_names, ch_from, ch_to, custom_text, file_obj):
    if not voice:
        return "보이스를 먼저 선택하세요"
    try:
        items = build_items(voice, mode, ver_label, book_names, ch_from, ch_to, custom_text, file_obj)
    except Exception as e:
        return f"실패: {e}"
    chars = sum(len(i["text"]) for i in items)
    audio, gen = engine.estimate(chars)
    done = sum(1 for i in items if Path(i["out"]).exists())
    return (f"{len(items):,}개 항목 · {chars:,}자\n"
            f"예상 오디오 {audio/3600:.1f}시간 · 예상 생성 {gen/3600:.1f}시간 ({gen/86400:.2f}일)\n"
            f"이미 생성됨 {done:,}개 → 남은 것만 처리합니다")


def ui_add_job(voice, mode, ver_label, book_names, ch_from, ch_to, custom_text, file_obj,
               batch, temp, punct, retry, auto_upload):
    if not voice:
        return "보이스를 먼저 선택하세요", gr.update()
    try:
        items = build_items(voice, mode, ver_label, book_names, ch_from, ch_to, custom_text, file_obj)
    except Exception as e:
        return f"실패: {e}", gr.update()
    title = (f"{ver_label} {'·'.join(book_names[:3])}{'…' if len(book_names) > 3 else ''}"
             if mode == "성경 범위" else f"{mode} {len(items)}행")

    # 성경 본문일 때만 예봄성경에 올린다 — 직접 입력·텍스트 파일은 본문이 아니라
    # 공유 캐시 키(본문 sha1)에 얹을 근거가 없다.
    upload_key = None
    note = ""
    if auto_upload and mode == "성경 범위":
        upload_key = engine.voice_upload_key(voice)
        if not upload_key:
            note = f"  (주의: 보이스 '{voice}' 에 예봄성경 성우 슬롯이 없어 업로드하지 않습니다)"
        elif not server.enabled():
            note = "  (주의: 서버 연동 정보가 없어 업로드가 보류됩니다)"
        else:
            note = f"  → 합격 절은 예봄성경 '{upload_key}' 로 자동 업로드됩니다"

    jid = jobs.new_job(voice, title, items, temp=float(temp), punct=bool(punct),
                       batch=int(batch), retry_max=int(retry), upload_key=upload_key)
    return f"작업 등록: {jid} ({len(items):,}개 항목){note}", ui_job_rows()


def ui_job_rows():
    rows = []
    for j in jobs.list_jobs()[:30]:
        ok, held, pend = jobs.counts(j)
        tot = len(j["items"])
        up_done, up_left = jobs.upload_counts(j)
        up = "—" if not j.get("upload_key") else f"{up_done}" + (f" (+{up_left})" if up_left else "")
        rows.append([j["id"], j["voice"], j["title"], j["status"],
                     f"{ok}/{tot}", held, pend, up])
    return rows


def ui_progress():
    cur = jobs.current()
    alive = "가동중" if jobs.worker_alive() else "정지"
    note = f" · 처리중: {cur['note']}" if cur.get("note") else ""
    # 업로드가 조용히 실패하면 며칠치 작업이 서빙되지 않은 채 쌓인다 — 눈에 보이게 한다
    errs = [f"{j['title']}: {j['upload_error']}" for j in jobs.list_jobs()[:30]
            if j.get("upload_error")]
    if errs:
        note += "  [업로드 오류] " + " / ".join(errs[:2])
    return f"워커 {alive}{note}", ui_job_rows()


def ui_stop():
    jobs.stop_worker()
    return "워커 정지 요청 — 진행 중인 배치를 마치고 멈춥니다"


def ui_resume(jid):
    if not jid:
        return "작업 ID를 고르세요"
    jobs.requeue(jid)
    return f"{jid} 이어서 진행"


# ═══════════════════ 3. 검수 ═══════════════════
def ui_job_choices():
    return gr.update(choices=[j["id"] for j in jobs.list_jobs()])


def ui_review(jid, only_held):
    if not jid:
        return [], "작업을 고르세요", None
    job = jobs.load(jid)
    if not job:
        return [], "작업을 찾을 수 없습니다", None
    ok, held, pend = jobs.counts(job)
    rows = []
    for it in job["items"]:
        if only_held and it["status"] != "held":
            continue
        rows.append([it["key"], it["ref"], len(it["text"]), it.get("audio_sec"),
                     it.get("ratio"), it["status"], it.get("reason", ""), it["text"][:40]])
    summary = (f"{job['title']} · {job['voice']} · 상태 {job['status']}\n"
               f"합격 {ok} · 보류 {held} · 대기 {pend} / 전체 {len(job['items'])}")
    return rows, summary, None


def ui_play(jid, rows, evt: gr.SelectData):
    if not jid or not rows:
        return None, ""
    try:
        key = rows[evt.index[0]][0]
    except Exception:
        return None, "행을 고르세요"
    job = jobs.load(jid)
    it = next((x for x in job["items"] if x["key"] == key), None)
    if not it or not Path(it["out"]).exists():
        return None, "음원이 아직 없습니다"
    return it["out"], f"{it['ref']} · {it.get('reason') or '합격'}\n{it['text']}"


def ui_regen_held(jid):
    if not jid:
        return "작업을 고르세요"
    job = jobs.load(jid)
    keys = [i["key"] for i in job["items"] if i["status"] == "held"]
    n = jobs.regenerate(jid, keys)
    return f"보류 {n}개 재생성 큐에 올렸습니다" if n else "보류 항목이 없습니다"


def ui_merge(jid):
    if not jid:
        return None, "작업을 고르세요"
    job = jobs.load(jid)
    parts, sr = [], engine.SR_TARGET
    import prosody
    for it in job["items"]:
        p = Path(it["out"])
        if not p.exists():
            continue
        w, sr = sf.read(str(p), dtype="float32")
        parts.append(w)
        parts.append(np.zeros(int(sr * prosody.gap_after(it["text"])), dtype=np.float32))
    if not parts:
        return None, "생성된 음원이 없습니다"
    out = TMP / f"merged_{jid}.wav"
    sf.write(str(out), np.concatenate(parts), sr)
    return str(out), f"{len(parts)//2}개 항목 합본"


# ═══════════════════ UI ═══════════════════
with gr.Blocks(title="커스텀 보이스 성경 낭독 스튜디오") as demo:
    gr.Markdown("# 커스텀 보이스 성경 낭독 스튜디오\n"
                "내 목소리를 등록하고, 성경 범위를 골라 **절 단위** 음원을 만듭니다. "
                "생성된 절은 자동 검수(ASR 역대조)를 거치고, 불합격은 자동 재시도 후 **보류**로 분리됩니다.")

    # ── 1. 보이스 ──
    with gr.Tab("1. 보이스"):
        with gr.Row():
            with gr.Column(scale=3):
                a_audio = gr.Audio(label="샘플 음원 업로드", type="filepath")
                a_btn_tr = gr.Button("자동 전사 (구간 찾기)", variant="secondary")
                a_segs = gr.Dataframe(headers=["시작(초)", "끝(초)", "전사"],
                                      label="전사 구간 — 인트로를 건너뛰고 절 경계를 고르세요",
                                      interactive=False, wrap=True)
                with gr.Row():
                    a_start = gr.Number(label="시작(초)", value=0)
                    a_end = gr.Number(label="끝(초)", value=25)
                    a_btn_prev = gr.Button("구간 미리듣기")
                a_prev = gr.Audio(label="선택 구간", type="filepath")
            with gr.Column(scale=2):
                gr.Markdown("**참조 텍스트** — 구간에서 실제로 읽은 문장.\n"
                            "성경 녹음이면 **원문 넣기**가 정확합니다(ASR 오인식 방지).")
                with gr.Row():
                    a_ver = gr.Dropdown(VER_LABELS, value="개역개정", label="역본")
                    a_book = gr.Dropdown([], label="책")
                with gr.Row():
                    a_ch = gr.Number(label="장", value=1, precision=0)
                    a_vf = gr.Number(label="시작절", value=1, precision=0)
                    a_vt = gr.Number(label="끝절", value=2, precision=0)
                with gr.Row():
                    a_btn_src = gr.Button("원문 넣기", variant="secondary")
                    a_btn_asr = gr.Button("ASR 전사 넣기")
                a_ref = gr.Textbox(label="참조 텍스트", lines=4)
                a_name = gr.Textbox(label="보이스 이름", placeholder="예: 리딩지저스")
                a_btn_reg = gr.Button("보이스 등록", variant="primary")
                a_msg = gr.Textbox(label="결과", lines=3)
        gr.Markdown("### 등록된 보이스")
        with gr.Row():
            a_list = gr.Dropdown([], label="보이스", scale=2)
            a_btn_ref = gr.Button("새로고침")
            a_btn_del = gr.Button("삭제", variant="stop")
        a_vprev = gr.Audio(label="참조 음원", type="filepath")
        a_vinfo = gr.Textbox(label="정보", lines=2)

    # ── 2. 생성 ──
    with gr.Tab("2. 생성"):
        with gr.Row():
            b_voice = gr.Dropdown([], label="보이스", scale=2)
            b_btn_ref = gr.Button("보이스 새로고침")
        b_mode = gr.Radio(["성경 범위", "직접 입력", "텍스트 파일"], value="성경 범위", label="입력")
        with gr.Group():
            with gr.Row():
                b_ver = gr.Dropdown(VER_LABELS, value="새번역", label="역본")
                b_g1 = gr.Button("신약 전체")
                b_g2 = gr.Button("구약 전체")
                b_g3 = gr.Button("전체")
                b_g0 = gr.Button("선택 해제")
            b_books = gr.CheckboxGroup([], label="책 (다중 선택)")
            with gr.Row():
                b_cf = gr.Number(label="시작 장 (책 1권일 때만)", value=None, precision=0)
                b_ct = gr.Number(label="끝 장", value=None, precision=0)
        b_text = gr.Textbox(label="직접 입력 (한 줄 = 한 항목)", lines=5)
        b_file = gr.File(label="텍스트 파일(.txt)", type="filepath")
        with gr.Row():
            b_batch = gr.Slider(1, 8, value=4, step=1, label="배치 (VRAM 부족하면 낮추세요)")
            b_temp = gr.Slider(0.5, 1.0, value=0.75, step=0.05, label="temperature")
            b_retry = gr.Slider(1, 5, value=3, step=1, label="재시도 상한")
            b_punct = gr.Checkbox(value=True, label="구두점 주입(개역 등 구두점 없는 본문에 유효)")
        b_upload = gr.Checkbox(
            value=True,
            label="완성된 절을 예봄성경에 자동 업로드 (성경 범위일 때만)")
        with gr.Row():
            b_btn_est = gr.Button("예상 계산")
            b_btn_add = gr.Button("작업 추가 (생성 시작)", variant="primary")
        b_msg = gr.Textbox(label="상태", lines=4)
        gr.Markdown("### 작업 현황")
        with gr.Row():
            b_status = gr.Textbox(label="워커", scale=3)
            b_btn_stop = gr.Button("워커 정지", variant="stop")
        b_jobs = gr.Dataframe(headers=["작업ID", "보이스", "제목", "상태", "합격/전체", "보류", "대기", "업로드"],
                              label="작업", interactive=False, wrap=True)
        with gr.Row():
            b_jid = gr.Dropdown([], label="이어할 작업 ID", scale=2)
            b_btn_resume = gr.Button("이어하기")
        b_timer = gr.Timer(3.0)

    # ── 3. 검수 ──
    with gr.Tab("3. 검수"):
        with gr.Row():
            c_jid = gr.Dropdown([], label="작업", scale=3)
            c_btn_ref = gr.Button("새로고침")
            c_held = gr.Checkbox(value=True, label="보류만 보기")
        c_sum = gr.Textbox(label="요약", lines=2)
        c_rows = gr.Dataframe(
            headers=["key", "위치", "글자", "길이(초)", "일치율", "상태", "사유", "본문"],
            label="절별 결과 — 행을 클릭하면 재생됩니다", interactive=False, wrap=True)
        with gr.Row():
            c_audio = gr.Audio(label="선택 절", type="filepath")
            c_info = gr.Textbox(label="내용", lines=4)
        with gr.Row():
            c_btn_regen = gr.Button("보류 전체 재생성", variant="primary")
            c_btn_merge = gr.Button("합본 만들기")
        c_msg = gr.Textbox(label="결과", lines=2)
        c_merged = gr.Audio(label="합본", type="filepath")

    # ── 이벤트 ──
    a_btn_tr.click(ui_transcribe, [a_audio], [a_segs, a_msg])
    a_btn_prev.click(ui_preview, [a_audio, a_start, a_end], [a_prev, a_msg])
    a_btn_asr.click(ui_asr_to_ref, [a_segs, a_start, a_end], [a_ref, a_msg])
    a_btn_src.click(ui_src_to_ref, [a_ver, a_book, a_ch, a_vf, a_vt], [a_ref, a_msg])
    a_btn_reg.click(ui_register, [a_name, a_audio, a_ref, a_start, a_end], [a_msg, a_list])
    a_btn_ref.click(refresh_voices, None, a_list)
    a_btn_del.click(ui_delete_voice, [a_list], [a_msg, a_list])
    a_list.change(ui_voice_info, [a_list], [a_vprev, a_vinfo])
    a_ver.change(ui_books, [a_ver], [a_book, b_books, a_msg])

    b_btn_ref.click(refresh_voices, None, b_voice)
    b_ver.change(ui_books, [b_ver], [a_book, b_books, b_msg])
    b_g1.click(lambda v: ui_select_group(v, "신약"), [b_ver], b_books)
    b_g2.click(lambda v: ui_select_group(v, "구약"), [b_ver], b_books)
    b_g3.click(lambda v: ui_select_group(v, "전체"), [b_ver], b_books)
    b_g0.click(lambda: gr.update(value=[]), None, b_books)
    b_btn_est.click(ui_estimate,
                    [b_voice, b_mode, b_ver, b_books, b_cf, b_ct, b_text, b_file], b_msg)
    b_btn_add.click(ui_add_job,
                    [b_voice, b_mode, b_ver, b_books, b_cf, b_ct, b_text, b_file,
                     b_batch, b_temp, b_punct, b_retry, b_upload], [b_msg, b_jobs])
    b_btn_stop.click(ui_stop, None, b_msg)
    b_btn_resume.click(ui_resume, [b_jid], b_msg)
    b_timer.tick(ui_progress, None, [b_status, b_jobs])

    c_btn_ref.click(ui_job_choices, None, c_jid)
    c_btn_ref.click(ui_job_choices, None, b_jid)
    c_jid.change(ui_review, [c_jid, c_held], [c_rows, c_sum, c_audio])
    c_held.change(ui_review, [c_jid, c_held], [c_rows, c_sum, c_audio])
    c_rows.select(ui_play, [c_jid, c_rows], [c_audio, c_info])
    c_btn_regen.click(ui_regen_held, [c_jid], c_msg)
    c_btn_merge.click(ui_merge, [c_jid], [c_merged, c_msg])

    def _boot():
        v = _voices()
        return (gr.update(choices=v, value=(v[0] if v else None)),
                gr.update(choices=v, value=(v[0] if v else None)),
                ui_job_choices(), ui_job_choices(), ui_job_rows())

    demo.load(_boot, None, [a_list, b_voice, c_jid, b_jid, b_jobs])
    demo.load(ui_books, [a_ver], [a_book, b_books, a_msg])


if __name__ == "__main__":
    jobs.start_worker()
    demo.launch(server_name="127.0.0.1", server_port=7860, inbrowser=True)
