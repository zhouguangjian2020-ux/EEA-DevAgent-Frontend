import type { Metadata } from "next";
import "./globals.css";
import "@/components/feedback/loading.css";
import { I18nProvider } from "@/features/i18n/provider";

export const metadata: Metadata = {
  title: "天枢 · 研发工作空间",
  description: "TS Agent platform一期交互式前端原型",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><I18nProvider>{children}</I18nProvider></body></html>;
}

