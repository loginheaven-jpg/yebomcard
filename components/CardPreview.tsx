"use client";

import { useState, useEffect } from "react";
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

export default function CardPreview({ verses, onBack }: CardPreviewProps) {
  const [activeCard, setActiveCard] = useState<CardType>("gradient");
  const [gradient, setGradient] = useState<GradientPreset | null>(null);
  const [photo, setPhoto] = useState<UnsplashImage | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [aiBackground, setAiBackground] = useState<AiBackground | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Combine verse texts
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

  // 1. CSS Gradient — 즉시 매칭
  useEffect(() => {
    setGradient(findGradient(koreanText));
  }, [koreanText]);

  // 2. Unsplash — 탭 선택 시 로드
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
          if (data.length > 0) {
            setPhoto(data[0]);
          }
        }
      } catch {
        // silent fail
      } finally {
        setPhotoLoading(false);
      }
    }
    loadPhoto();
  }, [activeCard, photo, keywords]);

  // 3. AI Background — 탭 선택 시 로드
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
          if (data.backgrounds?.length > 0) {
            setAiBackground(data.backgrounds[0]);
          }
        }
      } catch {
        // silent fail
      } finally {
        setAiLoading(false);
      }
    }
    loadAi();
  }, [activeCard, aiBackground, koreanText, keywords]);

  // Current card background + text color
  let cardBg = "";
  let cardStyle: React.CSSProperties = {};
  let textColorClass = "text-white";
  let creditLine: React.ReactNode = null;

  if (activeCard === "gradient" && gradient) {
    cardStyle = { background: gradient.gradient };
    textColorClass = gradient.textColor === "dark" ? "text-gray-900" : "text-white";
  } else if (activeCard === "photo" && photo) {
    cardBg = photo.url;
    cardStyle = {
      backgroundImage: `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)), url(${photo.url})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
    textColorClass = "text-white";
    creditLine = (
      <span className="text-[10px] opacity-60">
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

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          말씀으로 돌아가기
        </button>
      </div>

      {/* Card type selector */}
      <div className="flex gap-1 mb-4 bg-gray-50 p-1 rounded-xl">
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

      {/* Card preview */}
      <div
        className="relative rounded-2xl overflow-hidden shadow-lg"
        style={{ aspectRatio: "4/5", ...cardStyle }}
      >
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <svg
                className="animate-spin w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              {activeCard === "photo" ? "사진 불러오는 중..." : "생성 중..."}
            </div>
          </div>
        ) : (
          <div
            className={`absolute inset-0 flex flex-col justify-center px-10 ${textColorClass}`}
            style={{ textShadow: textColorClass === "text-white" ? "0 2px 8px rgba(0,0,0,0.6)" : "none" }}
          >
            {/* Korean verse */}
            <p className="text-lg leading-relaxed font-[family-name:var(--font-gowun-dodum)] font-bold mb-4">
              {koreanText}
            </p>
            <p className="text-sm opacity-80 mb-6">{koreanRef}</p>

            {/* English ref */}
            <p className="text-xs font-[family-name:var(--font-playfair)] italic opacity-60">
              {englishRef}
            </p>
          </div>
        )}

        {/* Watermark */}
        {!isLoading && (
          <div
            className="absolute bottom-5 right-6 font-[family-name:var(--font-playfair)] italic text-sm opacity-50"
            style={{
              color: textColorClass === "text-white" ? "white" : "#1a1a1a",
            }}
          >
            Yebom Card
          </div>
        )}

        {/* Attribution */}
        {!isLoading && creditLine && (
          <div
            className="absolute bottom-5 left-6"
            style={{ color: "white" }}
          >
            {creditLine}
          </div>
        )}
      </div>

      {/* Gradient name badge */}
      {activeCard === "gradient" && gradient && (
        <p className="text-center text-xs text-gray-400 mt-3">
          &ldquo;{gradient.name}&rdquo; 스타일
        </p>
      )}
      {activeCard === "ai" && aiBackground && (
        <p className="text-center text-xs text-gray-400 mt-3">
          &ldquo;{aiBackground.name}&rdquo; 스타일
        </p>
      )}

      {/* Action buttons */}
      <div className="mt-6 space-y-3">
        <button
          disabled
          className="w-full py-3 bg-[#B8860B] text-white rounded-xl text-sm font-semibold shadow-lg opacity-50 cursor-not-allowed"
        >
          PNG 다운로드 (다음 단계에서 구현)
        </button>
        <p className="text-center text-xs text-gray-400">
          키워드: {keywords.join(", ")}
        </p>
      </div>
    </div>
  );
}
