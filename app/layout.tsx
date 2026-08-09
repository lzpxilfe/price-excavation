import type { Metadata, Viewport } from "next";
import "./globals.css";

const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const metadataBase = new URL(configuredSiteUrl ?? "https://github.com/lzpxilfe/price-excavation");
const socialImageUrl = configuredSiteUrl
  ? new URL("/og-v2.png", metadataBase)
  : new URL("https://raw.githubusercontent.com/lzpxilfe/price-excavation/main/public/og-v2.png");

export const metadata: Metadata = {
  metadataBase,
  title: "발굴 현장 계산기 — 토공·공기·단가 추정",
  description:
    "측량 체적부터 덤프 운반, 조사 공기, 날씨와 현장 실적까지 한 번에 계산하는 로컬 우선 발굴 현장 도구",
  applicationName: "발굴 현장 계산기",
  keywords: ["발굴", "매장유산", "토공", "체적", "덤프트럭", "공기", "견적"],
  openGraph: {
    type: "website",
    locale: "ko_KR",
    title: "발굴 현장 계산기 — 토량·운반·공기를 한 번에",
    description: "측량 체적부터 덤프 운반, 조사 공기와 현장 실적까지 연결하는 로컬 우선 계산기",
    images: [{ url: socialImageUrl, width: 1200, height: 630, alt: "발굴 현장 계산기" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "발굴 현장 계산기 — 토량·운반·공기를 한 번에",
    description: "측량 체적부터 덤프 운반, 조사 공기와 현장 실적까지 연결하는 로컬 우선 계산기",
    images: [socialImageUrl],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#173d3b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
