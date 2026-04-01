import type { Metadata } from "next";
import { Noto_Serif_KR, Gothic_A1, Gowun_Dodum, Gowun_Batang, Playfair_Display } from "next/font/google";
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

const gowunDodum = Gowun_Dodum({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-gowun-dodum",
});

const gowunBatang = Gowun_Batang({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-gowun-batang",
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
});

export const metadata: Metadata = {
  title: "예봄카드 | Yebom Card",
  description: "성경 말씀을 아름다운 이미지 카드로 만들어 보세요",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${notoSerifKr.variable} ${gothicA1.variable} ${gowunDodum.variable} ${gowunBatang.variable} ${playfairDisplay.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-gothic-a1)]">
        {children}
      </body>
    </html>
  );
}
