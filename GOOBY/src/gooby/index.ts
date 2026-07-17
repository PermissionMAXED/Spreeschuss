import {
  BoxGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import type { GoobyActor, GoobyMood, GoobyReaction } from "../core/contracts/gooby";
import type { Object3D } from "three";

const material = (color: number, roughness = 0.86): MeshStandardMaterial =>
  new MeshStandardMaterial({ color, roughness });

function shapedSphere(color: number, scale: readonly [number, number, number]): Mesh {
  const value = new Mesh(new SphereGeometry(1, 32, 24), material(color));
  value.scale.set(...scale);
  value.castShadow = true;
  value.receiveShadow = true;
  return value;
}

export class ProceduralGooby implements GoobyActor {
  readonly root = new Group();
  readonly interactionTarget: Object3D;
  private readonly belly: Mesh;
  private readonly head: Mesh;
  private readonly ears: readonly [Mesh, Mesh];
  private readonly eyes: readonly [Group, Group];
  private currentMood: GoobyMood = "content";
  private sleeping = false;
  private reaction: GoobyReaction | null = null;
  private reactionAge = 0;
  private earVelocity = 0;

  constructor() {
    this.root.name = "Gooby";
    const cream = 0xf6d9b1;
    const apricot = 0xeeb47e;
    this.belly = shapedSphere(cream, [1.22, 1.38, 1.04]);
    this.belly.position.y = 1.35;
    this.interactionTarget = this.belly;

    const haunchLeft = shapedSphere(apricot, [0.72, 0.62, 0.72]);
    haunchLeft.position.set(-0.78, 0.62, 0.08);
    const haunchRight = haunchLeft.clone();
    haunchRight.position.x = 0.78;
    const chest = shapedSphere(0xf2c994, [0.95, 1.05, 0.9]);
    chest.position.set(0, 2.05, 0);

    this.head = shapedSphere(cream, [0.88, 0.82, 0.82]);
    this.head.position.set(0, 2.95, 0.03);

    const muzzleLeft = shapedSphere(0xffe8c8, [0.34, 0.27, 0.25]);
    muzzleLeft.position.set(-0.2, 2.72, 0.71);
    const muzzleRight = muzzleLeft.clone();
    muzzleRight.position.x = 0.2;
    const nose = shapedSphere(0xd78680, [0.13, 0.1, 0.08]);
    nose.position.set(0, 2.86, 0.8);
    const tooth = new Mesh(new BoxGeometry(0.22, 0.28, 0.08), material(0xfffdf2));
    tooth.position.set(0, 2.53, 0.78);

    const earLeft = new Mesh(new CapsuleGeometry(0.25, 1.05, 8, 16), material(cream));
    earLeft.scale.set(0.82, 1, 0.46);
    earLeft.position.set(-0.38, 4.02, 0);
    earLeft.rotation.z = 0.18;
    earLeft.castShadow = true;
    const earRight = new Mesh(new CapsuleGeometry(0.25, 0.9, 8, 16), material(cream));
    earRight.scale.set(0.86, 1, 0.48);
    earRight.position.set(0.38, 3.95, 0.02);
    earRight.rotation.z = -0.46;
    earRight.rotation.x = 0.12;
    earRight.castShadow = true;
    this.ears = [earLeft, earRight];

    this.eyes = [-0.3, 0.3].map((x) => {
      const eyeGroup = new Group();
      eyeGroup.position.set(x, 3.08, 0.73);
      const eye = shapedSphere(0x43373a, [0.12, 0.16, 0.06]);
      const glint = shapedSphere(0xffffff, [0.035, 0.045, 0.025]);
      glint.position.set(-0.035, 0.05, 0.055);
      eyeGroup.add(eye, glint);
      return eyeGroup;
    }) as [Group, Group];

    const feet = [-0.65, 0.65].map((x) => {
      const foot = shapedSphere(cream, [0.54, 0.25, 0.76]);
      foot.position.set(x, 0.18, 0.36);
      return foot;
    });
    const tail = shapedSphere(0xffedcf, [0.38, 0.38, 0.38]);
    tail.position.set(0.88, 1.15, -0.82);

    this.root.add(
      haunchLeft,
      haunchRight,
      tail,
      chest,
      this.belly,
      this.head,
      muzzleLeft,
      muzzleRight,
      nose,
      tooth,
      earLeft,
      earRight,
      ...this.eyes,
      ...feet,
    );
  }

  get mood(): GoobyMood {
    return this.currentMood;
  }

  setMood(mood: GoobyMood): void {
    this.currentMood = mood;
  }

  react(reaction: GoobyReaction): void {
    this.reaction = reaction;
    this.reactionAge = 0;
    if (reaction === "pet" || reaction === "tickle" || reaction === "feed") this.currentMood = "delighted";
    if (reaction === "poke") this.currentMood = "curious";
    this.earVelocity += reaction === "tickle" ? 1.9 : 0.9;
  }

  setSleeping(sleeping: boolean): void {
    this.sleeping = sleeping;
    this.currentMood = sleeping ? "sleepy" : "content";
    this.react(sleeping ? "sleep" : "wake");
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    this.reactionAge += deltaSeconds;
    const reactionStrength = this.reaction ? Math.max(0, 1 - this.reactionAge / 0.85) : 0;
    if (reactionStrength === 0) this.reaction = null;

    const breathing = Math.sin(elapsedSeconds * (this.sleeping ? 2.1 : 3.2)) * 0.018;
    const jiggle = this.reaction === "tickle" ? Math.sin(this.reactionAge * 30) * reactionStrength * 0.06 : 0;
    this.belly.scale.set(1.22 + jiggle, 1.38 + breathing - jiggle * 0.45, 1.04);

    const hop = this.reaction === "feed" || this.reaction === "pet"
      ? Math.sin(Math.min(1, this.reactionAge / 0.7) * Math.PI) * reactionStrength * 0.18
      : 0;
    this.root.position.y = this.sleeping ? -0.12 : hop;
    this.root.rotation.z =
      this.reaction === "poke" ? Math.sin(this.reactionAge * 15) * reactionStrength * 0.07 : 0;

    const earTarget = this.sleeping ? 0.42 : this.currentMood === "delighted" ? -0.08 : 0;
    this.earVelocity += (earTarget - this.ears[0].rotation.x) * deltaSeconds * 18;
    this.earVelocity *= Math.pow(0.025, deltaSeconds);
    this.ears[0].rotation.x += this.earVelocity * deltaSeconds;
    this.ears[1].rotation.x = 0.12 + this.ears[0].rotation.x * 0.72;

    const blinkCycle = elapsedSeconds % 4.6;
    const blink = this.sleeping ? 0.08 : blinkCycle > 4.42 ? Math.max(0.08, Math.abs(blinkCycle - 4.51) * 10) : 1;
    for (const eye of this.eyes) eye.scale.y = blink;
    this.head.rotation.x = this.sleeping ? 0.16 : Math.sin(elapsedSeconds * 0.8) * 0.018;
  }

  dispose(): void {
    this.root.traverse((child) => {
      const renderable = child as Object3D & {
        geometry?: { dispose(): void };
        material?: MeshStandardMaterial | MeshStandardMaterial[];
      };
      renderable.geometry?.dispose();
      if (Array.isArray(renderable.material)) renderable.material.forEach((value) => value.dispose());
      else renderable.material?.dispose();
    });
    this.root.removeFromParent();
  }
}
