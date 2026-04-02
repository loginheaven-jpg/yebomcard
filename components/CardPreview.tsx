"use client";

import { useState, useEffect, useRef } from "react";
import { toPng } from "html-to-image";
import { supabase } from "@/lib/supabase";
import { findGradients, type GradientPreset } from "@/lib/gradients";
import { extractKeywords, getUnsplashQuery } from "@/lib/keywords";
import { getBookByCode } from "@/lib/books";
import type { BibleVerse } from "@/lib/types";

/**
 * 슬라이더 값(0~100) → 흰→주조색→검 그라데이션 상의 색상
 * 0=white, 50=dominantColor, 100=black
 */
function sliderToColor(value: number, dominant: string): string {
  const dr = parseInt(dominant.slice(1, 3), 16) || 128;
  const dg = parseInt(dominant.slice(3, 5), 16) || 128;
  const db = parseInt(dominant.slice(5, 7), 16) || 128;

  if (value <= 50) {
    const t = value / 50;
    const r = Math.round(255 + (dr - 255) * t);
    const g = Math.round(255 + (dg - 255) * t);
    const b = Math.round(255 + (db - 255) * t);
    return `rgb(${r},${g},${b})`;
  } else {
    const t = (value - 50) / 50;
    const r = Math.round(dr * (1 - t));
    const g = Math.round(dg * (1 - t));
    const b = Math.round(db * (1 - t));
    return `rgb(${r},${g},${b})`;
  }
}

/** gradient CSS에서 중간 hex 색상 추출 → 평균 */
function extractGradientColor(gradient: string): string {
  const hexes = gradient.match(/#[0-9a-fA-F]{6}/g);
  if (!hexes || hexes.length === 0) return "#808080";
  let r = 0, g = 0, b = 0;
  for (const hex of hexes) {
    r += parseInt(hex.slice(1, 3), 16);
    g += parseInt(hex.slice(3, 5), 16);
    b += parseInt(hex.slice(5, 7), 16);
  }
  const n = hexes.length;
  return `#${Math.round(r / n).toString(16).padStart(2, "0")}${Math.round(g / n).toString(16).padStart(2, "0")}${Math.round(b / n).toString(16).padStart(2, "0")}`;
}

/** base64 이미지 → 중앙 영역 평균색 추출 */
function extractImageColor(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 50;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve("#808080"); return; }
      // 중앙 영역 샘플링
      const sx = (img.width - img.width * 0.3) / 2;
      const sy = (img.height - img.height * 0.3) / 2;
      ctx.drawImage(img, sx, sy, img.width * 0.3, img.height * 0.3, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let r = 0, g = 0, b = 0;
      const pixels = size * size;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i + 1]; b += data[i + 2];
      }
      resolve(`#${Math.round(r / pixels).toString(16).padStart(2, "0")}${Math.round(g / pixels).toString(16).padStart(2, "0")}${Math.round(b / pixels).toString(16).padStart(2, "0")}`);
    };
    img.onerror = () => resolve("#808080");
    img.src = dataUrl;
  });
}

interface UnsplashImage {
  id: string;
  url: string;
  color: string;
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

