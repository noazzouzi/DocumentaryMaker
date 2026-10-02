// apps/web/next.config.ts (SPEC §14.1)
import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: [
    "@docmaker/core", "@docmaker/styles", "@docmaker/remotion", "@docmaker/engine", "@docmaker/llm", "@docmaker/assets",
    "@docmaker/voice", "@docmaker/audio", "@docmaker/director", "@docmaker/export",
  ],
  serverExternalPackages: ["sharp", "sherpa-onnx-node", "@remotion/install-whisper-cpp", "linkedom"],
  typescript: { ignoreBuildErrors: true }, // `pnpm typecheck` is the type gate
};
export default config;
