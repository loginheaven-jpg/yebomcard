"use client";

import { useState, useEffect, useRef } from "react";
import { toPng } from "html-to-image";
import { supabase } from "@/lib/supabase";
import { findGradients, type GradientPreset } from "@/lib/gradients";
import { extractKeywords, getUnsplashQuery } from "@/lib/keywords";
import { getBookByCode } from "@/lib/books";
import { stripNotes, type BibleVerse, type BibleVersion } from "@/lib/types";
import { addScrapToServer } from "@/lib/scrap";

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
  mainVersion: BibleVersion;
  subVersion: BibleVersion | "none";
  onBack: () => void;
}

type CardType = "gradient" | "photo" | "ai" | "upload";
type AiMode = "background" | "illustration";
type FontChoice = "noto-serif" | "ibm-plex" | "gowun-dodum";

const FONT_OPTIONS: { key: FontChoice; label: string; css: string }[] = [
  { key: "noto-serif", label: "명조", css: "var(--font-noto-serif-kr)" },
  { key: "ibm-plex", label: "고딕", css: "var(--font-ibm-plex)" },
  { key: "gowun-dodum", label: "돋움", css: "var(--font-gowun-dodum)" },
];

export default function CardPreview({ verses, mainVersion, subVersion, onBack }: CardPreviewProps) {
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

  // Upload state — 서버 연동 (Supabase Storage)
  interface UploadImage { id: string; dataUrl: string; }
  const [uploads, setUploads] = useState<UploadImage[]>([]);
  const [selectedUploadIdx, setSelectedUploadIdx] = useState(0);
  const [cleaningImage, setCleaningImage] = useState(false);
  const [showUploadPopup, setShowUploadPopup] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadMode = useRef<"as-is" | "remove-text">("as-is");

  // 서버에서 사용자 사진 불러오기
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/photos");
        if (!res.ok) return;
        const { photos } = await res.json();
        if (Array.isArray(photos) && photos.length > 0) {
          setUploads(photos.map((p: { id: string; public_url: string }) => ({ id: p.id, dataUrl: p.public_url })));
        }
      } catch { /* silent */ }
    })();
  }, []);

  // 이미지 리사이즈 (긴 변 1200px, JPEG 80%)
  function resizeImage(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round((h * MAX) / w); w = MAX; }
          else { w = Math.round((w * MAX) / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("canvas fail")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("toBlob fail"));
        }, "image/jpeg", 0.8);
      };
      img.onerror = () => reject(new Error("image load fail"));
      img.src = URL.createObjectURL(file);
    });
  }

  // Photo page + AI 검색어 캐시
  const photoPage = useRef(1);
  const [cachedQuery, setCachedQuery] = useState<string | null>(null);

  // English + download + text color
  const [englishText, setEnglishText] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [dominantColor, setDominantColor] = useState("#808080");
  const [textColorSlider, setTextColorSlider] = useState(0);
  const [fontScale, setFontScale] = useState(100); // 80~140%
  const [verticalPos, setVerticalPos] = useState(50);
  const [cardRatio, setCardRatio] = useState<"4/5" | "9/16">("4/5");
  const [overlayStrength, setOverlayStrength] = useState(0); // 0~100% (0=원본 사진 그대로)

  // 텍스트 인라인 편집 (한글/영문 본문, 레퍼런스는 자동 유지)
  const [textEditMode, setTextEditMode] = useState(false);
  const [editedKorean, setEditedKorean] = useState<string | null>(null);
  const [editedEnglish, setEditedEnglish] = useState<string | null>(null);

  const koreanText = verses.map((v) => stripNotes(v.text)).join(" ");
  const firstVerse = verses[0];
  // 연속 절은 범위(1-3), 비연속은 쉼표(1,2,6)로 표시
  const formatVerseNums = (nums: number[]): string => {
    if (nums.length === 0) return "";
    if (nums.length === 1) return `${nums[0]}`;
    const sorted = [...nums].sort((a, b) => a - b);
    const ranges: string[] = [];
    let start = sorted[0], end = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === end + 1) { end = sorted[i]; }
      else { ranges.push(start === end ? `${start}` : `${start}-${end}`); start = sorted[i]; end = sorted[i]; }
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    return ranges.join(",");
  };
  // 책+장 단위로 그룹화하여 레퍼런스 생성
  // 예: 욥 17:7 + 요 14:27 → "욥기 17장 7절. 요한복음 14장 27절."
  const refGroups: { book_code: string; book_name: string; chapter: number; verses: number[] }[] = [];
  const sortedVerses = [...verses].sort((a, b) => {
    if (a.book_order !== b.book_order) return a.book_order - b.book_order;
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    return a.verse - b.verse;
  });
  for (const v of sortedVerses) {
    const last = refGroups[refGroups.length - 1];
    if (last && last.book_code === v.book_code && last.chapter === v.chapter) {
      last.verses.push(v.verse);
    } else {
      refGroups.push({ book_code: v.book_code, book_name: v.book_name, chapter: v.chapter, verses: [v.verse] });
    }
  }
  const koreanRef = refGroups
    .map((g) => `${g.book_name} ${g.chapter}장 ${formatVerseNums(g.verses)}절`)
    .join(". ");
  const englishRef = refGroups
    .map((g) => {
      const b = getBookByCode(g.book_code);
      return b ? `${b.nameEn} ${g.chapter}:${formatVerseNums(g.verses)}` : "";
    })
    .filter(Boolean)
    .join("; ");
  const keywords = extractKeywords(koreanText);
  const fontCss =
    FONT_OPTIONS.find((f) => f.key === selectedFont)?.css || FONT_OPTIONS[0].css;

  // verses 변경 시 편집 내용 리셋 (원본이 바뀌므로 편집도 무효)
  useEffect(() => {
    setEditedKorean(null);
    setEditedEnglish(null);
    setTextEditMode(false);
  }, [koreanText]);

  // 0. English verse
  useEffect(() => {
    async function loadEnglish() {
      if (subVersion === "none") {
        setEnglishText("");
        return;
      }
      const promises = verses.map((v) =>
        supabase
          .from("bible_verses")
          .select("text")
          .eq("version", subVersion)
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
  }, [verses, subVersion]);

  // 1. Gradients — 5개
  useEffect(() => {
    setGradients(findGradients(koreanText, 6));
  }, [koreanText]);

  // 2. Unsplash — 6장 (AI 검색어 → fallback 정적 매핑)
  async function fetchPhotos(page?: number) {
    setPhotoLoading(true);
    try {
      // 캐시된 검색어가 있으면 재사용, 없으면 AI 생성
      let query = cachedQuery;
      if (!query) {
        try {
          const suggestRes = await fetch("/api/unsplash/suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ verseText: koreanText }),
          });
          if (suggestRes.ok) {
            const { query: aiQuery } = await suggestRes.json();
            query = aiQuery;
          }
        } catch { /* AI 실패 → fallback */ }
        if (!query) query = getUnsplashQuery(keywords, koreanText);
        setCachedQuery(query);
      }

      const p = page ?? photoPage.current;
      const res = await fetch(
        `/api/unsplash?query=${encodeURIComponent(query)}&per_page=6&page=${p}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.length > 0) {
          setPhotos(data);
          setSelectedPhotoIdx(0);
        }
      }
    } catch {
      /* silent */
    } finally {
      setPhotoLoading(false);
    }
  }

  useEffect(() => {
    if (activeCard !== "photo" || photos.length > 0) return;
    fetchPhotos(1);
  }, [activeCard, photos.length, keywords]);

  function refreshPhotos() {
    photoPage.current += 1;
    fetchPhotos(photoPage.current);
  }

  // 3. Upload — 팝업에서 모드 선택 후 파일 선택
  function triggerUpload(mode: "as-is" | "remove-text") {
    pendingUploadMode.current = mode;
    setShowUploadPopup(false);
    fileInputRef.current?.click();
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("5MB 이하의 사진을 선택해 주세요");
      e.target.value = "";
      return;
    }

    // 같은 파일 재선택 허용
    e.target.value = "";

    setCleaningImage(true);
    try {
      // 1. 리사이즈 (긴 변 1200px, JPEG 80%)
      let blob: Blob = file;
      try {
        blob = await resizeImage(file);
      } catch { /* 리사이즈 실패 시 원본 사용 */ }

      // 2. 글자지움 모드면 AI 편집 — 실패 시 명시적 알림 후 업로드 중단
      if (pendingUploadMode.current === "remove-text") {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        try {
          const base64 = dataUrl.split(",")[1];
          const mimeMatch = dataUrl.match(/data:([^;]+);/);
          const mediaType = mimeMatch?.[1] || "image/jpeg";
          const res = await fetch("/api/upload/clean", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: base64, media_type: mediaType }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `AI 응답 오류 (${res.status})`);
          }
          const { data, media_type } = await res.json();
          if (!data) throw new Error("AI 응답에 이미지 데이터가 없습니다");
          const b64 = atob(data);
          const arr = new Uint8Array(b64.length);
          for (let i = 0; i < b64.length; i++) arr[i] = b64.charCodeAt(i);
          blob = new Blob([arr], { type: media_type });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[remove-text]", msg);
          alert(`글자 제거 AI 호출 실패\n\n${msg}\n\n원본 그대로 사용하려면 '그냥' 옵션을 선택하세요.`);
          return; // 원본을 업로드하지 않음 — 사용자가 다시 선택하도록
        }
      }

      // 3. 서버 업로드
      const form = new FormData();
      form.append("file", blob, `upload.${blob.type === "image/png" ? "png" : "jpg"}`);
      const res = await fetch("/api/photos", { method: "POST", body: form });
      if (res.ok) {
        const { photo } = await res.json();
        setUploads((prev) => {
          const next = [...prev, { id: photo.id, dataUrl: photo.public_url }];
          setSelectedUploadIdx(next.length - 1);
          return next;
        });
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "업로드 실패");
      }
    } finally {
      setCleaningImage(false);
    }
  }

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
    const oTop = (overlayStrength / 100).toFixed(2);
    const oBot = overlayStrength === 0 ? "0" : (Math.min(overlayStrength + 15, 100) / 100).toFixed(2);
    cardStyle = {
      backgroundImage: `linear-gradient(rgba(0,0,0,${oTop}), rgba(0,0,0,${oBot})), url(${selectedPhoto.url})`,
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
  } else if (activeCard === "upload" && uploads.length > 0) {
    const sel = uploads[selectedUploadIdx] ?? uploads[0];
    const oTop = (overlayStrength / 100).toFixed(2);
    const oBot = overlayStrength === 0 ? "0" : (Math.min(overlayStrength + 15, 100) / 100).toFixed(2);
    cardStyle = {
      backgroundImage: `linear-gradient(rgba(0,0,0,${oTop}), rgba(0,0,0,${oBot})), url(${sel.dataUrl})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
    textColorClass = "text-white";
  }

  const isLoading =
    (activeCard === "photo" && photoLoading) ||
    (activeCard === "ai" && aiLoading) ||
    (activeCard === "upload" && cleaningImage);

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
        defaultSlider = 0;
        setOverlayStrength(30);
      } else if (activeCard === "ai" && currentAi) {
        if (currentAi.type === "image" && currentAi.imageDataUrl) {
          color = await extractImageColor(currentAi.imageDataUrl);
          defaultSlider = 0;
        } else if (currentAi.gradient) {
          color = extractGradientColor(currentAi.gradient);
          defaultSlider = currentAi.textColor === "dark" ? 100 : 0;
        }
      } else if (activeCard === "upload" && uploads.length > 0) {
        const sel = uploads[selectedUploadIdx] ?? uploads[0];
        color = await extractImageColor(sel.dataUrl);
        defaultSlider = 0;
        setOverlayStrength(15);
      }

      setDominantColor(color);
      setTextColorSlider(defaultSlider);
    }
    updateDominant();
  }, [activeCard, selectedGradientIdx, selectedPhotoIdx, currentAi, uploads, selectedUploadIdx]);

  // 슬라이더 기반 텍스트 색상
  const userTextColor = sliderToColor(textColorSlider, dominantColor);

  // PNG Download
  const handleDownload = async () => {
    if (!cardRef.current) return;
    // 다운로드 전 편집모드 OFF — textarea 대신 <p>로 렌더되어야 깔끔한 PNG
    if (textEditMode) setTextEditMode(false);
    setDownloading(true);
    try {
      await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 100)); // 렌더 안정화
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

  // PNG 저장 및 스크랩 연동
  const handleScrapAndDownload = async () => {
    if (!cardRef.current) return;
    // 다운로드 전 편집모드 OFF
    if (textEditMode) setTextEditMode(false);
    setDownloading(true);
    try {
      await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 100)); // 렌더 안정화
      const el = cardRef.current;
      const ratio = 1080 / el.offsetWidth;
      const dataUrl = await toPng(el, {
        pixelRatio: ratio,
        cacheBust: true,
      });
      
      // 1. DataURL을 Blob으로 변환
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      
      // 2. Storage 업로드
      const form = new FormData();
      form.append("file", blob, `card.png`);
      const uploadRes = await fetch("/api/scrap/image", { method: "POST", body: form });
      
      let imageUrl = undefined;
      if (uploadRes.ok) {
        const data = await uploadRes.json();
        imageUrl = data.url;
      }
      
      // 3. 서버 스크랩 저장 (이미지 URL 포함)
      await addScrapToServer(verses, mainVersion, imageUrl);
      
      // 4. 로컬 다운로드도 병행 실행
      const link = document.createElement("a");
      link.download = `yebom-card-${firstVerse.book_code}${firstVerse.chapter}.png`;
      link.href = dataUrl;
      link.click();
      
      alert("카드가 갤러리에 저장되고 앱 스크랩에도 추가되었습니다!");
    } catch (err) {
      console.error("Scrap & Download failed:", err);
      alert("저장 중 오류가 발생했습니다.");
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
      <div className="flex gap-1 mb-2 bg-gray-50 p-1 rounded-xl">
        <button onClick={() => setActiveCard("gradient")} className={tabClass("gradient")}>
          그라데이션
        </button>
        <button onClick={() => setActiveCard("photo")} className={tabClass("photo")}>
          사진 배경
        </button>
        <button onClick={() => setActiveCard("upload")} className={tabClass("upload")}>
          내 사진
        </button>
        {/* AI 아트 — 퀄리티 개선 후 재활성화 */}
      </div>

      {/* 텍스트 편집 토글 + 원본 복원 */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <button
          onClick={() => setTextEditMode((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            textEditMode
              ? "bg-amber-50 border-amber-300 text-amber-700"
              : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
          title="카드 텍스트를 편집 (줄바꿈·오타 수정)"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
          </svg>
          {textEditMode ? "편집 중" : "텍스트 편집"}
        </button>
        {(editedKorean !== null || editedEnglish !== null) && (
          <button
            onClick={() => { setEditedKorean(null); setEditedEnglish(null); }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
            title="편집 전 원본으로 복원"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
            원본 복원
          </button>
        )}
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

      {/* Card preview + vertical position slider — 모바일에서 슬라이더 보이도록 오른쪽 여백 */}
      <div className="relative mr-9 lg:mr-0">
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
            {/* Korean verse (편집 모드면 textarea) */}
            {textEditMode ? (
              <textarea
                value={editedKorean ?? koreanText}
                onChange={(e) => setEditedKorean(e.target.value)}
                rows={Math.max(2, Math.ceil((editedKorean ?? koreanText).length / 24))}
                className="w-full text-xl leading-[1.9] text-center mb-3 bg-transparent border-0 focus:outline-none resize-none"
                style={{
                  fontFamily: fontCss,
                  fontSize: `${fontScale}%`,
                  wordBreak: "keep-all",
                  color: "inherit",
                  outline: "1px dashed currentColor",
                  outlineOffset: "6px",
                  borderRadius: "2px",
                }}
              />
            ) : (
              <p
                className="text-xl leading-[1.9] text-center mb-3"
                style={{
                  fontFamily: fontCss,
                  fontSize: `${fontScale}%`,
                  wordBreak: "keep-all",
                  overflowWrap: "break-word",
                  textWrap: "balance" as never,
                  whiteSpace: "pre-wrap",
                }}
              >
                {editedKorean ?? koreanText}
              </p>
            )}

            {/* Korean ref */}
            <p className="text-sm opacity-80 font-semibold mb-5" style={{ fontSize: `${fontScale * 0.7}%` }}>{koreanRef}</p>

            {/* English verse (편집 모드면 textarea) */}
            {(editedEnglish ?? englishText) && (
              textEditMode ? (
                <textarea
                  value={editedEnglish ?? englishText}
                  onChange={(e) => setEditedEnglish(e.target.value)}
                  rows={Math.max(2, Math.ceil((editedEnglish ?? englishText).length / 35))}
                  className="w-full text-base font-[family-name:var(--font-playfair)] italic opacity-60 text-center leading-relaxed mb-2 bg-transparent border-0 focus:outline-none resize-none"
                  style={{
                    fontSize: `${fontScale * 0.85}%`,
                    wordBreak: "keep-all",
                    color: "inherit",
                    outline: "1px dashed currentColor",
                    outlineOffset: "6px",
                    borderRadius: "2px",
                  }}
                />
              ) : (
              <p
                className="text-base font-[family-name:var(--font-playfair)] italic opacity-60 text-center leading-relaxed mb-2"
                style={{ fontSize: `${fontScale * 0.85}%`, wordBreak: "keep-all", textWrap: "balance" as never, whiteSpace: "pre-wrap" }}
              >
                {editedEnglish ?? englishText}
              </p>
              )
            )}

            {/* English ref */}
            <p className="text-xs font-[family-name:var(--font-playfair)] opacity-50" style={{ fontSize: `${fontScale * 0.6}%` }}>
              {englishRef}
            </p>
          </div>
        )}

        {/* Watermark — 배경 대비 자동 색상 */}
        {!isLoading && (() => {
          const dr = parseInt(dominantColor.slice(1, 3), 16) || 128;
          const dg = parseInt(dominantColor.slice(3, 5), 16) || 128;
          const db = parseInt(dominantColor.slice(5, 7), 16) || 128;
          const brightness = (dr * 299 + dg * 587 + db * 114) / 1000;
          const wmColor = brightness > 128 ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.6)";
          return (
            <div
              className="absolute bottom-4 right-5 font-[family-name:var(--font-playfair)] italic text-sm"
              style={{ color: wmColor }}
            >
              Yebom Bible Card
            </div>
          );
        })()}

        {/* Attribution */}
        {!isLoading && creditLine && (
          <div className="absolute bottom-4 left-5" style={{ color: "white" }}>
            {creditLine}
          </div>
        )}
      </div>

      {/* Vertical position slider — 모바일은 카드 내부 우측, PC는 카드 외부 */}
      <div className="absolute right-2 top-2 bottom-2 lg:-right-8 lg:top-0 lg:bottom-0 flex flex-col items-center justify-between py-2 lg:py-3 w-6 bg-white/30 backdrop-blur-sm rounded-full lg:bg-transparent lg:backdrop-blur-none lg:rounded-none">
        <svg className="w-3 h-3 text-gray-700 lg:text-gray-300" viewBox="0 0 12 12" fill="currentColor"><path d="M6 2 L1 8 L11 8 Z" /></svg>
        <input
          type="range"
          min={0}
          max={100}
          value={verticalPos}
          onChange={(e) => setVerticalPos(Number(e.target.value))}
          className="h-full w-1.5 appearance-none cursor-pointer bg-gray-200/70 lg:bg-gray-200 rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-gray-700 lg:[&::-webkit-slider-thumb]:bg-gray-500 [&::-webkit-slider-thumb]:rounded-full"
          style={{ writingMode: "vertical-lr" }}
          aria-label="텍스트 상하 위치"
        />
        <svg className="w-3 h-3 text-gray-700 lg:text-gray-300" viewBox="0 0 12 12" fill="currentColor"><path d="M6 10 L1 4 L11 4 Z" /></svg>
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

      {/* Photo thumbnails + 새로고침 */}
      {activeCard === "photo" && photos.length > 1 && (
        <div className="flex gap-2 mt-3 justify-center items-center">
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
          <button
            onClick={refreshPhotos}
            disabled={photoLoading}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
            title="다른 사진 보기"
          >
            <svg className={`w-4 h-4 ${photoLoading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      )}

      {/* Upload — 썸네일 + 사진 추가 버튼 */}
      {activeCard === "upload" && (
        <div className="mt-3 space-y-2">
          {/* hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* 썸네일 가로 스크롤 */}
          {uploads.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1 justify-start">
              {uploads.map((img, i) => (
                <div key={img.id} className="relative shrink-0">
                  <button
                    onClick={() => setSelectedUploadIdx(i)}
                    className={`w-12 h-12 rounded-lg overflow-hidden border-2 transition-all ${
                      i === selectedUploadIdx
                        ? "border-gray-900 scale-110"
                        : "border-transparent opacity-60 hover:opacity-80"
                    }`}
                  >
                    <img src={img.dataUrl} alt="" className="w-full h-full object-cover" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm("이 사진을 삭제하시겠습니까?")) return;
                      // 서버에서 삭제 (UUID가 아닌 경우 무시)
                      if (img.id && img.id.length === 36) {
                        try {
                          await fetch(`/api/photos?id=${img.id}`, { method: "DELETE" });
                        } catch { /* silent */ }
                      }
                      setUploads((prev) => prev.filter((_, idx) => idx !== i));
                      setSelectedUploadIdx((prev) => Math.max(0, Math.min(prev, uploads.length - 2)));
                    }}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gray-600 text-white rounded-full flex items-center justify-center text-[9px] leading-none hover:bg-gray-800 transition-colors"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 사진 추가 버튼 / 글자 제거 중 표시 */}
          {cleaningImage ? (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-gray-400">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              글자 제거 중...
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={() => setShowUploadPopup(!showUploadPopup)}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                사진 추가
              </button>

              {/* 팝업: 그냥 | 글자지움 */}
              {showUploadPopup && (
                <div className="absolute z-50 left-0 right-0 bottom-full mb-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                  <button
                    onClick={() => triggerUpload("as-is")}
                    className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5A1.5 1.5 0 003.75 21z" />
                    </svg>
                    그냥 사용
                  </button>
                  <button
                    onClick={() => triggerUpload("remove-text")}
                    className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50 border-t border-gray-100 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    글자 지우고 사용
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 빈 상태 안내 */}
          {uploads.length === 0 && !cleaningImage && (
            <p className="text-center text-xs text-gray-300 py-2">
              사진을 추가하면 카드 배경으로 사용됩니다
            </p>
          )}
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

        {/* Row 3: 오버레이 — 사진/업로드 모드에서만 */}
        {(activeCard === "photo" || activeCard === "upload") && (
          <div className="col-span-2">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-gray-400">어둡기</p>
              <p className="text-xs text-gray-400">{overlayStrength}%</p>
            </div>
            <input
              type="range"
              min={0}
              max={70}
              value={overlayStrength}
              onChange={(e) => setOverlayStrength(Number(e.target.value))}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-gray-700 [&::-webkit-slider-thumb]:rounded-full"
            />
          </div>
        )}
      </div>

      {/* Download */}
      <div className="mt-5 flex gap-2">
        <button
          onClick={handleScrapAndDownload}
          disabled={isLoading || downloading}
          className="flex-1 py-3 bg-[var(--amber)] text-white rounded-xl text-sm font-semibold shadow-lg hover:bg-[var(--amber-deep)] disabled:opacity-50 transition-colors"
        >
          {downloading ? "처리 중..." : "저장 및 앱 스크랩"}
        </button>
        <button
          onClick={handleDownload}
          disabled={isLoading || downloading}
          className="flex-1 py-3 bg-gray-900 text-white rounded-xl text-sm font-semibold shadow-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {downloading ? "처리 중..." : "그냥 다운로드만"}
        </button>
      </div>
    </div>
  );
}
