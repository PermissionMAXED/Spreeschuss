import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  MeshStandardMaterial,
  Raycaster,
  Vector2,
  type Mesh,
  type Object3D,
} from "three";
import { RealClock, type Clock } from "../../core/contracts/clock";
import type { AssetLoader } from "../../core/contracts/assets";
import type { GoobyReaction } from "../../core/contracts/gooby";
import type { Gesture } from "../../core/contracts/input";
import type { SaveState } from "../../core/contracts/save";
import {
  type GameScene,
  type HomeZoneId,
  type MinigameId,
  type NormalUiDestination,
  type SceneContext,
} from "../../core/contracts/scenes";
import { ProceduralGooby } from "../../gooby";
import { createProceduralAsset } from "../../render/proc";
import { ResourceTracker, type GameRenderer } from "../../render/renderer";
import { CATALOG_BY_ID, COSMETIC_SLOTS, type CosmeticSlot } from "../../data/catalog";
import { HOME_DECOR_CATALOG, HOME_GRID_SIZE, HOME_ZONE_BLUEPRINTS } from "../../data/home";
import { createCatalogItemModel, createCosmeticModel } from "../shops/visuals";
import {
  persistDecorPlacements,
  petGooby,
  removeDecorPlacement,
  restoreDecorPlacements,
  rotateDecorPlacement,
  upsertDecorPlacement,
  type DecorPlacement,
  type PlacementRequest,
  type PlacementValidation,
} from "./state";

export type HomeEvent =
  | { readonly type: "inventory:opened"; readonly items: Readonly<Record<string, number>> }
  | { readonly type: "need:changed"; readonly need: "hunger" | "energy" | "hygiene" | "fun"; readonly value: number }
  | { readonly type: "home:navigate"; readonly destination: NormalUiDestination }
  | { readonly type: "minigame:selected"; readonly game: MinigameId }
  | { readonly type: "decor:changed"; readonly placements: readonly DecorPlacement[] }
  | { readonly type: "sleep:confirm-wake" }
  | { readonly type: "harvest"; readonly harvested: boolean; readonly remainingToday: number }
  | { readonly type: "toast"; readonly message: string };

export interface HomeSceneOptions {
  readonly clock?: Clock;
  readonly assetLoader?: AssetLoader;
  readonly readSave?: () => SaveState | null;
  readonly writeSave?: (save: SaveState) => void;
  readonly onEvent?: (event: HomeEvent) => void;
  readonly navigate?: (destination: NormalUiDestination) => void;
}

export abstract class HomeZoneScene implements GameScene {
  readonly id: `home:${HomeZoneId}`;
  readonly gooby: ProceduralGooby;
  protected readonly root = new Group();
  protected readonly clock: Clock;
  protected elapsed = 0;
  private readonly resources = new ResourceTracker();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly readSave: () => SaveState | null;
  private readonly writeSave: (save: SaveState) => void;
  private readonly eventHandler: (event: HomeEvent) => void;
  private readonly navigationHandler: (destination: NormalUiDestination) => void;
  private placements: readonly DecorPlacement[];
  private readonly decorObjects = new Map<string, Object3D>();
  private readonly catalogCosmetics = new Map<CosmeticSlot, Object3D>();
  private complete = false;
  private disposed = false;

  protected constructor(
    protected readonly gameRenderer: GameRenderer,
    externalTracker: ResourceTracker,
    readonly zoneId: HomeZoneId,
    options: HomeSceneOptions = {},
  ) {
    this.id = `home:${zoneId}`;
    this.gooby = new ProceduralGooby(options.assetLoader ? { assetLoader: options.assetLoader } : {});
    this.root.name = `home-zone:${zoneId}`;
    this.clock = options.clock ?? new RealClock();
    this.readSave = options.readSave ?? (() => null);
    this.writeSave = options.writeSave ?? (() => undefined);
    this.eventHandler = options.onEvent ?? (() => undefined);
    this.navigationHandler = options.navigate ?? (() => undefined);
    this.placements = restoreDecorPlacements(this.readSave() ?? this.emptySaveForDecor());
    externalTracker.track(this.resources);
    this.applyScenePresentation();
  }

  private emptySaveForDecor(): SaveState {
    return {
      version: 2,
      profile: { name: "Gooby", onboardingComplete: true, createdAt: 0 },
      simulation: {
        needs: { hunger: 0, energy: 0, hygiene: 0, fun: 0 },
        lastSimulatedAt: 0,
        sleep: null,
      },
      economy: { coins: 0, xp: 0, level: 1 },
      inventory: {},
      settings: { muted: false, reducedMotion: false },
    };
  }

