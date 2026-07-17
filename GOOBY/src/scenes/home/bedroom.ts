import {
  Color,
  Mesh,
  MeshStandardMaterial,
  type Group,
} from "three";
import type { Gesture } from "../../core/contracts/input";
import type { HomeZoneId } from "../../core/contracts/scenes";
import {
  advanceSimulation,
  startSleep,
  wakeEarly,
} from "../../core/contracts/simulation";
import { createProceduralAsset } from "../../render/proc";
import type { GameRenderer, ResourceTracker } from "../../render/renderer";
import { HomeZoneScene, type HomeSceneOptions } from "./base";
import { box, makeDoor, makeRoomShell, makeWindow } from "./primitives";

export class Bedroom extends HomeZoneScene {
  private readonly bed: Group;
  private readonly curtains: readonly [Mesh, Mesh];
  private readonly bedsideLamp: Group;
  private readonly doors = new Map<HomeZoneId, Group>();
  private curtainClosed = false;
  private dimmed = false;
  private wakeConfirmationPending = false;
  private wakePoseAge = Number.POSITIVE_INFINITY;

  constructor(
    renderer: GameRenderer,
    tracker: ResourceTracker,
    options: HomeSceneOptions = {},
  ) {
    super(renderer, tracker, "bedroom", options);
    this.add(makeRoomShell("bedroom"));

    this.bed = createProceduralAsset("furniture.bed") as Group;
    this.bed.name = "bedroom:dreamy-bed";
    this.bed.position.set(-2.35, 0, -2.05);
    this.bed.scale.set(1.35, 0.85, 1.2);

    const blanket = box([2.65, 0.18, 1.45], 0xc09bd2, [-2.35, 0.82, -1.98]);
    blanket.name = "bedroom:blanket";
    const pillow = box([0.85, 0.24, 1.1], 0xffe5d3, [-3.18, 1.02, -2]);
    pillow.rotation.z = -0.08;

    const window = makeWindow(0x7887b5);
    window.root.name = "bedroom:curtained-window";
    window.root.position.set(1, 4.25, -3.04);
    window.root.scale.setScalar(0.82);
    this.curtains = window.curtains;

    this.bedsideLamp = createProceduralAsset("furniture.lamp") as Group;
    this.bedsideLamp.name = "bedroom:night-light";
    this.bedsideLamp.position.set(-0.25, 0, -2.55);
    this.bedsideLamp.scale.setScalar(0.72);
    const rug = createProceduralAsset("furniture.rug");
    rug.name = "bedroom:soft-rug";
    rug.position.set(0.45, 0.04, 0.65);
    rug.scale.set(1.05, 1, 0.88);

    const sleepIcon = createProceduralAsset("icon.sleep");
    sleepIcon.name = "bedroom:moon";
    sleepIcon.position.set(1, 4.25, -2.86);
    sleepIcon.scale.setScalar(1.15);

    const bathroomDoor = makeDoor(0x8ebfbd, "right");
    bathroomDoor.name = "door:bathroom";
    bathroomDoor.position.set(4.22, 0, 0.95);
    bathroomDoor.rotation.y = -Math.PI / 2;
    const livingDoor = makeDoor(0xe3a074);
    livingDoor.name = "door:living-room";
    livingDoor.position.set(-4.22, 0, 1.15);
    livingDoor.rotation.y = Math.PI / 2;
    this.doors.set("bathroom", bathroomDoor);
    this.doors.set("living-room", livingDoor);

    this.gooby.root.position.set(0.25, 0.06, 0.6);
    this.gooby.root.scale.setScalar(0.96);
    this.add(
      this.bed,
      blanket,
      pillow,
      window.root,
      this.bedsideLamp,
      rug,
      sleepIcon,
      bathroomDoor,
      livingDoor,
      this.gooby.root,
    );
    this.finishScene();

    const sleeping = this.currentSave()?.simulation.sleep !== null;
    if (sleeping) this.applySleepingPose();
  }

  tuckIn(): boolean {
    const save = this.currentSave();
    if (!save || save.simulation.sleep) return false;
    const sleeping = { ...save, simulation: startSleep(save.simulation, this.clock.now()) };
    this.commit(sleeping);
    this.applySleepingPose();
    this.emit({ type: "need:changed", need: "energy", value: sleeping.simulation.needs.energy });
    this.emit({ type: "toast", message: "Tucked in for a real 30-minute nap." });
    return true;
  }

  private applySleepingPose(): void {
    this.setSleeping(true);
    this.curtainClosed = true;
    this.dimmed = true;
    this.gooby.root.position.set(-2.25, 0.58, -1.72);
    this.gooby.root.rotation.z = -0.32;
    this.gooby.root.scale.setScalar(0.62);
  }

  requestEarlyWake(): boolean {
    if (!this.currentSave()?.simulation.sleep) return false;
    this.wakeConfirmationPending = true;
    this.emit({ type: "sleep:confirm-wake" });
    this.emit({ type: "toast", message: "Wake Gooby before the nap is finished?" });
    return true;
  }

