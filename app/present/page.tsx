"use client";

import { useEffect, useLayoutEffect, useState, useRef } from "react";

/**
 * 프레젠테이션 전용 페이지 — 보조 모니터에 성경 본문만 표시
 * BroadcastChannel('yebom-worship')로 메인 창에서 데이터 수신
 */

interface PresentData {
  type: "verse";
  ref: string;
  main: string;
  sub?: string;
  fontKey: string;
  fontCss: string;
  fontWeight: number;
  fontSize: number;
  theme: "light" | "dark";
  parallel: boolean;
  subVersionLabel: string;
}

const FONTS: Record<string, { css: string; weight: number }> = {
  "noto-serif": { css: "var(--font-noto-serif-kr), 'Noto Serif KR', serif", weight: 600 },
  "noto-sans": { css: "var(--font-noto-sans-kr), 'Noto Sans KR', sans-serif", weight: 700 },
  "gowun-dodum": { css: "var(--font-gowun-dodum), 'Gowun Dodum', sans-serif", weight: 400 },
  "gothic-a1": { css: "var(--font-gothic-a1), 'Gothic A1', sans-serif", weight: 600 },
  "ibm-plex": { css: "var(--font-ibm-plex), 'IBM Plex Sans KR', sans-serif", weight: 600 },
};

export default function PresentPage() {
  const [data, setData] = useState<PresentData | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [effectiveFontSize, setEffectiveFontSize] = useState(74);

  // BroadcastChannel 수신
  useEffect(() => {
    const ch = new BroadcastChannel("yebom-worship");
    ch.onmessage = (e) => {
      if (e.data?.type === "verse") setData(e.data);
      if (e.data?.type === "close") window.close();
    };

    // 풀스크린 자동 진입
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
    document.body.style.overflow = "hidden";

    // 키보드 이벤트 → 메인 창에 전달
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "PageUp", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        ch.postMessage({ type: "key", key: e.key });
      }
    };
    window.addEventListener("keydown", onKey);

    return () => { ch.close(); window.removeEventListener("keydown", onKey); };
  }, []);

  // 폰트 자동 축소
  useLayoutEffect(() => {
    if (data) setEffectiveFontSize(data.fontSize);
  }, [data]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    if (el.scrollHeight - el.clientHeight > 2 && effectiveFontSize > 24) {
      setEffectiveFontSize((s) => Math.max(24, s - 2));
    }
  }, [effectiveFontSize, data]);

  if (!data) {
    return (
      <div style={{
        position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        background: "#ded4c8", color: "#575247", fontFamily: "sans-serif", fontSize: 18,
      }}>
        메인 창에서 구절을 선택하면 여기에 표시됩니다
      </div>
    );
  }

  const isDark = data.theme === "dark";
  const vars = isDark
    ? { bg: "#1A1A1A", card: "#242424", text: "#E6DDCE", muted: "#9A948A", divider: "rgba(230,221,206,0.14)", subText: "#C7BFAE",
        shadow: "0 24px 48px -16px rgba(0,0,0,0.5), 0 6px 14px rgba(0,0,0,0.25), 0 0 0 1px rgba(230,221,206,0.08), inset 0 1px 0 rgba(255,255,255,0.04)" }
    : { bg: "#ded4c8", card: "#ece7e0", text: "#1C1C1C", muted: "#575247", divider: "rgba(28,28,28,0.12)", subText: "#3F3A2E",
        shadow: "0 24px 48px -16px rgba(60,45,20,0.18), 0 6px 14px rgba(60,45,20,0.08), 0 0 0 1px #d2c8bc, inset 0 1px 0 rgba(255,255,255,0.55)" };

  const outerStyle: React.CSSProperties = isDark
    ? { background: vars.bg }
    : {
        backgroundColor: vars.bg,
        backgroundImage:
          "repeating-linear-gradient(0deg, #dbd0c5 0 1px, transparent 1px 24px), " +
          "repeating-linear-gradient(90deg, #dbd0c5 0 1px, transparent 1px 24px)",
      };

  const font = FONTS[data.fontKey] || FONTS["noto-serif"];

  return (
    <div style={{
      position: "fixed", inset: 0, ...outerStyle,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "clamp(16px, 2vw, 32px)",
      overflow: "hidden",
    }}>
      <div
        ref={cardRef}
        style={{
          background: vars.card,
          borderRadius: "clamp(14px, 1.4vw, 22px)",
          boxShadow: vars.shadow,
          width: "min(1400px, 94%)",
          height: "min(90vh, 100%)",
          padding: "clamp(24px, 3vw, 56px) clamp(20px, 4vw, 72px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          overflow: "hidden",
        }}
      >
        {/* 레퍼런스 */}
        <div style={{
          display: "flex", alignItems: "center", gap: "clamp(12px, 1.2vw, 20px)",
          marginBottom: "clamp(18px, 2vw, 32px)", maxWidth: "70%", width: "100%", justifyContent: "center",
        }}>
          <span style={{ flex: 1, height: 1, background: vars.divider }} />
          <span style={{ fontSize: "clamp(20px, 1.9vw, 32px)", color: vars.muted, fontWeight: 500, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
            {data.ref}
          </span>
          <span style={{ flex: 1, height: 1, background: vars.divider }} />
        </div>

        {/* 본문 */}
        <div style={{
          fontSize: `${effectiveFontSize}px`,
          fontWeight: font.weight,
          lineHeight: 1.5,
          wordBreak: "keep-all",
          overflowWrap: "anywhere",
          maxWidth: "96%",
          color: vars.text,
          letterSpacing: "-0.01em",
          fontFamily: font.css,
        }}>
          {data.main}
        </div>

        {/* 병기 */}
        {data.parallel && data.sub && (
          <div style={{
            marginTop: "clamp(14px, 1.5vw, 24px)",
            fontSize: `${Math.round(effectiveFontSize * 0.52)}px`,
            fontWeight: 400, lineHeight: 1.55, color: vars.subText,
            wordBreak: "keep-all", maxWidth: "94%",
            paddingTop: "clamp(8px, 1vw, 12px)",
            borderTop: `1px solid ${vars.divider}`,
          }}>
            <span style={{ display: "block", fontSize: 11, letterSpacing: "0.2em", color: vars.muted, marginBottom: 10, fontWeight: 500 }}>
              {data.subVersionLabel}
            </span>
            {data.sub}
          </div>
        )}
      </div>

      {/* 워터마크 */}
      <span style={{
        position: "fixed", bottom: 12, right: 16,
        fontSize: 10, color: vars.muted, opacity: 0.3,
        fontFamily: '"Playfair Display", serif', fontStyle: "italic",
      }}>
        Yebom Bible
      </span>
    </div>
  );
}
