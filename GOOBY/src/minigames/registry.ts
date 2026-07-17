import type { MinigameFactory } from "../core/contracts/minigame";
import { MINIGAME_IDS, type MinigameId } from "../core/contracts/scenes";
import { definition as bubbleBathBlast } from "./bubble-bath-blast";
import { definition as bunnyHop } from "./bunny-hop";
import { definition as carrotCannon, createMinigame as createCarrotCannon } from "./carrot-cannon";
import { definition as carrotCatch } from "./carrot-catch";
import { definition as deliveryDash, createMinigame as createDeliveryDash } from "./delivery-dash";
import { definition as gardenMoles, createMinigame as createGardenMoles } from "./garden-moles";
import { definition as goobySays } from "./gooby-says";
import { createMemoryMeadow, definition as memoryMeadow } from "./memory-meadow";
import { definition as pancakePeak } from "./pancake-peak";
import { createPondFishing, definition as pondFishing } from "./pond-fishing";
import { createRhythmHop, definition as rhythmHop } from "./rhythm-hop";
import type { MinigameStubDefinition } from "./stub";
import { definition as veggieSort } from "./veggie-sort";

export const MINIGAME_DEFINITIONS = [
  carrotCatch,
  bunnyHop,
  pancakePeak,
  bubbleBathBlast,
  veggieSort,
  goobySays,
  gardenMoles,
  carrotCannon,
  deliveryDash,
  memoryMeadow,
  pondFishing,
  rhythmHop,
] as const satisfies readonly MinigameStubDefinition[];

export const MINIGAME_REGISTRY: ReadonlyMap<MinigameId, MinigameFactory> = new Map(
  [
    [carrotCatch.id, carrotCatch.create],
    [bunnyHop.id, bunnyHop.create],
    [pancakePeak.id, pancakePeak.create],
    [bubbleBathBlast.id, bubbleBathBlast.create],
    [veggieSort.id, veggieSort.create],
    [goobySays.id, goobySays.create],
    [gardenMoles.id, createGardenMoles],
    [carrotCannon.id, createCarrotCannon],
    [deliveryDash.id, createDeliveryDash],
    [memoryMeadow.id, createMemoryMeadow],
    [pondFishing.id, createPondFishing],
    [rhythmHop.id, createRhythmHop],
  ],
);

if (
  MINIGAME_REGISTRY.size !== MINIGAME_IDS.length ||
  MINIGAME_DEFINITIONS.length !== MINIGAME_IDS.length
) {
  throw new Error("Every minigame contract requires exactly one specialist-owned module");
}
