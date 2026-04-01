"use client";

import { useState, useCallback } from "react";
import SearchPanel from "@/components/SearchPanel";
import VerseDisplay from "@/components/VerseDisplay";
import CardPreview from "@/components/CardPreview";
import type { BibleVerse, ViewMode } from "@/lib/types";

export default function Home() {
  const [selectedVerses, setSelectedVerses] = useState<BibleVerse[]>([]);
  const [view, setView] = useState<ViewMode>("search");
  const [isAddingMore, setIsAddingMore] = useState(false);

  const handleToggleVerse = useCallback((verse: BibleVerse) => {
    setSelectedVerses((prev) => {
      const exists = prev.some(
        (v) =>
          v.book_code === verse.book_code &&
          v.chapter === verse.chapter &&
          v.verse === verse.verse &&
          v.version === verse.version
      );
      if (exists) {
        return prev.filter(
          (v) =>
            !(
              v.book_code === verse.book_code &&
              v.chapter === verse.chapter &&
              v.verse === verse.verse &&
              v.version === verse.version
            )
        );
      }
      return [...prev, verse];
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setView("display");
    setIsAddingMore(false);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedVerses([]);
    setIsAddingMore(false);
    setView("search");
  }, []);

  const handleAddMore = useCallback(() => {
    setIsAddingMore(true);
    setView("search");
  }, []);

  const handleRemoveVerse = useCallback((verse: BibleVerse) => {
    setSelectedVerses((prev) => {
      const next = prev.filter(
        (v) =>
          !(
            v.book_code === verse.book_code &&
            v.chapter === verse.chapter &&
            v.verse === verse.verse &&
            v.version === verse.version
          )
      );
      if (next.length === 0) {
        setView("search");
        setIsAddingMore(false);
      }
      return next;
    });
  }, []);

  const handleCreateCard = useCallback(() => {
    setView("card");
  }, []);

  const handleBackToDisplay = useCallback(() => {
    setView("display");
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      {view === "card" ? (
        <CardPreview
          verses={selectedVerses}
          onBack={handleBackToDisplay}
        />
      ) : view === "display" ? (
        <VerseDisplay
          verses={selectedVerses}
          onBack={handleBack}
          onAddMore={handleAddMore}
          onRemoveVerse={handleRemoveVerse}
          onCreateCard={handleCreateCard}
        />
      ) : (
        <SearchPanel
          selectedVerses={selectedVerses}
          onToggleVerse={handleToggleVerse}
          onConfirm={handleConfirm}
          isAddingMore={isAddingMore}
        />
      )}
    </main>
  );
}
