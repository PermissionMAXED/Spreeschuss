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
import { definition as carrotCannon, createMinigame as createCarrotCannon } from "./carrot-cannon";
import { definition as carrotCatch, manifest as carrotCatchManifest } from "./carrot-catch";
import {
  createMinigame as createCloudBounce,
  definition as cloudBounce,
  manifest as cloudBounceManifest,
} from "./cloud-bounce";
import { definition as deliveryDash, createMinigame as createDeliveryDash } from "./delivery-dash";
import {
  createMinigame as createFireflyLantern,
  definition as fireflyLantern,
  manifest as fireflyLanternManifest,
} from "./firefly-lantern";
import { definition as gardenMoles, createMinigame as createGardenMoles } from "./garden-moles";
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
 * The six deepened launch specialists export their own final manifests; the
 * frozen hub unlock gates must stay byte-identical to the launch layout.
 */
const DEEPENED_LAUNCH_MANIFESTS: readonly MinigameManifest[] = [
  carrotCatchManifest,
  bunnyHopManifest,
  pancakePeakManifest,
  bubbleBathBlastManifest,
  veggieSortManifest,
  goobySaysManifest,
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
    id: "garden-moles",
    category: "action",
    audioCues: ["go", "hit", "miss", "combo", "countdown", "score", "lose", "win"],
    unlockLevel: LAUNCH_UNLOCK_LEVELS[6],
    tutorial: [
      {
        icon: "🌱",
        title: { en: "Shoo the moles", de: "Verscheuche die Maulwürfe" },
        body: {
          en: "Tap moles the moment they pop out of their burrows.",
          de: "Tippe Maulwürfe an, sobald sie aus ihren Höhlen schauen.",
        },
      },
      {
        icon: "🐇",
        title: { en: "Spare the friends", de: "Verschone die Freunde" },
        body: {
          en: "Bunny friends peek out too. Tapping them costs garden points.",
          de: "Auch Hasenfreunde schauen heraus. Sie anzutippen kostet Gartenpunkte.",
        },
      },
    ],
  }),
  launchManifest({
    id: "carrot-cannon",
    category: "skill",
    audioCues: ["go", "hit", "miss", "combo", "countdown", "score", "lose", "win"],
    unlockLevel: LAUNCH_UNLOCK_LEVELS[7],
    tutorial: [
      {
        icon: "✹",
        title: { en: "Aim the cannon", de: "Ziele mit der Kanone" },
        body: {
          en: "Drag to aim, release to launch bouncy carrots at the picnic targets.",
          de: "Ziehe zum Zielen und lass los, um Hüpfkarotten auf die Picknick-Ziele zu schießen.",
        },
      },
      {
        icon: "✦",
        title: { en: "Bank the bounces", de: "Nutze die Abpraller" },
        body: {
          en: "Carrots bounce off walls. Trick shots hit distant targets for more points.",
          de: "Karotten prallen von Wänden ab. Trickschüsse treffen ferne Ziele für mehr Punkte.",
        },
      },
    ],
  }),
  launchManifest({
    id: "delivery-dash",
    category: "action",
    audioCues: ["go", "hit", "miss", "combo", "countdown", "score", "lose", "win"],
    unlockLevel: LAUNCH_UNLOCK_LEVELS[8],
    tutorial: [
      {
        icon: "▣",
        title: { en: "Deliver the parcels", de: "Liefere die Pakete aus" },
        body: {
          en: "Steer through town and drop each parcel at its glowing doorstep.",
          de: "Steuere durch die Stadt und lege jedes Paket vor der leuchtenden Haustür ab.",
        },
      },
      {
        icon: "⏱",
        title: { en: "Beat the clock", de: "Schlage die Uhr" },
        body: {
          en: "Fast, tidy deliveries earn time bonuses before the route ends.",
          de: "Schnelle, saubere Lieferungen bringen Zeitboni, bevor die Route endet.",
        },
      },
    ],
  }),
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
          en: "Turn over two cards at a time to hunt for matching flowers.",
          de: "Decke zwei Karten gleichzeitig auf und suche passende Blumenpaare.",
        },
      },
      {
        icon: "✦",
        title: { en: "Remember the meadow", de: "Merke dir die Wiese" },
        body: {
          en: "Fewer flips mean a bigger bloom bonus at the end.",
          de: "Weniger Versuche bedeuten am Ende einen größeren Blütenbonus.",
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
        icon: "≈",
        title: { en: "Wait for a nibble", de: "Warte auf ein Anbeißen" },
        body: {
          en: "Cast the line and watch the bobber. Patience lures the shiniest fish.",
          de: "Wirf die Angel aus und beobachte den Schwimmer. Geduld lockt die glänzendsten Fische.",
        },
      },
      {
        icon: "✦",
        title: { en: "Reel in gently", de: "Kurbel sanft ein" },
        body: {
          en: "Tap right when the bobber dips to reel the catch in gently.",
          de: "Tippe genau dann, wenn der Schwimmer eintaucht, um den Fang sanft einzuholen.",
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
        title: { en: "Feel the beat", de: "Fühle den Takt" },
        body: {
          en: "Notes glide toward the glowing line. Hop exactly on the beat.",
          de: "Noten gleiten auf die leuchtende Linie zu. Hüpfe genau im Takt.",
        },
      },
      {
        icon: "✦",
        title: { en: "Light the meadow", de: "Erleuchte die Wiese" },
        body: {
          en: "Perfect hops light up the meadow and multiply your score.",
          de: "Perfekte Sprünge erleuchten die Wiese und vervielfachen deine Punkte.",
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
