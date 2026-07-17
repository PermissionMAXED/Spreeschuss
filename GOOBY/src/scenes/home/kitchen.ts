import {
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
} from "three";
import type { Gesture } from "../../core/contracts/input";
import type { HomeZoneId } from "../../core/contracts/scenes";
import { createProceduralAsset } from "../../render/proc";
import type { GameRenderer, ResourceTracker } from "../../render/renderer";
import { HomeZoneScene, type HomeSceneOptions } from "./base";
import { box, makeCounter, makeDoor, makeRoomShell } from "./primitives";
import { feedFromInventory, type FoodId } from "./state";

interface Crumb {
  readonly mesh: Mesh;
  readonly velocity: Vector3;
  age: number;
}

const FOOD_ASSET: Readonly<Record<FoodId, "food.carrot" | "food.apple" | "food.pancake">> = {
  carrot: "food.carrot",
  apple: "food.apple",
  pancake: "food.pancake",
};

export class Kitchen extends HomeZoneScene {
  private readonly fridge = new Group();
  private readonly foodObjects = new Map<FoodId, Object3D>();
  private readonly doors = new Map<HomeZoneId, Group>();
  private readonly crumbs: Crumb[] = [];
  private draggedFood: { readonly id: FoodId; readonly object: Object3D } | null = null;
  private fridgeOpen = false;

  constructor(
    renderer: GameRenderer,
    tracker: ResourceTracker,
    options: HomeSceneOptions = {},
  ) {
    super(renderer, tracker, "kitchen", options);
    this.add(makeRoomShell("kitchen"));

    this.fridge.name = "kitchen:fridge";
    const fridgeBody = box([1.55, 3.25, 1.2], 0xf2eee3, [0, 1.625, 0]);
    const freezerLine = box([1.42, 0.05, 0.05], 0xb6c7c9, [0, 2.18, 0.63]);
    const handle = box([0.09, 0.85, 0.1], 0x879397, [0.52, 1.48, 0.69]);
    this.fridge.add(fridgeBody, freezerLine, handle);
    this.fridge.position.set(-3.05, 0, -2.5);

    const counter = makeCounter(4.4);
    counter.name = "kitchen:counter";
    counter.position.set(1.15, 0, -2.58);
    const kitchenAsset = createProceduralAsset("furniture.kitchen-counter");
    kitchenAsset.name = "kitchen:asset-counter";
    kitchenAsset.position.set(3.65, 0, 0.15);
    kitchenAsset.rotation.y = Math.PI / 2;
    kitchenAsset.scale.set(0.72, 1, 0.72);

    const backsplash = box([4.6, 1.1, 0.08], 0x8fc7bd, [1.1, 1.78, -3.08]);
    const tileLines = [-0.5, 0.55, 1.6, 2.65].map((x) =>
      box([0.035, 1, 0.05], 0xd8f1e9, [x, 1.78, -3]),
    );

    const livingDoor = makeDoor(0xe5a273, "right");
    livingDoor.name = "door:living-room";
    livingDoor.position.set(-4.22, 0, 0.85);
    livingDoor.rotation.y = 0.18;
    const bathroomDoor = makeDoor(0x89bfc4);
    bathroomDoor.name = "door:bathroom";
    bathroomDoor.position.set(4.22, 0, 1.15);
    bathroomDoor.rotation.y = -0.18;
    this.doors.set("living-room", livingDoor);
    this.doors.set("bathroom", bathroomDoor);
    this.registerEssentialTarget("door:living-room", livingDoor, [-4.22, 1.42, 0.85], [1.65, 3.2, 0.7]);
    this.registerEssentialTarget("door:bathroom", bathroomDoor, [4.22, 1.42, 1.15], [1.65, 3.2, 0.7]);

    this.gooby.root.position.set(0.1, 0.06, 0.55);
    this.gooby.root.scale.setScalar(0.87);
    this.add(
      this.fridge,
      counter,
      kitchenAsset,
      backsplash,
      ...tileLines,
      livingDoor,
      bathroomDoor,
      this.gooby.root,
    );
    this.finishScene();
  }

  openFridge(): Readonly<Record<string, number>> {
    const inventory = this.currentSave()?.inventory ?? {};
    this.fridgeOpen = true;
    this.fridge.rotation.y = -0.035;
    this.showAvailableFood(inventory);
    this.emit({ type: "inventory:opened", items: { ...inventory } });
    this.emit({ type: "toast", message: "Drag a snack right to Gooby's mouth." });
    return inventory;
  }

  closeFridge(): void {
    this.fridgeOpen = false;
    this.fridge.rotation.y = 0;
    for (const [id, food] of this.foodObjects) {
      this.unregisterEssentialTarget(`food:${id}`);
      this.disposeDynamic(food);
    }
    this.foodObjects.clear();
  }

