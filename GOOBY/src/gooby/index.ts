import {
  BoxGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Texture,
  TorusGeometry,
} from "three";
import type { GoobyActor, GoobyMood, GoobyReaction } from "../core/contracts/gooby";
import type { AssetKey, AssetLoader } from "../core/contracts/assets";
import type { Needs } from "../core/contracts/simulation";
import { deriveCareMood, type CareMood } from "../data/emotions";
import { FallbackAssetLoader } from "../render/proc";
import type { BufferGeometry, Material, Vector3 } from "three";

export const CHARACTER_TRIANGLE_BUDGET = 12_000;
export const COSMETIC_SOCKETS = ["head", "ears", "neck", "back"] as const;

export type CosmeticSocket = (typeof COSMETIC_SOCKETS)[number];
export type CharacterReaction =
  | GoobyReaction
  | "bathe"
  | "shiver"
  | "fall-asleep"
  | "wake-stretch"
  | "celebrate"
  | "sad";

export type ReactionPhase =
  | "idle"
  | "respond"
  | "tickle-1"
  | "tickle-2"
  | "tickle-3"
  | "anticipate"
  | "chew"
  | "swallow"
  | "fall-asleep"
  | "sleep"
  | "wake-stretch";

export interface ProceduralGoobyOptions {
  readonly assetLoader?: AssetLoader;
}

type Disposable = { dispose(): void };
type CharacterMesh = Mesh<BufferGeometry, MeshStandardMaterial>;

interface CosmeticSlotState {
  readonly anchor: Group;
  readonly resources: Set<Disposable>;
  generation: number;
  key: AssetKey | null;
  object: Object3D | null;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const smoothstep = (value: number): number => value * value * (3 - 2 * value);

const legacyMoodFor = (mood: CareMood): GoobyMood => {
  if (mood === "ecstatic" || mood === "happy") return "delighted";
  if (mood === "sleepy") return "sleepy";
  if (mood === "content") return "content";
  return "grumpy";
};

const collectMaterialResources = (material: Material, resources: Set<Disposable>): void => {
  resources.add(material);
  for (const value of Object.values(material)) {
    if (value instanceof Texture) resources.add(value);
  }
};

const collectTreeResources = (root: Object3D, resources: Set<Disposable>): void => {
  root.traverse((child) => {
    const renderable = child as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    if (renderable.geometry) resources.add(renderable.geometry);
    if (Array.isArray(renderable.material)) {
      for (const material of renderable.material) collectMaterialResources(material, resources);
    } else if (renderable.material) {
      collectMaterialResources(renderable.material, resources);
    }
  });
};

const disposeResources = (resources: Set<Disposable>): void => {
  for (const resource of resources) resource.dispose();
  resources.clear();
};

const disposeTree = (root: Object3D): void => {
  const resources = new Set<Disposable>();
  collectTreeResources(root, resources);
  root.removeFromParent();
  disposeResources(resources);
};

export function countCharacterTriangles(root: Object3D): number {
  let triangles = 0;
  root.traverse((child) => {
    const geometry = (child as Object3D & { geometry?: BufferGeometry }).geometry;
    if (!geometry) return;
    triangles += geometry.index
      ? geometry.index.count / 3
      : geometry.attributes.position
        ? geometry.attributes.position.count / 3
        : 0;
  });
  return triangles;
}

export class ProceduralGooby implements GoobyActor {
  readonly root = new Group();
  readonly interactionTarget: Object3D;
  private readonly rig = new Group();
  private readonly belly: CharacterMesh;
  private readonly tummyPatch: CharacterMesh;
  private readonly head = new Group();
  private readonly muzzles: readonly [CharacterMesh, CharacterMesh];
  private readonly cheeks: readonly [CharacterMesh, CharacterMesh];
  private readonly tooth: CharacterMesh;
  private readonly mouth: CharacterMesh;
  private readonly ears: readonly [Group, Group];
  private readonly eyes: readonly [Group, Group];
  private readonly pupils: readonly [CharacterMesh, CharacterMesh];
  private readonly brows: readonly [CharacterMesh, CharacterMesh];
  private readonly arms: readonly [CharacterMesh, CharacterMesh];
  private readonly feet: readonly [CharacterMesh, CharacterMesh];
  private readonly tail = new Group();
  private readonly ownResources = new Set<Disposable>();
  private readonly assetLoader: AssetLoader;
  private readonly ownsAssetLoader: boolean;
  private readonly cosmeticSlots: Readonly<Record<CosmeticSocket, CosmeticSlotState>>;
  private currentMood: GoobyMood = "content";
  private currentCareMood: CareMood = "content";
  private sleeping = false;
  private reaction: CharacterReaction | null = null;
  private reactionAge = 0;
  private reactionDuration = 0;
  private tickleLevel = 0;
  private tickleWindow = 0;
  private leftEarSpring = 0;
  private rightEarSpring = 0;
  private leftEarVelocity = 0;
  private rightEarVelocity = 0;
  private tailSpring = 0;
  private tailVelocity = 0;
  private bellySpring = 0;
  private bellyVelocity = 0;
  private lookX = 0;
  private lookY = 0;
  private disposed = false;

