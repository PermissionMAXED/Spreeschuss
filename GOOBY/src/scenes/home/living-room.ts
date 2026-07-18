import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from "three";
import type { Gesture } from "../../core/contracts/input";
import type { HomeZoneId } from "../../core/contracts/scenes";
import { createProceduralAsset } from "../../render/proc";
import type { GameRenderer, ResourceTracker } from "../../render/renderer";
import { HomeZoneScene, type HomeSceneOptions } from "./base";
import { box, makeDoor, makeRoomShell, makeWindow } from "./primitives";

const DAY_MS = 24 * 60 * 60 * 1_000;
const TV_CHANNELS = ["meadow-watch", "butterfly-cam", "cozy-cooking", "off"] as const;
type TelevisionChannel = (typeof TV_CHANNELS)[number];

export class LivingRoom extends HomeZoneScene {
  private readonly televisionScreen: Mesh;
  private readonly windowGlass: Mesh;
  private readonly doors = new Map<HomeZoneId, Group>();
  private televisionChannel: TelevisionChannel = "meadow-watch";

  constructor(
    gameRenderer: GameRenderer,
    tracker: ResourceTracker,
    options: HomeSceneOptions = {},
  ) {
    super(gameRenderer, tracker, "living-room", options);
    this.add(makeRoomShell("living-room"));

    const rug = createProceduralAsset("furniture.rug");
    rug.name = "living-room:rug";
    rug.position.set(0, 0.04, 0.55);
    rug.scale.set(1.28, 1, 1.08);
    const sofa = createProceduralAsset("furniture.sofa");
    sofa.name = "living-room:sofa";
    sofa.position.set(-2.65, 0, -2.05);
    sofa.rotation.y = 0.08;
    sofa.scale.setScalar(0.9);
    const coffeeTable = createProceduralAsset("furniture.coffee-table");
    coffeeTable.name = "living-room:coffee-table";
    coffeeTable.position.set(2.35, 0, 0.65);
    coffeeTable.scale.setScalar(0.62);
    const shelf = createProceduralAsset("furniture.bookshelf");
    shelf.name = "living-room:story-shelves";
    shelf.position.set(4.05, 0, -2.92);
    shelf.scale.setScalar(0.64);

    const television = new Group();
    television.name = "living-room:animated-tv";
    const frame = new Mesh(
      new BoxGeometry(2.05, 1.32, 0.24),
      new MeshStandardMaterial({ color: 0x55484b, roughness: 0.62 }),
    );
    this.televisionScreen = new Mesh(
      new PlaneGeometry(1.72, 1.02),
      new MeshStandardMaterial({ color: 0x8fd4d3, roughness: 0.24 }),
    );
    this.televisionScreen.position.z = 0.14;
    const stand = box([0.22, 0.65, 0.22], 0x70564a, [0, -0.93, 0]);
    const consoleTop = box([2.5, 0.2, 0.7], 0xa66c4d, [0, -1.25, 0]);
    television.add(frame, this.televisionScreen, stand, consoleTop);
    television.position.set(2.25, 2.7, -2.93);

    const window = makeWindow();
    window.root.name = "living-room:day-night-window";
    window.root.position.set(-0.95, 4.55, -3.04);
    window.root.scale.setScalar(0.78);
    this.windowGlass = window.glass;

    const kitchenDoor = makeDoor(0x87bca7, "right");
    kitchenDoor.name = "door:kitchen";
    kitchenDoor.position.set(-4.18, 0, -3.02);
    const gardenDoor = makeDoor(0xeca16e);
    gardenDoor.name = "door:garden";
    gardenDoor.position.set(4.18, 0, -3.02);
    this.doors.set("kitchen", kitchenDoor);
    this.doors.set("garden", gardenDoor);
    this.registerEssentialTarget("door:kitchen", kitchenDoor, [-4.18, 1.42, -3], [1.65, 3.2, 0.65]);
    this.registerEssentialTarget("door:garden", gardenDoor, [4.18, 1.42, -3], [1.65, 3.2, 0.65]);

    const plant = createProceduralAsset("city.tree");
    plant.name = "living-room:plant";
    plant.position.set(4.25, 0.05, 1.55);
    plant.scale.setScalar(0.56);

    this.gooby.root.position.set(-0.05, 0.08, 0.35);
    this.gooby.root.scale.setScalar(0.9);
    this.excludeFromStaticBatch(this.televisionScreen, this.windowGlass);
    this.add(
      rug,
      sofa,
      coffeeTable,
      shelf,
      television,
      window.root,
      kitchenDoor,
      gardenDoor,
      plant,
      this.gooby.root,
    );
    this.finishScene();
  }