  cancelEarlyWake(): void {
    this.wakeConfirmationPending = false;
  }

  confirmEarlyWake(): boolean {
    const save = this.currentSave();
    if (!save?.simulation.sleep || !this.wakeConfirmationPending) return false;
    const awake = { ...save, simulation: wakeEarly(save.simulation, this.clock.now()) };
    this.wakeConfirmationPending = false;
    this.commitNeed(awake, "energy");
    this.beginWakePose();
    this.emit({ type: "toast", message: "Good morning, sleepy bun." });
    return true;
  }

  private beginWakePose(): void {
    this.setSleeping(false);
    this.curtainClosed = false;
    this.dimmed = false;
    this.wakePoseAge = 0;
    this.gooby.root.position.set(-2.15, 0.62, -1.62);
    this.gooby.root.rotation.z = -0.22;
    this.gooby.root.scale.setScalar(0.7);
    this.gooby.react("wake");
  }

  toggleCurtains(): boolean {
    this.curtainClosed = !this.curtainClosed;
    this.dimmed = this.curtainClosed;
    return this.curtainClosed;
  }

  protected override handleZoneGesture(gesture: Gesture): boolean {
    if (gesture.type !== "tap" && gesture.type !== "double-tap") return false;
    for (const [zone, door] of this.doors) {
      if (this.hit(door, gesture.x, gesture.y)) {
        this.navigateToZone(zone);
        return true;
      }
    }
    if (this.hit(this.bed, gesture.x, gesture.y)) {
      if (this.currentSave()?.simulation.sleep) this.requestEarlyWake();
      else this.tuckIn();
      return true;
    }
    if (this.hit(this.curtains[0], gesture.x, gesture.y) || this.hit(this.curtains[1], gesture.x, gesture.y)) {
      this.toggleCurtains();
      return true;
    }
    if (this.hit(this.bedsideLamp, gesture.x, gesture.y)) {
      this.dimmed = !this.dimmed;
      return true;
    }
    return false;
  }

  protected override updateZone(deltaSeconds: number): void {
    const save = this.currentSave();
    if (save?.simulation.sleep && this.clock.now() >= save.simulation.sleep.completesAt) {
      const completed = {
        ...save,
        simulation: advanceSimulation(save.simulation, this.clock.now()),
      };
      this.commitNeed(completed, "energy");
      this.beginWakePose();
    }
    if (save?.simulation.sleep) {
      this.gooby.root.position.set(-2.25, 0.58, -1.72);
      this.gooby.root.rotation.z = -0.32;
      this.gooby.root.scale.setScalar(0.62);
    }

    const curtainTarget = this.curtainClosed ? 0.67 : 1.58;
    this.curtains[0].position.x += (-curtainTarget - this.curtains[0].position.x) * Math.min(1, deltaSeconds * 3.2);
    this.curtains[1].position.x += (curtainTarget - this.curtains[1].position.x) * Math.min(1, deltaSeconds * 3.2);

    const targetColor = new Color(this.dimmed ? 0x7779a1 : 0xbbb5dc);
    const background = this.gameRenderer.scene.background;
    if (background instanceof Color) background.lerp(targetColor, Math.min(1, deltaSeconds * 2.6));
    this.gameRenderer.renderer.toneMappingExposure +=
      ((this.dimmed ? 0.67 : 1.05) - this.gameRenderer.renderer.toneMappingExposure) *
      Math.min(1, deltaSeconds * 2.2);

    this.bedsideLamp.traverse((child) => {
      if (!(child instanceof Mesh) || !(child.material instanceof MeshStandardMaterial)) return;
      if (child.position.y > 1.5) {
        child.material.emissive.setHex(0xffb85f);
        child.material.emissiveIntensity = this.dimmed ? 0.65 : 0.18;
      }
    });

    if (Number.isFinite(this.wakePoseAge)) {
      this.wakePoseAge += deltaSeconds;
      const progress = Math.min(1, this.wakePoseAge / 0.8);
      this.gooby.root.rotation.z = -0.85 * (1 - progress);
      const blend = progress * 0.12;
      this.gooby.root.position.x += (0.25 - this.gooby.root.position.x) * blend;
      this.gooby.root.position.y += (0.06 - this.gooby.root.position.y) * blend;
      this.gooby.root.position.z += (0.6 - this.gooby.root.position.z) * blend;
      this.gooby.root.scale.setScalar(0.8 + progress * 0.16);
      if (progress >= 1) {
        this.gooby.root.position.set(0.25, 0.06, 0.6);
        this.gooby.root.rotation.z = 0;
        this.gooby.root.scale.setScalar(0.96);
        this.wakePoseAge = Number.POSITIVE_INFINITY;
      }
    }
  }

  override dispose(): void {
    this.gameRenderer.renderer.toneMappingExposure = 1.05;
    super.dispose();
  }
}
