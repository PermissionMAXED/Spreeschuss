import { HOME_ZONE_IDS, type HomeZoneId } from "../../core/contracts/scenes";
import type { GameRenderer, ResourceTracker } from "../../render/renderer";
import { HOME_ZONE_BLUEPRINTS } from "../../data/home";
import { Bathroom } from "./bathroom";
import { Bedroom } from "./bedroom";
import { Garden } from "./garden";
import { Kitchen } from "./kitchen";
import { LivingRoom } from "./living-room";
import type { HomeSceneOptions, HomeZoneScene } from "./base";

export const HOME_ZONE_STUBS: Readonly<Record<HomeZoneId, { readonly title: string; readonly ready: boolean }>> = {
  "living-room": { title: "Living Room", ready: true },
  kitchen: { title: "Sunny Kitchen", ready: true },
  bathroom: { title: "Bubble Bathroom", ready: true },
  bedroom: { title: "Cozy Bedroom", ready: true },
  garden: { title: "Carrot Garden", ready: true },
};

if (Object.keys(HOME_ZONE_STUBS).length !== HOME_ZONE_IDS.length) {
  throw new Error("Every home zone requires a registry entry");
}

export const HOME_PLACES = HOME_ZONE_IDS.map((zone) => ({
  id: HOME_ZONE_BLUEPRINTS[zone].sceneId,
  zone,
  title: HOME_ZONE_BLUEPRINTS[zone].title,
  destination: HOME_ZONE_BLUEPRINTS[zone].destination,
})) as readonly {
  readonly id: `home:${HomeZoneId}`;
  readonly zone: HomeZoneId;
  readonly title: string;
  readonly destination: { readonly kind: "home"; readonly zone: HomeZoneId };
}[];

export function createHomeZone(
  zone: HomeZoneId,
  renderer: GameRenderer,
  tracker: ResourceTracker,
  options: HomeSceneOptions = {},
): HomeZoneScene {
  switch (zone) {
    case "living-room":
      return new LivingRoom(renderer, tracker, options);
    case "kitchen":
      return new Kitchen(renderer, tracker, options);
    case "bathroom":
      return new Bathroom(renderer, tracker, options);
    case "bedroom":
      return new Bedroom(renderer, tracker, options);
    case "garden":
      return new Garden(renderer, tracker, options);
  }
}

export { Bathroom, Bedroom, Garden, Kitchen, LivingRoom };
export {
  configureHomeCamera,
  projectObjectToScreen,
} from "./base";
export type {
  EssentialInteractionTarget,
  HomeEvent,
  HomeSceneOptions,
  HomeViewport,
  ScreenProjection,
  SelectedDecorPlacementRequest,
} from "./base";
export { HomeZoneScene } from "./base";
export * from "./state";
export * from "../../data/home";