  toggleTelevision(): boolean {
    this.televisionChannel = this.televisionChannel === "off" ? "meadow-watch" : "off";
    this.emit({
      type: "toast",
      message: this.televisionChannel === "off" ? "Quiet cozy time." : "Meadow Watch is on.",
    });
    this.emit({ type: "tv:channel", channel: this.televisionChannel });
    return this.televisionChannel !== "off";
  }

  cycleTelevisionChannel(): TelevisionChannel {
    const next = (TV_CHANNELS.indexOf(this.televisionChannel) + 1) % TV_CHANNELS.length;
    this.televisionChannel = TV_CHANNELS[next] ?? "meadow-watch";
    const message: Readonly<Record<TelevisionChannel, string>> = {
      "meadow-watch": "Meadow Watch: a very calm field.",
      "butterfly-cam": "Butterfly Cam: tiny wings, live from the garden.",
      "cozy-cooking": "Cozy Cooking: carrot pancakes are sizzling.",
      off: "Quiet cozy time.",
    };
    this.emit({ type: "tv:channel", channel: this.televisionChannel });
    this.emit({ type: "toast", message: message[this.televisionChannel] });
    return this.televisionChannel;
  }

  get currentTelevisionChannel(): TelevisionChannel {
    return this.televisionChannel;
  }

  openDoor(zone: "kitchen" | "garden"): void {
    this.navigateToZone(zone);
  }

  protected override handleZoneGesture(gesture: Gesture): boolean {
    if (gesture.type !== "tap" && gesture.type !== "double-tap") return false;
    if (this.hit(this.televisionScreen, gesture.x, gesture.y)) {
      this.cycleTelevisionChannel();
      return true;
    }
    for (const [zone] of this.doors) {
      if (this.hitEssential(`door:${zone}`, gesture.x, gesture.y)) {
        this.navigateToZone(zone);
        return true;
      }
    }
    return false;
  }

  protected override updateZone(): void {
    const material = this.televisionScreen.material;
    if (material instanceof MeshStandardMaterial) {
      if (this.televisionChannel !== "off") {
        const pulse = (Math.sin(this.elapsed * 2.3) + 1) / 2;
        const channelStyle: Readonly<Record<Exclude<TelevisionChannel, "off">, readonly [number, number]>> = {
          "meadow-watch": [0.47, 0x5ec6ca],
          "butterfly-cam": [0.86, 0xd66fa9],
          "cozy-cooking": [0.08, 0xe69a55],
        };
        const [hue, emissive] = channelStyle[this.televisionChannel];
        material.color.setHSL(hue + pulse * 0.055, 0.52, 0.55);
        material.emissive.setHex(emissive);
        material.emissiveIntensity = 0.22 + pulse * 0.3;
      } else {
        material.color.setHex(0x332f35);
        material.emissiveIntensity = 0;
      }
    }

    const dayFraction = ((this.clock.now() % DAY_MS) + DAY_MS) % DAY_MS / DAY_MS;
    const daylight = dayFraction >= 0.25 && dayFraction < 0.79;
    const glassMaterial = this.windowGlass.material;
    if (glassMaterial instanceof MeshStandardMaterial) {
      glassMaterial.color.setHex(daylight ? 0x98dce5 : 0x4e5f8b);
      glassMaterial.emissive.setHex(daylight ? 0x9adce1 : 0x343b70);
      glassMaterial.emissiveIntensity = daylight ? 0.18 : 0.32;
    }
  }
}
