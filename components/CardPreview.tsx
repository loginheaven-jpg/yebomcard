"use client";

import { useState, useEffect, useRef } from "react";
import { toPng } from "html-to-image";
import { supabase } from "@/lib/supabase";
import { findGradients, type GradientPreset } from "@/lib/gradients";
import { extractKeywords, getUnsplashQuery } from "@/lib/keywords";
import { getBookByCode } from "@/lib/books";
import type { BibleVerse } from "@/lib/types";

interface UnsplashImage {
  id: string;
  url: string;
  credit: { name: string; profileUrl: string };
}

interface AiBackground {
  type: "image" | "gradient";
  imageDataUrl?: string;
  name?: string;
  gradient?: string;
  textColor?: "white" | "dark";
}

interface CardPreviewProps {
  verses: BibleVerse[];
  onBack: () => void;
}

type CardType = "gradient" | "photo" | "ai";
type AiMode = "background" | "illustration";
type FontChoice = "noto-serif" | "ibm-plex" | "gowun-dodum";

const FONT_OPTIONS: { key: FontChoice; label: string; css: string }[] = [
  { key: "noto-serif", label: "명조", css: "var(--font-noto-serif-kr)" },
  { key: "ibm-plex", label: "고딕", css: "var(--font-ibm-plex)" },
  { key: "gowun-dodum", label: "돋움", css: "var(--font-gowun-dodum)" },
];

