import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Compass LLM",
  description: "On-premise LLM 운영 콘솔",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
