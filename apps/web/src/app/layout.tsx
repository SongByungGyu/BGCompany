import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BG Company · 가상 회사 관제",
  description: "AI 직원들의 업무와 상태를 관리하는 BG Company 관제 시스템",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
