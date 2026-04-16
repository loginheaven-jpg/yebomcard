"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";

export interface FullscreenVerseItem {
  ref: string;
  main: string;
  sub?: string;
}

type BibleVersion = "nkrv" | "rnksv";

interface JumpRef {
  book_abbr: string;
  book_code: string;
  chapter: number;
  verse: number;
}

interface Props {
  verses: FullscreenVerseItem[];
  version: BibleVersion;
  onVersionChange: (v: BibleVersion) => void;
  parallel: boolean;
  onParallelToggle: () => void;
  onOverscrollNext?: () => void;
  onOverscrollPrev?: () => void;
  onClose: () => void;
  jumpMode?: boolean;
  jumpRefs?: JumpRef[];
  hideVersionButtons?: boolean;
  /** jumpMode: 풀스크린에서 구절 추가. 입력 문자열 → 부모가 파싱/fetch → verses 업데이트 */
  onAddVerses?: (input: string) => Promise<void>;
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
  jumpMode = false,
  jumpRefs,
  hideVersionButtons = false,
  onAddVerses,
}: Props) {
  const subVersionLabel = version === "nkrv" ? "새번역" : "개역개정";
  const [idx, setIdx] = useState(0);

  // ─── 레퍼런스 필 바 (jumpMode) ───
  const [pillsVisible, setPillsVisible] = useState(true);
  const pillsTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pillsScrollRef = useRef<HTMLDivElement>(null);

  const resetPillsTimer = useCallback(() => {
    setPillsVisible(true);
    if (pillsTimer.current) clearTimeout(pillsTimer.current);
    pillsTimer.current = setTimeout(() => setPillsVisible(false), 3000);
  }, []);

  useEffect(() => {
    if (!jumpMode && hideVersionButtons) return;
    resetPillsTimer();
    return () => { if (pillsTimer.current) clearTimeout(pillsTimer.current); };
  }, [jumpMode, resetPillsTimer]);

  useEffect(() => {
    if (!jumpMode && hideVersionButtons) return;
    resetPillsTimer();
    // 현재 필을 스크롤 뷰에 표시
    const container = pillsScrollRef.current;
    if (container) {
      const activePill = container.children[idx] as HTMLElement;
      if (activePill) activePill.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [idx, jumpMode, resetPillsTimer]);

  // 마우스/터치 시 필 바 복귀
  useEffect(() => {
    if (!jumpMode && hideVersionButtons) return;
    const show = () => resetPillsTimer();
    window.addEventListener("mousemove", show);
    window.addEventListener("touchstart", show);
    return () => { window.removeEventListener("mousemove", show); window.removeEventListener("touchstart", show); };
  }, [jumpMode, resetPillsTimer]);

  // 필 약칭 생성: 6개 이하면 [욥 17:7], 7개 이상이면 그룹 압축 [요4:1] [2] [3] [시10:10] [15]
  function buildPillLabels(refs: JumpRef[]): string[] {
    if (refs.length <= 6) {
      return refs.map((r) => `${r.book_abbr} ${r.chapter}:${r.verse}`);
    }
    const labels: string[] = [];
    let prevGroup = "";
    for (const r of refs) {
      const group = `${r.book_code}-${r.chapter}`;
      if (group === prevGroup) {
        labels.push(`${r.verse}`);
      } else {
        labels.push(`${r.book_abbr}${r.chapter}:${r.verse}`);
        prevGroup = group;
      }
    }
    return labels;
  }

  // 추가 입력행
  const [showAddInput, setShowAddInput] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  async function handleAddSubmit() {
    if (!addInput.trim() || !onAddVerses) return;
    setAddLoading(true);
    await onAddVerses(addInput.trim());
    setAddInput("");
    setShowAddInput(false);
    setAddLoading(false);
  }

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("fullscreenTheme") as "light" | "dark") || "light";
  });
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window === "undefined") return 74;
    return parseInt(localStorage.getItem("fullscreenFontSize") || "74");
  });

  // 폰트 5종
  const FONTS = [
    { key: "noto-serif", label: "명조", css: "var(--font-noto-serif-kr), 'Noto Serif KR', serif", weight: 600 },
    { key: "noto-sans", label: "고딕", css: "var(--font-noto-sans-kr), 'Noto Sans KR', sans-serif", weight: 700 },
    { key: "gowun-dodum", label: "돋움", css: "var(--font-gowun-dodum), 'Gowun Dodum', sans-serif", weight: 400 },
    { key: "gothic-a1", label: "Gothic", css: "var(--font-gothic-a1), 'Gothic A1', sans-serif", weight: 600 },
    { key: "ibm-plex", label: "Plex", css: "var(--font-ibm-plex), 'IBM Plex Sans KR', sans-serif", weight: 600 },
  ] as const;
  type FontKey = typeof FONTS[number]["key"];

  const defaultFontFor = (v: BibleVersion) => v === "nkrv" ? "noto-serif" as FontKey : "gowun-dodum" as FontKey;
  const [fontKey, setFontKey] = useState<FontKey>(() => {
    if (typeof window === "undefined") return defaultFontFor(version);
    return (localStorage.getItem("fullscreenFont") as FontKey) || defaultFontFor(version);
  });
  // 버전 전환 시 기본 폰트 자동 변경 (사용자가 수동 선택 안 했으면)
  const userPickedFont = useRef(false);
  useEffect(() => {
    if (!userPickedFont.current) setFontKey(defaultFontFor(version));
  }, [version]);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const currentFont = FONTS.find((f) => f.key === fontKey) || FONTS[0];

  useEffect(() => {
    localStorage.setItem("fullscreenTheme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("fullscreenFontSize", String(fontSize));
  }, [fontSize]);
  useEffect(() => {
    localStorage.setItem("fullscreenFont", fontKey);
  }, [fontKey]);

  // 브라우저 Fullscreen API 진입/해제 + body 스크롤 잠금
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
    return () => {
      document.body.style.overflow = prev;
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, []);

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
        shadow:
          "0 24px 48px -16px rgba(0,0,0,0.5), 0 6px 14px rgba(0,0,0,0.25), 0 0 0 1px rgba(230,221,206,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
      }
    : {
        bg: "#ded4c8",
        card: "#ece7e0",
        arrow: "#BFB392",
        text: "#1C1C1C",
        muted: "#575247",
        divider: "rgba(28,28,28,0.12)",
        subText: "#3F3A2E",
        ctrlBg: "rgba(28,28,28,0.04)",
        ctrlHover: "rgba(28,28,28,0.09)",
        ctrlBorder: "rgba(28,28,28,0.18)",
        credit: "#8A8578",
        // 카드 그림자 더 부드럽게 + 도드라진 윤곽 (#d2c8bc) + 상단 1px highlight
        shadow:
          "0 24px 48px -16px rgba(60,45,20,0.18), 0 6px 14px rgba(60,45,20,0.08), 0 0 0 1px #d2c8bc, inset 0 1px 0 rgba(255,255,255,0.55)",
      };

  // 라이트 모드: 외곽에 미세한 격자 패턴 (#dbd0c5, 24px 간격)
  const outerStyle: React.CSSProperties = isDark
    ? { background: vars.bg }
    : {
        backgroundColor: vars.bg,
        backgroundImage:
          "repeating-linear-gradient(0deg, #dbd0c5 0 1px, transparent 1px 24px), " +
          "repeating-linear-gradient(90deg, #dbd0c5 0 1px, transparent 1px 24px)",
      };

  return (
    <div
      role="dialog"
      aria-label="성경 풀스크린 보기"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        ...outerStyle,
        color: vars.text,
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        padding: "clamp(16px, 2vw, 28px) clamp(20px, 3vw, 48px)",
        overflow: "hidden",
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
      {/* 상단 — 최소 여백 */}
      <header style={{ height: "clamp(4px, 0.5vw, 8px)" }} />

      {/* 본문 카드 */}
      <main
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 0,
        }}
      >
        {/* 페이지 표시 — 카드 위 우측 정렬 */}
        <div
          style={{
            width: "min(1400px, 94%)",
            margin: "0 auto",
            paddingBottom: "clamp(6px, 0.8vw, 12px)",
            display: "flex",
            justifyContent: "flex-end",
            color: vars.muted,
          }}
        >
          <span
            style={{
              fontFamily: '"Playfair Display", serif',
              fontStyle: "italic",
              fontSize: 16,
              letterSpacing: "0.05em",
            }}
          >
            <b style={{ color: vars.text, fontStyle: "normal", fontWeight: 600 }}>{idx + 1}</b>
            <span style={{ opacity: 0.5, margin: "0 6px" }}>/</span>
            {verses.length}
          </span>
        </div>

        {/* 외부 좌측 클릭존 — 이전 구절 */}
        <div
          onClick={() => go(-1)}
          style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "6%", cursor: "pointer", zIndex: 2 }}
        />
        {/* 외부 우측 클릭존 — 다음 구절 */}
        <div
          onClick={() => go(1)}
          style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "6%", cursor: "pointer", zIndex: 2 }}
        />

        <section
          ref={cardRef}
          style={{
            position: "relative",
            background: vars.card,
            borderRadius: "clamp(14px, 1.4vw, 22px)",
            boxShadow: vars.shadow,
            width: "min(1400px, 94%)",
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
          {/* 좌/우 절반 클릭 → 이전/다음 구절 */}
          <div
            onClick={() => go(-1)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "50%",
              height: "100%",
              cursor: "pointer",
              zIndex: 3,
            }}
          />
          <div
            onClick={() => go(1)}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: "50%",
              height: "100%",
              cursor: "pointer",
              zIndex: 3,
            }}
          />
          {/* 레퍼런스 — 양옆 얇은 장식선 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "clamp(12px, 1.2vw, 20px)",
              marginBottom: "clamp(18px, 2vw, 32px)",
              maxWidth: "70%",
              width: "100%",
              justifyContent: "center",
            }}
          >
            <span style={{ flex: 1, height: 1, background: vars.divider }} />
            <span
              style={{
                fontSize: "clamp(20px, 1.9vw, 32px)",
                color: vars.muted,
                fontWeight: 500,
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
              }}
            >
              {current.ref}
            </span>
            <span style={{ flex: 1, height: 1, background: vars.divider }} />
          </div>
          <div
            style={{
              fontSize: `${effectiveFontSize}px`,
              fontWeight: currentFont.weight,
              lineHeight: 1.5,
              wordBreak: "keep-all",
              overflowWrap: "anywhere",
              maxWidth: "96%",
              color: vars.text,
              letterSpacing: "-0.01em",
              fontFamily: currentFont.css,
            }}
          >
            {current.main}
          </div>
          {parallel && current.sub && (
            <div
              style={{
                marginTop: "clamp(14px, 1.5vw, 24px)",
                fontSize: `${Math.round(effectiveFontSize * 0.52)}px`,
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
          marginTop: "clamp(16px, 2vw, 28px)",
        }}
      >
        {/* 레퍼런스 필 바 (jumpMode) — 컨트롤 위, 고정 위치 */}
        {jumpMode && jumpRefs && jumpRefs.length > 1 && (() => {
          const labels = buildPillLabels(jumpRefs);
          return (
            <>
            <div
              ref={pillsScrollRef}
              style={{
                width: "min(1400px, 94%)",
                margin: "0 auto",
                display: "flex",
                gap: 10,
                overflowX: "auto",
                paddingBottom: "clamp(8px, 1vw, 12px)",
                marginBottom: "clamp(4px, 0.5vw, 8px)",
                scrollbarWidth: "none",
                justifyContent: "center",
                flexWrap: "wrap",
                opacity: pillsVisible ? 1 : 0.12,
                transition: "opacity 0.6s ease",
              }}
            >
              {labels.map((label, i) => (
                <button
                  key={i}
                  onClick={() => { setIdx(i); resetPillsTimer(); }}
                  style={{
                    flexShrink: 0,
                    padding: "7px 18px",
                    borderRadius: 999,
                    border: i === idx ? "none" : `1px solid ${vars.ctrlBorder}`,
                    fontSize: 13,
                    fontWeight: i === idx ? 600 : 400,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    background: i === idx ? vars.text : "transparent",
                    color: i === idx ? vars.card : vars.muted,
                    transition: "background .15s, color .15s",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </button>
              ))}
              {/* [+] 추가 버튼 */}
              {onAddVerses && (
                <button
                  onClick={() => { setShowAddInput(true); setTimeout(() => addInputRef.current?.focus(), 100); }}
                  style={{
                    flexShrink: 0,
                    padding: "7px 14px",
                    borderRadius: 999,
                    border: `1px solid ${vars.ctrlBorder}`,
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    background: "transparent",
                    color: vars.muted,
                    transition: "background .15s, color .15s",
                  }}
                >
                  +
                </button>
              )}
            </div>
            {/* 입력행 — [+] 클릭 시 슬라이드 */}
            {showAddInput && onAddVerses && (
              <div
                style={{
                  width: "min(1400px, 94%)",
                  margin: "0 auto",
                  display: "flex",
                  gap: 8,
                  paddingBottom: "clamp(6px, 0.8vw, 10px)",
                }}
              >
                <input
                  ref={addInputRef}
                  type="text"
                  value={addInput}
                  onChange={(e) => setAddInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddSubmit(); if (e.key === "Escape") { setShowAddInput(false); setAddInput(""); } }}
                  placeholder="롬8:28, 시23:1-6"
                  style={{
                    flex: 1,
                    padding: "8px 14px",
                    borderRadius: 10,
                    border: `1px solid ${vars.ctrlBorder}`,
                    background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                    color: vars.text,
                    fontSize: 13,
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
                <button
                  onClick={handleAddSubmit}
                  disabled={addLoading || !addInput.trim()}
                  style={{
                    padding: "8px 18px",
                    borderRadius: 10,
                    border: "none",
                    background: vars.text,
                    color: vars.card,
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    opacity: addLoading || !addInput.trim() ? 0.4 : 1,
                  }}
                >
                  {addLoading ? "..." : "추가"}
                </button>
              </div>
            )}
            </>
          );
        })()}

        <div
          style={{
            width: "min(1400px, 94%)",
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "clamp(10px, 1.2vw, 16px)",
            color: vars.muted,
            position: "relative",
            opacity: pillsVisible ? 1 : 0.12,
            transition: "opacity 0.6s ease",
          }}
        >
          {/* 좌측: 다크/라이트 토글 */}
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
          <span aria-hidden style={{ width: 1, height: 14, background: vars.divider, opacity: 0.7 }} />

          {/* 폰트 선택 버튼 + 팝업 */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowFontPicker(!showFontPicker)}
              style={{
                background: "transparent",
                border: `1px solid ${vars.ctrlBorder}`,
                color: vars.muted,
                padding: "4px 12px",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: currentFont.css,
                borderRadius: 999,
                transition: "background .15s, color .15s",
                whiteSpace: "nowrap",
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
              {currentFont.label}
            </button>
            {showFontPicker && (
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: vars.card,
                  border: `1px solid ${vars.ctrlBorder}`,
                  borderRadius: 12,
                  padding: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                  zIndex: 10,
                  minWidth: 120,
                }}
              >
                {FONTS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => { userPickedFont.current = true; setFontKey(f.key); setShowFontPicker(false); }}
                    style={{
                      background: fontKey === f.key ? vars.text : "transparent",
                      color: fontKey === f.key ? vars.card : vars.muted,
                      border: "none",
                      padding: "7px 14px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontFamily: f.css,
                      fontWeight: f.weight,
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background .12s, color .12s",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => {
                      if (fontKey !== f.key) {
                        e.currentTarget.style.background = vars.ctrlHover;
                        e.currentTarget.style.color = vars.text;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (fontKey !== f.key) {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = vars.muted;
                      }
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 구분 */}
          <span aria-hidden style={{ width: 1, height: 14, background: vars.divider, opacity: 0.7 }} />

          {/* 폰트 크기 슬라이더 */}
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
                width: 140,
                height: 2,
                background: vars.ctrlBorder,
                borderRadius: 999,
                outline: "none",
                cursor: "pointer",
              }}
            />
            <span style={{ fontSize: 17, opacity: 0.85, color: vars.muted }}>가</span>
          </div>

          {/* 버전 버튼 — 폰트 슬라이더 우측 (자동 숨김) */}
          {!hideVersionButtons && (
            <div style={{
              display: "inline-flex",
              gap: 4,
              alignItems: "center",
            }}>
              <span aria-hidden style={{ width: 1, height: 14, background: vars.divider, opacity: 0.7, marginRight: 4 }} />
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
          )}

          {/* 닫기 버튼 — absolute 우측끝 */}
          <button
            onClick={onClose}
            aria-label="닫기 (Esc)"
            style={{
              position: "absolute",
              right: 0,
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "none",
              background: "transparent",
              color: vars.muted,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
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
