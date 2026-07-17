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

const NON_CONSUMER_SOURCE = /(?:^|\/)(?:data\/assetManifest\.ts|render\/assets\.ts|[^/]*\.(?:test|spec|e2e)\.[^/]+)$/u;

function occurrenceCount(source, marker) {
  if (!marker) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(marker, offset)) !== -1) {
    count += 1;
    offset += marker.length;
  }
  return count;
}

export function extractRuntimeAssetRequests(sourceFiles, assetKeys) {
  const allowed = new Set(assetKeys);
  const requests = new Map();
  const record = (key, path) => {
    if (!allowed.has(key)) return;
    const paths = requests.get(key) ?? new Set();
    paths.add(path);
    requests.set(key, paths);
  };

  for (const [path, source] of sourceFiles) {
    if (NON_CONSUMER_SOURCE.test(path)) continue;
    for (const match of source.matchAll(/\.(?:load|preload)\(\s*["']([^"']+)["']/gu)) {
      if (match[1]) record(match[1], path);
    }
    for (const declaration of source.matchAll(
      /(?:const|let)\s+([A-Z][A-Z0-9_]*)\s*=\s*\[([\s\S]*?)\]\s*as const/gu,
    )) {
      const identifier = declaration[1];
      const entries = declaration[2];
      if (!identifier || !entries) continue;
      const usedByPreload = new RegExp(`\\.preload\\(\\s*${identifier}\\s*\\)`, "u").test(source);
      if (!usedByPreload) continue;
      for (const match of entries.matchAll(/["']([^"']+)["']/gu)) {
        if (match[1]) record(match[1], path);
      }
    }
  }
  return requests;
}

export function buildAssetConsumerAudit({
  files,
  availablePaths,
  modelDependencies,
  runtimeRequests,
  sourceFiles,
  declaredAssetKeys,
}) {
  const violations = [];
  const available = new Set(availablePaths);
  const dependenciesByFile = new Map();
  for (const { model, dependency } of modelDependencies) {
    const parents = dependenciesByFile.get(dependency) ?? new Set();
    parents.add(model);
    dependenciesByFile.set(dependency, parents);
  }

  const entries = files.map((file) => ({
    path: file.path,
    declaration: true,
    dependenciesOf: [...(dependenciesByFile.get(file.path) ?? [])].sort(),
    runtimeRequests: [],
    sourceConsumers: [],
  }));
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const validDirectFiles = new Set();

  for (const file of files) {
    const entry = entriesByPath.get(file.path);
    if (!entry) continue;
    if (!available.has(file.path)) violations.push(`${file.path}: manifest points to a missing runtime file`);
    const seenConsumers = new Set();
    for (const proof of file.consumers ?? []) {
      const identity = `${proof.assetKey}\0${proof.path}\0${proof.marker}`;
      if (seenConsumers.has(identity)) {
        violations.push(`${file.path}: duplicate source consumer proof for ${proof.assetKey}`);
        continue;
      }
      seenConsumers.add(identity);
      if (
        typeof proof.path !== "string"
        || !proof.path.startsWith("src/")
        || NON_CONSUMER_SOURCE.test(proof.path)
      ) {
        violations.push(`${file.path}: ${String(proof.path)} is a declaration/test, not a source consumer`);
        continue;
      }
      if (!(declaredAssetKeys.get(file.path) ?? new Set()).has(proof.assetKey)) {
        violations.push(`${file.path}: consumer key ${proof.assetKey} does not declare this file`);
        continue;
      }
      const requestSources = runtimeRequests.get(proof.assetKey);
      if (!requestSources || requestSources.size === 0) {
        violations.push(`${file.path}: ${proof.assetKey} has no runtime asset request`);
        continue;
      }
      const source = sourceFiles.get(proof.path);
      const count = typeof source === "string" ? occurrenceCount(source, proof.marker) : 0;
      if (count === 0) {
        violations.push(`${file.path}: source consumer marker is missing from ${proof.path}`);
        continue;
      }
      entry.runtimeRequests.push({
        assetKey: proof.assetKey,
        paths: [...requestSources].sort(),
      });
      entry.sourceConsumers.push({ ...proof, occurrences: count });
      validDirectFiles.add(file.path);
    }
  }

  for (const file of files) {
    const entry = entriesByPath.get(file.path);
    if (!entry) continue;
    if (validDirectFiles.has(file.path)) continue;
    if (entry.dependenciesOf.length === 0) {
      violations.push(`${file.path}: declaration has no transitive GLB dependency or actual source consumer`);
      continue;
    }
    const liveParents = entry.dependenciesOf.filter((parent) => validDirectFiles.has(parent));
    if (liveParents.length === 0) {
      violations.push(`${file.path}: transitive GLB dependency has no source-consumed parent model`);
    }
  }

  return {
    entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
    violations,
  };
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
