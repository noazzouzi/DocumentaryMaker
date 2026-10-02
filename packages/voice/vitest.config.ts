import { defineProject } from "vitest/config";
export default defineProject({ test: { name: "voice", include: ["test/**/*.test.ts?(x)"], environment: "node", passWithNoTests: true } });
