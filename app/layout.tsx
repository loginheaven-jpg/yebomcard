import type { Metadata, Viewport } from "next";
import {
  Noto_Sans_KR,
  Noto_Serif_KR,
  Gothic_A1,
  Gowun_Dodum,
  IBM_Plex_Sans_KR,
  Playfair_Display,
} from "next/font/google";
import "./globals.css";
import VersionCheck from "@/components/VersionCheck";
import PwaInstall from "@/components/PwaInstall";

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-noto-sans-kr",
});

const notoSerifKr = Noto_Serif_KR({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-noto-serif-kr",
});

const gothicA1 = Gothic_A1({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-gothic-a1",
});

const gowunDodum = Gowun_Dodum({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-gowun-dodum",
});

const ibmPlexSansKr = IBM_Plex_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex",
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
});

export const metadata: Metadata = {
  title: "예봄성경 | Yebom Bible Card",
  description: "성경 말씀을 아름다운 이미지 카드로 만들어 보세요",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "예봄성경",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#1A2B3C",
};

import { FontProvider } from "@/contexts/FontContext";
import { TtsProvider } from "@/contexts/TtsContext";
import TTSMiniPlayer from "@/components/TTSMiniPlayer";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${notoSansKr.variable} ${notoSerifKr.variable} ${gothicA1.variable} ${gowunDodum.variable} ${ibmPlexSansKr.variable} ${playfairDisplay.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-gothic-a1)] bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <FontProvider>
          <TtsProvider>
            {children}
            <TTSMiniPlayer />
          </TtsProvider>
          <VersionCheck />
          <PwaInstall />
        </FontProvider>
      </body>
    </html>
  );
}
