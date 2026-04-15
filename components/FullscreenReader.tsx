"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";

export interface FullscreenVerseItem {
  ref: string;
  main: string;
  sub?: string;
}

interface Props {
  verses: FullscreenVerseItem[];
  mainVersionLabel: string;
  subVersionLabel?: string;
  parallel: boolean;
  onParallelToggle: () => void;
  onClose: () => void;
}

export default function FullscreenReader({
  verses,
  mainVersionLabel,
  subVersionLabel,
  parallel,
  onParallelToggle,
  onClose,
}: Props) {
  const [idx, setIdx] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("fullscreenTheme") as "light" | "dark") || "light";
  });
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window === "undefined") return 74;
    return parseInt(localStorage.getItem("fullscreenFontSize") || "74");
  });

  useEffect(() => {
    localStorage.setItem("fullscreenTheme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("fullscreenFontSize", String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    if (idx >= verses.length) setIdx(Math.max(0, verses.length - 1));
  }, [verses.length, idx]);

  // 카드 박스를 넘치면 효과 폰트를 자동 축소 (사용자 설정은 유지)
  const MIN_FIT_SIZE = 24;
  const cardRef = useRef<HTMLElement | null>(null);
  const [effectiveFontSize, setEffectiveFontSize] = useState(fontSize);

  useLayoutEffect(() => {
    setEffectiveFontSize(fontSize);
  }, [fontSize, idx, parallel, verses]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    // 2px 여유 — 서브픽셀 반올림/폰트 라이닝 오차 흡수
    const overflow = el.scrollHeight - el.clientHeight > 2;
    if (overflow && effectiveFontSize > MIN_FIT_SIZE) {
      setEffectiveFontSize((s) => Math.max(MIN_FIT_SIZE, s - 2));
    }
  }, [effectiveFontSize, idx, parallel, verses]);

  // 뷰포트 리사이즈 시 재측정
  useEffect(() => {
    const onResize = () => setEffectiveFontSize(fontSize);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fontSize]);

  const go = useCallback(
    (delta: number) => {
      setIdx((i) => Math.max(0, Math.min(verses.length - 1, i + delta)));
    },
    [verses.length]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  const current = verses[idx];
  if (!current) return null;

  const isDark = theme === "dark";
  const vars = isDark
    ? {
        bg: "#1A1A1A",
        card: "#242424",
        text: "#E6DDCE",
        muted: "#9A948A",
        divider: "rgba(230,221,206,0.14)",
        subText: "#C7BFAE",
        ctrlBg: "rgba(230,221,206,0.06)",
        ctrlHover: "rgba(230,221,206,0.12)",
        ctrlBorder: "rgba(230,221,206,0.18)",
        credit: "#6E6A60",
        shadow: "0 2px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(230,221,206,0.05)",
      }
    : {
        bg: "#DDD3C1",
        card: "#D5CAB6",
        text: "#1C1C1C",
        muted: "#575247",
        divider: "rgba(28,28,28,0.12)",
        subText: "#3F3A2E",
        ctrlBg: "rgba(28,28,28,0.04)",
        ctrlHover: "rgba(28,28,28,0.09)",
        ctrlBorder: "rgba(28,28,28,0.18)",
        credit: "#8A8578",
        shadow: "0 2px 24px rgba(50,40,20,0.08), 0 0 0 1px rgba(28,28,28,0.05)",
      };

  return (
    <div
      role="dialog"
      aria-label="성경 풀스크린 보기"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: vars.bg,
        color: vars.text,
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        padding: "clamp(16px, 2vw, 28px) clamp(20px, 3vw, 48px)",
        fontFamily:
          '"Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {/* 상단 바 */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: vars.muted,
            fontSize: 11,
            letterSpacing: "0.25em",
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: vars.text,
              opacity: 0.85,
              color: vars.bg,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            예
          </span>
          <span>YEBOM BIBLE</span>
          <span style={{ opacity: 0.5, marginLeft: 10 }}>· {mainVersionLabel}</span>
        </div>
        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          {subVersionLabel && (
            <TbBtn
              vars={vars}
              pressed={parallel}
              onClick={onParallelToggle}
              title="병기 — 다른 번역을 부가 표시"
            >
              ⇅ 병기
            </TbBtn>
          )}
          <TbBtn
            vars={vars}
            onClick={() => setTheme(isDark ? "light" : "dark")}
            title="다크/라이트 전환"
          >
            {isDark ? "☀" : "☾"} {isDark ? "Light" : "Dark"}
          </TbBtn>
          <button
            onClick={onClose}
            aria-label="닫기 (Esc)"
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: `1px solid ${vars.ctrlBorder}`,
              background: "transparent",
              color: vars.text,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = vars.ctrlHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            ✕
          </button>
        </div>
      </header>

      {/* 본문 카드 */}
      <main
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 0,
        }}
      >
        <NavBtn vars={vars} side="prev" disabled={idx === 0} onClick={() => go(-1)} />
        <NavBtn
          vars={vars}
          side="next"
          disabled={idx === verses.length - 1}
          onClick={() => go(1)}
        />

        <section
          ref={cardRef}
          style={{
            background: vars.card,
            borderRadius: "clamp(14px, 1.4vw, 22px)",
            boxShadow: vars.shadow,
            width: "min(1480px, 96%)",
            height: "100%",
            maxHeight: "100%",
            margin: "0 auto",
            padding: "clamp(36px, 5vw, 88px) clamp(32px, 6vw, 120px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontSize: "clamp(22px, 2.2vw, 36px)",
              color: vars.muted,
              marginBottom: "clamp(28px, 3.4vw, 56px)",
              fontWeight: 500,
              letterSpacing: "0.01em",
            }}
          >
            {current.ref}
          </div>
          <div
            style={{
              fontSize: `${effectiveFontSize}px`,
              fontWeight: 700,
              lineHeight: 1.42,
              wordBreak: "keep-all",
              overflowWrap: "anywhere",
              maxWidth: "min(1280px, 94%)",
              color: vars.text,
              letterSpacing: "-0.015em",
            }}
          >
            {current.main}
          </div>
          {parallel && current.sub && (
            <div
              style={{
                marginTop: "clamp(28px, 3vw, 48px)",
                fontSize: `${Math.round(effectiveFontSize * 0.46)}px`,
                fontWeight: 400,
                lineHeight: 1.55,
                color: vars.subText,
                wordBreak: "keep-all",
                maxWidth: "min(1100px, 88%)",
                paddingTop: "clamp(16px, 1.8vw, 24px)",
                borderTop: `1px solid ${vars.divider}`,
              }}
            >
              {subVersionLabel && (
                <span
                  style={{
                    display: "block",
                    fontSize: 11,
                    letterSpacing: "0.2em",
                    color: vars.muted,
                    marginBottom: 10,
                    fontWeight: 500,
                  }}
                >
                  {subVersionLabel}
                </span>
              )}
              {current.sub}
            </div>
          )}
        </section>
      </main>

      {/* 하단 바 */}
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          color: vars.muted,
          fontSize: 11,
        }}
      >
        <div
          style={{
            fontWeight: 500,
            letterSpacing: "0.03em",
            color: vars.credit,
            fontSize: 10,
          }}
        >
          예봄성경 · <b style={{ color: vars.muted, fontWeight: 500 }}>reading bible together</b>
        </div>
        <div
          style={{
            fontFamily: '"Playfair Display", serif',
            fontStyle: "italic",
            fontSize: 14,
            color: vars.muted,
            letterSpacing: "0.05em",
          }}
        >
          <b style={{ color: vars.text, fontStyle: "normal", fontWeight: 500 }}>{idx + 1}</b> /{" "}
          {verses.length}
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            background: vars.ctrlBg,
            padding: "6px 14px",
            borderRadius: 999,
            border: `1px solid ${vars.ctrlBorder}`,
          }}
        >
          <span style={{ fontSize: 10, opacity: 0.7 }}>가</span>
          <input
            type="range"
            min={40}
            max={120}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            style={{
              WebkitAppearance: "none",
              appearance: "none",
              width: 120,
              height: 2,
              background: vars.ctrlBorder,
              borderRadius: 999,
              outline: "none",
            }}
          />
          <span style={{ fontSize: 15, opacity: 0.9 }}>가</span>
        </div>
      </footer>
    </div>
  );
}

