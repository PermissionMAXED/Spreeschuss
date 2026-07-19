import {
  validateMinigameManifest,
  type MinigameAudioCue,
  type MinigameCategory,
  type MinigameFactory,
  type MinigameManifest,
  type MinigameTutorialStep,
} from "../core/contracts/minigame";
import { MINIGAME_IDS, type MinigameId } from "../core/contracts/scenes";
import { EN_CATALOG, localizedText } from "../i18n";
import {
  createMinigame as createBurrowDig,
  definition as burrowDig,
  manifest as burrowDigManifest,
} from "./burrow-dig";
import {
  definition as bubbleBathBlast,
  manifest as bubbleBathBlastManifest,
} from "./bubble-bath-blast";
import { definition as bunnyHop, manifest as bunnyHopManifest } from "./bunny-hop";
import {
  createMinigame as createCakeAtelier,
  definition as cakeAtelier,
  manifest as cakeAtelierManifest,
} from "./cake-atelier";
import {
  createMinigame as createCarrotCannon,
  definition as carrotCannon,
  manifest as carrotCannonManifest,
} from "./carrot-cannon";
import { definition as carrotCatch, manifest as carrotCatchManifest } from "./carrot-catch";
import {
  createMinigame as createCloudBounce,
  definition as cloudBounce,
  manifest as cloudBounceManifest,
} from "./cloud-bounce";
import {
  createMinigame as createDeliveryDash,
  definition as deliveryDash,
  manifest as deliveryDashManifest,
} from "./delivery-dash";
import {
  createMinigame as createFireflyLantern,
  definition as fireflyLantern,
  manifest as fireflyLanternManifest,
} from "./firefly-lantern";
import {
  createMinigame as createGardenMoles,
  definition as gardenMoles,
  manifest as gardenMolesManifest,
} from "./garden-moles";
import { definition as goobySays, manifest as goobySaysManifest } from "./gooby-says";
import {
  createMinigame as createHoneyDrizzle,
  definition as honeyDrizzle,
  manifest as honeyDrizzleManifest,
} from "./honey-drizzle";
import {
  createMinigame as createLibraryStack,
  definition as libraryStack,
  manifest as libraryStackManifest,
} from "./library-stack";
import {
  createMinigame as createMarketScales,
  definition as marketScales,
  manifest as marketScalesManifest,
} from "./market-scales";
import { createMemoryMeadow, definition as memoryMeadow } from "./memory-meadow";
import { definition as pancakePeak, manifest as pancakePeakManifest } from "./pancake-peak";
import {
  createMinigame as createPicnicPacker,
  definition as picnicPacker,
  manifest as picnicPackerManifest,
} from "./picnic-packer";
import { createPondFishing, definition as pondFishing } from "./pond-fishing";
import {
  createMinigame as createPuddleHopper,
  definition as puddleHopper,
  manifest as puddleHopperManifest,
} from "./puddle-hopper";
import { createRhythmHop, definition as rhythmHop } from "./rhythm-hop";
import {
  createMinigame as createShoppingSurf,
  definition as shoppingSurf,
  manifest as shoppingSurfManifest,
} from "./shopping-surf";
import {
  createMinigame as createSnailMail,
  definition as snailMail,
  manifest as snailMailManifest,
} from "./snail-mail";
import type { MinigameStubDefinition } from "./stub";
import {
  createMinigame as createTopiaryTrim,
  definition as topiaryTrim,
  manifest as topiaryTrimManifest,
} from "./topiary-trim";
import { definition as veggieSort, manifest as veggieSortManifest } from "./veggie-sort";

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
  cakeAtelier,
  shoppingSurf,
  picnicPacker,
  fireflyLantern,
  puddleHopper,
  marketScales,
  burrowDig,
  cloudBounce,
  snailMail,
  topiaryTrim,
  honeyDrizzle,
  libraryStack,
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
    [cakeAtelier.id, createCakeAtelier],
    [shoppingSurf.id, createShoppingSurf],
    [picnicPacker.id, createPicnicPacker],
    [fireflyLantern.id, createFireflyLantern],
    [puddleHopper.id, createPuddleHopper],
    [marketScales.id, createMarketScales],
    [burrowDig.id, createBurrowDig],
    [cloudBounce.id, createCloudBounce],
    [snailMail.id, createSnailMail],
    [topiaryTrim.id, createTopiaryTrim],
    [honeyDrizzle.id, createHoneyDrizzle],
    [libraryStack.id, createLibraryStack],
  ],
);