  protected finishScene(): void {
    if (this.complete) return;
    this.complete = true;
    const blueprint = HOME_ZONE_BLUEPRINTS[this.zoneId];
    const ambient = new AmbientLight(0xfff1d9, this.zoneId === "bedroom" ? 1.55 : 2.15);
    ambient.name = `${this.zoneId}:ambient`;
    const key = new DirectionalLight(0xfff2d6, this.zoneId === "garden" ? 3.35 : 2.75);
    key.name = `${this.zoneId}:key-light`;
    key.position.set(-4, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -2;
    this.root.add(ambient, key);
    this.gameRenderer.scene.add(this.root);
    this.gameRenderer.scene.background = new Color(blueprint.palette.background);
    this.resources.trackTree(this.root);
    this.syncDecorObjects();
    this.frameCamera();
  }

  private applyScenePresentation(): void {
    const blueprint = HOME_ZONE_BLUEPRINTS[this.zoneId];
    this.gameRenderer.scene.background = new Color(blueprint.palette.background);
    this.gameRenderer.scene.fog = null;
    this.frameCamera();
  }

  protected add(...objects: Object3D[]): void {
    this.root.add(...objects);
  }

  protected trackDynamic(object: Object3D): void {
    this.resources.trackTree(object);
  }

  protected material(color: number, roughness = 0.82): MeshStandardMaterial {
    return new MeshStandardMaterial({ color, roughness });
  }

  protected emit(event: HomeEvent): void {
    this.eventHandler(event);
  }

  protected currentSave(): SaveState | null {
    return this.readSave();
  }

  protected commit(save: SaveState): void {
    this.writeSave(save);
  }

  protected commitNeed(save: SaveState, need: "hunger" | "energy" | "hygiene" | "fun"): void {
    this.commit(save);
    this.emit({ type: "need:changed", need, value: save.simulation.needs[need] });
  }

  protected navigateTo(destination: NormalUiDestination): void {
    this.navigationHandler(destination);
    this.emit({ type: "home:navigate", destination });
  }

  navigateToZone(zone: HomeZoneId): void {
    this.navigateTo({ kind: "home", zone });
  }

  protected selectMinigame(game: MinigameId): void {
    this.emit({ type: "minigame:selected", game });
    this.navigateTo({ kind: "minigame-menu" });
  }

  private setPointer(clientX: number, clientY: number): void {
    const rect = this.gameRenderer.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.gameRenderer.camera);
  }

  protected hit(object: Object3D, clientX: number, clientY: number): boolean {
    this.setPointer(clientX, clientY);
    return this.raycaster.intersectObject(object, true).length > 0;
  }

  hitGooby(clientX: number, clientY: number): boolean {
    return this.hit(this.gooby.interactionTarget, clientX, clientY);
  }

  react(reaction: GoobyReaction): void {
    this.gooby.react(reaction);
    if (reaction !== "pet" && reaction !== "tickle" && reaction !== "poke") return;
    const save = this.currentSave();
    if (save) this.commitNeed(petGooby(save, reaction, this.clock), "fun");
  }

  setSleeping(sleeping: boolean): void {
    this.gooby.setSleeping(sleeping);
  }

  handleGesture(gesture: Gesture): boolean {
    if (
      gesture.type === "press-move" &&
      Math.hypot(gesture.dx, gesture.dy) > 18 &&
      this.hitGooby(gesture.x, gesture.y)
    ) {
      this.react("tickle");
      return true;
    }
    if (gesture.type === "tap" && this.hitGooby(gesture.x, gesture.y)) {
      this.react("pet");
      return true;
    }
    if (gesture.type === "double-tap" && this.hitGooby(gesture.x, gesture.y)) {
      this.react("poke");
      return true;
    }
    return this.handleZoneGesture(gesture);
  }

  protected abstract handleZoneGesture(gesture: Gesture): boolean;

  placeDecor(request: PlacementRequest): PlacementValidation {
    const result = upsertDecorPlacement(this.placements, request);
    if (!result.validation.valid) return result.validation;
    this.placements = result.placements;
    this.persistDecor();
    this.syncDecorObjects();
    return result.validation;
  }

  rotateDecor(instanceId: string): PlacementValidation {
    const result = rotateDecorPlacement(this.placements, instanceId);
    if (!result.validation.valid) return result.validation;
    this.placements = result.placements;
    this.persistDecor();
    this.syncDecorObjects();
    return result.validation;
  }

  removeDecor(instanceId: string): boolean {
    if (!this.placements.some((placement) => placement.instanceId === instanceId)) return false;
    this.placements = removeDecorPlacement(this.placements, instanceId);
    this.persistDecor();
    this.syncDecorObjects();
    return true;
  }

  getDecorPlacements(): readonly DecorPlacement[] {
    return this.placements;
  }

  placeCatalogItem(itemId: string): boolean {
    const save = this.currentSave();
    const item = CATALOG_BY_ID.get(itemId);
    if (
      !save ||
      item?.kind !== "furniture" ||
      !item.zones.includes(this.zoneId) ||
      (save.inventory[itemId] ?? 0) <= 0
    ) {
      this.emit({ type: "toast", message: "That piece cannot be placed in this room." });
      return false;
    }
    const count = Object.keys(save.inventory)
      .filter((key) => key.startsWith(`__home.catalog.v1|${this.zoneId}|`) && key.endsWith(`|${itemId}`))
      .length;
    const instanceId = `${itemId}-${count + 1}`;
    this.commit({
      ...save,
      inventory: {
        ...save.inventory,
        [`__home.catalog.v1|${this.zoneId}|${instanceId}|${itemId}`]: 1,
      },
    });
    this.syncDecorObjects();
    this.emit({ type: "toast", message: `${item.name} is now cozy in ${HOME_ZONE_BLUEPRINTS[this.zoneId].title}.` });
    return true;
  }

