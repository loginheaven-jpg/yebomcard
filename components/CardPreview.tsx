"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { findGradient, type GradientPreset } from "@/lib/gradients";
import { extractKeywords, getUnsplashQuery } from "@/lib/keywords";
import { getBookByCode } from "@/lib/books";
import type { BibleVerse } from "@/lib/types";

interface UnsplashImage {
  id: string;
  url: string;
  credit: { name: string; profileUrl: string };
}

interface AiBackground {
  name: string;
  gradient: string;
  textColor: "white" | "dark";
}

interface CardPreviewProps {
  verses: BibleVerse[];
  onBack: () => void;
}

type CardType = "gradient" | "photo" | "ai";
type FontChoice = "noto-serif" | "gowun-batang" | "gowun-dodum";

const FONT_OPTIONS: { key: FontChoice; label: string; css: string }[] = [
  { key: "noto-serif", label: "명조", css: "var(--font-noto-serif-kr)" },
  { key: "gowun-batang", label: "바탕", css: "var(--font-gowun-batang)" },
  { key: "gowun-dodum", label: "돋움", css: "var(--font-gowun-dodum)" },
];

export default function CardPreview({ verses, onBack }: CardPreviewProps) {
  const [activeCard, setActiveCard] = useState<CardType>("gradient");
  const [selectedFont, setSelectedFont] = useState<FontChoice>("gowun-dodum");
  const [gradient, setGradient] = useState<GradientPreset | null>(null);
  const [photo, setPhoto] = useState<UnsplashImage | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [aiBackground, setAiBackground] = useState<AiBackground | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [englishText, setEnglishText] = useState("");

  const koreanText = verses.map((v) => v.text).join(" ");
  const firstVerse = verses[0];
  const book = getBookByCode(firstVerse.book_code);

  const verseRange =
    verses.length === 1
      ? `${verses[0].verse}`
      : `${verses[0].verse}-${verses[verses.length - 1].verse}`;
  const koreanRef = `${firstVerse.book_name} ${firstVerse.chapter}장 ${verseRange}절`;
  const englishRef = book
    ? `${book.nameEn} ${firstVerse.chapter}:${verseRange}`
    : "";

  const keywords = extractKeywords(koreanText);
  const fontCss =
    FONT_OPTIONS.find((f) => f.key === selectedFont)?.css || FONT_OPTIONS[0].css;

  // 0. English verse
  useEffect(() => {
    async function loadEnglish() {
      const promises = verses.map((v) =>
        supabase
          .from("bible_verses")
          .select("text")
          .eq("version", "kjv")
          .eq("book_code", v.book_code)
          .eq("chapter", v.chapter)
          .eq("verse", v.verse)
          .single()
      );
      const results = await Promise.all(promises);
      const texts = results
        .map((r) => r.data?.text)
        .filter(Boolean)
        .join(" ");
      setEnglishText(texts);
    }
    loadEnglish();
  }, [verses]);

  // 1. CSS Gradient
  useEffect(() => {
    setGradient(findGradient(koreanText));
  }, [koreanText]);

  // 2. Unsplash
  useEffect(() => {
    if (activeCard !== "photo" || photo) return;
    async function loadPhoto() {
      setPhotoLoading(true);
      try {
        const query = getUnsplashQuery(keywords);
        const res = await fetch(
          `/api/unsplash?query=${encodeURIComponent(query)}&per_page=1`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) setPhoto(data[0]);
        }
      } catch {
        /* silent */
      } finally {
        setPhotoLoading(false);
      }
    }
    loadPhoto();
  }, [activeCard, photo, keywords]);

  // 3. AI Background
  useEffect(() => {
    if (activeCard !== "ai" || aiBackground) return;
    async function loadAi() {
      setAiLoading(true);
      try {
        const res = await fetch("/api/ai/background", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verseText: koreanText, keywords }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.backgrounds?.length > 0) setAiBackground(data.backgrounds[0]);
        }
      } catch {
        /* silent */
      } finally {
        setAiLoading(false);
      }
    }
    loadAi();
  }, [activeCard, aiBackground, koreanText, keywords]);

  // Card style
  let cardStyle: React.CSSProperties = {};
  let textColorClass = "text-white";
  let creditLine: React.ReactNode = null;

  if (activeCard === "gradient" && gradient) {
    cardStyle = { background: gradient.gradient };
    textColorClass =
      gradient.textColor === "dark" ? "text-gray-900" : "text-white";
  } else if (activeCard === "photo" && photo) {
    cardStyle = {
      backgroundImage: `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.4)), url(${photo.url})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
    textColorClass = "text-white";
    creditLine = (
      <span className="text-[9px] opacity-50">
        Photo by{" "}
        <a
          href={photo.credit.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {photo.credit.name}
        </a>{" "}
        on Unsplash
      </span>
    );
  } else if (activeCard === "ai" && aiBackground) {
    cardStyle = { background: aiBackground.gradient };
    textColorClass =
      aiBackground.textColor === "dark" ? "text-gray-900" : "text-white";
  }

  const isLoading =
    (activeCard === "photo" && photoLoading) ||
    (activeCard === "ai" && aiLoading);

  const tabClass = (type: CardType) =>
    `flex-1 py-2 text-xs font-medium text-center rounded-lg transition-colors ${
      activeCard === type
        ? "bg-gray-900 text-white"
        : "text-gray-500 hover:bg-gray-100"
    }`;

  const fontBtnClass = (key: FontChoice) =>
    `px-3 py-1.5 text-xs rounded-lg transition-colors ${
      selectedFont === key
        ? "bg-gray-900 text-white"
        : "text-gray-500 hover:bg-gray-100"
    }`;

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          말씀으로 돌아가기
        </button>
      </div>

      {/* Card type selector */}
      <div className="flex gap-1 mb-3 bg-gray-50 p-1 rounded-xl">
        <button onClick={() => setActiveCard("gradient")} className={tabClass("gradient")}>
          그라데이션
        </button>
        <button onClick={() => setActiveCard("photo")} className={tabClass("photo")}>
          사진 배경
        </button>
        <button onClick={() => setActiveCard("ai")} className={tabClass("ai")}>
          AI 아트
        </button>
      </div>

      {/* Card preview — 4:5 ratio (1080×1350) */}
      <div
        className="relative rounded-2xl overflow-hidden shadow-lg"
        style={{ aspectRatio: "4/5", ...cardStyle }}
      >
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {activeCard === "photo" ? "사진 불러오는 중..." : "생성 중..."}
            </div>
          </div>
        ) : (
          <div
            className={`absolute inset-0 flex flex-col justify-center items-center px-8 ${textColorClass}`}
            style={{
              textShadow:
                textColorClass === "text-white"
                  ? "0 1px 6px rgba(0,0,0,0.7), 0 0 20px rgba(0,0,0,0.3)"
                  : "none",
            }}
          >
            {/* Korean verse */}
            <p
              className="text-xl leading-[1.9] text-center mb-3"
              style={{
                fontFamily: fontCss,
                wordBreak: "keep-all",
                overflowWrap: "break-word",
                textWrap: "balance" as never,
              }}
            >
              {koreanText}
            </p>

            {/* Korean ref */}
            <p className="text-sm opacity-80 font-semibold mb-5">{koreanRef}</p>

            {/* English verse */}
            {englishText && (
              <p
                className="text-xs font-[family-name:var(--font-playfair)] italic opacity-60 text-center leading-relaxed mb-2"
                style={{
                  wordBreak: "keep-all",
                  textWrap: "balance" as never,
                }}
              >
                {englishText}
              </p>
            )}

            {/* English ref */}
            <p className="text-xs font-[family-name:var(--font-playfair)] opacity-50">
              {englishRef}
            </p>
          </div>
        )}

        {/* Watermark */}
        {!isLoading && (
          <div
            className="absolute bottom-4 right-5 font-[family-name:var(--font-playfair)] italic text-xs"
            style={{
              color: textColorClass === "text-white" ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.3)",
            }}
          >
            Yebom Card
          </div>
        )}

        {/* Attribution */}
        {!isLoading && creditLine && (
          <div className="absolute bottom-4 left-5" style={{ color: "white" }}>
            {creditLine}
          </div>
        )}
      </div>

      {/* Style name */}
      {activeCard === "gradient" && gradient && (
        <p className="text-center text-xs text-gray-400 mt-2">
          &ldquo;{gradient.name}&rdquo;
        </p>
      )}
      {activeCard === "ai" && aiBackground && (
        <p className="text-center text-xs text-gray-400 mt-2">
          &ldquo;{aiBackground.name}&rdquo;
        </p>
      )}

      {/* Font selector */}
      <div className="mt-4">
        <p className="text-xs text-gray-400 mb-2">서체</p>
        <div className="flex gap-1 bg-gray-50 p-1 rounded-xl">
          {FONT_OPTIONS.map((f) => (
            <button
              key={f.key}
              onClick={() => setSelectedFont(f.key)}
              className={fontBtnClass(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Action */}
      <div className="mt-5 space-y-2">
        <button
          disabled
          className="w-full py-3 bg-[#B8860B] text-white rounded-xl text-sm font-semibold shadow-lg opacity-50 cursor-not-allowed"
        >
          PNG 다운로드 (다음 단계)
        </button>
      </div>
    </div>
  );
}
