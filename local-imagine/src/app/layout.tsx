import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local Imagine",
  description: "ローカル LLM + ComfyUI で動く画像生成スタジオ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