  constructor(options: ProceduralGoobyOptions = {}) {
    this.assetLoader = options.assetLoader ?? new FallbackAssetLoader();
    this.ownsAssetLoader = options.assetLoader === undefined;
    this.root.name = "Gooby";
    this.rig.name = "Gooby.animation-rig";
    this.root.add(this.rig);

    const sphere = this.track(new SphereGeometry(1, 18, 12));
    const capsule = this.track(new CapsuleGeometry(0.5, 1, 5, 12));
    const box = this.track(new BoxGeometry(1, 1, 1));
    const mouthArc = this.track(new TorusGeometry(0.16, 0.022, 6, 12, Math.PI));
    const cream = this.createMaterial(0xf6d6a7);
    const apricot = this.createMaterial(0xe9a46e);
    const deepApricot = this.createMaterial(0xd9855e);
    const muzzle = this.createMaterial(0xffe7c5);
    const cheek = this.createMaterial(0xee8e87, 0.72);
    const innerEar = this.createMaterial(0xefaaa0, 0.78);
    const eyeWhite = this.createMaterial(0xfff8e8, 0.58);
    const pupil = this.createMaterial(0x382e38, 0.5);
    const glint = this.createMaterial(0xffffff, 0.36);
    const nose = this.createMaterial(0xc86f76, 0.65);
    const tooth = this.createMaterial(0xfffdf4, 0.45);
    const mouth = this.createMaterial(0x8b5055, 0.74);

    this.belly = this.createMesh(sphere, cream, "Gooby.belly");
    this.belly.scale.set(1.3, 1.48, 1.02);
    this.belly.position.y = 1.45;
    this.interactionTarget = this.belly;

    this.tummyPatch = this.createMesh(sphere, apricot, "Gooby.apricot-tummy");
    this.tummyPatch.scale.set(0.88, 1.1, 0.73);
    this.tummyPatch.position.set(0, 1.34, 0.58);

    const haunchLeft = this.createMesh(sphere, apricot, "Gooby.haunch.left");
    haunchLeft.scale.set(0.76, 0.66, 0.72);
    haunchLeft.position.set(-0.78, 0.67, -0.02);
    const haunchRight = this.createMesh(sphere, apricot, "Gooby.haunch.right");
    haunchRight.scale.copy(haunchLeft.scale);
    haunchRight.position.set(0.78, 0.67, -0.02);

    const headShape = this.createMesh(sphere, cream, "Gooby.head");
    headShape.scale.set(0.92, 0.84, 0.84);
    this.head.name = "Gooby.head-rig";
    this.head.position.set(0, 3.03, 0.06);
    this.head.add(headShape);

    const muzzleLeft = this.createMesh(sphere, muzzle, "Gooby.muzzle.left");
    muzzleLeft.scale.set(0.34, 0.27, 0.25);
    muzzleLeft.position.set(-0.2, -0.22, 0.71);
    const muzzleRight = this.createMesh(sphere, muzzle, "Gooby.muzzle.right");
    muzzleRight.scale.copy(muzzleLeft.scale);
    muzzleRight.position.set(0.2, -0.22, 0.71);
    this.muzzles = [muzzleLeft, muzzleRight];

    const noseMesh = this.createMesh(sphere, nose, "Gooby.nose");
    noseMesh.scale.set(0.13, 0.1, 0.09);
    noseMesh.position.set(0, -0.06, 0.81);

    const cheekLeft = this.createMesh(sphere, cheek, "Gooby.cheek.left");
    cheekLeft.scale.set(0.2, 0.12, 0.055);
    cheekLeft.position.set(-0.52, -0.2, 0.66);
    const cheekRight = this.createMesh(sphere, cheek, "Gooby.cheek.right");
    cheekRight.scale.copy(cheekLeft.scale);
    cheekRight.position.x = 0.52;
    cheekRight.position.y = -0.2;
    cheekRight.position.z = 0.66;
    this.cheeks = [cheekLeft, cheekRight];

    this.tooth = this.createMesh(box, tooth, "Gooby.buck-tooth");
    this.tooth.scale.set(0.23, 0.3, 0.09);
    this.tooth.position.set(0, -0.48, 0.78);

    this.mouth = this.createMesh(mouthArc, mouth, "Gooby.mouth");
    this.mouth.position.set(0, -0.38, 0.77);
    this.mouth.rotation.z = Math.PI;

    const makeEar = (name: string, innerName: string): Group => {
      const pivot = new Group();
      pivot.name = name;
      const outer = this.createMesh(capsule, cream, `${name}.outer`);
      outer.scale.set(0.48, 0.9, 0.34);
      outer.position.y = 0.55;
      const inset = this.createMesh(capsule, innerEar, innerName);
      inset.scale.set(0.29, 0.68, 0.2);
      inset.position.set(0, 0.57, 0.29);
      pivot.add(outer, inset);
      return pivot;
    };
    const uprightEar = makeEar("Gooby.ear.upright", "Gooby.ear.upright.inner");
    uprightEar.position.set(-0.4, 3.57, -0.02);
    uprightEar.rotation.z = 0.14;
    const lopEar = makeEar("Gooby.ear.lop", "Gooby.ear.lop.inner");
    lopEar.position.set(0.43, 3.58, 0);
    lopEar.rotation.z = -1.08;
    lopEar.scale.set(0.92, 0.86, 0.94);
    this.ears = [uprightEar, lopEar];

    const makeEye = (x: number, side: "left" | "right"): {
      readonly group: Group;
      readonly pupil: CharacterMesh;
      readonly brow: CharacterMesh;
    } => {
      const eyeGroup = new Group();
      eyeGroup.name = `Gooby.eye.${side}`;
      eyeGroup.position.set(x, 0.12, 0.73);
      const white = this.createMesh(sphere, eyeWhite, `Gooby.eye.${side}.white`);
      white.scale.set(0.17, 0.22, 0.075);
      const pupilMesh = this.createMesh(sphere, pupil, `Gooby.eye.${side}.pupil`);
      pupilMesh.scale.set(0.095, 0.145, 0.055);
      pupilMesh.position.z = 0.065;
      const shine = this.createMesh(sphere, glint, `Gooby.eye.${side}.glint`);
      shine.scale.set(0.035, 0.045, 0.022);
      shine.position.set(-0.035, 0.05, 0.115);
      eyeGroup.add(white, pupilMesh, shine);
      const brow = this.createMesh(box, deepApricot, `Gooby.brow.${side}`);
      brow.scale.set(0.25, 0.035, 0.035);
      brow.position.set(x, 0.41, 0.69);
      return { group: eyeGroup, pupil: pupilMesh, brow };
    };
    const leftEye = makeEye(-0.31, "left");
    const rightEye = makeEye(0.31, "right");
    this.eyes = [leftEye.group, rightEye.group];
    this.pupils = [leftEye.pupil, rightEye.pupil];
    this.brows = [leftEye.brow, rightEye.brow];

    const armLeft = this.createMesh(sphere, cream, "Gooby.arm.left");
    armLeft.scale.set(0.24, 0.56, 0.25);
    armLeft.position.set(-1.08, 1.65, 0.2);
    armLeft.rotation.z = -0.24;
    const armRight = this.createMesh(sphere, cream, "Gooby.arm.right");
    armRight.scale.copy(armLeft.scale);
    armRight.position.set(1.08, 1.65, 0.2);
    armRight.rotation.z = 0.24;
    this.arms = [armLeft, armRight];

    const footLeft = this.createMesh(sphere, cream, "Gooby.foot.left");
    footLeft.scale.set(0.6, 0.29, 0.78);
    footLeft.position.set(-0.62, 0.24, 0.38);
    const footRight = this.createMesh(sphere, cream, "Gooby.foot.right");
    footRight.scale.copy(footLeft.scale);
    footRight.position.set(0.62, 0.24, 0.38);
    this.feet = [footLeft, footRight];
    const padLeft = this.createMesh(sphere, innerEar, "Gooby.foot.left.pad");
    padLeft.scale.set(0.28, 0.08, 0.38);
    padLeft.position.set(-0.62, 0.21, 1.04);
    const padRight = this.createMesh(sphere, innerEar, "Gooby.foot.right.pad");
    padRight.scale.copy(padLeft.scale);
    padRight.position.x = 0.62;
    padRight.position.y = 0.21;
    padRight.position.z = 1.04;

    this.tail.name = "Gooby.tail-rig";
    this.tail.position.set(0.94, 1.22, -0.69);
    const tailShape = this.createMesh(sphere, muzzle, "Gooby.tail");
    tailShape.scale.set(0.4, 0.4, 0.4);
    this.tail.add(tailShape);

    const headSocket = new Group();
    headSocket.name = "Gooby.socket.head";
    headSocket.position.set(0, 0.68, 0);
    const earsSocket = new Group();
    earsSocket.name = "Gooby.socket.ears";
    earsSocket.position.set(0, 4.42, 0.02);
    const neckSocket = new Group();
    neckSocket.name = "Gooby.socket.neck";
    neckSocket.position.set(0, 2.48, 0.32);
    const backSocket = new Group();
    backSocket.name = "Gooby.socket.back";
    backSocket.position.set(0, 1.92, -0.9);
    this.head.add(headSocket);
    this.cosmeticSlots = {
      head: this.createCosmeticSlot(headSocket),
      ears: this.createCosmeticSlot(earsSocket),
      neck: this.createCosmeticSlot(neckSocket),
      back: this.createCosmeticSlot(backSocket),
    };

    this.head.add(
      muzzleLeft,
      muzzleRight,
      noseMesh,
      cheekLeft,
      cheekRight,
      this.tooth,
      this.mouth,
      ...this.eyes,
      ...this.brows,
    );
    this.rig.add(
      haunchLeft,
      haunchRight,
      this.tail,
      this.belly,
      this.tummyPatch,
      this.head,
      uprightEar,
      lopEar,
      armLeft,
      armRight,
      footLeft,
      footRight,
      padLeft,
      padRight,
      earsSocket,
      neckSocket,
      backSocket,
    );

    const triangles = countCharacterTriangles(this.root);
    if (triangles > CHARACTER_TRIANGLE_BUDGET) {
      this.dispose();
      throw new Error(`Gooby exceeds triangle budget: ${triangles}/${CHARACTER_TRIANGLE_BUDGET}`);
    }
  }

