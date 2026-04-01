import type { Metadata } from "next";
import {
  Noto_Serif_KR,
  Gothic_A1,
  Playfair_Display,
} from "next/font/google";
import "./globals.css";

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

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
});

export const metadata: Metadata = {
  title: "예봄카드 | Yebom Card",
  description: "말씀을 품은 카드, 은혜를 담은 이미지",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${notoSerifKr.variable} ${gothicA1.variable} ${playfairDisplay.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-gothic-a1)]">
        {children}
      </body>
    </html>
  );
}
