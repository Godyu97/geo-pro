import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "GeoPro · GEO 品牌可见度监测与优化平台",
    template: "%s · GeoPro",
  },
  description:
    "面向中国大陆品牌经营者，以真实回答和可核验证据，连接品牌可见度观察与内容优化。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">
        <a href="#main-content" className="skip-link">
          跳转到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
