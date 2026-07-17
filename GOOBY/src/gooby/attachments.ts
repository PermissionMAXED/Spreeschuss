import type { Object3D } from "three";

export const COSMETIC_SOCKETS = ["head", "ears", "neck", "back"] as const;

export type CosmeticSocket = (typeof COSMETIC_SOCKETS)[number];
export type CosmeticAttachmentParent = "head" | "rig";

export interface CosmeticAttachmentDescriptor {
  readonly parent: CosmeticAttachmentParent;
  readonly anchorPosition: readonly [x: number, y: number, z: number];
  readonly anchorRotation: readonly [x: number, y: number, z: number];
  readonly modelPosition: readonly [x: number, y: number, z: number];
  readonly modelRotation: readonly [x: number, y: number, z: number];
  readonly modelScale: number;
}

/**
 * The single attachment-space contract used by the actor, home equipment and
 * shop-created cosmetic models. Anchors follow the animated body part while
 * models remain normalized in anchor-local space.
 */
export const COSMETIC_ATTACHMENTS = Object.freeze({
    head: {
      parent: "head",
      anchorPosition: [0, 0.68, 0.02] as const,
      anchorRotation: [0, 0, 0] as const,
      modelPosition: [0, 0, 0] as const,
      modelRotation: [0, 0, 0] as const,
      modelScale: 0.58,
    },
    ears: {
      parent: "head",
      anchorPosition: [0, 0.72, 0.12] as const,
      anchorRotation: [0, 0, 0] as const,
      modelPosition: [0, 0, 0] as const,
      modelRotation: [0, 0, 0] as const,
      modelScale: 0.58,
    },
    neck: {
      parent: "rig",
      anchorPosition: [0, 2.48, 0.32] as const,
      anchorRotation: [0, 0, 0] as const,
      modelPosition: [0, 0, 0] as const,
      modelRotation: [0, 0, 0] as const,
      modelScale: 0.58,
    },
    back: {
      parent: "rig",
      anchorPosition: [0, 1.92, -0.9] as const,
      anchorRotation: [0, 0, 0] as const,
      modelPosition: [0, 0, 0] as const,
      modelRotation: [0, 0, 0] as const,
      modelScale: 0.68,
    },
  } satisfies Readonly<Record<CosmeticSocket, CosmeticAttachmentDescriptor>>);

export function applyCosmeticModelAttachment(socket: CosmeticSocket, model: Object3D): Object3D {
  const descriptor = COSMETIC_ATTACHMENTS[socket];
  model.position.set(...descriptor.modelPosition);
  model.rotation.set(...descriptor.modelRotation);
  model.scale.setScalar(descriptor.modelScale);
  model.userData.cosmeticSocket = socket;
  return model;
}
