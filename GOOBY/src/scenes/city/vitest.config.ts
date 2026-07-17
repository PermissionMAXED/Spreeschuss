import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/scenes/city/**/*.test.ts", "src/data/city/**/*.test.ts"],
  },
});
