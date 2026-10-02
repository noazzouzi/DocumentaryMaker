// Root layout (P0 skeleton; W11 replaces it). Self-hosted fonts come from @docmaker/remotion/fonts (never Google Fonts).
import type React from "react";
import "@docmaker/remotion/fonts";
import "./globals.css";

export const metadata = { title: "DocumentaryMaker", description: "Long-form narrated documentaries from an idea." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
