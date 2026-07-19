import {
  createMinigameLifecycle,
  type MinigameSettlementReceipt,
} from "../../core/contracts/minigame";
import { SeededRng } from "../../core/contracts/rng";
import { createMinigame } from "./index";

const mount = document.querySelector<HTMLElement>("#game");
if (!mount) throw new Error("Puddle Hopper harness mount missing");

let clockMs = 0;
let bestScore = 0;
const receipts = new Map<string, MinigameSettlementReceipt>();
const lifecycle = createMinigameLifecycle(
  "puddle-hopper",
  { now: () => clockMs },
  {
    getBestScore: () => bestScore,
    getSettlement: (runId) => receipts.get(runId) ?? null,
    settle: (receipt) => {
      const existing = receipts.get(receipt.runId);
      if (existing) return existing;
      receipts.set(receipt.runId, receipt);
      bestScore = Math.max(bestScore, receipt.bestScore);
      return receipt;
    },
  },
  {
    emit: (event) => {
      if (event.kind === "run-completed") {
        document.body.dataset.settlements = String(receipts.size);
      }
    },
  },
);
const game = createMinigame();
void game.mount({
  clock: { now: () => clockMs },
  rng: new SeededRng(42),
  mount,
  lifecycle,
  finish: () => {
    throw new Error("Lifecycle-aware harness must not use legacy finish");
  },
});
game.start();

let previous = performance.now();
const tick = (timestamp: number): void => {
  const delta = Math.min(0.1, Math.max(0, (timestamp - previous) / 1_000));
  previous = timestamp;
  clockMs += delta * 1_000;
  game.update(delta);
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
