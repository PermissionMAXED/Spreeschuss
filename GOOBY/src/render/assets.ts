import { Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { AssetKey, AssetValue } from "../core/contracts/assets";
import { ASSET_MANIFEST } from "../data/assetManifest";
import { FallbackAssetLoader } from "./proc";

function runtimeUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

/**
 * Resolves curated local GLB files when available. Unsupported or corrupt
 * vendored files deliberately return to the total procedural fallback path.
 */
async function resolveVendoredAsset(key: AssetKey): Promise<AssetValue | null> {
  const reference = ASSET_MANIFEST[key].vendored.find(({ path }) => path.endsWith(".glb"));
  if (!reference) return null;
  const gltf = await new GLTFLoader().loadAsync(runtimeUrl(reference.path));
  if (!(gltf.scene instanceof Object3D)) return null;
  gltf.scene.name = `vendored:${key}`;
  return gltf.scene;
}

export function createRuntimeAssetLoader(): FallbackAssetLoader {
  return new FallbackAssetLoader(resolveVendoredAsset);
}
