/**
 * Shopping Surf asset depot — curated GLBs with total procedural fallback.
 *
 * The depot resolves the planned curated keys the course is dressed with
 * (`surf.cart` / `surf.ramp` / `surf.crate` plus the city building/prop keys
 * shared with Gooby City) through the frozen planned-asset manifest. Loading
 * is total: every key has an immediate procedural template so the scene can
 * build synchronously, and curated GLBs swap in when (and only when) they
 * load. Swaps notify subscribers so the instanced pools rebuild exactly once
 * per upgraded key — never on the steady frame path.
 *
 * The depot never touches City internals: the curated keys and their
 * vendored paths come from `src/data/assetManifest.ts`, and every fallback
 * mesh is authored here with footprints matching the curated kits.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from "three";
import type { AssetSource } from "../../core/contracts/assets";
import { PLANNED_ASSET_MANIFEST, type PlannedAssetKey } from "../../data/assetManifest";

export const SURF_ASSET_KEYS = [
  "surf.cart",
  "surf.ramp",
  "surf.crate",
  "building.city-a",
  "building.city-b",
  "building.city-c",
  "city.sign",
  "city.hydrant",
] as const satisfies readonly PlannedAssetKey[];

export type SurfAssetKey = (typeof SURF_ASSET_KEYS)[number];

export type SurfAssetResolver = (key: SurfAssetKey) => Promise<Object3D | null>;

export interface SurfAssetDepot {
  /** Shared template; callers must not mutate it. Clone or instance it. */
  template(key: SurfAssetKey): Object3D;
  source(key: SurfAssetKey): AssetSource;
  /** Kicks curated loading; resolves when every key settled (total). */
  preload(): Promise<void>;
  /** Fires once per key whose curated GLB replaced the fallback. */
  onUpgrade(listener: (key: SurfAssetKey) => void): () => void;
  dispose(): void;
}

const SURF_PALETTE = {
  cartBody: 0x4f8dc9,
  cartFrame: 0xd8e6f2,
  board: 0xf2b661,
  boardStripe: 0xe0685a,
  wheel: 0x3e3a41,
  rampWood: 0xc98d5a,
  rampEdge: 0x8a5c38,
  crate: 0xb07a4a,
  crateSlat: 0x8a5c38,
  brickA: 0xdfb488,
  brickB: 0xafc7d8,
  brickC: 0xe0a9a0,
  roof: 0x8a6250,
  window: 0xbfe2e8,
  steel: 0x6a6f7c,
  signFace: 0xf3e6c2,
  hydrant: 0xd95d47,
} as const;

function standard(color: number, roughness = 0.8): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness });
}

