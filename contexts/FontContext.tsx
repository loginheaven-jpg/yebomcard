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

interface FontContextType {
  fontSize: number;
  setFontSize: (size: number) => void;
  fontKey: FontKey;
  setFontKey: (key: FontKey) => void;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  showFontSettings: boolean;
  setShowFontSettings: (show: boolean) => void;
}

const FontContext = createContext<FontContextType | undefined>(undefined);

export function FontProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSize] = useState(20);
  const [fontKey, setFontKey] = useState<FontKey>("noto-serif");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [showFontSettings, setShowFontSettings] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const storedSize = localStorage.getItem("globalFontSize");
    const storedKey = localStorage.getItem("globalFontKey") as FontKey;
    const storedTheme = localStorage.getItem("globalTheme") as "light" | "dark";
    if (storedSize) setFontSize(parseInt(storedSize, 10));
    if (storedKey) setFontKey(storedKey);
    if (storedTheme) setTheme(storedTheme);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("globalFontSize", String(fontSize));
    localStorage.setItem("globalFontKey", fontKey);
    localStorage.setItem("globalTheme", theme);
  }, [fontSize, fontKey, theme, mounted]);

  return (
    <FontContext.Provider value={{ fontSize, setFontSize, fontKey, setFontKey, theme, setTheme, showFontSettings, setShowFontSettings }}>
      {children}
    </FontContext.Provider>
  );
}

export function useFont() {
  const context = useContext(FontContext);
  if (!context) throw new Error("useFont must be used within FontProvider");
  return context;
}
