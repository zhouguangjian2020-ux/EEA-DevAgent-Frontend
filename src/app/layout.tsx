import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "天枢 · 研发工作空间",
  description: "TS Agent platform一期交互式前端原型",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}