/** Frozen level gates matching the launch hub layout; expansion games open at level one. */
const LAUNCH_UNLOCK_LEVELS = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7] as const;

interface LaunchManifestSpec {
  readonly id: MinigameId;
  readonly category: MinigameCategory;
  readonly audioCues: readonly MinigameAudioCue[];
  readonly tutorial: readonly MinigameTutorialStep[];
  readonly unlockLevel: number;
}

/** Launch manifests reuse the typed catalog copy so titles stay in parity. */
function launchManifest(spec: LaunchManifestSpec): MinigameManifest {
  return validateMinigameManifest({
    id: spec.id,
    title: localizedText((catalog) => catalog.minigames[spec.id].title),
    instructions: localizedText((catalog) => catalog.minigames[spec.id].instructions),
    icon: EN_CATALOG.minigames[spec.id].icon,
    category: spec.category,
    stage3d: false,
    tutorial: spec.tutorial,
    audioCues: spec.audioCues,
    unlockLevel: spec.unlockLevel,
  });
}

/**
 * The nine deepened launch specialists export their own final manifests; the
 * frozen hub unlock gates must stay byte-identical to the launch layout.
 */
const DEEPENED_LAUNCH_MANIFESTS: readonly MinigameManifest[] = [
  carrotCatchManifest,
  bunnyHopManifest,
  pancakePeakManifest,
  bubbleBathBlastManifest,
  veggieSortManifest,
  goobySaysManifest,
  gardenMolesManifest,
  carrotCannonManifest,
  deliveryDashManifest,
];
if (
  DEEPENED_LAUNCH_MANIFESTS.some(
    (manifest, index) => manifest.unlockLevel !== LAUNCH_UNLOCK_LEVELS[index],
  )
) {
  throw new Error("Deepened launch manifests must keep the frozen hub unlock levels");
}

