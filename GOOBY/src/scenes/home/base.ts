import {
  AmbientLight,
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Raycaster,
  Texture,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
  type PerspectiveCamera,
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
import { HOME_GRID_SIZE, HOME_ZONE_BLUEPRINTS } from "../../data/home";
import {
  createCatalogItemModel,
  createCosmeticModel,
  disposeObjectTree,
} from "../shops/visuals";
import {
  findAvailableDecorPlacement,
  persistDecorPlacements,
  petGooby,
  removeDecorPlacement,
  resolveDecorDefinition,
  restoreDecorPlacements,
  rotateDecorPlacement,
  upsertDecorPlacement,
  type DecorPlacement,
  type PlacementRequest,
  type PlacementValidation,
  NOUGAT_DISPENSER_DECOR_ID,
} from "./state";
import { BellyGestureTracker } from "./gestures";
import {
  batchSolidColorModel,
  batchStaticHomeGeometry,
  makeNougatDispenser,
  type StaticBatchResult,
} from "./primitives";

export interface HomeViewport {
  readonly width: number;
  readonly height: number;
}

export interface ScreenProjection {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly inFront: boolean;
  readonly fullyVisible: boolean;
}

export interface EssentialInteractionTarget {
  readonly id: string;
  readonly visual: Object3D;
  readonly hitTarget: Object3D;
}

export interface SelectedDecorPlacementRequest {
  readonly x: number;
  readonly z: number;
  readonly quarterTurns?: 0 | 1 | 2 | 3;
  readonly slotId?: string | null;
}

export function configureHomeCamera(
  camera: PerspectiveCamera,
  zone: HomeZoneId,
  viewport: HomeViewport,
): void {
  const aspect = viewport.width / Math.max(1, viewport.height);
  const blueprint = HOME_ZONE_BLUEPRINTS[zone];
  const fov = aspect < 0.75 ? 52 : 36;
  const verticalTangent = Math.tan(fov * Math.PI / 360);
  const interactionPullback = 5.35 / Math.max(0.01, verticalTangent * aspect) + 1.9;
  camera.aspect = aspect;
  camera.position.set(
    blueprint.camera.position[0],
    blueprint.camera.position[1],
    Math.max(blueprint.camera.position[2], interactionPullback),
  );
  camera.fov = fov;
  camera.lookAt(...blueprint.camera.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

export function projectObjectToScreen(
  object: Object3D,
  camera: PerspectiveCamera,
  viewport: HomeViewport,
): ScreenProjection {
  object.updateWorldMatrix(true, true);
  camera.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(object);
  if (bounds.isEmpty()) {
    return {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      width: 0,
      height: 0,
      centerX: 0,
      centerY: 0,
      inFront: false,
      fullyVisible: false,
    };
  }
  const projected = [
    new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
    new Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
    new Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
    new Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
    new Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
    new Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
    new Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
  ].map((corner) => corner.project(camera));
  const xs = projected.map(({ x }) => (x + 1) * viewport.width / 2);
  const ys = projected.map(({ y }) => (1 - y) * viewport.height / 2);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const inFront = projected.every(({ z }) => z >= -1 && z <= 1);
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
    inFront,
    fullyVisible: inFront && left >= 0 && right <= viewport.width && top >= 0 && bottom <= viewport.height,
  };
}

export type HomeEvent =
  | { readonly type: "inventory:opened"; readonly items: Readonly<Record<string, number>> }
  | { readonly type: "need:changed"; readonly need: "hunger" | "energy" | "hygiene" | "fun"; readonly value: number }
  | {
      readonly type: "care:performed";
      readonly action: "pet" | "tickle" | "poke" | "belly-rub" | "scrub" | "feed";
      readonly need: "hunger" | "hygiene" | "fun";
      readonly amount: number;
      readonly value: number;
      readonly itemId?: string;
    }
  | {
      readonly type: "care:effect";
      readonly action: "purr" | "giggle" | "munch";
      readonly particles: "hearts" | "sparkles" | "crumbs";
      readonly x?: number;
      readonly y?: number;
    }
  | {
      readonly type: "achievement:hook";
      readonly action: "belly-rub" | "nougat-dispensed" | "care" | "greeting";
      readonly amount: number;
    }
  | {
      readonly type: "item:dispensed";
      readonly itemId: "hazelnut-nougat-spread";
      readonly source: "nougatschleuse";
    }
  | {
      readonly type: "gooby:greeting";
      readonly zone: HomeZoneId;
      readonly greeting: "wave" | "ear-perk" | "happy-hop";
    }
  | {
      readonly type: "tv:channel";
      readonly channel: "meadow-watch" | "butterfly-cam" | "cozy-cooking" | "off";
    }
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
  private readonly dynamicObjects = new Set<Object3D>();
  private readonly essentialTargets = new Map<string, EssentialInteractionTarget>();
  private readonly staticBatchExclusions = new Set<Object3D>();
  private staticBatchResult: StaticBatchResult = {
    sourceMeshes: 0,
    batchedMeshes: 0,
    drawCallsSaved: 0,
  };
  private readonly bellyGesture = new BellyGestureTracker();
  private bellyGestureScale = 100;
  private bellyGestureClaimed: "belly-rub" | "tickle" | null = null;
  private suppressFollowupGesture = false;
  private greetingSent = false;
  private selectedDecor: { readonly decorId: string; readonly instanceId: string | null } | null = null;
  private complete = false;
  private disposed = false;

  protected constructor(
    protected readonly gameRenderer: GameRenderer,
    externalTracker: ResourceTracker,
    readonly zoneId: HomeZoneId,
    options: HomeSceneOptions = {},
  ) {
    this.id = `home:${zoneId}`;
    this.root.name = `home-zone:${zoneId}`;
    this.clock = options.clock ?? new RealClock();
    this.readSave = options.readSave ?? (() => null);
    this.writeSave = options.writeSave ?? (() => undefined);
    this.eventHandler = options.onEvent ?? (() => undefined);
    this.navigationHandler = options.navigate ?? (() => undefined);
    this.gooby = new ProceduralGooby(options.assetLoader ? { assetLoader: options.assetLoader } : {});
    this.staticBatchExclusions.add(this.gooby.root);
    this.gooby.setReducedMotion(this.readSave()?.settings.reducedMotion ?? false);
    if (this.readSave()?.simulation.sleep) this.gooby.restoreSleepingPose();
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
    this.staticBatchResult = batchStaticHomeGeometry(this.root, this.staticBatchExclusions);
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
    this.dynamicObjects.add(object);
  }

  protected excludeFromStaticBatch(...objects: Object3D[]): void {
    for (const object of objects) this.staticBatchExclusions.add(object);
  }

  get staticBatchStats(): StaticBatchResult {
    return this.staticBatchResult;
  }

  protected disposeDynamic(object: Object3D): void {
    if (!this.dynamicObjects.delete(object)) return;
    disposeObjectTree(object);
  }

  get dynamicResourceCount(): number {
    const resources = new Set<unknown>();
    for (const root of this.dynamicObjects) {
      root.traverse((object) => {
        const renderable = object as Object3D & {
          geometry?: unknown;
          material?: Material | Material[];
        };
        if (renderable.geometry) resources.add(renderable.geometry);
        const materials = Array.isArray(renderable.material)
          ? renderable.material
          : renderable.material
            ? [renderable.material]
            : [];
        for (const material of materials) {
          resources.add(material);
          for (const value of Object.values(material)) if (value instanceof Texture) resources.add(value);
        }
      });
    }
    return resources.size;
  }

  protected registerEssentialTarget(
    id: string,
    visual: Object3D,
    center: readonly [x: number, y: number, z: number],
    size: readonly [width: number, height: number, depth: number],
  ): void {
    this.unregisterEssentialTarget(id);
    const material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    });
    const hitTarget = new Mesh(new BoxGeometry(...size), material);
    hitTarget.name = `essential-hit:${this.zoneId}:${id}`;
    hitTarget.position.set(...center);
    this.root.add(hitTarget);
    this.staticBatchExclusions.add(visual);
    this.staticBatchExclusions.add(hitTarget);
    if (this.complete) this.trackDynamic(hitTarget);
    this.essentialTargets.set(id, { id, visual, hitTarget });
  }

  protected unregisterEssentialTarget(id: string): void {
    const current = this.essentialTargets.get(id);
    if (!current) return;
    this.essentialTargets.delete(id);
    if (this.dynamicObjects.has(current.hitTarget)) this.disposeDynamic(current.hitTarget);
    else current.hitTarget.removeFromParent();
  }

  getEssentialInteractionTargets(): readonly EssentialInteractionTarget[] {
    return [...this.essentialTargets.values()];
  }

  protected hitEssential(id: string, clientX: number, clientY: number): boolean {
    const target = this.essentialTargets.get(id);
    return !!target && (this.hit(target.hitTarget, clientX, clientY) || this.hit(target.visual, clientX, clientY));
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
    if (this.blocksGenericGoobyGesture()) return false;
    const hit = this.hitGoobyRaw(clientX, clientY);
    if (!hit || this.suppressFollowupGesture) return false;
    if (!this.bellyGesture.active) return true;

    const metrics = this.bellyGesture.move({ x: clientX, y: clientY });
    if (this.bellyGestureClaimed) return false;
    if (
      metrics.samples <= 3 &&
      metrics.normalizedMaximumSegment >= 0.34 &&
      metrics.angularTravel < 0.45
    ) {
      this.bellyGestureClaimed = "tickle";
      return true;
    }
    return false;
  }

  protected hitGoobyRaw(clientX: number, clientY: number): boolean {
    return this.hit(this.gooby.interactionTarget, clientX, clientY);
  }

  react(reaction: GoobyReaction): void {
    this.gooby.react(reaction);
    if (reaction !== "pet" && reaction !== "tickle" && reaction !== "poke") return;
    const save = this.currentSave();
    if (!save) return;
    const changed = petGooby(save, reaction, this.clock);
    const amount = Math.max(0, changed.simulation.needs.fun - save.simulation.needs.fun);
    this.commitNeed(changed, "fun");
    this.emit({
      type: "care:performed",
      action: reaction,
      need: "fun",
      amount,
      value: changed.simulation.needs.fun,
    });
    this.emit({
      type: "care:effect",
      action: reaction === "tickle" ? "giggle" : "purr",
      particles: reaction === "tickle" ? "sparkles" : "hearts",
    });
    this.emit({ type: "achievement:hook", action: "care", amount: 1 });
  }

  setSleeping(sleeping: boolean): void {
    this.gooby.setSleeping(sleeping);
  }

  handleGesture(gesture: Gesture): boolean {
    if (this.handleZoneGesture(gesture)) return true;
    if (
      this.suppressFollowupGesture &&
      (gesture.type === "tap" || gesture.type === "double-tap" || gesture.type === "swipe")
    ) {
      this.suppressFollowupGesture = false;
      return true;
    }
    if (gesture.type === "press-start" && this.hitGooby(gesture.x, gesture.y)) {
      const projection = projectObjectToScreen(
        this.gooby.interactionTarget,
        this.gameRenderer.camera,
        this.gameRenderer.renderer.domElement.getBoundingClientRect(),
      );
      this.bellyGestureScale = Math.max(44, Math.min(projection.width, projection.height));
      this.bellyGesture.begin({ x: gesture.x, y: gesture.y }, this.bellyGestureScale);
      this.bellyGestureClaimed = null;
      return true;
    }
    if (gesture.type === "press-move" && this.bellyGesture.active) {
      const metrics = this.bellyGesture.move({ x: gesture.x, y: gesture.y });
      const explicitFastMove =
        metrics.samples <= 3 &&
        Math.hypot(gesture.dx, gesture.dy) >= this.bellyGestureScale * 0.5 &&
        metrics.angularTravel < 0.45;
      if (!this.bellyGestureClaimed && explicitFastMove) {
        this.bellyGestureClaimed = "tickle";
        this.react("tickle");
      }
      return true;
    }
    if (gesture.type === "press-end" && this.bellyGesture.active) {
      const classification = this.bellyGestureClaimed ?? this.bellyGesture.classify(gesture.durationMs);
      if (classification === "belly-rub") this.performBellyRub(gesture.x, gesture.y);
      else if (classification === "tickle" && !this.bellyGestureClaimed) this.react("tickle");
      this.bellyGesture.reset();
      this.bellyGestureClaimed = null;
      this.suppressFollowupGesture = classification !== "none";
      return classification !== "none";
    }
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
    return false;
  }

  protected blocksGenericGoobyGesture(): boolean {
    return false;
  }

  private performBellyRub(x: number, y: number): void {
    this.gooby.react("belly-rub");
    const save = this.currentSave();
    if (!save) return;
    const changed = petGooby(save, "belly-rub", this.clock);
    const amount = Math.max(0, changed.simulation.needs.fun - save.simulation.needs.fun);
    this.commitNeed(changed, "fun");
    this.emit({
      type: "care:performed",
      action: "belly-rub",
      need: "fun",
      amount,
      value: changed.simulation.needs.fun,
    });
    this.emit({ type: "care:effect", action: "purr", particles: "hearts", x, y });
    this.emit({ type: "achievement:hook", action: "belly-rub", amount: 1 });
    this.emit({ type: "toast", message: "Prrrr… that slow belly rub feels wonderful! Fun is up." });
  }

  protected abstract handleZoneGesture(gesture: Gesture): boolean;

  placeDecor(request: PlacementRequest): PlacementValidation {
    const result = upsertDecorPlacement(this.placements, request, this.currentSave()?.inventory);
    if (!result.validation.valid) return result.validation;
    this.placements = result.placements;
    this.persistDecor();
    this.syncDecorObjects();
    return result.validation;
  }

  rotateDecor(instanceId: string): PlacementValidation {
    const result = rotateDecorPlacement(this.placements, instanceId, this.currentSave()?.inventory);
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

  selectDecor(decorId: string): boolean {
    const definition = resolveDecorDefinition(decorId);
    const save = this.currentSave();
    if (
      !definition ||
      !definition.allowedZones.includes(this.zoneId) ||
      (definition.inventoryId && (!save || (save.inventory[definition.inventoryId] ?? 0) <= 0))
    ) {
      this.selectedDecor = null;
      return false;
    }
    this.selectedDecor = { decorId, instanceId: null };
    return true;
  }

  selectPlacedDecor(instanceId: string): boolean {
    const placement = this.placements.find((candidate) => candidate.instanceId === instanceId);
    if (!placement || placement.zone !== this.zoneId) {
      this.selectedDecor = null;
      return false;
    }
    this.selectedDecor = { decorId: placement.decorId, instanceId };
    return true;
  }

  getSelectedDecor(): Readonly<{ decorId: string; instanceId: string | null }> | null {
    return this.selectedDecor;
  }

  private nextDecorInstanceId(decorId: string): string {
    for (let index = 1; index <= 9_999; index += 1) {
      const suffix = `-${index}`;
      const candidate = `${decorId.slice(0, 64 - suffix.length)}${suffix}`;
      if (!this.placements.some(({ instanceId }) => instanceId === candidate)) return candidate;
    }
    throw new Error(`No decor instance IDs remain for ${decorId}`);
  }

  placeSelectedDecor(request: SelectedDecorPlacementRequest): PlacementValidation {
    const selected = this.selectedDecor;
    if (!selected || selected.instanceId) return { valid: false, reason: "invalid-instance" };
    const instanceId = this.nextDecorInstanceId(selected.decorId);
    const validation = this.placeDecor({
      ...request,
      instanceId,
      decorId: selected.decorId,
      zone: this.zoneId,
    });
    if (validation.valid) this.selectedDecor = { ...selected, instanceId };
    return validation;
  }

  moveDecor(
    instanceId: string,
    request: Omit<SelectedDecorPlacementRequest, "quarterTurns">,
  ): PlacementValidation {
    const current = this.placements.find((placement) => placement.instanceId === instanceId);
    if (!current || current.zone !== this.zoneId) return { valid: false, reason: "invalid-instance" };
    return this.placeDecor({
      instanceId,
      decorId: current.decorId,
      zone: current.zone,
      x: request.x,
      z: request.z,
      quarterTurns: current.quarterTurns,
      slotId: request.slotId ?? null,
    });
  }

  moveSelectedDecor(request: Omit<SelectedDecorPlacementRequest, "quarterTurns">): PlacementValidation {
    const instanceId = this.selectedDecor?.instanceId;
    return instanceId
      ? this.moveDecor(instanceId, request)
      : { valid: false, reason: "invalid-instance" };
  }

  rotateSelectedDecor(): PlacementValidation {
    const instanceId = this.selectedDecor?.instanceId;
    return instanceId
      ? this.rotateDecor(instanceId)
      : { valid: false, reason: "invalid-instance" };
  }

  removeSelectedDecor(): boolean {
    const selected = this.selectedDecor;
    if (!selected?.instanceId || !this.removeDecor(selected.instanceId)) return false;
    this.selectedDecor = { decorId: selected.decorId, instanceId: null };
    return true;
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
    const placedCopies = this.placements.filter(({ decorId }) => decorId === itemId).length;
    if (placedCopies >= (save.inventory[itemId] ?? 0)) {
      this.emit({ type: "toast", message: "Every owned copy of that piece is already placed." });
      return false;
    }
    if (!this.selectDecor(itemId)) return false;
    const instanceId = this.nextDecorInstanceId(itemId);
    const available = findAvailableDecorPlacement(
      this.placements,
      itemId,
      this.zoneId,
      instanceId,
      save.inventory,
    );
    if (!available.valid) {
      this.emit({ type: "toast", message: "There is no collision-free spot for that piece yet." });
      return false;
    }
    const placed = this.placeDecor({
      instanceId,
      decorId: itemId,
      zone: this.zoneId,
      x: available.placement.gridX * HOME_GRID_SIZE,
      z: available.placement.gridZ * HOME_GRID_SIZE,
      quarterTurns: available.placement.quarterTurns,
      slotId: available.placement.slotId,
    });
    if (!placed.valid) return false;
    this.selectedDecor = { decorId: itemId, instanceId };
    this.emit({ type: "toast", message: `${item.name} is now cozy in ${HOME_ZONE_BLUEPRINTS[this.zoneId].title}.` });
    return true;
  }

  equipCatalogCosmetics(equipped: Readonly<Partial<Record<CosmeticSlot, string>>>): void {
    for (const slot of COSMETIC_SLOTS) {
      const previous = this.catalogCosmetics.get(slot);
      if (previous) this.disposeDynamic(previous);
      this.catalogCosmetics.delete(slot);
      const itemId = equipped[slot];
      const item = itemId ? CATALOG_BY_ID.get(itemId) : null;
      if (item?.kind !== "cosmetic" || item.slot !== slot) continue;
      const object = createCosmeticModel(item);
      batchSolidColorModel(object);
      object.name = `equipped:${slot}:${item.id}`;
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
    for (const object of this.decorObjects.values()) this.disposeDynamic(object);
    this.decorObjects.clear();
    for (const placement of this.placements.filter(({ zone }) => zone === this.zoneId)) {
      const definition = resolveDecorDefinition(placement.decorId);
      if (!definition) continue;
      const object = placement.decorId === NOUGAT_DISPENSER_DECOR_ID
        ? makeNougatDispenser()
        : definition.catalogItem
          ? createCatalogItemModel(definition.catalogItem)
          : createProceduralAsset(definition.assetKey!);
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
    this.onDecorObjectsChanged();
  }

  protected getDecorObject(instanceId: string): Object3D | null {
    return this.decorObjects.get(instanceId) ?? null;
  }

  protected onDecorObjectsChanged(): void {
    // Zones can wire interactions to newly synchronized special furniture.
  }

  enter(context: SceneContext): void {
    if (this.disposed) throw new Error(`Cannot enter disposed home zone: ${this.zoneId}`);
    this.root.visible = true;
    if (!this.root.parent) this.gameRenderer.scene.add(this.root);
    if (this.currentSave()?.simulation.sleep) this.gooby.restoreSleepingPose();
    else if (!this.greetingSent) {
      const greetings = ["wave", "ear-perk", "happy-hop"] as const;
      const greeting = greetings[
        Math.abs(Math.floor(this.clock.now() / 1_000) + this.zoneId.length) % greetings.length
      ] ?? "wave";
      this.greetingSent = true;
      this.gooby.react("greet");
      this.emit({ type: "gooby:greeting", zone: this.zoneId, greeting });
      this.emit({ type: "achievement:hook", action: "greeting", amount: 1 });
    }
    this.resize(context);
  }

  update(deltaSeconds: number): void {
    if (this.disposed || !this.root.visible) return;
    this.elapsed += Math.max(0, deltaSeconds);
    this.gooby.setReducedMotion(this.currentSave()?.settings.reducedMotion ?? false);
    this.gooby.update(deltaSeconds, this.elapsed);
    this.updateZone(deltaSeconds);
  }

  protected abstract updateZone(deltaSeconds: number): void;

  resize(context: SceneContext): void {
    const aspect = context.viewport.width / Math.max(1, context.viewport.height);
    this.frameCamera(aspect);
  }

  private frameCamera(aspect = this.gameRenderer.camera.aspect): void {
    configureHomeCamera(this.gameRenderer.camera, this.zoneId, { width: aspect, height: 1 });
  }

  exit(): void {
    this.root.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const object of [...this.dynamicObjects]) this.disposeDynamic(object);
    this.catalogCosmetics.clear();
    this.decorObjects.clear();
    this.essentialTargets.clear();
    this.resources.dispose();
  }

  protected animateEmissive(mesh: Mesh, color: number, intensity: number): void {
    const material = mesh.material;
    if (!(material instanceof MeshStandardMaterial)) return;
    material.emissive.setHex(color);
    material.emissiveIntensity = intensity;
  }
}
