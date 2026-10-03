// apps/web/next.config.ts (SPEC §14.1)
import type { NextConfig } from "next";

/**
 * Anti-framing (clickjacking): a cross-site page must not be able to frame the local app and trick the user into one-click
 * actions (cost-gate approval, fair-use acknowledgement, demo, job starts). X-Frame-Options goes on every response (pages,
 * API, the proxy-exempt upload route). The CSP goes on pages only: a next.config header REPLACES a header the route sets,
 * and the API routes that serve documents (media, teleprompter) send their own sandbox CSP, frame-ancestors included.
 */
export const ANTI_FRAMING_HEADERS: readonly { key: string; value: string }[] = [{ key: "X-Frame-Options", value: "DENY" }];
export const PAGE_CSP_SOURCE = "/((?!api(?:/|$)).*)";
export const PAGE_CSP_HEADERS: readonly { key: string; value: string }[] = [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }];

const config: NextConfig = {
  transpilePackages: [
    "@docmaker/core", "@docmaker/styles", "@docmaker/remotion", "@docmaker/engine", "@docmaker/llm", "@docmaker/assets",
    "@docmaker/voice", "@docmaker/audio", "@docmaker/director", "@docmaker/export",
  ],
  serverExternalPackages: ["sharp", "sherpa-onnx-node", "@remotion/install-whisper-cpp", "linkedom"],
  typescript: { ignoreBuildErrors: true }, // `pnpm typecheck` is the type gate
  async headers() {
    return [
      { source: "/:path*", headers: [...ANTI_FRAMING_HEADERS] },
      { source: PAGE_CSP_SOURCE, headers: [...PAGE_CSP_HEADERS] },
    ];
  },
};
export default config;