  private track<T extends Disposable>(resource: T): T {
    this.ownResources.add(resource);
    return resource;
  }

  private createMaterial(color: number, roughness = 0.86): MeshStandardMaterial {
    return this.track(new MeshStandardMaterial({ color, roughness }));
  }

  private createMesh(
    geometry: BufferGeometry,
    meshMaterial: MeshStandardMaterial,
    name: string,
  ): CharacterMesh {
    const value = new Mesh(geometry, meshMaterial);
    value.name = name;
    value.castShadow = true;
    value.receiveShadow = true;
    return value;
  }

  private createCosmeticSlot(anchor: Group): CosmeticSlotState {
    return {
      anchor,
      resources: new Set<Disposable>(),
      generation: 0,
      key: null,
      object: null,
    };
  }

  get mood(): GoobyMood {
    return this.currentMood;
  }

  get careMood(): CareMood {
    return this.currentCareMood;
  }

  get activeReaction(): CharacterReaction | null {
    return this.reaction;
  }

  get reactionPhase(): ReactionPhase {
    if (!this.reaction) return this.sleeping ? "sleep" : "idle";
    if (this.reaction === "tickle") {
      if (this.tickleLevel === 1) return "tickle-1";
      if (this.tickleLevel === 2) return "tickle-2";
      return "tickle-3";
    }
    if (this.reaction === "feed") {
      if (this.reactionAge < 0.28) return "anticipate";
      if (this.reactionAge < 1.45) return "chew";
      return "swallow";
    }
    if (this.reaction === "fall-asleep" || this.reaction === "sleep") return "fall-asleep";
    if (this.reaction === "wake" || this.reaction === "wake-stretch") return "wake-stretch";
    return "respond";
  }

