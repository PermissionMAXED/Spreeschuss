import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/minigames/carrot-catch/**/*.test.ts",
      "src/minigames/bunny-hop/**/*.test.ts",
      "src/minigames/pancake-peak/**/*.test.ts",
    ],
  },
});
