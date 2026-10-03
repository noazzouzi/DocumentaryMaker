// apps/web/next.config.ts (SPEC §14.1)
import type { NextConfig } from "next";

/**
 * Anti-framing on every response (pages, API, the proxy-exempt upload route): a cross-site page must not be able to
 * frame the local app and clickjack one-click actions (cost-gate approval, fair-use acknowledgement, demo, job starts).
 */
export const ANTI_FRAMING_HEADERS: readonly { key: string; value: string }[] = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const config: NextConfig = {
  transpilePackages: [
    "@docmaker/core", "@docmaker/styles", "@docmaker/remotion", "@docmaker/engine", "@docmaker/llm", "@docmaker/assets",
    "@docmaker/voice", "@docmaker/audio", "@docmaker/director", "@docmaker/export",
  ],
  serverExternalPackages: ["sharp", "sherpa-onnx-node", "@remotion/install-whisper-cpp", "linkedom"],
  typescript: { ignoreBuildErrors: true }, // `pnpm typecheck` is the type gate
  async headers() {
    return [{ source: "/:path*", headers: [...ANTI_FRAMING_HEADERS] }];
  },
};
export default config;