export default function CardPreview({ verses, onBack }: CardPreviewProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [activeCard, setActiveCard] = useState<CardType>("gradient");
  const [selectedFont, setSelectedFont] = useState<FontChoice>("gowun-dodum");

  // Gradient state — 5개
  const [gradients, setGradients] = useState<GradientPreset[]>([]);
  const [selectedGradientIdx, setSelectedGradientIdx] = useState(0);

  // Photo state
  const [photos, setPhotos] = useState<UnsplashImage[]>([]);
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState(0);
  const [photoLoading, setPhotoLoading] = useState(false);

  // AI state — 배경/삽화 서브모드
  const [aiMode, setAiMode] = useState<AiMode>("background");
  const [aiBg, setAiBg] = useState<AiBackground | null>(null);
  const [aiIllust, setAiIllust] = useState<AiBackground | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // English + download
  const [englishText, setEnglishText] = useState("");
  const [downloading, setDownloading] = useState(false);

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
      setEnglishText(
        results
          .map((r) => r.data?.text)
          .filter(Boolean)
          .join(" ")
      );
    }
    loadEnglish();
  }, [verses]);

  // 1. Gradients — 5개
  useEffect(() => {
    setGradients(findGradients(koreanText, 5));
  }, [koreanText]);

  // 2. Unsplash — 5장
  useEffect(() => {
    if (activeCard !== "photo" || photos.length > 0) return;
    async function loadPhotos() {
      setPhotoLoading(true);
      try {
        const query = getUnsplashQuery(keywords);
        const res = await fetch(
          `/api/unsplash?query=${encodeURIComponent(query)}&per_page=5`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) setPhotos(data);
        }
      } catch {
        /* silent */
      } finally {
        setPhotoLoading(false);
      }
    }
    loadPhotos();
  }, [activeCard, photos.length, keywords]);

  // 3. AI — 수동 생성 (서브 토글 선택 후 "생성" 버튼)
  const currentAi = aiMode === "illustration" ? aiIllust : aiBg;

  async function generateAi() {
    const setter = aiMode === "illustration" ? setAiIllust : setAiBg;
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verseText: koreanText, keywords, mode: aiMode }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.type === "image" && data.data) {
          setter({
            type: "image",
            imageDataUrl: `data:${data.media_type};base64,${data.data}`,
          });
        } else if (data.backgrounds?.length > 0) {
          const bg = data.backgrounds[0];
          setter({
            type: "gradient",
            name: bg.name,
            gradient: bg.gradient,
            textColor: bg.textColor,
          });
        }
      }
    } catch {
      /* silent */
    } finally {
      setAiLoading(false);
    }
  }

  // Card style computation
  let cardStyle: React.CSSProperties = {};
  let textColorClass = "text-white";
  let creditLine: React.ReactNode = null;

  const selectedGradient = gradients[selectedGradientIdx];

  if (activeCard === "gradient" && selectedGradient) {
    cardStyle = { background: selectedGradient.gradient };
    textColorClass =
      selectedGradient.textColor === "dark" ? "text-gray-900" : "text-white";
  } else if (activeCard === "photo" && photos.length > 0) {
    const selectedPhoto = photos[selectedPhotoIdx];
    cardStyle = {
      backgroundImage: `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.4)), url(${selectedPhoto.url})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
    textColorClass = "text-white";
    creditLine = (
      <span className="text-[9px] opacity-50">
        Photo by{" "}
        <a href={selectedPhoto.credit.profileUrl} target="_blank" rel="noopener noreferrer" className="underline">
          {selectedPhoto.credit.name}
        </a>{" "}
        on Unsplash
      </span>
    );
  } else if (activeCard === "ai" && currentAi) {
    if (currentAi.type === "image" && currentAi.imageDataUrl) {
      cardStyle = {
        backgroundImage: `linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.35)), url(${currentAi.imageDataUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
      textColorClass = "text-white";
    } else if (currentAi.gradient) {
      cardStyle = { background: currentAi.gradient };
      textColorClass =
        currentAi.textColor === "dark" ? "text-gray-900" : "text-white";
    }
  }

  const isLoading =
    (activeCard === "photo" && photoLoading) ||
    (activeCard === "ai" && aiLoading);

  // PNG Download
  const handleDownload = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      await document.fonts.ready;
      const dataUrl = await toPng(cardRef.current, {
        width: 1080,
        height: 1350,
        pixelRatio: 1,
        cacheBust: true,
        style: { transform: "scale(1)", transformOrigin: "top left" },
      });
      const link = document.createElement("a");
      link.download = `yebom-card-${firstVerse.book_code}${firstVerse.chapter}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setDownloading(false);
    }
  };

  const tabClass = (type: CardType) =>
    `flex-1 py-2 text-xs font-medium text-center rounded-lg transition-colors ${
      activeCard === type
        ? "bg-gray-900 text-white"
        : "text-gray-500 hover:bg-gray-100"
    }`;

  const aiModeClass = (m: AiMode) =>
    `flex-1 py-1.5 text-xs font-medium text-center rounded-md transition-colors ${
      aiMode === m
        ? "bg-gray-700 text-white"
        : "text-gray-400 hover:text-gray-600"
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

      {/* AI sub-toggle + generate button */}
      {activeCard === "ai" && (
        <div className="flex gap-2 mb-3 items-center">
          <div className="flex gap-1 flex-1 bg-gray-100 p-0.5 rounded-lg">
            <button onClick={() => setAiMode("background")} className={aiModeClass("background")}>
              배경 사진
            </button>
            <button onClick={() => setAiMode("illustration")} className={aiModeClass("illustration")}>
              삽화
            </button>
          </div>
          <button
            onClick={generateAi}
            disabled={aiLoading}
            className="px-4 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {aiLoading ? "..." : "생성"}
          </button>
        </div>
      )}

      {/* Card preview — 4:5 ratio */}
      <div
        ref={cardRef}
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
              {activeCard === "photo" ? "사진 불러오는 중..." : aiMode === "illustration" ? "삽화 생성 중..." : "생성 중..."}
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
              className="text-2xl leading-[1.9] text-center mb-3"
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
                className="text-sm font-[family-name:var(--font-playfair)] italic opacity-60 text-center leading-relaxed mb-2"
                style={{ wordBreak: "keep-all", textWrap: "balance" as never }}
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

      {/* Gradient thumbnails */}
      {activeCard === "gradient" && gradients.length > 1 && (
        <div className="flex gap-2 mt-3 justify-center">
          {gradients.map((g, i) => (
            <button
              key={g.name}
              onClick={() => setSelectedGradientIdx(i)}
              className={`w-12 h-12 rounded-lg border-2 transition-all ${
                i === selectedGradientIdx
                  ? "border-gray-900 scale-110"
                  : "border-transparent opacity-60 hover:opacity-80"
              }`}
              style={{ background: g.gradient }}
              title={g.name}
            />
          ))}
        </div>
      )}

      {/* Photo thumbnails */}
      {activeCard === "photo" && photos.length > 1 && (
        <div className="flex gap-2 mt-3 justify-center">
          {photos.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setSelectedPhotoIdx(i)}
              className={`w-12 h-12 rounded-lg overflow-hidden border-2 transition-all ${
                i === selectedPhotoIdx
                  ? "border-gray-900 scale-110"
                  : "border-transparent opacity-60 hover:opacity-80"
              }`}
            >
              <img src={p.url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* AI label */}
      {activeCard === "ai" && !aiLoading && currentAi?.type === "image" && (
        <p className="text-center text-xs text-gray-400 mt-2">
          {aiMode === "illustration" ? "AI 삽화" : "AI 배경 사진"}
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
              className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${
                selectedFont === f.key
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Download */}
      <div className="mt-5">
        <button
          onClick={handleDownload}
          disabled={isLoading || downloading}
          className="w-full py-3 bg-[#B8860B] text-white rounded-xl text-sm font-semibold shadow-lg hover:bg-[#9A7009] disabled:opacity-50 transition-colors"
        >
          {downloading ? "다운로드 중..." : "PNG 다운로드"}
        </button>
      </div>
    </div>
  );
}
