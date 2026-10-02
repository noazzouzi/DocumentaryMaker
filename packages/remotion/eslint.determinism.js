// packages/remotion/eslint.determinism.js — determinism rules for Remotion code (SPEC §10.9). Exported as
// "@docmaker/remotion/lint"; the root eslint.config.js imports it by RELATIVE path.
export default [{
  files: ["packages/remotion/src/**/*.{ts,tsx}", "packages/remotion/hero/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-properties": ["error",
      { object: "Math", property: "random", message: "Use random(seed) from 'remotion' or rngFor()." },
      { object: "Date", property: "now", message: "No wall clock in frames." },
      { object: "performance", property: "now", message: "No wall clock in frames." }],
    "no-restricted-globals": ["error", "setTimeout", "setInterval", "requestAnimationFrame", "localStorage",
      "sessionStorage", "XMLHttpRequest", "WebSocket"],
    "no-restricted-syntax": ["error",
      { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "No wall clock." },
      { selector: "Property[key.name=/^(transition|transitionDuration|animation|animationName|animationDuration|willChange)$/]",
        message: "No CSS transitions/animations/will-change: derive every value from useCurrentFrame()." },
      { selector: "CallExpression[callee.name='fetch']", message: "No render-time network (only useTimeline/calculateMetadata)." },
      { selector: "CallExpression[callee.name='useState']", message: "Frames are pure functions of the frame." }],
    "no-restricted-imports": ["error", { paths: ["gsap", "p5", "three", "@remotion/gsap", "@remotion/google-fonts", "@docmaker/core/node"],
      patterns: ["node:*"] }],
  },
}, { files: ["packages/remotion/src/data/useTimeline.ts", "packages/remotion/src/Root.tsx", "packages/remotion/src/fonts/FontGate.tsx", "packages/remotion/src/fonts/styleFonts.ts"],
     rules: { "no-restricted-syntax": "off" } }];
