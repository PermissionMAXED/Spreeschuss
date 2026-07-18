import { Object3D } from "three";
import type { AssetSource } from "../../../core/contracts/assets";
import { PLANNED_ASSET_MANIFEST } from "../../../data/assetManifest";
import {
  CITY_CURATED_KEYS,
  createProceduralCityAsset,
  type CityCuratedKey,
} from "./procedural";

export interface CityCuratedAudit {
  readonly key: CityCuratedKey;
  readonly source: AssetSource;
  readonly warning: string | null;
}

export type CityCuratedResolver = (key: CityCuratedKey) => Promise<Object3D | null>;

/**
 * Loads the real curated KayKit/Kenney city GLBs (planned manifest keys) with
 * their authored textures and UVs. Loading is total: any missing or corrupt
 * file resolves to the procedural fallback while keeping the warning
 * observable for audits, mirroring the frozen `AssetLoader` contract.
 */
export class CityCuratedDepot {
  private readonly loaded = new Map<CityCuratedKey, {
    readonly value: Object3D;
    readonly source: AssetSource;
    readonly warning: string | null;
  }>();
  private ready = false;

  constructor(private readonly resolver: CityCuratedResolver | null = null) {}

  async preload(): Promise<readonly CityCuratedAudit[]> {
    await Promise.all(CITY_CURATED_KEYS.map(async (key) => {
      try {
        const vendored = await this.resolver?.(key);
        if (vendored) {
          this.loaded.set(key, { value: vendored, source: "vendored", warning: null });
          return;
        }
        this.loaded.set(key, {
          value: createProceduralCityAsset(key),
          source: "procedural",
          warning: null,
        });
      } catch (error) {
        this.loaded.set(key, {
          value: createProceduralCityAsset(key),
          source: "procedural",
          warning: error instanceof Error ? error.message : "Curated city asset could not be loaded",
        });
      }
    }));
    this.ready = true;
    return this.audit();
  }

  source(key: CityCuratedKey): AssetSource {
    return this.loaded.get(key)?.source ?? "procedural";
  }

  /** The shared template; callers must not mutate it. Use `clone` to place. */
  template(key: CityCuratedKey): Object3D {
    if (!this.ready) throw new Error("Curated city assets must be preloaded before use");
    const entry = this.loaded.get(key);
    if (!entry) throw new TypeError(`Curated city asset is missing: ${key}`);
    return entry.value;
  }

  clone(key: CityCuratedKey): Object3D {
    return this.template(key).clone(true);
  }

  audit(): readonly CityCuratedAudit[] {
    return CITY_CURATED_KEYS.map((key) => {
      const entry = this.loaded.get(key);
      return {
        key,
        source: entry?.source ?? "procedural",
        warning: entry?.warning ?? null,
      };
    });
  }

  dispose(): void {
    this.loaded.clear();
    this.ready = false;
  }
}

/**
 * Browser resolver: fetches the curated GLB listed in the planned manifest.
 * Returns null (fallback-first) when running without a DOM, e.g. under tests.
 */
export function createCuratedCityResolver(): CityCuratedResolver | null {
  if (typeof document === "undefined") return null;
  return async (key) => {
    const reference = PLANNED_ASSET_MANIFEST[key].vendored.find(({ path }) => path.endsWith(".glb"));
    if (!reference) return null;
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const gltf = await new GLTFLoader().loadAsync(new URL(reference.path, document.baseURI).href);
    if (!(gltf.scene instanceof Object3D)) return null;
    gltf.scene.name = `vendored:${key}`;
    return gltf.scene;
  };
}
