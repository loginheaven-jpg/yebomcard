"use client";

/**
 * 말씀의삶 진입 때 한 번 묻는 그룹 초대코드 창.
 *
 * 코드를 넣고 확인하면 그 그룹에 참여한다. 비워 두고 확인하거나 창 바깥·뒤로가기·'그룹 없이 들어가기'로
 * 닫으면 그냥 진도표로 들어간다(로그인했으면 개인 진도, 아니면 보기만).
 * 참여했거나 한 번 건너뛰면 그 기기에서는 다시 묻지 않는다 — 판단은 ReadingPlanPanel 이 한다.
 * 나중에는 그룹 탭 '초대코드로 참여'로 언제든 참여할 수 있다.
 */

import { useEffect, useState } from "react";
import { useHardwareBack } from "@/hooks/useHardwareBack";

interface Props {
  isLoggedIn: boolean;
  /** 자동 참여가 실패해 다시 연 경우 — 그 이유를 처음부터 보여 준다 */
  initialError?: string | null;
  /** 코드로 참여. 실패하면 창에 띄울 문구를, 성공(또는 로그인으로 넘김)이면 null 을 돌려준다 */
  onSubmit: (code: string) => Promise<string | null>;
  /** 건너뛰기 — 비운 채 확인, 창 바깥, 뒤로가기, '그룹 없이 들어가기' */
  onSkip: () => void;
}

/** 입력 정규화 — 대소문자 무시, 공백·하이픈 제거 (서버 normalizeCode 와 같다) */
function normalize(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export default function GroupCodePrompt({ isLoggedIn, initialError, onSubmit, onSkip }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);

  useHardwareBack(true, onSkip);

  const submit = async () => {
    if (busy) return;
    const code = normalize(value);
    if (!code) {
      onSkip();
      return;
    }
    if (code.length !== 6) {
      setError("초대코드는 6자리입니다");
      return;
    }
    setBusy(true);
    setError(null);
    const err = await onSubmit(code);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center">
      <button type="button" aria-label="그룹 없이 들어가기" onClick={onSkip} className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-code-prompt-title"
        className="relative w-full max-w-md bg-[var(--paper)] rounded-t-2xl p-5 pb-8 shadow-2xl"
      >
        <div className="w-10 h-1 rounded-full bg-[var(--line)] mx-auto mb-4" aria-hidden />
        <p id="group-code-prompt-title" className="text-sm font-bold text-[var(--ink)] mb-1">
          함께 읽는 그룹이 있나요?
        </p>
        <p className="text-[12px] text-[var(--ink-soft)] leading-relaxed mb-3">
          받은 초대코드 6자리를 넣으면 그룹에 참여해 서로의 진도를 볼 수 있습니다.
          <br />
          없으면 비워 두고 확인을 누르세요.
          {!isLoggedIn && (
            <>
              <br />
              <span className="text-[var(--amber-deep)]">
                참여하려면 로그인이 필요합니다 — 코드를 넣고 확인하면 로그인한 뒤 자동으로 참여합니다.
              </span>
            </>
          )}
        </p>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value.toUpperCase().slice(0, 8));
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          maxLength={8}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="YB7K2M"
          aria-label="초대코드"
          className="w-full px-3 py-2.5 rounded-xl border border-[var(--line)] bg-[var(--paper-2)] text-sm text-[var(--ink)] outline-none focus:border-[var(--amber)] font-mono tracking-[3px] uppercase"
        />
        {error && <p className="text-[11px] text-red-500 mt-2">{error}</p>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="w-full mt-3 py-3 rounded-xl text-sm font-bold bg-[var(--amber)] text-white disabled:opacity-50"
        >
          {busy ? "참여하는 중…" : "확인"}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="w-full mt-2 py-2 text-[12px] text-[var(--ink-faint)] underline underline-offset-2"
        >
          그룹 없이 들어가기
        </button>
        <p className="text-[11px] text-[var(--ink-faint)] text-center mt-1">나중에 그룹 탭에서도 참여할 수 있습니다</p>
      </div>
    </div>
  );
}

/** 참여 결과 한 줄 알림 — 그룹 탭의 알림과 같은 모양 */
export function PromptToast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom)+96px)] z-[320] px-3.5 py-2 rounded-full bg-black/80 text-white text-xs max-w-[80vw] text-center">
      {text}
    </div>
  );
}