const LAUNCH_MANIFESTS: readonly MinigameManifest[] = [
  ...DEEPENED_LAUNCH_MANIFESTS,
  launchManifest({
    id: "memory-meadow",
    category: "puzzle",
    audioCues: ["go", "hit", "miss", "combo", "countdown", "win"],
    unlockLevel: LAUNCH_UNLOCK_LEVELS[9],
    tutorial: [
      {
        icon: "❀",
        title: { en: "Flip the flowers", de: "Drehe die Blumen um" },
        body: {
          en: "Turn over two cards at a time to hunt for matching flower pairs.",
          de: "Decke zwei Karten gleichzeitig auf und suche passende Blumenpaare.",
        },
      },
      {
        icon: "🌙",
        title: { en: "Find the glowing trios", de: "Finde die leuchtenden Trios" },
        body: {
          en: "Moonlit Meadow hides glowing trios — match all three glowing cards in a row.",
          de: "Die Mondwiese verbirgt leuchtende Trios — finde alle drei leuchtenden Karten nacheinander.",
        },
      },
      {
        icon: "✦",
        title: { en: "Chain a streak", de: "Bilde eine Serie" },
        body: {
          en: "Chain matches without a miss. Every extra streak match grows your bloom bonus.",
          de: "Reihe Treffer ohne Fehlversuch aneinander. Jeder weitere Serientreffer vergrößert deinen Blütenbonus.",
        },
      },
    ],
  }),
  launchManifest({
    id: "pond-fishing",
    category: "skill",
    audioCues: ["go", "hit", "miss", "combo", "countdown", "win"],
    unlockLevel: LAUNCH_UNLOCK_LEVELS[10],
    tutorial: [
      {
        icon: "🎣",
        title: { en: "Cast with care", de: "Wirf mit Bedacht aus" },
        body: {
          en: "Drag the line to a fish shadow. Longer shadows often hide heavier catches.",
          de: "Ziehe die Angel zu einem Fischschatten. Längere Schatten verbergen oft schwerere Fänge.",
        },
      },
      {
        icon: "❗",
        title: { en: "Set the hook", de: "Setze den Haken" },
        body: {
          en: "When the bobber plunges and glows, tap it quickly to hook the fish.",
          de: "Wenn der Schwimmer eintaucht und leuchtet, tippe ihn schnell an, um den Fisch zu haken.",
        },
      },
      {
        icon: "🟢",
        title: { en: "Balance the tension", de: "Halte die Spannung im Griff" },
        body: {
          en: "Hold to reel, release to ease, and keep the needle in green. Tackle and the day-night stock change the posted odds.",
          de: "Halte zum Einholen, lass zum Entspannen los und halte die Nadel im Grünen. Köder und Tag-Nacht-Besatz ändern die angezeigten Chancen.",
        },
      },
    ],
  }),
  launchManifest({
    id: "rhythm-hop",
    category: "rhythm",
    audioCues: ["go", "hit", "miss", "combo", "countdown", "score", "lose", "win"],
    unlockLevel: LAUNCH_UNLOCK_LEVELS[11],
    tutorial: [
      {
        icon: "♫",
        title: { en: "Follow the beat", de: "Folge dem Takt" },
        body: {
          en: "Notes glide down three moonlit lanes toward the glowing hop line near Gooby.",
          de: "Noten gleiten drei mondhelle Bahnen hinab zur leuchtenden Hüpflinie bei Gooby.",
        },
      },
      {
        icon: "🐰",
        title: { en: "Hop and hold", de: "Hüpfen und halten" },
        body: {
          en: "Tap the lane buttons or use A/S/D and the arrows. Notes with a glowing trail are holds — keep the lane held to the end.",
          de: "Tippe die Bahntasten oder nutze A/S/D und die Pfeile. Noten mit Leuchtspur sind Haltenoten — halte die Bahn bis zum Ende gedrückt.",
        },
      },
      {
        icon: "✦",
        title: { en: "Sparkle the combo", de: "Lass die Combo funkeln" },
        body: {
          en: "Dead-center hits sparkle for extra points; misses reset the combo. Hard mode tightens every timing window.",
          de: "Punktgenaue Treffer funkeln für Extrapunkte; Fehler setzen die Combo zurück. Der harte Modus verengt jedes Zeitfenster.",
        },
      },
    ],
  }),
];

const EXPANSION_MANIFESTS: readonly MinigameManifest[] = [
  cakeAtelierManifest,
  shoppingSurfManifest,
  picnicPackerManifest,
  fireflyLanternManifest,
  puddleHopperManifest,
  marketScalesManifest,
  burrowDigManifest,
  cloudBounceManifest,
  snailMailManifest,
  topiaryTrimManifest,
  honeyDrizzleManifest,
  libraryStackManifest,
];

/** All twenty-four frozen manifests, in canonical `MINIGAME_IDS` order. */
export const MINIGAME_MANIFEST_LIST: readonly MinigameManifest[] = [
  ...LAUNCH_MANIFESTS,
  ...EXPANSION_MANIFESTS,
];

export const MINIGAME_MANIFESTS: ReadonlyMap<MinigameId, MinigameManifest> = new Map(
  MINIGAME_MANIFEST_LIST.map((manifest) => [manifest.id, manifest]),
);

if (
  MINIGAME_REGISTRY.size !== MINIGAME_IDS.length ||
  MINIGAME_DEFINITIONS.length !== MINIGAME_IDS.length ||
  MINIGAME_MANIFESTS.size !== MINIGAME_IDS.length
) {
  throw new Error("Every minigame contract requires exactly one module and manifest");
}
if (MINIGAME_MANIFEST_LIST.some((manifest, index) => manifest.id !== MINIGAME_IDS[index])) {
  throw new Error("Minigame manifests must follow the canonical contract order");
}