  get tickleIntensity(): number {
    return this.tickleLevel;
  }

  get triangleCount(): number {
    return countCharacterTriangles(this.root);
  }

  get resourceCount(): number {
    let count = this.ownResources.size;
    count += this.cosmeticSlots.head.resources.size;
    count += this.cosmeticSlots.ears.resources.size;
    count += this.cosmeticSlots.neck.resources.size;
    count += this.cosmeticSlots.back.resources.size;
    return count;
  }

  setMood(mood: GoobyMood): void {
    this.currentMood = mood;
  }

  updateNeeds(needs: Needs): CareMood {
    this.currentCareMood = deriveCareMood(needs, this.currentCareMood);
    if (!this.reaction && !this.sleeping) this.currentMood = legacyMoodFor(this.currentCareMood);
    return this.currentCareMood;
  }

  lookAt(target?: Vector3): void {
    if (!target) {
      this.lookX = 0;
      this.lookY = 0;
      return;
    }
    this.lookX = clamp(target.x * 0.35, -1, 1);
    this.lookY = clamp((target.y - 2.8) * 0.35, -1, 1);
  }

  react(reaction: GoobyReaction, at?: Vector3): void;
  react(reaction: CharacterReaction, at?: Vector3): void;
  react(reaction: CharacterReaction, at?: Vector3): void {
    if (this.disposed) return;
    if (at) this.lookAt(at);
    if (reaction === "sleep" || reaction === "fall-asleep") {
      this.setSleeping(true);
      return;
    }
    if (reaction === "wake" || reaction === "wake-stretch") {
      this.sleeping = false;
      this.beginReaction("wake-stretch", 1.45);
      this.currentMood = legacyMoodFor(this.currentCareMood);
      return;
    }
    if (reaction === "tickle") {
      this.tickleLevel = this.tickleWindow > 0 ? Math.min(3, this.tickleLevel + 1) : 1;
      this.tickleWindow = 1.25;
    }
    const duration = reaction === "pet"
      ? 1.15
      : reaction === "tickle"
        ? 0.95 + this.tickleLevel * 0.12
        : reaction === "poke"
          ? 0.78
          : reaction === "feed"
            ? 1.85
            : reaction === "bathe"
              ? 1.55
              : reaction === "shiver"
                ? 1.1
                : reaction === "celebrate"
                  ? 1.7
                  : 1.8;
    this.beginReaction(reaction, duration);
    if (reaction === "pet" || reaction === "tickle" || reaction === "feed" || reaction === "celebrate") {
      this.currentMood = "delighted";
    } else if (reaction === "poke" || reaction === "bathe" || reaction === "shiver") {
      this.currentMood = "curious";
    } else if (reaction === "sad") {
      this.currentMood = "grumpy";
    }
    const impulse = reaction === "tickle" ? 1.3 + this.tickleLevel * 0.45 : 0.65;
    this.leftEarVelocity += impulse;
    this.rightEarVelocity -= impulse * 0.72;
    this.tailVelocity += reaction === "sad" ? -0.8 : impulse * 1.25;
    this.bellyVelocity += reaction === "poke" ? -0.7 : impulse * 0.35;
  }

