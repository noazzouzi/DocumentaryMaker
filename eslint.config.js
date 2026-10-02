// Root ESLint flat config (SPEC §2.4). `pnpm lint` = eslint . --max-warnings=0 (a P3 gate).
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import remotionPlugin from "@remotion/eslint-plugin";
import determinism from "./packages/remotion/eslint.determinism.js"; // RELATIVE path (§10.9)

const NODE_BUILTINS = ["fs", "path", "child_process", "crypto", "os"];
const builtinPaths = NODE_BUILTINS.map((name) => ({ name, message: "Browser-reachable code: Node built-ins are banned." }));
const nodePattern = { group: ["node:*"], message: "Browser-reachable code: node:* imports are banned (they break bundle() and Turbopack)." };

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**", "**/.next/**", "projects/**", "python/**", "fixtures/**", "**/dist/**", ".turbo/**",
      "**/next-env.d.ts", "**/test-results/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  // P0 API stubs keep the §4.19 signatures verbatim: their parameters are unused until the owner implements them.
  {
    files: ["packages/*/src/index.ts", "packages/remotion/src/compute/index.ts"],
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },

  // The §4 contract files are verbatim copies of the verified contract: never "fix" them for lint.
  {
    files: ["packages/core/src/schema/**/*.ts", "packages/core/src/interfaces.ts"],
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },

  // ---- @docmaker/core: zod + relative imports only; node:* only under src/node
  {
    files: ["packages/core/src/**/*.ts"],
    ignores: ["packages/core/src/node/**"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: builtinPaths,
        patterns: [nodePattern, { regex: "^(?!zod$)(?!\\.{1,2}/)", message: "@docmaker/core may import only zod and relative paths." }],
      }],
    },
  },
  {
    files: ["packages/core/src/node/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ regex: "^(?!zod$)(?!node:)(?!\\.{1,2}/)", message: "@docmaker/core/node may import only zod, node:* and relative paths." }],
      }],
    },
  },

  // ---- @docmaker/remotion: determinism rules + Remotion plugin; browser-safe
  ...determinism,
  {
    files: ["packages/remotion/src/**/*.{ts,tsx}"],
    plugins: { "@remotion": remotionPlugin },
    rules: {
      ...remotionPlugin.configs.recommended.rules,
      // union of the determinism import bans and the browser-safety bans (flat config does not merge rule options)
      "no-restricted-imports": ["error", {
        paths: [
          ...["gsap", "p5", "three", "@remotion/gsap", "@remotion/google-fonts"].map((name) => ({ name, message: "Banned in Remotion code (§10.9)." })),
          { name: "@docmaker/core/node", message: "Remotion code is browser code." },
          ...builtinPaths,
        ],
        patterns: [nodePattern],
      }],
    },
  },

  // ---- apps/web
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    settings: { next: { rootDir: "apps/web/" } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...reactHooks.configs.flat["recommended-latest"].rules,
    },
  },
  {
    files: ["apps/web/src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          ...builtinPaths,
          ...["@docmaker/render", "@remotion/bundler", "@remotion/renderer", "@docmaker/core/node"].map((name) => ({ name, message: "Client components must not import Node-only packages (§14.1)." })),
        ],
        patterns: [nodePattern],
      }],
    },
  },
);
