"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type FontKey = "noto-serif" | "noto-sans" | "gowun-dodum" | "gothic-a1" | "ibm-plex";

export const FONTS: { key: FontKey; label: string; css: string; weight: number }[] = [
  { key: "noto-serif", label: "본명조", css: "var(--font-noto-serif-kr)", weight: 400 },
  { key: "noto-sans", label: "본고딕", css: "var(--font-noto-sans-kr)", weight: 400 },
  { key: "gowun-dodum", label: "고운돋움", css: "var(--font-gowun-dodum)", weight: 400 },
  { key: "gothic-a1", label: "고딕A1", css: "var(--font-gothic-a1)", weight: 400 },
  { key: "ibm-plex", label: "IBM플렉스", css: "var(--font-ibm-plex)", weight: 400 },
];

/** Phase 3 — 시스템 다크 추종 옵션 (사용자 Q5=B) */
export type ThemeMode = "light" | "dark" | "system";

interface FontContextType {
  fontSize: number;
  setFontSize: (size: number) => void;
  fontKey: FontKey;
  setFontKey: (key: FontKey) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  /** 실제 적용된 외관 (system 일 때 prefers-color-scheme 반영) */
  resolvedTheme: "light" | "dark";
  showFontSettings: boolean;
  setShowFontSettings: (show: boolean) => void;
}

const FontContext = createContext<FontContextType | undefined>(undefined);

export function FontProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSize] = useState(20);
  const [fontKey, setFontKey] = useState<FontKey>("noto-serif");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [showFontSettings, setShowFontSettings] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const storedSize = localStorage.getItem("globalFontSize");
    const storedKey = localStorage.getItem("globalFontKey") as FontKey;
    const storedTheme = localStorage.getItem("globalTheme") as ThemeMode | null;
    if (storedSize) setFontSize(parseInt(storedSize, 10));
    if (storedKey) setFontKey(storedKey);
    if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
      setTheme(storedTheme);
    }
  }, []);

  // Phase 3 — 테마 적용 + 시스템 추종 시 prefers-color-scheme 리스닝
  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("globalTheme", theme);

    const apply = (dark: boolean) => {
      setResolvedTheme(dark ? "dark" : "light");
      if (dark) document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
    };

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches);
      const handler = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    apply(theme === "dark");
  }, [theme, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("globalFontSize", String(fontSize));
    localStorage.setItem("globalFontKey", fontKey);
  }, [fontSize, fontKey, mounted]);

  return (
    <FontContext.Provider value={{ fontSize, setFontSize, fontKey, setFontKey, theme, setTheme, resolvedTheme, showFontSettings, setShowFontSettings }}>
      {children}
    </FontContext.Provider>
  );
}

export function useFont() {
  const context = useContext(FontContext);
  if (!context) throw new Error("useFont must be used within FontProvider");
  return context;
}
