import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/minigames/bubble-bath-blast/logic.test.ts",
      "src/minigames/veggie-sort/logic.test.ts",
      "src/minigames/gooby-says/logic.test.ts",
      "src/minigames/bubble-bath-blast/manifests.test.ts",
    ],
  },
});