  private beginReaction(reaction: CharacterReaction, duration: number): void {
    this.reaction = reaction;
    this.reactionAge = 0;
    this.reactionDuration = duration;
  }

  setSleeping(sleeping: boolean): void {
    if (this.disposed) return;
    if (sleeping && this.sleeping && this.reaction === "fall-asleep") return;
    this.sleeping = sleeping;
    if (sleeping) {
      this.currentMood = "sleepy";
      this.beginReaction("fall-asleep", 1.65);
      this.leftEarVelocity += 0.35;
      this.rightEarVelocity += 0.28;
    } else {
      this.currentMood = legacyMoodFor(this.currentCareMood);
      this.beginReaction("wake-stretch", 1.45);
      this.leftEarVelocity -= 0.65;
      this.rightEarVelocity -= 0.42;
    }
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    if (this.disposed) return;
    const delta = clamp(deltaSeconds, 0, 0.05);
    this.reactionAge += deltaSeconds;
    this.tickleWindow = Math.max(0, this.tickleWindow - deltaSeconds);

    let reactionProgress = 0;
    let reactionEnvelope = 0;
    if (this.reaction && this.reactionDuration > 0) {
      reactionProgress = clamp(this.reactionAge / this.reactionDuration, 0, 1);
      reactionEnvelope = Math.sin(reactionProgress * Math.PI);
      if (reactionProgress >= 1) {
        this.reaction = null;
        this.reactionAge = 0;
        this.reactionDuration = 0;
        this.currentMood = this.sleeping ? "sleepy" : legacyMoodFor(this.currentCareMood);
        reactionProgress = 0;
        reactionEnvelope = 0;
      }
    }

    const breathRate = this.sleeping ? 2.05 : this.currentCareMood === "ecstatic" ? 4.1 : 3.05;
    const breath = Math.sin(elapsedSeconds * breathRate) * (this.sleeping ? 0.026 : 0.018);
    const weightShift = Math.sin(elapsedSeconds * 0.72) * (this.sleeping ? 0.008 : 0.024);
    let hop = 0;
    let shake = 0;
    let lean = 0;
    let squash = 0;
    let stretch = 0;
    let armLift = 0;
    let chew = 0;
    let headNod = 0;
    let sleepBlend = this.sleeping && this.reaction !== "fall-asleep" ? 1 : 0;
    let earTargetLeft = this.sleeping ? 0.46 : 0;
    let earTargetRight = this.sleeping ? 0.34 : 0.08;
    let tailTarget = this.sleeping ? -0.35 : Math.sin(elapsedSeconds * 1.4) * 0.055;

    if (this.currentCareMood === "sad") {
      headNod += 0.1;
      earTargetLeft += 0.18;
      earTargetRight += 0.12;
      tailTarget -= 0.18;
    } else if (this.currentCareMood === "sleepy") {
      headNod += 0.055;
      earTargetLeft += 0.1;
    } else if (this.currentCareMood === "ecstatic" && !this.sleeping) {
      hop += (Math.sin(elapsedSeconds * 4.5) + 1) * 0.025;
      tailTarget += Math.sin(elapsedSeconds * 9) * 0.2;
    } else if (this.currentCareMood === "bored") {
      lean += Math.sin(elapsedSeconds * 0.38) * 0.035;
    }

    if (this.reaction === "pet") {
      lean += reactionEnvelope * 0.085;
      headNod -= reactionEnvelope * 0.12;
      tailTarget += Math.sin(this.reactionAge * 16) * reactionEnvelope * 0.38;
      earTargetLeft -= reactionEnvelope * 0.12;
      armLift += reactionEnvelope * 0.08;
    } else if (this.reaction === "tickle") {
      const ticklePower = 0.72 + this.tickleLevel * 0.18;
      shake += Math.sin(this.reactionAge * (18 + this.tickleLevel * 6))
        * reactionEnvelope
        * 0.075
        * ticklePower;
      hop += Math.abs(Math.sin(this.reactionAge * 9)) * reactionEnvelope * 0.11 * ticklePower;
      squash += Math.sin(this.reactionAge * 22) * reactionEnvelope * 0.055 * ticklePower;
      armLift += reactionEnvelope * (0.25 + this.tickleLevel * 0.08);
      tailTarget += Math.sin(this.reactionAge * 24) * reactionEnvelope * 0.45;
      earTargetLeft += Math.sin(this.reactionAge * 20) * reactionEnvelope * 0.16;
      earTargetRight -= Math.sin(this.reactionAge * 18) * reactionEnvelope * 0.13;
    } else if (this.reaction === "poke") {
      lean -= reactionEnvelope * 0.13;
      shake += Math.sin(this.reactionAge * 18) * reactionEnvelope * 0.06;
      squash -= reactionEnvelope * 0.045;
      headNod -= reactionEnvelope * 0.06;
    } else if (this.reaction === "feed") {
      hop += Math.sin(Math.min(1, reactionProgress * 2.4) * Math.PI) * 0.08;
      chew = this.reactionAge > 0.26
        ? Math.abs(Math.sin((this.reactionAge - 0.26) * 13)) * reactionEnvelope
        : 0;
      headNod += Math.sin(this.reactionAge * 13) * reactionEnvelope * 0.035;
      tailTarget += Math.sin(this.reactionAge * 11) * reactionEnvelope * 0.22;
    } else if (this.reaction === "bathe" || this.reaction === "shiver") {
      const shiverRate = this.reaction === "bathe" ? 26 : 34;
      shake += Math.sin(this.reactionAge * shiverRate) * reactionEnvelope * 0.055;
      squash -= reactionEnvelope * 0.035;
      earTargetLeft += reactionEnvelope * 0.32;
      earTargetRight += reactionEnvelope * 0.25;
      this.lookY = clamp(this.lookY + deltaSeconds * 0.8, -0.7, 0.2);
    } else if (this.reaction === "fall-asleep") {
      sleepBlend = smoothstep(reactionProgress);
      headNod += sleepBlend * 0.18;
      earTargetLeft += sleepBlend * 0.46;
      earTargetRight += sleepBlend * 0.26;
      lean += sleepBlend * 0.075;
    } else if (this.reaction === "wake" || this.reaction === "wake-stretch") {
      stretch += reactionEnvelope * 0.13;
      armLift += reactionEnvelope * 0.72;
      headNod -= reactionEnvelope * 0.12;
      earTargetLeft -= reactionEnvelope * 0.2;
      earTargetRight -= reactionEnvelope * 0.12;
      hop += Math.sin(reactionProgress * Math.PI) * 0.075;
    } else if (this.reaction === "celebrate") {
      hop += Math.abs(Math.sin(reactionProgress * Math.PI * 2)) * reactionEnvelope * 0.28;
      stretch += reactionEnvelope * 0.09;
      armLift += reactionEnvelope * 0.9;
      shake += Math.sin(this.reactionAge * 10) * reactionEnvelope * 0.04;
      tailTarget += Math.sin(this.reactionAge * 20) * reactionEnvelope * 0.48;
    } else if (this.reaction === "sad") {
      headNod += reactionEnvelope * 0.18;
      squash -= reactionEnvelope * 0.055;
      earTargetLeft += reactionEnvelope * 0.38;
      earTargetRight += reactionEnvelope * 0.25;
      tailTarget -= reactionEnvelope * 0.32;
    }

    this.bellyVelocity += (-this.bellySpring * 42 - this.bellyVelocity * 8.5) * delta;
    this.bellySpring += this.bellyVelocity * delta;
    this.leftEarVelocity += (earTargetLeft - this.leftEarSpring) * 34 * delta;
    this.leftEarVelocity *= Math.pow(0.0018, delta);
    this.leftEarSpring += this.leftEarVelocity * delta;
    this.rightEarVelocity += (earTargetRight - this.rightEarSpring) * 30 * delta;
    this.rightEarVelocity *= Math.pow(0.0024, delta);
    this.rightEarSpring += this.rightEarVelocity * delta;
    this.tailVelocity += (tailTarget - this.tailSpring) * 45 * delta;
    this.tailVelocity *= Math.pow(0.0012, delta);
    this.tailSpring += this.tailVelocity * delta;

    const jiggle = this.bellySpring + squash;
    this.belly.scale.set(1.3 + jiggle, 1.48 + breath - jiggle * 0.58, 1.02 + jiggle * 0.22);
    this.tummyPatch.scale.set(
      0.88 + jiggle * 0.64,
      1.1 + breath * 0.7 - jiggle * 0.38,
      0.73 + jiggle * 0.16,
    );
    this.rig.position.set(weightShift + shake, hop - sleepBlend * 0.06, 0);
    this.rig.rotation.z = lean + weightShift * 0.35;
    this.rig.scale.set(1 + squash * 0.28, 1 + stretch - squash, 1 + squash * 0.2);

    this.ears[0].rotation.x = this.leftEarSpring;
    this.ears[1].rotation.x = this.rightEarSpring;
    this.tail.rotation.z = this.tailSpring;
    this.head.rotation.x = headNod + Math.sin(elapsedSeconds * 0.82) * 0.014;
    this.head.rotation.z = -lean * 0.38 + shake * 0.22;
    this.muzzles[0].scale.y = 0.27 + chew * 0.055;
    this.muzzles[1].scale.y = 0.27 + chew * 0.055;
    this.muzzles[0].position.x = -0.2 - chew * 0.018;
    this.muzzles[1].position.x = 0.2 + chew * 0.018;
    this.tooth.position.y = -0.48 - chew * 0.035;
    this.mouth.scale.y = 1 + chew * 0.45;

    this.arms[0].rotation.z = -0.24 - armLift;
    this.arms[1].rotation.z = 0.24 + armLift;
    this.arms[0].position.y = 1.65 + armLift * 0.17;
    this.arms[1].position.y = 1.65 + armLift * 0.17;
    this.feet[0].rotation.x = -hop * 0.9;
    this.feet[1].rotation.x = -hop * 0.9;

    const blinkPeriod = this.currentCareMood === "sleepy" ? 3.1 : 4.55;
    const blinkCycle = elapsedSeconds % blinkPeriod;
    let eyeOpen = this.sleeping ? 0.045 : 1;
    if (!this.sleeping && blinkCycle > blinkPeriod - 0.18) {
      eyeOpen = Math.max(0.055, Math.abs(blinkCycle - (blinkPeriod - 0.09)) * 10.5);
    }
    if (this.currentCareMood === "sleepy" && !this.reaction) eyeOpen *= 0.58;
    if (this.currentCareMood === "sad" || this.reaction === "sad") eyeOpen *= 0.78;
    if (this.reaction === "tickle" || this.reaction === "celebrate") {
      eyeOpen = Math.max(eyeOpen, 0.9 + reactionEnvelope * 0.18);
    }
    if (this.reaction === "poke") eyeOpen = 1 + reactionEnvelope * 0.24;
    if (this.reaction === "fall-asleep") eyeOpen *= 1 - sleepBlend * 0.95;

    const idleLookX = Math.sin(elapsedSeconds * 0.37) * 0.018;
    const idleLookY = Math.sin(elapsedSeconds * 0.29) * 0.012;
    const pupilX = clamp(this.lookX * 0.055 + idleLookX, -0.06, 0.06);
    const pupilY = clamp(this.lookY * 0.06 + idleLookY, -0.065, 0.065);
    this.eyes[0].scale.y = eyeOpen;
    this.eyes[1].scale.y = eyeOpen;
    this.pupils[0].position.set(pupilX, pupilY, 0.065);
    this.pupils[1].position.set(pupilX, pupilY, 0.065);

    let browTilt = 0;
    let browHeight = 0;
    if (this.currentCareMood === "sad" || this.reaction === "sad") {
      browTilt = 0.22;
      browHeight = -0.025;
    } else if (this.currentMood === "curious") {
      browTilt = -0.11;
      browHeight = 0.035;
    } else if (this.currentMood === "delighted") {
      browTilt = -0.07;
      browHeight = 0.025;
    } else if (this.currentMood === "grumpy") {
      browTilt = -0.17;
    }
    this.brows[0].rotation.z = browTilt;
    this.brows[1].rotation.z = -browTilt;
    this.brows[0].position.y = 0.41 + browHeight;
    this.brows[1].position.y = 0.41 + browHeight;
    const cheekPulse = 1 + (this.currentMood === "delighted" ? 0.12 : 0) + chew * 0.16;
    this.cheeks[0].scale.x = 0.2 * cheekPulse;
    this.cheeks[1].scale.x = 0.2 * cheekPulse;

    const lookReturn = Math.pow(0.28, delta);
    this.lookX *= lookReturn;
    this.lookY *= lookReturn;
  }

