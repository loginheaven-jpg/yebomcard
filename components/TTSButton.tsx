"use client";

/**
 * TTS 트리거 버튼 — chapter view 헤더 / FullscreenReader 풋터에 배치.
 * isPlaying 시 ⏹ + 라벨 변화, loading 시 스피너, idle 시 🔊.
 * 상위 컴포넌트가 status를 평가해서 props로 내려줌 (현재 트랙이 *이 화면의* 절인지 판정).
 */

interface Props {
  isPlaying: boolean;
  isLoading: boolean;
  disabled?: boolean;
  onClick: () => void;
  /**
   * "header" = 옛 두 줄 헤더(글자 있는 버튼) / "footer" = FullscreenReader 풋터
   * "icon"   = 본문 화면 한 줄 상단 바 — 44px 정사각, 글자 없이 아이콘만.
   *            대기는 amber 외곽선, 재생 중은 amber 채움 + 정지 도형(멈추는 유일한 버튼).
   */
  variant?: "header" | "footer" | "icon";
}

export default function TTSButton({
  isPlaying,
  isLoading,
  disabled,
  onClick,
  variant = "header",
}: Props) {
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={isPlaying ? "읽기 중지" : "본문 읽기"}
        title={isPlaying ? "읽기 중지" : "본문 읽기"}
        className={`shrink-0 w-11 h-11 flex items-center justify-center rounded-xl border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
          isPlaying
            ? "bg-[var(--amber)] border-[var(--amber)] text-white"
            : "bg-[var(--amber-tint)] border-[var(--amber)] text-[var(--amber-deep)] hover:bg-[var(--amber)] hover:text-white"
        }`}
      >
        {isLoading ? (
          <svg width="18" height="18" viewBox="0 0 16 16" className="animate-spin" aria-hidden>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="28" strokeDashoffset="8" />
          </svg>
        ) : isPlaying ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M11 5 6 9H3v6h3l5 4V5z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </svg>
        )}
      </button>
    );
  }

  if (variant === "footer") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={isPlaying ? "읽기 중지" : "본문 읽기"}
        title={isPlaying ? "읽기 중지" : "본문 읽기"}
        style={{
          background: "transparent",
          border: "none",
          color: "inherit",
          padding: "6px 12px",
          fontSize: 13,
          cursor: disabled ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          borderRadius: 999,
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <span style={{ fontSize: 15 }} aria-hidden>
          {isLoading ? "⌛" : isPlaying ? "⏹" : "🔊"}
        </span>
        {isPlaying ? "중지" : "읽기"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={isPlaying ? "읽기 중지" : "본문 읽기"}
      title={isPlaying ? "읽기 중지" : "본문 읽기"}
      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg shadow-sm dark:shadow-none transition-all border ${
        isPlaying
          ? "text-white bg-[var(--amber)] border-[var(--amber)] hover:bg-[var(--amber-deep)]"
          : "text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200"
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      <span aria-hidden>{isLoading ? "⌛" : isPlaying ? "⏹" : "🔊"}</span>
      <span>{isPlaying ? "중지" : "읽기"}</span>
    </button>
  );
}
