import { defineConfig } from "vitest/config";

/** Specialist-owned harness; the frozen root config intentionally targets foundation tests only. */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/audio/**/*.test.ts",
      "src/fx/**/*.test.ts",
      "src/haptics/**/*.test.ts",
    ],
  },
});
