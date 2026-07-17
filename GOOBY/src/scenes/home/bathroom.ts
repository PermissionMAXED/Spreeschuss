import {
  BoxGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import type { Gesture } from "../../core/contracts/input";
import type { HomeZoneId } from "../../core/contracts/scenes";
import { createProceduralAsset } from "../../render/proc";
import type { GameRenderer, ResourceTracker } from "../../render/renderer";
import { HomeZoneScene, type HomeSceneOptions } from "./base";
import { box, makeDoor, makeMirror, makeRoomShell } from "./primitives";
import { applyScrubProgress, mutateNeed } from "./state";

interface Bubble {
  readonly object: Object3D;
  readonly drift: number;
  age: number;
}

export class Bathroom extends HomeZoneScene {
  private readonly tub: Object3D;
  private readonly water: Mesh;
  private readonly soap = new Group();
  private readonly toothbrush = new Group();
  private readonly mirror: Group;
  private readonly bubbles: Bubble[] = [];
  private readonly doors = new Map<HomeZoneId, Group>();
  private waterLevel = 0;
  private waterTarget = 0;
  private scrubProgress = 0;
  private scrubbing = false;

  constructor(
    renderer: GameRenderer,
    tracker: ResourceTracker,
    options: HomeSceneOptions = {},
  ) {
    super(renderer, tracker, "bathroom", options);
    this.add(makeRoomShell("bathroom"));

    this.tub = createProceduralAsset("furniture.bathtub");
    this.tub.name = "bathroom:bathtub";
    this.tub.position.set(-2.55, 0, -2.15);
    this.tub.scale.set(1.35, 0.9, 1.2);
    this.water = new Mesh(
      new BoxGeometry(2.55, 0.18, 1.05),
      new MeshPhysicalMaterial({
        color: 0x8edce7,
        roughness: 0.12,
        transmission: 0.25,
        transparent: true,
        opacity: 0.72,
      }),
    );
    this.water.name = "bathroom:tub-water";
    this.water.position.set(-2.55, 0.62, -2.12);
    this.water.scale.y = 0.01;
    this.water.visible = false;

    const vanity = new Group();
    vanity.name = "bathroom:vanity";
    vanity.add(
      box([2.15, 0.95, 0.82], 0xf0c7b0, [0, 0.475, 0]),
      box([2.3, 0.12, 0.92], 0xfff0dc, [0, 1.02, 0]),
    );
    vanity.position.set(2.5, 0, -2.65);
    this.mirror = makeMirror();
    this.mirror.name = "bathroom:mirror";
    this.mirror.position.set(2.5, 2.45, -3.02);

    const soapBar = box([0.46, 0.18, 0.28], 0xf6a9bc, [0, 0, 0]);
    const soapBubble = createProceduralAsset("particle.bubble");
    soapBubble.position.set(0.18, 0.2, 0);
    this.soap.name = "bathroom:soap";
    this.soap.add(soapBar, soapBubble);
    this.soap.position.set(1.8, 1.22, -2.15);

    const handle = box([0.08, 0.75, 0.08], 0x75a8b5);
    handle.rotation.z = -0.24;
    const bristles = box([0.24, 0.14, 0.11], 0xf8eff0, [0.08, 0.36, 0]);
    this.toothbrush.name = "bathroom:toothbrush";
    this.toothbrush.add(handle, bristles);
    this.toothbrush.position.set(3.05, 1.32, -2.18);

    const towelRail = box([1.5, 0.1, 0.1], 0xe5c260, [3.55, 2.2, -2.95]);
    const towel = box([0.9, 1.05, 0.08], 0xf5aab8, [3.55, 1.68, -2.87]);
    const bedroomDoor = makeDoor(0xb6a4cc, "right");
    bedroomDoor.name = "door:bedroom";
    bedroomDoor.position.set(4.25, 0, 0.95);
    bedroomDoor.rotation.y = -Math.PI / 2;
    const kitchenDoor = makeDoor(0x87bca7);
    kitchenDoor.name = "door:kitchen";
    kitchenDoor.position.set(-4.25, 0, 1.1);
    kitchenDoor.rotation.y = Math.PI / 2;
    this.doors.set("bedroom", bedroomDoor);
    this.doors.set("kitchen", kitchenDoor);

    this.gooby.root.position.set(0, 0.06, 0.65);
    this.gooby.root.scale.setScalar(0.84);
    this.add(
      this.tub,
      this.water,
      vanity,
      this.mirror,
      this.soap,
      this.toothbrush,
      towelRail,
      towel,
      bedroomDoor,
      kitchenDoor,
      this.gooby.root,
    );
    this.finishScene();
  }

  fillTub(): void {
    this.waterTarget = 1;
    this.water.visible = true;
    this.emit({ type: "toast", message: "Warm bubble bath filling up…" });
  }

  drainTub(): void {
    this.waterTarget = 0;
    this.emit({ type: "toast", message: "Glug, glug—bath drained." });
  }

  toggleTub(): boolean {
    if (this.waterTarget > 0) this.drainTub();
    else this.fillTub();
    return this.waterTarget > 0;
  }

  scrub(amount: number): number {
    const save = this.currentSave();
    if (!save) {
      this.scrubProgress = Math.max(0, Math.min(1, this.scrubProgress + amount));
      return this.scrubProgress;
    }
    const result = applyScrubProgress(save, this.scrubProgress, amount, this.clock);
    this.scrubProgress = result.progress;
    this.spawnBubbles(Math.max(1, Math.round(amount * 12)));
    if (result.cleaned) {
      this.commitNeed(result.save, "hygiene");
      this.gooby.react("pet");
      this.emit({ type: "toast", message: "Squeaky clean! Hygiene +28" });
    }
    return this.scrubProgress;
  }

  useToothbrush(): boolean {
    const save = this.currentSave();
    if (!save) return false;
    const brushed = mutateNeed(save, "hygiene", 6, this.clock);
    this.commitNeed(brushed, "hygiene");
    this.gooby.react("tickle");
    this.emit({ type: "toast", message: "Sparkly buck tooth! Hygiene +6" });
    return true;
  }

  lookInMirror(): void {
    this.gooby.react("poke");
    this.emit({ type: "toast", message: "Who is that very round rabbit?" });
  }

  private spawnBubbles(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const object = createProceduralAsset("particle.bubble");
      object.position.set(
        -0.5 + (index % 5) * 0.24,
        1.05 + (index % 3) * 0.3,
        0.9,
      );
      object.scale.setScalar(0.72 + (index % 2) * 0.3);
      this.root.add(object);
      this.trackDynamic(object);
      this.bubbles.push({ object, drift: (index % 2 === 0 ? 1 : -1) * (0.08 + index * 0.006), age: 0 });
    }
  }

  protected override handleZoneGesture(gesture: Gesture): boolean {
    if (gesture.type === "tap" || gesture.type === "double-tap") {
      for (const [zone, door] of this.doors) {
        if (this.hit(door, gesture.x, gesture.y)) {
          this.navigateToZone(zone);
          return true;
        }
      }
    }
    if (gesture.type === "tap" && this.hit(this.tub, gesture.x, gesture.y)) {
      this.toggleTub();
      return true;
    }
    if (gesture.type === "tap" && this.hit(this.toothbrush, gesture.x, gesture.y)) {
      this.useToothbrush();
      return true;
    }
    if (gesture.type === "tap" && this.hit(this.mirror, gesture.x, gesture.y)) {
      this.lookInMirror();
      return true;
    }
    if (gesture.type === "press-start" && this.hit(this.soap, gesture.x, gesture.y)) {
      this.scrubbing = true;
      return true;
    }
    if (gesture.type === "press-move" && this.scrubbing) {
      if (this.hitGooby(gesture.x, gesture.y)) this.scrub(Math.min(0.24, Math.hypot(gesture.dx, gesture.dy) / 300));
      return true;
    }
    if (gesture.type === "press-end" && this.scrubbing) {
      this.scrubbing = false;
      this.soap.position.set(1.8, 1.22, -2.15);
      return true;
    }
    return false;
  }

  protected override updateZone(deltaSeconds: number): void {
    this.waterLevel += (this.waterTarget - this.waterLevel) * Math.min(1, deltaSeconds * 2.8);
    this.water.scale.y = Math.max(0.01, this.waterLevel);
    this.water.position.y = 0.5 + this.waterLevel * 0.15;
    if (this.waterTarget === 0 && this.waterLevel < 0.015) this.water.visible = false;

    const material = this.water.material;
    if (material instanceof MeshStandardMaterial) {
      material.emissive.setHex(0x77cbd8);
      material.emissiveIntensity = 0.08 + Math.sin(this.elapsed * 2) * 0.03;
    }

    for (let index = this.bubbles.length - 1; index >= 0; index -= 1) {
      const bubble = this.bubbles[index];
      if (!bubble) continue;
      bubble.age += deltaSeconds;
      bubble.object.position.y += deltaSeconds * (0.35 + bubble.age * 0.08);
      bubble.object.position.x += bubble.drift * deltaSeconds;
      bubble.object.rotation.y += deltaSeconds * 1.8;
      if (bubble.age > 2.2) {
        bubble.object.removeFromParent();
        this.bubbles.splice(index, 1);
      }
    }
  }
}
