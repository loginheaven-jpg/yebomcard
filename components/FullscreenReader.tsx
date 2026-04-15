"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";

export interface FullscreenVerseItem {
  ref: string;
  main: string;
  sub?: string;
}

type BibleVersion = "nkrv" | "rnksv";

interface Props {
  verses: FullscreenVerseItem[];
  version: BibleVersion;
  onVersionChange: (v: BibleVersion) => void;
  parallel: boolean;
  onParallelToggle: () => void;
  /** 마지막 절에서 우측 → 호출 시 → 다음 장 로드. 없으면 내부 루프(1절로 순환) */
  onOverscrollNext?: () => void;
  /** 첫 절에서 좌측 ← 호출 시 → 이전 장 로드. 없으면 내부 루프(마지막 절로 순환) */
  onOverscrollPrev?: () => void;
  onClose: () => void;
}

export default function FullscreenReader({
  verses,
  version,
  onVersionChange,
  parallel,
  onParallelToggle,
  onOverscrollNext,
  onOverscrollPrev,
  onClose,
}: Props) {
  const subVersionLabel = version === "nkrv" ? "새번역" : "개역개정";
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

  // 장 전환 직후 idx를 처음(next) / 끝(prev)으로 점프시키기 위한 플래그
  const [pendingDirection, setPendingDirection] = useState<1 | -1 | null>(null);
  useEffect(() => {
    if (pendingDirection === null) return;
    if (verses.length === 0) return;
    if (pendingDirection === 1) setIdx(0);
    else setIdx(verses.length - 1);
    setPendingDirection(null);
  }, [verses, pendingDirection]);

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
      const next = idx + delta;
      if (next < 0) {
        if (onOverscrollPrev) {
          setPendingDirection(-1);
          onOverscrollPrev();
        } else {
          setIdx(verses.length - 1); // 루프
        }
        return;
      }
      if (next >= verses.length) {
        if (onOverscrollNext) {
          setPendingDirection(1);
          onOverscrollNext();
        } else {
          setIdx(0); // 루프
        }
        return;
      }
      setIdx(next);
    },
    [idx, verses.length, onOverscrollNext, onOverscrollPrev]
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
        arrow: "#3D352A",  // 카드 계열 웜톤, 다크 배경에서 은은하게 보임
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
        arrow: "#BFB392",  // 카드 계열의 연한 웜 베이지 (회색 아님)
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
      <style>{`
        .yb-fs-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px; height: 14px; border-radius: 50%;
          background: ${vars.text}; cursor: pointer;
          border: none;
        }
        .yb-fs-range::-moz-range-thumb {
          width: 14px; height: 14px; border-radius: 50%;
          background: ${vars.text}; cursor: pointer; border: none;
        }
      `}</style>
      {/* 상단 바 */}
      <header
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 16,
          marginBottom: "clamp(8px, 1vw, 16px)",
        }}
      >
        <div />
        <div style={{ display: "inline-flex", gap: 6, alignItems: "center", justifyContent: "center" }}>
          <VersionPill vars={vars} active={version === "nkrv"} onClick={() => onVersionChange("nkrv")}>
            개역개정
          </VersionPill>
          <VersionPill vars={vars} active={version === "rnksv"} onClick={() => onVersionChange("rnksv")}>
            새번역
          </VersionPill>
          <VersionPill vars={vars} active={parallel} onClick={onParallelToggle}>
            병기
          </VersionPill>
        </div>
        <div style={{ display: "inline-flex", gap: 4, alignItems: "center", justifyContent: "flex-end" }}>
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            title="다크/라이트 전환"
            style={{
              background: "transparent",
              border: "none",
              color: vars.muted,
              padding: "6px 12px",
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 999,
              transition: "background .15s, color .15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = vars.ctrlHover;
              e.currentTarget.style.color = vars.text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = vars.muted;
            }}
          >
            <span style={{ fontSize: 15 }}>{isDark ? "☀" : "☾"}</span>
            {isDark ? "Light" : "Dark"}
          </button>
          <button
            onClick={onClose}
            aria-label="닫기 (Esc)"
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "none",
              background: "transparent",
              color: vars.muted,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              transition: "background .15s, color .15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = vars.ctrlHover;
              e.currentTarget.style.color = vars.text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = vars.muted;
            }}
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
        <NavBtn vars={vars} side="prev" onClick={() => go(-1)} />
        <NavBtn vars={vars} side="next" onClick={() => go(1)} />

        <section
          ref={cardRef}
          style={{
            background: vars.card,
            borderRadius: "clamp(14px, 1.4vw, 22px)",
            boxShadow: vars.shadow,
            width: "min(1400px, 88%)",
            height: "100%",
            maxHeight: "100%",
            margin: "0 auto",
            padding: "clamp(18px, 2.5vw, 44px) clamp(16px, 3vw, 60px)",
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
              marginBottom: "clamp(14px, 1.7vw, 28px)",
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
              maxWidth: "96%",
              color: vars.text,
              letterSpacing: "-0.015em",
            }}
          >
            {current.main}
          </div>
          {parallel && current.sub && (
            <div
              style={{
                marginTop: "clamp(14px, 1.5vw, 24px)",
                fontSize: `${Math.round(effectiveFontSize * 0.46)}px`,
                fontWeight: 400,
                lineHeight: 1.55,
                color: vars.subText,
                wordBreak: "keep-all",
                maxWidth: "94%",
                paddingTop: "clamp(8px, 1vw, 12px)",
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

      {/* 하단 바 — 카드 폭과 동일하게 정렬 */}
      <footer
        style={{
          marginTop: "clamp(10px, 1.2vw, 18px)",
        }}
      >
        <div
          style={{
            width: "min(1400px, 88%)",
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
            color: vars.muted,
          }}
        >
          <div
            style={{
              fontFamily: '"Playfair Display", serif',
              fontStyle: "italic",
              fontSize: 15,
              color: vars.muted,
              letterSpacing: "0.05em",
            }}
          >
            <b style={{ color: vars.text, fontStyle: "normal", fontWeight: 600 }}>{idx + 1}</b>
            <span style={{ opacity: 0.5, margin: "0 6px" }}>/</span>
            {verses.length}
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 11, opacity: 0.6, color: vars.muted }}>가</span>
            <input
              type="range"
              min={40}
              max={120}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="yb-fs-range"
              style={{
                WebkitAppearance: "none",
                appearance: "none",
                width: 160,
                height: 2,
                background: vars.ctrlBorder,
                borderRadius: 999,
                outline: "none",
                cursor: "pointer",
              }}
            />
            <span style={{ fontSize: 17, opacity: 0.85, color: vars.muted }}>가</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function NavBtn({
  side,
  onClick,
  vars,
}: {
  side: "prev" | "next";
  onClick: () => void;
  vars: { arrow: string };
}) {
  const gradId = `yb-fs-nav-${side}`;
  // 삼각형 (40×280 viewBox, 꼭짓점 안쪽)
  const path =
    side === "prev"
      ? "M 36 10 L 6 140 L 36 270 Z"
      : "M 4 10 L 34 140 L 4 270 Z";
  return (
    <button
      onClick={onClick}
      aria-label={side === "prev" ? "이전 구절" : "다음 구절"}
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        [side === "prev" ? "left" : "right"]: "clamp(2px, 0.4vw, 8px)",
        width: 64,
        height: "100%",
        border: "none",
        background: "transparent",
        padding: 0,
        color: vars.arrow,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "opacity .2s",
        zIndex: 2,
      } as React.CSSProperties}
      onMouseEnter={(e) => {
        const svg = e.currentTarget.querySelector("svg");
        if (svg) (svg as SVGSVGElement).style.opacity = "1";
      }}
      onMouseLeave={(e) => {
        const svg = e.currentTarget.querySelector("svg");
        if (svg) (svg as SVGSVGElement).style.opacity = "0.75";
      }}
    >
      <svg
        width="40"
        height="280"
        viewBox="0 0 40 280"
        aria-hidden
        style={{
          maxHeight: "86%",
          opacity: 0.75,
          transition: "opacity .2s",
          filter: "blur(0.5px)",
        }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0" />
            <stop offset="0.18" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="0.5" stopColor="currentColor" stopOpacity="1" />
            <stop offset="0.82" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={path} fill={`url(#${gradId})`} />
      </svg>
    </button>
  );
}

function VersionPill({
  children,
  onClick,
  active,
  vars,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  vars: { text: string; bg: string; ctrlHover: string; muted: string };
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: active ? vars.text : "transparent",
        border: "none",
        color: active ? vars.bg : vars.muted,
        padding: "6px 14px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "background .15s, color .15s",
        letterSpacing: "-0.005em",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = vars.ctrlHover;
          e.currentTarget.style.color = vars.text;
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = vars.muted;
        }
      }}
    >
      {children}
    </button>
  );
}
