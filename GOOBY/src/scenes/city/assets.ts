import { Object3D } from "three";
import type {
  AssetKey,
  AssetLoader,
  AssetSource,
  LoadedAsset,
} from "../../core/contracts/assets";
import { FallbackAssetLoader } from "../../render/proc";

export const CITY_ASSET_KEYS = [
  "city.road",
  "city.tree",
  "city.lamp",
  "city.car",
  "building.carrot-market",
  "building.cloud-boutique",
  "building.fluff-salon",
  "icon.coin",
] as const satisfies readonly AssetKey[];

export interface CityAssetAudit {
  readonly key: AssetKey;
  readonly source: AssetSource;
  readonly warning: string | null;
}

export class CityAssetDepot {
  private readonly loaded = new Map<AssetKey, LoadedAsset>();
  private ready = false;

  constructor(private readonly loader: AssetLoader = new FallbackAssetLoader()) {}

  async preload(): Promise<readonly CityAssetAudit[]> {
    const assets = await this.loader.preload(CITY_ASSET_KEYS);
    for (const asset of assets) this.loaded.set(asset.key, asset);
    this.ready = true;
    return assets.map((asset) => ({
      key: asset.key,
      source: asset.source,
      warning: asset.warning ?? null,
    }));
  }

  clone(key: (typeof CITY_ASSET_KEYS)[number]): Object3D {
    if (!this.ready) throw new Error("City assets must be preloaded before cloning");
    const asset = this.loaded.get(key);
    if (!asset || !(asset.value instanceof Object3D)) {
      throw new TypeError(`City asset is not a scene object: ${key}`);
    }
    return asset.value.clone(true);
  }

  audit(): readonly CityAssetAudit[] {
    return CITY_ASSET_KEYS.map((key) => {
      const asset = this.loaded.get(key);
      return {
        key,
        source: asset?.source ?? "procedural",
        warning: asset?.warning ?? null,
      };
    });
  }

  dispose(): void {
    this.loaded.clear();
    this.ready = false;
    this.loader.dispose();
  }
}