function part(
  parent: Group,
  geometry: BufferGeometry,
  material: Material,
  x: number,
  y: number,
  z: number,
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/**
 * Shopping cart riding a surfboard — the hero. Footprint ≈ 1.2 × 1.2 × 1.6
 * (w×h×d) with the board at y≈0, matching the curated `surf.cart` kit scale.
 */
function buildCart(): Group {
  const cart = new Group();
  const frame = standard(SURF_PALETTE.cartFrame, 0.45);
  const body = standard(SURF_PALETTE.cartBody, 0.6);

  const board = part(cart, new BoxGeometry(1.24, 0.09, 1.9), standard(SURF_PALETTE.board, 0.55), 0, 0.05, 0.05);
  board.name = "surf-board";
  part(cart, new BoxGeometry(1.26, 0.02, 0.34), standard(SURF_PALETTE.boardStripe, 0.5), 0, 0.1, 0.1);

  // Basket: floor plus four lattice walls.
  part(cart, new BoxGeometry(0.86, 0.06, 1.06), body, 0, 0.42, 0);
  part(cart, new BoxGeometry(0.9, 0.5, 0.05), frame, 0, 0.68, -0.53);
  part(cart, new BoxGeometry(0.9, 0.44, 0.05), frame, 0, 0.65, 0.53);
  part(cart, new BoxGeometry(0.05, 0.5, 1.08), frame, -0.45, 0.68, 0);
  part(cart, new BoxGeometry(0.05, 0.5, 1.08), frame, 0.45, 0.68, 0);
  // Handle bar.
  part(cart, new BoxGeometry(0.94, 0.06, 0.06), body, 0, 1.06, 0.62);
  part(cart, new BoxGeometry(0.05, 0.34, 0.05), frame, -0.42, 0.9, 0.6);
  part(cart, new BoxGeometry(0.05, 0.34, 0.05), frame, 0.42, 0.9, 0.6);

  const wheelGeometry = new CylinderGeometry(0.11, 0.11, 0.07, 12);
  const wheelMaterial = standard(SURF_PALETTE.wheel, 0.4);
  for (const [x, z] of [[-0.34, -0.42], [0.34, -0.42], [-0.34, 0.42], [0.34, 0.42]] as const) {
    const wheel = new Mesh(wheelGeometry, wheelMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.2, z);
    cart.add(wheel);
  }
  return cart;
}

/** Launch wedge, ~2 wide × 1.5 deep, ramping to ~0.62 high at the back. */
function buildRamp(): Group {
  const ramp = new Group();
  const deck = part(
    ramp,
    new BoxGeometry(1.9, 0.08, 1.7),
    standard(SURF_PALETTE.rampWood, 0.75),
    0,
    0.3,
    0,
  );
  deck.rotation.x = -0.36;
  part(ramp, new BoxGeometry(1.9, 0.56, 0.14), standard(SURF_PALETTE.rampEdge, 0.8), 0, 0.28, -0.74);
  part(ramp, new BoxGeometry(1.9, 0.1, 0.3), standard(SURF_PALETTE.rampEdge, 0.8), 0, 0.05, 0.7);
  return ramp;
}

/** Market crate, ~1.3 cube footprint from y = 0. */
function buildCrate(): Group {
  const crate = new Group();
  part(crate, new BoxGeometry(1.3, 1.2, 1.3), standard(SURF_PALETTE.crate, 0.85), 0, 0.6, 0);
  const slat = standard(SURF_PALETTE.crateSlat, 0.85);
  part(crate, new BoxGeometry(1.36, 0.14, 1.36), slat, 0, 0.14, 0);
  part(crate, new BoxGeometry(1.36, 0.14, 1.36), slat, 0, 1.06, 0);
  return crate;
}

/** City block façade matching the KayKit 2×2 footprint from y = 0. */
function buildBuilding(kind: "a" | "b" | "c"): Group {
  const building = new Group();
  const height = kind === "c" ? 3 : kind === "b" ? 2.1 : 1.7;
  const color = kind === "a" ? SURF_PALETTE.brickA : kind === "b" ? SURF_PALETTE.brickB : SURF_PALETTE.brickC;
  part(building, new BoxGeometry(2, height, 2), standard(color, 0.85), 0, height / 2, 0);
  part(building, new BoxGeometry(2.16, 0.12, 2.16), standard(SURF_PALETTE.roof, 0.8), 0, height + 0.06, 0);
  const windows = standard(SURF_PALETTE.window, 0.35);
  const rows = kind === "c" ? 3 : 2;
  for (let row = 0; row < rows; row += 1) {
    const y = height * ((row + 0.65) / (rows + 0.35));
    part(building, new BoxGeometry(1.5, 0.34, 0.06), windows, 0, y, 1.01);
  }
  return building;
}

function buildSign(): Group {
  const sign = new Group();
  part(sign, new BoxGeometry(0.06, 1.4, 0.06), standard(SURF_PALETTE.steel, 0.5), 0, 0.7, 0);
  part(sign, new BoxGeometry(0.05, 0.3, 0.62), standard(SURF_PALETTE.signFace, 0.6), 0.02, 1.16, 0.16);
  return sign;
}

function buildHydrant(): Group {
  const hydrant = new Group();
  const body = new Mesh(
    new CylinderGeometry(0.11, 0.13, 0.42, 10),
    standard(SURF_PALETTE.hydrant, 0.55),
  );
  body.position.y = 0.21;
  hydrant.add(body);
  const cap = new Mesh(new SphereGeometry(0.1, 10, 8), standard(SURF_PALETTE.hydrant, 0.55));
  cap.position.y = 0.44;
  hydrant.add(cap);
  return hydrant;
}

const FALLBACK_FACTORIES: Readonly<Record<SurfAssetKey, () => Group>> = {
  "surf.cart": buildCart,
  "surf.ramp": buildRamp,
  "surf.crate": buildCrate,
  "building.city-a": () => buildBuilding("a"),
  "building.city-b": () => buildBuilding("b"),
  "building.city-c": () => buildBuilding("c"),
  "city.sign": buildSign,
  "city.hydrant": buildHydrant,
};

export function createProceduralSurfAsset(key: SurfAssetKey): Object3D {
  const group = FALLBACK_FACTORIES[key]();
  group.name = `procedural:${key}`;
  group.userData.assetKey = key;
  group.userData.procedural = true;
  return group;
}

/**
 * Browser resolver fetching the vendored curated GLB for a key. Returns null
 * (procedural-first) without a DOM, e.g. in node test runners.
 */
export function createSurfAssetResolver(): SurfAssetResolver | null {
  if (typeof document === "undefined") return null;
  return async (key) => {
    const reference = PLANNED_ASSET_MANIFEST[key].vendored.find(({ path }) => path.endsWith(".glb"));
    if (!reference) return null;
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const gltf = await new GLTFLoader().loadAsync(new URL(reference.path, document.baseURI).href);
    if (!(gltf.scene instanceof Object3D)) return null;
    gltf.scene.name = `vendored:${key}`;
    gltf.scene.userData.assetKey = key;
    return gltf.scene;
  };
}

interface DepotEntry {
  value: Object3D;
  source: AssetSource;
}

export function createSurfAssetDepot(
  resolver: SurfAssetResolver | null = createSurfAssetResolver(),
): SurfAssetDepot {
  const entries = new Map<SurfAssetKey, DepotEntry>();
  for (const key of SURF_ASSET_KEYS) {
    entries.set(key, { value: createProceduralSurfAsset(key), source: "procedural" });
  }
  const listeners = new Set<(key: SurfAssetKey) => void>();
  let disposed = false;
  let preloading: Promise<void> | null = null;

  const disposeTemplate = (template: Object3D): void => {
    template.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh !== true) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.dispose();
    });
  };

  return {
    template(key) {
      const entry = entries.get(key);
      if (!entry) throw new TypeError(`Unknown surf asset key: ${key}`);
      return entry.value;
    },
    source(key) {
      return entries.get(key)?.source ?? "procedural";
    },
    preload() {
      preloading ??= Promise.all(SURF_ASSET_KEYS.map(async (key) => {
        try {
          const vendored = await resolver?.(key);
          if (!vendored || disposed) {
            if (vendored) disposeTemplate(vendored);
            return;
          }
          const previous = entries.get(key);
          entries.set(key, { value: vendored, source: "vendored" });
          // Listeners rebuild their pools/clones onto the curated template
          // first; only then is the fallback's GPU footprint released.
          for (const listener of [...listeners]) listener(key);
          if (previous) disposeTemplate(previous.value);
        } catch {
          // Total fallback: the procedural template simply stays in place.
        }
      })).then(() => undefined);
      return preloading;
    },
    onUpgrade(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      for (const entry of entries.values()) disposeTemplate(entry.value);
      entries.clear();
    },
  };
}

