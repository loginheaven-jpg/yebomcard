"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { parseReference, type ParsedReference } from "@/lib/parseReference";
import { getBookByCode } from "@/lib/books";
import { stripNotes, type BibleVerse, type BibleVersion } from "@/lib/types";
import FullscreenReader, { type FullscreenVerseItem } from "./FullscreenReader";

interface WorshipBibleProps {
  onClose: () => void;
}

interface WorshipSlot {
  name: string;
  input: string;
}

interface ParsedItem {
  ref: ParsedReference;
  verses: BibleVerse[];
  label: string; // "요한복음 2장 1절"
}

const STORAGE_KEY = "yebom_worship_lists";
const CURRENT_KEY = "yebom_worship_current";
const MAX_SLOTS = 10;

// ─── 입력 문자열을 개별 레퍼런스 토큰으로 분리 ───
// 규칙: 세미콜론은 항상 구분. 쉼표/스페이스 뒤에 한글이면 새 구절.
function splitReferences(input: string): string[] {
  // 세미콜론으로 먼저 분리
  const segments = input.split(";").map((s) => s.trim()).filter(Boolean);
  const tokens: string[] = [];

  for (const seg of segments) {
    // 쉼표 또는 스페이스 뒤에 한글이 오는 지점에서 분리
    const parts = seg.split(/[,\s]+(?=[가-힣])/).map((s) => s.trim()).filter(Boolean);
    tokens.push(...parts);
  }
  return tokens;
}

// ─── 절 범위 포맷 ───
function formatVerseRange(verses: number[]): string {
  if (verses.length === 0) return "";
  const sorted = [...verses].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) end = sorted[i];
    else { ranges.push(start === end ? `${start}` : `${start}-${end}`); start = sorted[i]; end = sorted[i]; }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(",");
}