  equipCatalogCosmetics(equipped: Readonly<Partial<Record<CosmeticSlot, string>>>): void {
    for (const slot of COSMETIC_SLOTS) {
      this.catalogCosmetics.get(slot)?.removeFromParent();
      this.catalogCosmetics.delete(slot);
      const itemId = equipped[slot];
      const item = itemId ? CATALOG_BY_ID.get(itemId) : null;
      if (item?.kind !== "cosmetic" || item.slot !== slot) continue;
      const object = createCosmeticModel(item);
      object.name = `equipped:${slot}:${item.id}`;
      object.scale.setScalar(slot === "back" ? 0.68 : 0.58);
      this.gooby.getCosmeticSocket(slot).add(object);
      this.trackDynamic(object);
      this.catalogCosmetics.set(slot, object);
    }
  }

  private persistDecor(): void {
    const save = this.currentSave();
    if (save) this.commit(persistDecorPlacements(save, this.placements));
    this.emit({ type: "decor:changed", placements: this.placements });
  }

  private syncDecorObjects(): void {
    for (const object of this.decorObjects.values()) object.removeFromParent();
    this.decorObjects.clear();
    for (const placement of this.placements.filter(({ zone }) => zone === this.zoneId)) {
      const definition = HOME_DECOR_CATALOG[placement.decorId];
      const object = createProceduralAsset(definition.assetKey);
      object.name = `decor:${placement.instanceId}`;
      object.position.set(
        placement.gridX * HOME_GRID_SIZE,
        0.03,
        placement.gridZ * HOME_GRID_SIZE,
      );
      object.rotation.y = placement.quarterTurns * Math.PI / 2;
      this.root.add(object);
      this.trackDynamic(object);
      this.decorObjects.set(placement.instanceId, object);
    }
    const save = this.currentSave();
    if (!save) return;
    const catalogEntries = Object.entries(save.inventory)
      .filter(([key, value]) => key.startsWith(`__home.catalog.v1|${this.zoneId}|`) && value === 1);
    catalogEntries.forEach(([key], index) => {
      const [, zone, instanceId, itemId] = key.split("|");
      const item = itemId ? CATALOG_BY_ID.get(itemId) : null;
      if (zone !== this.zoneId || !instanceId || item?.kind !== "furniture" || !item.zones.includes(this.zoneId)) {
        return;
      }
      const object = createCatalogItemModel(item);
      object.name = `catalog-decor:${instanceId}`;
      object.position.set(-2.8 + (index % 3) * 2.8, 0.05, 1.55 + Math.floor(index / 3) * 1.15);
      object.scale.setScalar(item.footprint === "large" ? 0.72 : item.footprint === "medium" ? 0.62 : 0.52);
      this.root.add(object);
      this.trackDynamic(object);
      this.decorObjects.set(`catalog:${instanceId}`, object);
    });
  }

  enter(context: SceneContext): void {
    if (this.disposed) throw new Error(`Cannot enter disposed home zone: ${this.zoneId}`);
    this.root.visible = true;
    if (!this.root.parent) this.gameRenderer.scene.add(this.root);
    this.resize(context);
  }

  update(deltaSeconds: number): void {
    if (this.disposed) return;
    this.elapsed += Math.max(0, deltaSeconds);
    this.gooby.update(deltaSeconds, this.elapsed);
    this.updateZone(deltaSeconds);
  }

  protected abstract updateZone(deltaSeconds: number): void;

  resize(context: SceneContext): void {
    const aspect = context.viewport.width / Math.max(1, context.viewport.height);
    this.frameCamera(aspect);
  }

  private frameCamera(aspect = this.gameRenderer.camera.aspect): void {
    const blueprint = HOME_ZONE_BLUEPRINTS[this.zoneId];
    const portraitPullback = Math.max(0, 0.72 - aspect) * 7.5;
    this.gameRenderer.camera.position.set(
      blueprint.camera.position[0],
      blueprint.camera.position[1],
      blueprint.camera.position[2] + portraitPullback,
    );
    this.gameRenderer.camera.fov = aspect < 0.7 ? 39 : 36;
    this.gameRenderer.camera.lookAt(...blueprint.camera.target);
    this.gameRenderer.camera.updateProjectionMatrix();
  }

  exit(): void {
    this.root.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.catalogCosmetics.clear();
    this.decorObjects.clear();
    this.resources.dispose();
  }

  protected animateEmissive(mesh: Mesh, color: number, intensity: number): void {
    const material = mesh.material;
    if (!(material instanceof MeshStandardMaterial)) return;
    material.emissive.setHex(color);
    material.emissiveIntensity = intensity;
  }
}