  getCosmeticSocket(socket: CosmeticSocket): Object3D {
    return this.cosmeticSlots[socket].anchor;
  }

  getCosmeticKey(socket: CosmeticSocket): AssetKey | null {
    return this.cosmeticSlots[socket].key;
  }

  async equipCosmetic(socket: CosmeticSocket, key: AssetKey): Promise<boolean> {
    if (this.disposed) return false;
    const slot = this.cosmeticSlots[socket];
    const generation = ++slot.generation;
    const loaded = await this.assetLoader.load(key);
    if (!(loaded.value instanceof Object3D)) {
      if (loaded.value instanceof Texture) loaded.value.dispose();
      return false;
    }
    if (this.disposed || generation !== slot.generation) {
      disposeTree(loaded.value);
      return false;
    }
    this.removeCosmetic(slot);
    slot.object = loaded.value;
    slot.key = key;
    loaded.value.name = `Gooby.cosmetic.${socket}.${key}`;
    collectTreeResources(loaded.value, slot.resources);
    slot.anchor.add(loaded.value);
    return true;
  }

  clearCosmetic(socket: CosmeticSocket): void {
    const slot = this.cosmeticSlots[socket];
    slot.generation += 1;
    this.removeCosmetic(slot);
  }

  private removeCosmetic(slot: CosmeticSlotState): void {
    slot.object?.removeFromParent();
    slot.object = null;
    slot.key = null;
    disposeResources(slot.resources);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearCosmetic("head");
    this.clearCosmetic("ears");
    this.clearCosmetic("neck");
    this.clearCosmetic("back");
    disposeResources(this.ownResources);
    if (this.ownsAssetLoader) this.assetLoader.dispose();
    this.root.removeFromParent();
    this.root.clear();
  }
}
