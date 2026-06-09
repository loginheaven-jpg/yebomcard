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
  /** "header" = chapter view 헤더 / "footer" = FullscreenReader 풋터 (스타일 차이) */
  variant?: "header" | "footer";
}

export default function TTSButton({
  isPlaying,
  isLoading,
  disabled,
  onClick,
  variant = "header",
}: Props) {
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
