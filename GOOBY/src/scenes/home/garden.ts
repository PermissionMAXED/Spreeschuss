import {
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import type { Gesture } from "../../core/contracts/input";
import type { MinigameId } from "../../core/contracts/scenes";
import { createProceduralAsset } from "../../render/proc";
import type { GameRenderer, ResourceTracker } from "../../render/renderer";
import { GARDEN_SIGNPOSTS } from "../../data/home";
import { HomeZoneScene, type HomeSceneOptions } from "./base";
import { box, makeDoor, makeFence, makeRoomShell, makeSignpost, sphere } from "./primitives";
import { carrotsRemainingToday, harvestCarrot } from "./state";

interface Butterfly {
  readonly root: Group;
  readonly wings: readonly [Object3D, Object3D];
  readonly offset: number;
  readonly basePosition: readonly [number, number, number];
}

export class Garden extends HomeZoneScene {
  private readonly carrots: Object3D[] = [];
  private readonly butterflies: Butterfly[] = [];
  private readonly signs = new Map<MinigameId, Group>();
  private readonly livingDoor: Group;
  private remainingToday = 3;
  private butterflyUpdateAge = 0;

  constructor(
    renderer: GameRenderer,
    tracker: ResourceTracker,
    options: HomeSceneOptions = {},
  ) {
    super(renderer, tracker, "garden", options);
    this.add(makeRoomShell("garden", true), makeFence());

    const path = box([2.2, 0.06, 7.2], 0xd8bd82, [0, 0.02, 0.1]);
    path.rotation.y = 0.04;
    const tree = createProceduralAsset("city.tree");
    tree.name = "garden:shade-tree";
    tree.position.set(3.45, 0, -2.05);
    tree.scale.setScalar(1.38);

    const patch = box([2.6, 0.16, 1.8], 0x855b3d, [-2.75, 0.07, -1.85]);
    patch.name = "garden:carrot-patch";
    for (let index = 0; index < 3; index += 1) {
      const carrot = createProceduralAsset("food.carrot");
      carrot.name = `garden:carrot-${index + 1}`;
      carrot.position.set(-3.35 + index * 0.62, 0.88, -1.75 + (index % 2) * 0.2);
      carrot.rotation.z = Math.PI;
      carrot.scale.setScalar(0.72);
      this.carrots.push(carrot);
      this.registerEssentialTarget(
        `carrot:${index + 1}`,
        carrot,
        [-3.35 + index * 0.62, 0.82, -1.75 + (index % 2) * 0.2],
        [1.45, 1.5, 0.9],
      );
    }

    for (let index = 0; index < 4; index += 1) {
      const root = new Group();
      root.name = `garden:butterfly-${index + 1}`;
      const left = createProceduralAsset("particle.sparkle");
      const right = createProceduralAsset("particle.sparkle");
      const body = sphere(0.06, 0x5f4d55);
      left.position.x = -0.1;
      right.position.x = 0.1;
      left.scale.set(0.72, 1.12, 0.35);
      right.scale.set(0.72, 1.12, 0.35);
      const materialColor = index % 2 === 0 ? 0xf5a6bd : 0x9fbaed;
      for (const wing of [left, right]) {
        wing.traverse((child) => {
          if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
            child.material.color.setHex(materialColor);
          }
        });
      }
      root.add(left, right, body);
      const basePosition = [
        -2.8 + index * 1.55,
        2 + (index % 2) * 0.55,
        -0.5 + (index % 3) * 0.7,
      ] as const;
      root.position.set(...basePosition);
      this.butterflies.push({ root, wings: [left, right], offset: index * 1.37, basePosition });
    }

    GARDEN_SIGNPOSTS.forEach((descriptor, index) => {
      const sign = makeSignpost([0xf1a05f, 0x8db8dc, 0xd49cc4][index] ?? 0xeab36f);
      sign.name = `minigame:${descriptor.game}`;
      sign.position.set(2.45 + (index % 2) * 1.25, 0, -0.2 + index * 1.05);
      sign.rotation.y = -0.2;
      const emblem = createProceduralAsset(descriptor.assetKey);
      emblem.position.set(0, 1.55, 0.16);
      emblem.scale.setScalar(0.58);
      sign.add(emblem);
      this.signs.set(descriptor.game, sign);
      this.registerEssentialTarget(
        `sign:${descriptor.game}`,
        sign,
        [2.45 + (index % 2) * 1.25, 1.2, -0.2 + index * 1.05],
        [1.55, 2.65, 0.8],
      );
    });

    this.livingDoor = makeDoor(0xe3a074, "right");
    this.livingDoor.name = "door:living-room";
    this.livingDoor.position.set(-4.35, 0, 1.65);
    this.livingDoor.rotation.y = 0.18;
    this.registerEssentialTarget("door:living-room", this.livingDoor, [-4.35, 1.42, 1.65], [1.65, 3.2, 0.7]);

    const flowerColors = [0xf2a4b5, 0xf6d16d, 0xa6b8ec, 0xf1a879];
    for (let index = 0; index < 14; index += 1) {
      const flower = createProceduralAsset("particle.sparkle");
      flower.position.set(-4.2 + (index % 7) * 1.35, 0.18, 2.4 + Math.floor(index / 7) * 0.48);
      flower.scale.setScalar(0.55);
      flower.traverse((child) => {
        if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
          child.material.color.setHex(flowerColors[index % flowerColors.length] ?? 0xf2a4b5);
        }
      });
      this.add(flower);
    }

    this.gooby.root.position.set(0, 0.04, 0.55);
    this.gooby.root.scale.setScalar(0.84);
    this.excludeFromStaticBatch(...this.butterflies.map(({ root }) => root));
    this.add(
      path,
      tree,
      patch,
      ...this.carrots,
      ...this.butterflies.map(({ root }) => root),
      ...this.signs.values(),
      this.livingDoor,
      this.gooby.root,
    );
    this.finishScene();
    this.refreshCarrots();
  }

  harvest(): boolean {
    const save = this.currentSave();
    if (!save) return false;
    const result = harvestCarrot(save, this.clock);
    this.remainingToday = result.remainingToday;
    if (result.harvested) {
      this.commit(result.save);
      this.gooby.react("feed");
      this.emit({ type: "toast", message: `Fresh carrot! ${result.remainingToday} left to pick today.` });
    } else {
      this.emit({ type: "toast", message: "The carrot patch needs until tomorrow to regrow." });
    }
    this.emit({ type: "harvest", harvested: result.harvested, remainingToday: result.remainingToday });
    this.refreshCarrots();
    return result.harvested;
  }

  openMinigameSign(game: MinigameId): void {
    if (!this.signs.has(game)) throw new Error(`Garden signpost is not available for ${game}`);
    this.selectMinigame(game);
  }

  private refreshCarrots(): void {
    const save = this.currentSave();
    this.remainingToday = save ? carrotsRemainingToday(save, this.clock) : 3;
    this.carrots.forEach((carrot, index) => {
      carrot.visible = index < this.remainingToday;
      carrot.scale.y = carrot.visible ? 0.72 : 0.05;
    });
  }

  protected override handleZoneGesture(gesture: Gesture): boolean {
    if (gesture.type !== "tap" && gesture.type !== "double-tap") return false;
    if (this.hitEssential("door:living-room", gesture.x, gesture.y)) {
      this.navigateToZone("living-room");
      return true;
    }
    for (const [index, carrot] of this.carrots.entries()) {
      if (carrot.visible && this.hitEssential(`carrot:${index + 1}`, gesture.x, gesture.y)) {
        this.harvest();
        return true;
      }
    }
    for (const [game] of this.signs) {
      if (this.hitEssential(`sign:${game}`, gesture.x, gesture.y)) {
        this.openMinigameSign(game);
        return true;
      }
    }
    return false;
  }

  protected override updateZone(deltaSeconds: number): void {
    this.butterflyUpdateAge += deltaSeconds;
    const reducedMotion = this.currentSave()?.settings.reducedMotion ?? false;
    const updateInterval = reducedMotion ? 0.2 : 1 / 30;
    if (this.butterflyUpdateAge < updateInterval) return;
    this.butterflyUpdateAge = 0;
    this.butterflies.forEach(({ root, wings, offset, basePosition }, index) => {
      const time = this.elapsed + offset;
      const travel = reducedMotion ? 0.035 : 0.16;
      root.position.set(
        basePosition[0] + Math.sin(time * 0.8 + index) * travel,
        basePosition[1] + Math.sin(time * 1.6) * travel * 0.65,
        basePosition[2] + Math.cos(time * 0.55 + index) * travel * 0.45,
      );
      root.rotation.y = Math.sin(time * 0.65) * (reducedMotion ? 0.12 : 0.5);
      const flap = Math.sin(time * (reducedMotion ? 3 : 10)) * (reducedMotion ? 0.18 : 0.7);
      wings[0].rotation.y = flap;
      wings[1].rotation.y = -flap;
    });
    const save = this.currentSave();
    if (save && carrotsRemainingToday(save, this.clock) !== this.remainingToday) {
      this.refreshCarrots();
    }
  }
}