  private showAvailableFood(inventory: Readonly<Record<string, number>>): void {
    for (const [id, food] of this.foodObjects) {
      this.unregisterEssentialTarget(`food:${id}`);
      this.disposeDynamic(food);
    }
    this.foodObjects.clear();
    const visibleFoods = (Object.keys(FOOD_ASSET) as FoodId[]).filter((id) => (inventory[id] ?? 0) > 0);
    visibleFoods.forEach((id, index) => {
      const object = createProceduralAsset(FOOD_ASSET[id]);
      object.name = `food:${id}`;
      object.position.set(-3.35 + index * 0.65, 1.35 + (index % 2) * 0.55, -1.62);
      object.scale.setScalar(id === "carrot" ? 0.65 : 0.78);
      this.root.add(object);
      this.trackDynamic(object);
      this.foodObjects.set(id, object);
      this.registerEssentialTarget(
        `food:${id}`,
        object,
        [-3.35 + index * 0.65, 1.65 + (index % 2) * 0.55, -1.62],
        [1.4, 1.5, 0.9],
      );
    });
  }

  beginFoodDrag(food: FoodId): boolean {
    if (!this.fridgeOpen) this.openFridge();
    const object = this.foodObjects.get(food);
    if (!object) return false;
    this.draggedFood = { id: food, object };
    object.scale.multiplyScalar(1.12);
    return true;
  }

  dragFoodTo(worldX: number, worldY: number): void {
    if (!this.draggedFood) return;
    this.draggedFood.object.position.set(
      Math.max(-4, Math.min(4, worldX)),
      Math.max(0.55, Math.min(4.4, worldY)),
      1.9,
    );
  }

  dropFoodAtMouth(): boolean {
    if (!this.draggedFood) return false;
    const food = this.draggedFood.id;
    this.draggedFood = null;
    const consumed = this.feedFood(food);
    if (!consumed) this.showAvailableFood(this.currentSave()?.inventory ?? {});
    return consumed;
  }

  feedFood(food: FoodId): boolean {
    const save = this.currentSave();
    if (!save) return false;
    const result = feedFromInventory(save, food, this.clock);
    if (!result.consumed) {
      this.emit({ type: "toast", message: "That snack shelf is empty." });
      return false;
    }
    this.commitNeed(result.save, "hunger");
    this.gooby.react("feed");
    this.spawnCrumbs();
    this.emit({ type: "toast", message: "Crunch! Hunger is up." });
    this.showAvailableFood(result.save.inventory);
    return true;
  }

  private spawnCrumbs(): void {
    for (let index = 0; index < 8; index += 1) {
      const crumb = new Mesh(
        new SphereGeometry(0.045 + (index % 3) * 0.012, 7, 5),
        new MeshStandardMaterial({ color: index % 2 === 0 ? 0xe89a45 : 0xf4c575, roughness: 0.95 }),
      );
      crumb.position.set((index - 3.5) * 0.055, 2.63 + (index % 2) * 0.08, 1.1);
      this.root.add(crumb);
      this.trackDynamic(crumb);
      this.crumbs.push({
        mesh: crumb,
        velocity: new Vector3((index - 3.5) * 0.11, 0.38 + (index % 3) * 0.09, 0.12),
        age: 0,
      });
    }
  }

  protected override handleZoneGesture(gesture: Gesture): boolean {
    if (gesture.type === "tap" || gesture.type === "double-tap") {
      for (const [zone] of this.doors) {
        if (this.hitEssential(`door:${zone}`, gesture.x, gesture.y)) {
          this.navigateToZone(zone);
          return true;
        }
      }
    }
    if (gesture.type === "tap" && this.hit(this.fridge, gesture.x, gesture.y)) {
      if (this.fridgeOpen) this.closeFridge();
      else this.openFridge();
      return true;
    }
    if (gesture.type === "press-start") {
      for (const [id] of this.foodObjects) {
        if (this.hitEssential(`food:${id}`, gesture.x, gesture.y)) return this.beginFoodDrag(id);
      }
    }
    if (gesture.type === "press-move" && this.draggedFood) {
      const rect = this.gameRenderer.renderer.domElement.getBoundingClientRect();
      const x = ((gesture.x - rect.left) / Math.max(1, rect.width) - 0.5) * 8;
      const y = (1 - (gesture.y - rect.top) / Math.max(1, rect.height)) * 4.6;
      this.dragFoodTo(x, y);
      return true;
    }
    if (gesture.type === "press-end" && this.draggedFood) {
      if (this.hitGooby(gesture.x, gesture.y)) this.dropFoodAtMouth();
      else {
        this.draggedFood = null;
        this.showAvailableFood(this.currentSave()?.inventory ?? {});
      }
      return true;
    }
    return false;
  }

  protected override updateZone(deltaSeconds: number): void {
    for (let index = this.crumbs.length - 1; index >= 0; index -= 1) {
      const crumb = this.crumbs[index];
      if (!crumb) continue;
      crumb.age += deltaSeconds;
      crumb.velocity.y -= deltaSeconds * 1.8;
      crumb.mesh.position.addScaledVector(crumb.velocity, deltaSeconds);
      crumb.mesh.rotation.x += deltaSeconds * 4;
      if (crumb.age > 1.4) {
        this.disposeDynamic(crumb.mesh);
        this.crumbs.splice(index, 1);
      }
    }
  }
}