function TbBtn({
  children,
  onClick,
  pressed,
  title,
  vars,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  title?: string;
  vars: { text: string; bg: string; ctrlBorder: string; ctrlHover: string };
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={pressed}
      style={{
        background: pressed ? vars.text : "transparent",
        border: `1px solid ${pressed ? vars.text : vars.ctrlBorder}`,
        color: pressed ? vars.bg : vars.text,
        padding: "6px 12px",
        borderRadius: 999,
        fontSize: 12,
        cursor: "pointer",
        fontFamily: "inherit",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        transition: "background .15s, border-color .15s",
      }}
      onMouseEnter={(e) => {
        if (!pressed) e.currentTarget.style.background = vars.ctrlHover;
      }}
      onMouseLeave={(e) => {
        if (!pressed) e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function NavBtn({
  side,
  disabled,
  onClick,
  vars,
}: {
  side: "prev" | "next";
  disabled?: boolean;
  onClick: () => void;
  vars: { text: string; ctrlBg: string; ctrlHover: string; ctrlBorder: string };
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "prev" ? "이전 구절" : "다음 구절"}
      style={{
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        [side === "prev" ? "left" : "right"]: "clamp(6px, 1vw, 16px)",
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: vars.ctrlBg,
        border: `1px solid ${vars.ctrlBorder}`,
        color: vars.text,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 18,
        opacity: disabled ? 0.25 : 1,
        zIndex: 2,
      } as React.CSSProperties}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = vars.ctrlHover;
      }}
      onMouseLeave={(e) => (e.currentTarget.style.background = vars.ctrlBg)}
    >
      {side === "prev" ? "‹" : "›"}
    </button>
  );
}
