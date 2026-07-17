import type { MinigameFactory } from "../core/contracts/minigame";
import { MINIGAME_IDS, type MinigameId } from "../core/contracts/scenes";
import { definition as bubbleBathBlast } from "./bubble-bath-blast";
import { definition as bunnyHop } from "./bunny-hop";
import { definition as carrotCannon } from "./carrot-cannon";
import { definition as carrotCatch } from "./carrot-catch";
import { definition as deliveryDash } from "./delivery-dash";
import { definition as gardenMoles } from "./garden-moles";
import { definition as goobySays } from "./gooby-says";
import { definition as memoryMeadow } from "./memory-meadow";
import { definition as pancakePeak } from "./pancake-peak";
import { definition as pondFishing } from "./pond-fishing";
import { definition as rhythmHop } from "./rhythm-hop";
import { SpecialistMinigameStub, type MinigameStubDefinition } from "./stub";
import { definition as veggieSort } from "./veggie-sort";

const DEFINITIONS = [
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
  DEFINITIONS.map((definition) => [definition.id, () => new SpecialistMinigameStub(definition)]),
);

if (MINIGAME_REGISTRY.size !== MINIGAME_IDS.length) {
  throw new Error("Every minigame contract requires exactly one specialist-owned module");
}
