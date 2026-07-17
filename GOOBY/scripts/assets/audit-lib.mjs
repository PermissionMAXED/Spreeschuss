import { createHash } from "node:crypto";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function extractAssetKeys(contractSource) {
  const declaration = contractSource.match(/export const ASSET_KEYS = \[([\s\S]*?)\] as const;/u);
  if (!declaration?.[1]) return [];
  return [...declaration[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
}

export function extractManifestKeys(manifestSource) {
  const declaration = manifestSource.match(/export const ASSET_MANIFEST = \{([\s\S]*?)\n\} as const satisfies/u);
  if (!declaration?.[1]) return [];
  return [...declaration[1].matchAll(/^\s{2}"([^"]+)":/gmu)].map((match) => match[1]);
}

export function compareExactKeys(expected, actual, label) {
  const violations = [];
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  for (const key of expectedSet) {
    if (!actualSet.has(key)) violations.push(`${label} is missing AssetKey "${key}"`);
  }
  for (const key of actualSet) {
    if (!expectedSet.has(key)) violations.push(`${label} contains unknown AssetKey "${key}"`);
  }
  if (actual.length !== actualSet.size) violations.push(`${label} contains duplicate AssetKeys`);
  return violations;
}

export function runtimeReferenceViolations(path, source) {
  const violations = [];
  if (/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/iu.test(source)) {
    violations.push(`${path}: external runtime URL`);
  }
  if (/["'`](?:[^"'`\r\n]*\/)?[^"'`\r\n]*\.ogg(?:[?#][^"'`]*)?["'`]/iu.test(source)) {
    violations.push(`${path}: OGG runtime load path`);
  }
  return violations;
}

export function isAllowedRuntimeAudio(path) {
  return /\.(?:m4a|mp3|wav)$/iu.test(path);
}

export function fileSizeViolations(path, bytes, maximumBytes) {
  return bytes > maximumBytes ? [`${path}: exceeds 10 MB`] : [];
}

export function licenseMetadataViolations(packId, license) {
  const expectedPath = `assets/vendor/${packId}/License.txt`;
  if (
    !license
    || license.path !== expectedPath
    || !/(^|\/)license\.txt$/iu.test(license.archiveEntry ?? "")
    || !/^[a-f0-9]{64}$/u.test(license.sha256 ?? "")
  ) {
    return [`${packId}: missing genuine archive License.txt record`];
  }
  return [];
}

export function glbResourceUris(bytes, path) {
  if (bytes.subarray(0, 4).toString("ascii") !== "glTF") throw new Error(`${path}: invalid GLB magic`);
  if (bytes.readUInt32LE(4) !== 2) throw new Error(`${path}: unsupported GLB version`);
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error(`${path}: invalid GLB length`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength > bytes.length) {
    throw new Error(`${path}: missing GLB JSON chunk`);
  }
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").trim());
  if (!Array.isArray(document.meshes) || document.meshes.length === 0) {
    throw new Error(`${path}: GLB contains no renderable meshes`);
  }
  return [...document.buffers ?? [], ...document.images ?? []]
    .map(({ uri }) => uri)
    .filter((uri) => typeof uri === "string" && !uri.startsWith("data:"));
}