/** One instanced part of a template: geometry/material plus its local pose. */
export interface SurfInstancePart {
  readonly geometry: BufferGeometry;
  readonly material: Material;
  readonly offset: Matrix4;
}

/**
 * Flattens a template into at most `maxParts` geometry/material pairs with
 * baked local transforms, ready for `InstancedMesh` pools. Curated GLBs keep
 * their largest parts first so trimming to the cap stays representative.
 */
export function extractInstanceParts(template: Object3D, maxParts: number): SurfInstancePart[] {
  const parts: Array<SurfInstancePart & { readonly volume: number }> = [];
  template.updateWorldMatrix(true, true);
  const rootInverse = new Matrix4().copy(template.matrixWorld).invert();
  template.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh !== true) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!material) return;
    const offset = new Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    const volume = bounds
      ? Math.abs(
        (bounds.max.x - bounds.min.x)
        * (bounds.max.y - bounds.min.y)
        * (bounds.max.z - bounds.min.z),
      )
      : 0;
    parts.push({ geometry: mesh.geometry, material, offset, volume });
  });
  parts.sort((a, b) => b.volume - a.volume);
  return parts.slice(0, Math.max(1, maxParts)).map(({ geometry, material, offset }) => ({
    geometry,
    material,
    offset,
  }));
}
