import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/minigames/memory-meadow/**/*.test.ts"],
  },
});