export default function WorshipBible({ onClose }: WorshipBibleProps) {
  const [input, setInput] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(CURRENT_KEY) || "";
  });
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState<BibleVersion>("rnksv");
  const [parallel, setParallel] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [altVerseMap, setAltVerseMap] = useState<Map<string, string>>(new Map());

  // 프레젠테이션 모드
  const presentChannel = useRef<BroadcastChannel | null>(null);
  const presentWindow = useRef<Window | null>(null);
  const [presentActive, setPresentActive] = useState(false);
  const [presentIdx, setPresentIdx] = useState(0);
  const [showMonitorPicker, setShowMonitorPicker] = useState(false);

  // 프레젠테이션 설정 (보조 모니터에 전송)
  type FontKey = "noto-serif" | "noto-sans" | "gowun-dodum" | "gothic-a1" | "ibm-plex";
  const FONT_LABELS: { key: FontKey; label: string }[] = [
    { key: "noto-serif", label: "명조" }, { key: "noto-sans", label: "고딕" },
    { key: "gowun-dodum", label: "돋움" }, { key: "gothic-a1", label: "Gothic" },
    { key: "ibm-plex", label: "Plex" },
  ];
  const defaultFont = (v: BibleVersion): FontKey => v === "nkrv" ? "noto-serif" : "gowun-dodum";
  const [pFontKey, setPFontKey] = useState<FontKey>(() => {
    if (typeof window === "undefined") return defaultFont(version);
    return (localStorage.getItem("fullscreenFont") as FontKey) || defaultFont(version);
  });
  const [pFontSize, setPFontSize] = useState(() => {
    if (typeof window === "undefined") return 74;
    return parseInt(localStorage.getItem("fullscreenFontSize") || "74");
  });
  const [pTheme, setPTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("fullscreenTheme") as "light" | "dark") || "light";
  });
  const [showPFontPicker, setShowPFontPicker] = useState(false);

  // 병기: parallel 토글 시 alt 버전 fetch
  useEffect(() => {
    if (!parallel || parsedItems.length === 0) { setAltVerseMap(new Map()); return; }
    const altVersion = version === "nkrv" ? "rnksv" : "nkrv";
    (async () => {
      const map = new Map<string, string>();
      for (const item of parsedItems) {
        let q = supabase.from("bible_verses").select("*")
          .eq("version", altVersion).eq("book_code", item.ref.bookCode).eq("chapter", item.ref.chapter);
        if (item.ref.verses.length > 0) q = q.in("verse", item.ref.verses);
        const { data } = await q.order("verse");
        if (data) {
          for (const v of data as BibleVerse[]) {
            map.set(`${v.book_code}-${v.chapter}-${v.verse}`, stripNotes(v.text));
          }
        }
      }
      setAltVerseMap(map);
    })();
  }, [parallel, version, parsedItems]);

  // 슬롯 관리
  const [slots, setSlots] = useState<WorshipSlot[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
  });
  const [showSlotMenu, setShowSlotMenu] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

  // 자동저장 (입력 변경마다)
  useEffect(() => {
    try { localStorage.setItem(CURRENT_KEY, input); } catch {}
  }, [input]);

  // 슬롯 저장
  function saveSlot() {
    const name = saveName.trim() || new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short" });
    const next = [{ name, input }, ...slots.filter((s) => s.name !== name)].slice(0, MAX_SLOTS);
    setSlots(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    setShowSaveInput(false);
    setSaveName("");
  }

  function loadSlot(slot: WorshipSlot) {
    setInput(slot.input);
    setShowSlotMenu(false);
  }

  function deleteSlot(name: string) {
    const next = slots.filter((s) => s.name !== name);
    setSlots(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  }

  // ─── 구절 파싱 + DB 조회 ───
  async function handleParse() {
    if (!input.trim()) return;
    setLoading(true);
    setParsedItems([]);
    setParseErrors([]);

    const tokens = splitReferences(input);
    const items: ParsedItem[] = [];
    const errors: string[] = [];

    for (const token of tokens) {
      const parsed = parseReference(token);
      if (!parsed) {
        errors.push(token);
        continue;
      }

      const book = getBookByCode(parsed.bookCode);
      if (!book) { errors.push(token); continue; }

      let query = supabase
        .from("bible_verses")
        .select("*")
        .eq("version", version)
        .eq("book_code", parsed.bookCode)
        .eq("chapter", parsed.chapter);

      if (parsed.verses.length > 0) {
        query = query.in("verse", parsed.verses);
      }

      const { data } = await query.order("verse");
      if (data && data.length > 0) {
        const verseNums = data.map((v: BibleVerse) => v.verse);
        const range = formatVerseRange(verseNums);
        items.push({
          ref: parsed,
          verses: data as BibleVerse[],
          label: `${book.nameKr} ${parsed.chapter}장 ${range}절`,
        });
      } else {
        errors.push(token);
      }
    }

    setParsedItems(items);
    setParseErrors(errors);
    setLoading(false);
  }

  // ─── 버전 변경 시 re-fetch ───
  async function refetchAllItems(newVersion: BibleVersion) {
    setVersion(newVersion);
    if (parsedItems.length === 0) return;
    const updated: ParsedItem[] = [];
    for (const item of parsedItems) {
      let query = supabase
        .from("bible_verses")
        .select("*")
        .eq("version", newVersion)
        .eq("book_code", item.ref.bookCode)
        .eq("chapter", item.ref.chapter);
      if (item.ref.verses.length > 0) query = query.in("verse", item.ref.verses);
      const { data } = await query.order("verse");
      if (data && data.length > 0) {
        updated.push({ ...item, verses: data as BibleVerse[] });
      }
    }
    setParsedItems(updated);
  }

  // ─── 풀스크린에서 구절 추가 (onAddVerses 콜백) ───
  async function handleAddFromFullscreen(inputStr: string) {
    const tokens = splitReferences(inputStr);
    const newItems: ParsedItem[] = [];
    for (const token of tokens) {
      const parsed = parseReference(token);
      if (!parsed) continue;
      const book = getBookByCode(parsed.bookCode);
      if (!book) continue;
      let query = supabase
        .from("bible_verses")
        .select("*")
        .eq("version", version)
        .eq("book_code", parsed.bookCode)
        .eq("chapter", parsed.chapter);
      if (parsed.verses.length > 0) query = query.in("verse", parsed.verses);
      const { data } = await query.order("verse");
      if (data && data.length > 0) {
        const verseNums = data.map((v: BibleVerse) => v.verse);
        newItems.push({
          ref: parsed,
          verses: data as BibleVerse[],
          label: `${book.nameKr} ${parsed.chapter}장 ${formatVerseRange(verseNums)}절`,
        });
      }
    }
    if (newItems.length > 0) setParsedItems((prev) => [...prev, ...newItems]);
  }

  // ─── 프레젠테이션 모드 ───
  const FONTS_MAP: Record<string, { css: string; weight: number }> = {
    "noto-serif": { css: "var(--font-noto-serif-kr), 'Noto Serif KR', serif", weight: 600 },
    "noto-sans": { css: "var(--font-noto-sans-kr), 'Noto Sans KR', sans-serif", weight: 700 },
    "gowun-dodum": { css: "var(--font-gowun-dodum), 'Gowun Dodum', sans-serif", weight: 400 },
    "gothic-a1": { css: "var(--font-gothic-a1), 'Gothic A1', sans-serif", weight: 600 },
    "ibm-plex": { css: "var(--font-ibm-plex), 'IBM Plex Sans KR', sans-serif", weight: 600 },
  };

  const allVerses = parsedItems.flatMap((item) => item.verses);

  function sendToPresent(
    idx: number,
    overrides?: { fontKey?: FontKey; fontSize?: number; theme?: "light" | "dark"; parallel?: boolean; altMap?: Map<string, string> }
  ) {
    if (!presentChannel.current || allVerses.length === 0) return;
    const v = allVerses[idx];
    if (!v) return;
    const fk = overrides?.fontKey ?? pFontKey;
    const font = FONTS_MAP[fk] || FONTS_MAP["noto-serif"];
    const fs = overrides?.fontSize ?? pFontSize;
    const th = overrides?.theme ?? pTheme;
    const par = overrides?.parallel ?? parallel;
    const aMap = overrides?.altMap ?? altVerseMap;
    presentChannel.current.postMessage({
      type: "verse",
      ref: `${v.book_name} ${v.chapter}장 ${v.verse}절`,
      main: stripNotes(v.text),
      sub: par ? aMap.get(`${v.book_code}-${v.chapter}-${v.verse}`) : undefined,
      fontKey: fk, fontCss: font.css, fontWeight: font.weight,
      fontSize: fs, theme: th, parallel: par,
      subVersionLabel: version === "nkrv" ? "새번역" : "개역개정",
    });
  }

  async function openPresentation() {
    // BroadcastChannel 초기화
    if (!presentChannel.current) {
      presentChannel.current = new BroadcastChannel("yebom-worship");
    }

    // Window Management API 시도 (Chrome/Edge)
    if ("getScreenDetails" in window) {
      try {
        const screenDetails = await (window as unknown as { getScreenDetails: () => Promise<{ screens: Array<{ left: number; top: number; width: number; height: number; label: string; isPrimary: boolean }> }> }).getScreenDetails();
        const screens = screenDetails.screens;
        const secondary = screens.find((s) => !s.isPrimary) || screens[screens.length - 1];
        presentWindow.current = window.open(
          "/present",
          "yebom-present",
          `left=${secondary.left},top=${secondary.top},width=${secondary.width},height=${secondary.height}`
        );
      } catch {
        // 권한 거부 또는 에러 → 기본 window.open
        presentWindow.current = window.open("/present", "yebom-present", "width=1024,height=768");
      }
    } else {
      presentWindow.current = window.open("/present", "yebom-present", "width=1024,height=768");
    }

    if (presentWindow.current) {
      setPresentActive(true);
      setPresentIdx(0);
      // 창 로드 후 첫 구절 전송
      setTimeout(() => sendToPresent(0), 1000);
      // 창 닫힘 감지
      const checkClosed = setInterval(() => {
        if (presentWindow.current?.closed) {
          clearInterval(checkClosed);
          setPresentActive(false);
        }
      }, 1000);
    }
  }

  function presentGo(delta: number) {
    const next = Math.max(0, Math.min(allVerses.length - 1, presentIdx + delta));
    setPresentIdx(next);
    sendToPresent(next);
  }

  function presentJump(idx: number) {
    setPresentIdx(idx);
    sendToPresent(idx);
  }

  // 프레젠테이션 종료
  function closePresentation() {
    presentChannel.current?.postMessage({ type: "close" });
    presentWindow.current?.close();
    setPresentActive(false);
  }

  // 메인 창 키보드 + 프레젠테이션 창에서 키 전달 수신
  useEffect(() => {
    if (!presentActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); presentGo(-1); }
      else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); presentGo(1); }
      else if (e.key === "Escape") closePresentation();
    };
    window.addEventListener("keydown", onKey);

    // 프레젠테이션 창에서 키 이벤트 수신
    const ch = presentChannel.current;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "key") {
        if (e.data.key === "ArrowLeft" || e.data.key === "PageUp") presentGo(-1);
        else if (e.data.key === "ArrowRight" || e.data.key === "PageDown" || e.data.key === " ") presentGo(1);
      }
    };
    ch?.addEventListener("message", onMsg);

    return () => {
      window.removeEventListener("keydown", onKey);
      ch?.removeEventListener("message", onMsg);
    };
  });

  // ─── 풀스크린 데이터 생성 ───
  const fsVerses: FullscreenVerseItem[] = allVerses.map((v) => ({
    ref: `${v.book_name} ${v.chapter}장 ${v.verse}절`,
    main: stripNotes(v.text),
    sub: parallel ? altVerseMap.get(`${v.book_code}-${v.chapter}-${v.verse}`) : undefined,
  }));

  const jumpRefs = allVerses.map((v) => ({
    book_abbr: v.book_abbr,
    book_code: v.book_code,
    chapter: v.chapter,
    verse: v.verse,
  }));

  // ─── 항목 삭제 ───
  function removeItem(index: number) {
    setParsedItems((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose}>
        <div
          className="absolute inset-x-0 bottom-0 max-h-[90vh] bg-gray-50 rounded-t-2xl overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 pt-2 max-w-[800px] mx-auto">
            {/* 핸들 바 */}
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-3" />

            {/* 헤더 */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-gray-900">예배성경</h2>
              <button
                onClick={onClose}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                닫기
              </button>
            </div>

            {/* 슬롯 불러오기 */}
            <div className="mb-3">
              <div className="relative">
                <button
                  onClick={() => setShowSlotMenu(!showSlotMenu)}
                  className="w-full py-2 px-3 text-left text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center justify-between"
                >
                  <span>{slots.length > 0 ? "저장된 목록 불러오기" : "저장된 목록 없음"}</span>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
                {showSlotMenu && slots.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                    {slots.map((slot) => (
                      <div key={slot.name} className="flex items-center hover:bg-gray-50">
                        <button
                          onClick={() => loadSlot(slot)}
                          className="flex-1 px-3 py-2.5 text-left text-sm text-gray-700"
                        >
                          <span className="font-medium">{slot.name}</span>
                          <span className="block text-xs text-gray-400 mt-0.5 truncate">{slot.input}</span>
                        </button>
                        <button
                          onClick={() => deleteSlot(slot.name)}
                          className="px-3 text-gray-300 hover:text-gray-500"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 입력 영역 */}
            <div className="flex gap-2 mb-2 items-stretch">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleParse(); } }}
                placeholder="요2:1, 신12:10-12, 계10:10,17 요일2:1"
                rows={4}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
              />
              <div className="shrink-0 flex flex-col gap-2 w-24 relative">
                <button
                  onClick={handleParse}
                  disabled={loading || !input.trim()}
                  className="flex-1 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {loading ? "..." : "구절 추가"}
                </button>
                <button
                  onClick={() => setShowSaveInput(true)}
                  disabled={!input.trim()}
                  className="flex-1 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  저장
                </button>
                {showSaveInput && (
                  <div className="absolute z-20 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex gap-1 w-[220px]">
                    <input
                      type="text"
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveSlot();
                        else if (e.key === "Escape") { setShowSaveInput(false); setSaveName(""); }
                      }}
                      placeholder="이름 (예: 주일예배)"
                      className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-400"
                      autoFocus
                    />
                    <button onClick={saveSlot} className="shrink-0 px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg">
                      확인
                    </button>
                  </div>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              쉼표 또는 스페이스로 구분 · 예: 요2:1, 시23:1-6 롬8:28
            </p>

            {/* 파싱 에러 */}
            {parseErrors.length > 0 && (
              <div className="mb-3 p-2 bg-red-50 rounded-lg">
                {parseErrors.map((err, i) => (
                  <p key={i} className="text-xs text-red-500">✗ &ldquo;{err}&rdquo; — 인식 불가</p>
                ))}
              </div>
            )}

            {/* 파싱 결과 리스트 */}
            {parsedItems.length > 0 && (
              <div className="border border-gray-200 rounded-lg mb-3 divide-y divide-gray-100">
                {parsedItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2.5 hover:bg-gray-50">
                    <span className="text-green-500 mt-0.5 shrink-0 text-sm">✓</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">
                        {item.verses.map((v) => stripNotes(v.text)).join(" ").slice(0, 60)}...
                      </p>
                    </div>
                    <button
                      onClick={() => removeItem(i)}
                      className="text-gray-300 hover:text-gray-500 shrink-0 mt-0.5"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 시작 버튼 */}
            {allVerses.length > 0 && !presentActive && (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowFullscreen(true)}
                  className="flex-1 py-3 bg-[#B8860B] text-white rounded-xl text-sm font-semibold shadow-lg hover:bg-[#9A7009] transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m11.25-5.25v4.5m0-4.5h-4.5m4.5 0L15 9m-11.25 11.25v-4.5m0 4.5h4.5m-4.5 0L9 15m11.25 5.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />
                  </svg>
                  풀스크린
                </button>
                <button
                  onClick={openPresentation}
                  className="flex-1 py-3 bg-gray-900 text-white rounded-xl text-sm font-semibold shadow-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z" />
                  </svg>
                  프레젠테이션
                </button>
              </div>
            )}

            {/* 프레젠테이션 컨트롤 패널 */}
            {presentActive && allVerses.length > 0 && (
              <div className="space-y-3 bg-white border border-gray-200 rounded-xl p-4">
                {/* 상단: 페이지 + 이전/다음 + 종료 */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => presentGo(-1)}
                    disabled={presentIdx === 0}
                    className="flex-1 py-3 text-base font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
                  >
                    ←
                  </button>
                  <span className="shrink-0 text-center text-sm text-gray-500 min-w-[60px]">
                    <b className="text-gray-900">{presentIdx + 1}</b> / {allVerses.length}
                  </span>
                  <button
                    onClick={() => presentGo(1)}
                    disabled={presentIdx >= allVerses.length - 1}
                    className="flex-1 py-3 text-base font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
                  >
                    →
                  </button>
                  <button
                    onClick={closePresentation}
                    className="px-3 py-2 text-sm font-medium text-red-500 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    종료
                  </button>
                </div>

                {/* 구절 필 바 */}
                <div className="flex gap-1.5 flex-wrap justify-center max-h-24 overflow-y-auto">
                  {allVerses.map((v, i) => (
                    <button
                      key={`${v.book_code}-${v.chapter}-${v.verse}-${i}`}
                      onClick={() => presentJump(i)}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        i === presentIdx
                          ? "bg-gray-900 text-white border-gray-900"
                          : "text-gray-500 border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      {v.book_abbr}{v.chapter}:{v.verse}
                    </button>
                  ))}
                </div>

                {/* 번역본 + 병기 */}
                <div className="flex gap-1 justify-center">
                  {(["nkrv", "rnksv"] as const).map((bv) => (
                    <button
                      key={bv}
                      onClick={async () => {
                        setVersion(bv);
                        setPFontKey(defaultFont(bv));
                        // 즉석 re-fetch 후 전송
                        const updated: ParsedItem[] = [];
                        for (const item of parsedItems) {
                          let q = supabase.from("bible_verses").select("*")
                            .eq("version", bv).eq("book_code", item.ref.bookCode).eq("chapter", item.ref.chapter);
                          if (item.ref.verses.length > 0) q = q.in("verse", item.ref.verses);
                          const { data } = await q.order("verse");
                          if (data && data.length > 0) updated.push({ ...item, verses: data as BibleVerse[] });
                        }
                        setParsedItems(updated);
                        // 새 데이터로 즉시 전송
                        const newAll = updated.flatMap((it) => it.verses);
                        const idx = Math.min(presentIdx, newAll.length - 1);
                        const nv = newAll[idx];
                        if (nv && presentChannel.current) {
                          const fk = defaultFont(bv);
                          const font = FONTS_MAP[fk] || FONTS_MAP["noto-serif"];
                          presentChannel.current.postMessage({
                            type: "verse",
                            ref: `${nv.book_name} ${nv.chapter}장 ${nv.verse}절`,
                            main: stripNotes(nv.text),
                            sub: parallel ? altVerseMap.get(`${nv.book_code}-${nv.chapter}-${nv.verse}`) : undefined,
                            fontKey: fk, fontCss: font.css, fontWeight: font.weight,
                            fontSize: pFontSize, theme: pTheme, parallel,
                            subVersionLabel: bv === "nkrv" ? "새번역" : "개역개정",
                          });
                        }
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                        version === bv ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
                      }`}
                    >
                      {bv === "nkrv" ? "개역개정" : "새번역"}
                    </button>
                  ))}
                  <button
                    onClick={async () => {
                      const newParallel = !parallel;
                      setParallel(newParallel);
                      if (newParallel && altVerseMap.size === 0) {
                        // 즉석 fetch
                        const altV = version === "nkrv" ? "rnksv" : "nkrv";
                        const map = new Map<string, string>();
                        for (const item of parsedItems) {
                          let q = supabase.from("bible_verses").select("*")
                            .eq("version", altV).eq("book_code", item.ref.bookCode).eq("chapter", item.ref.chapter);
                          if (item.ref.verses.length > 0) q = q.in("verse", item.ref.verses);
                          const { data } = await q.order("verse");
                          if (data) for (const row of data as BibleVerse[]) map.set(`${row.book_code}-${row.chapter}-${row.verse}`, stripNotes(row.text));
                        }
                        setAltVerseMap(map);
                        sendToPresent(presentIdx, { parallel: true, altMap: map });
                      } else {
                        sendToPresent(presentIdx, { parallel: newParallel });
                      }
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                      parallel ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
                    }`}
                  >
                    병기
                  </button>
                </div>

                {/* 폰트 + 크기 + 다크모드 */}
                <div className="flex items-center gap-3 justify-center">
                  {/* 다크/라이트 */}
                  <button
                    onClick={() => { const t = pTheme === "dark" ? "light" : "dark"; setPTheme(t); localStorage.setItem("fullscreenTheme", t); sendToPresent(presentIdx, { theme: t }); }}
                    className="px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
                  >
                    {pTheme === "dark" ? "☀ Light" : "☾ Dark"}
                  </button>

                  <span className="w-px h-3 bg-gray-200" />

                  {/* 폰트 선택 */}
                  <div className="relative">
                    <button
                      onClick={() => setShowPFontPicker(!showPFontPicker)}
                      className="px-2.5 py-1 text-xs text-gray-500 border border-gray-200 rounded-full hover:bg-gray-50 transition-colors"
                    >
                      {FONT_LABELS.find((f) => f.key === pFontKey)?.label || "명조"}
                    </button>
                    {showPFontPicker && (
                      <div className="absolute z-10 bottom-full mb-1 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-lg shadow-lg p-1 min-w-[100px]">
                        {FONT_LABELS.map((f) => (
                          <button
                            key={f.key}
                            onClick={() => { setPFontKey(f.key); setShowPFontPicker(false); localStorage.setItem("fullscreenFont", f.key); sendToPresent(presentIdx, { fontKey: f.key }); }}
                            className={`w-full px-3 py-1.5 text-xs text-left rounded-md transition-colors ${
                              pFontKey === f.key ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <span className="w-px h-3 bg-gray-200" />

                  {/* 폰트 크기 */}
                  <div className="flex items-center gap-2">
                    <button onClick={() => { const s = Math.max(40, pFontSize - 6); setPFontSize(s); localStorage.setItem("fullscreenFontSize", String(s)); sendToPresent(presentIdx, { fontSize: s }); }} className="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer">가</button>
                    <input
                      type="range" min={40} max={120} value={pFontSize}
                      onChange={(e) => { const s = Number(e.target.value); setPFontSize(s); localStorage.setItem("fullscreenFontSize", String(s)); sendToPresent(presentIdx, { fontSize: s }); }}
                      className="w-24 h-1 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-gray-700 [&::-webkit-slider-thumb]:rounded-full"
                    />
                    <button onClick={() => { const s = Math.min(120, pFontSize + 6); setPFontSize(s); localStorage.setItem("fullscreenFontSize", String(s)); sendToPresent(presentIdx, { fontSize: s }); }} className="text-sm text-gray-400 hover:text-gray-600 cursor-pointer">가</button>
                  </div>
                </div>
              </div>
            )}

            {parsedItems.length === 0 && !loading && (
              <p className="text-center text-xs text-gray-300 py-6">
                구절을 입력하고 &ldquo;구절 추가&rdquo;를 누르세요
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 풀스크린 리더 */}
      {showFullscreen && fsVerses.length > 0 && (
        <FullscreenReader
          verses={fsVerses}
          version={version}
          onVersionChange={refetchAllItems}
          parallel={parallel}
          onParallelToggle={() => setParallel(!parallel)}
          onClose={() => setShowFullscreen(false)}
          jumpMode
          jumpRefs={jumpRefs}
          hideVersionButtons={false}
          onAddVerses={handleAddFromFullscreen}
        />
      )}
    </>
  );
}
