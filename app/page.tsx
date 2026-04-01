"use client";

import { useState } from "react";
import SearchPanel from "@/components/SearchPanel";
import VerseDisplay from "@/components/VerseDisplay";
import type { BibleVerse } from "@/lib/types";

export default function Home() {
  const [selectedVerse, setSelectedVerse] = useState<BibleVerse | null>(null);

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      {selectedVerse ? (
        <VerseDisplay
          verse={selectedVerse}
          onBack={() => setSelectedVerse(null)}
        />
      ) : (
        <SearchPanel onVerseSelect={setSelectedVerse} />
      )}
    </main>
  );
}