  // English + download + text color
  const [englishText, setEnglishText] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [dominantColor, setDominantColor] = useState("#808080");
  const [textColorSlider, setTextColorSlider] = useState(0);
  const [fontScale, setFontScale] = useState(100); // 80~140%
  const [verticalPos, setVerticalPos] = useState(50);
  const [cardRatio, setCardRatio] = useState<"4/5" | "9/16">("4/5");

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
    setGradients(findGradients(koreanText, 6));
  }, [koreanText]);

  // 2. Unsplash — 5장
  useEffect(() => {
    if (activeCard !== "photo" || photos.length > 0) return;
    async function loadPhotos() {
      setPhotoLoading(true);
      try {
        const query = getUnsplashQuery(keywords);
        const res = await fetch(
          `/api/unsplash?query=${encodeURIComponent(query)}&per_page=6`
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

  // 주조색 추출 + 슬라이더 기본값 설정
  useEffect(() => {
    async function updateDominant() {
      let color = "#808080";
      let defaultSlider = 0; // 0=white

      if (activeCard === "gradient" && selectedGradient) {
        color = extractGradientColor(selectedGradient.gradient);
        defaultSlider = selectedGradient.textColor === "dark" ? 100 : 0;
      } else if (activeCard === "photo" && photos.length > 0) {
        color = photos[selectedPhotoIdx]?.color || "#808080";
        defaultSlider = 0; // 사진은 어두운 overlay → 흰 글씨
      } else if (activeCard === "ai" && currentAi) {
        if (currentAi.type === "image" && currentAi.imageDataUrl) {
          color = await extractImageColor(currentAi.imageDataUrl);
          defaultSlider = 0;
        } else if (currentAi.gradient) {
          color = extractGradientColor(currentAi.gradient);
          defaultSlider = currentAi.textColor === "dark" ? 100 : 0;
        }
      }

      setDominantColor(color);
      setTextColorSlider(defaultSlider);
    }
    updateDominant();
  }, [activeCard, selectedGradientIdx, selectedPhotoIdx, currentAi]);

  // 슬라이더 기반 텍스트 색상
  const userTextColor = sliderToColor(textColorSlider, dominantColor);

  // PNG Download
  const handleDownload = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      await document.fonts.ready;
      const el = cardRef.current;
      const ratio = 1080 / el.offsetWidth;
      const dataUrl = await toPng(el, {
        pixelRatio: ratio,
        cacheBust: true,
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

      {/* Card preview + vertical position slider */}
      <div className="relative">
      <div
        ref={cardRef}
        className="relative rounded-2xl overflow-hidden shadow-lg"
        style={{ aspectRatio: cardRatio, ...cardStyle }}
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
            className="absolute inset-0 flex flex-col items-center px-8"
            style={{
              color: userTextColor,
              paddingTop: `${verticalPos * 0.7}%`,
              textShadow:
                textColorSlider < 50
                  ? "0 1px 6px rgba(0,0,0,0.7), 0 0 20px rgba(0,0,0,0.3)"
                  : "0 1px 4px rgba(255,255,255,0.5)",
            }}
          >
            {/* Korean verse */}
            <p
              className="text-xl leading-[1.9] text-center mb-3"
              style={{
                fontFamily: fontCss,
                fontSize: `${fontScale}%`,
                wordBreak: "keep-all",
                overflowWrap: "break-word",
                textWrap: "balance" as never,
              }}
            >
              {koreanText}
            </p>

            {/* Korean ref */}
            <p className="text-sm opacity-80 font-semibold mb-5" style={{ fontSize: `${fontScale * 0.7}%` }}>{koreanRef}</p>

            {/* English verse */}
            {englishText && (
              <p
                className="text-base font-[family-name:var(--font-playfair)] italic opacity-60 text-center leading-relaxed mb-2"
                style={{ fontSize: `${fontScale * 0.85}%`, wordBreak: "keep-all", textWrap: "balance" as never }}
              >
                {englishText}
              </p>
            )}

            {/* English ref */}
            <p className="text-xs font-[family-name:var(--font-playfair)] opacity-50" style={{ fontSize: `${fontScale * 0.6}%` }}>
              {englishRef}
            </p>
          </div>
        )}

        {/* Watermark */}
        {!isLoading && (
          <div
            className="absolute bottom-4 right-5 font-[family-name:var(--font-playfair)] italic text-xs"
            style={{ color: userTextColor, opacity: 0.4 }}
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

      {/* Vertical position slider — absolute right side */}
      <div className="absolute -right-8 top-0 bottom-0 flex flex-col items-center justify-between py-3 w-6">
        <svg className="w-3 h-3 text-gray-300" viewBox="0 0 12 12" fill="currentColor"><path d="M6 2 L1 8 L11 8 Z" /></svg>
        <input
          type="range"
          min={0}
          max={100}
          value={verticalPos}
          onChange={(e) => setVerticalPos(Number(e.target.value))}
          className="h-full w-1.5 appearance-none cursor-pointer bg-gray-200 rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-gray-500 [&::-webkit-slider-thumb]:rounded-full"
          style={{ writingMode: "vertical-lr", direction: "rtl" }}
        />
        <svg className="w-3 h-3 text-gray-300" viewBox="0 0 12 12" fill="currentColor"><path d="M6 10 L1 4 L11 4 Z" /></svg>
      </div>
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

      {/* Controls — 2×2 grid */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {/* Row 1 Left: 글자색 */}
        <div>
          <p className="text-xs text-gray-400 mb-1.5">글자색</p>
          <div className="relative">
            <div
              className="h-5 rounded-full"
              style={{
                background: `linear-gradient(to right, #ffffff, ${dominantColor}, #000000)`,
                border: "1px solid #e5e5e5",
              }}
            />
            <input
              type="range"
              min={0}
              max={100}
              value={textColorSlider}
              onChange={(e) => setTextColorSlider(Number(e.target.value))}
              className="absolute inset-0 w-full h-5 opacity-0 cursor-pointer"
            />
            <div
              className="absolute top-0 w-4 h-5 rounded-full border-2 border-white shadow-md pointer-events-none"
              style={{
                left: `calc(${textColorSlider}% - 8px)`,
                background: userTextColor,
              }}
            />
          </div>
        </div>

        {/* Row 1 Right: 글자 크기 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs text-gray-400">크기</p>
            <p className="text-xs text-gray-400">{fontScale}%</p>
          </div>
          <input
            type="range"
            min={80}
            max={140}
            value={fontScale}
            onChange={(e) => setFontScale(Number(e.target.value))}
            className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-gray-700 [&::-webkit-slider-thumb]:rounded-full"
          />
        </div>

        {/* Row 2 Left: 서체 */}
        <div>
          <p className="text-xs text-gray-400 mb-1.5">서체</p>
          <div className="flex gap-0.5 bg-gray-50 p-0.5 rounded-lg">
            {FONT_OPTIONS.map((f) => (
              <button
                key={f.key}
                onClick={() => setSelectedFont(f.key)}
                className={`flex-1 py-1 text-[11px] rounded-md transition-colors ${
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

        {/* Row 2 Right: 비율 */}
        <div>
          <p className="text-xs text-gray-400 mb-1.5">비율</p>
          <div className="flex gap-0.5 bg-gray-50 p-0.5 rounded-lg">
            {(["4/5", "9/16"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setCardRatio(r)}
                className={`flex-1 py-1 text-[11px] rounded-md transition-colors ${
                  cardRatio === r
                    ? "bg-gray-900 text-white"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {r === "4/5" ? "4:5" : "9:16"}
              </button>
            ))}
          </div>
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
