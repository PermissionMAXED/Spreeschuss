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

export function extractPlannedManifestKeys(manifestSource) {
  const declaration = manifestSource.match(
    /export const PLANNED_ASSET_MANIFEST = \{([\s\S]*?)\n\} as const satisfies/u,
  );
  if (!declaration?.[1]) return [];
  return [...declaration[1].matchAll(/^\s{2}"([^"]+)":/gmu)].map((match) => match[1]);
}

/**
 * Planned manifest entries with an empty vendored list are allowed only when
 * intentional: either the curated domain manifest marks the key
 * intentionalFallbackOnly, or a curated output exists and must be referenced.
 */
export function plannedVendoredViolations(manifestSource, key, outputPath, intentionalFallbackOnly) {
  const block = manifestSource.match(
    new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}":\\s*\\{([\\s\\S]*?)\\n  \\}`, "u"),
  )?.[1];
  if (!block) return [`${key}: missing from PLANNED_ASSET_MANIFEST`];
  const empty = /vendored:\s*\[\s*\]/u.test(block);
  if (outputPath && !block.includes(`"${outputPath}"`)) {
    return [`${key}: PLANNED_ASSET_MANIFEST does not reference curated output ${outputPath}`];
  }
  if (!outputPath && !empty && !intentionalFallbackOnly) {
    return [`${key}: vendored references exist without a curated output`];
  }
  if (!outputPath && !intentionalFallbackOnly) {
    return [`${key}: empty vendored mapping is not marked as intentional fallback-only`];
  }
  return [];
}

const HEX64 = /^[a-f0-9]{64}$/u;

const CURATED_EXTENSIONS = {
  models: /\.glb$/iu,
  audio: /\.(?:m4a|mp3|wav)$/iu,
  stickers: /\.(?:png|webp|svg)$/iu,
};

/**
 * Structural audit for a curated domain manifest (models, audio, stickers):
 * lock cross-references, revision pinning, genuine license evidence chains,
 * hashes, sizes, and intentional-fallback bookkeeping. Filesystem content
 * checks are performed by the caller.
 */
export function curatedDomainViolations({ domain, manifest, lock, licenseRoot = "assets/curated/vendor" }) {
  const violations = [];
  const fail = (message) => violations.push(`curated ${domain}: ${message}`);
  if (!manifest || typeof manifest !== "object") {
    fail("manifest is missing or unreadable");
    return violations;
  }
  if (manifest.schemaVersion !== 1) fail("unsupported schemaVersion");
  if (manifest.domain !== domain) fail(`manifest domain "${String(manifest.domain)}" does not match its file`);
  if (typeof manifest.spec?.path !== "string" || !HEX64.test(manifest.spec?.sha256 ?? "")) {
    fail("missing curation spec provenance (path + SHA-256)");
  }
  if (!Number.isInteger(manifest.budget?.maxRuntimeBytes) || manifest.budget.maxRuntimeBytes <= 0) {
    fail("missing runtime byte budget");
  }
  if (!lock?.sources) {
    fail("assets/sources.lock.json is missing; curated domains require a locked source cache");
    return violations;
  }
  const extensionRule = CURATED_EXTENSIONS[domain] ?? null;

  const sources = manifest.sources ?? {};
  for (const [sourceId, source] of Object.entries(sources)) {
    const locked = lock.sources[sourceId];
    if (!locked) {
      fail(`${sourceId}: source is not in the lock`);
      continue;
    }
    if (source.archiveSha256 !== locked.archive?.sha256) fail(`${sourceId}: archive hash differs from the lock`);
    if (locked.kind === "github-commit" && source.commit !== locked.commit) {
      fail(`${sourceId}: commit differs from the locked pin`);
    }
    if (source.downloadUrl !== locked.downloadUrl) fail(`${sourceId}: download URL differs from the lock`);
    const license = source.license;
    if (
      !license
      || license.path !== `${licenseRoot}/${sourceId}/License.txt`
      || license.sha256 !== locked.license?.sha256
      || license.sourceEntry !== locked.license?.entry
      || license.spdx !== locked.license?.spdx
      || JSON.stringify(license.evidence) !== JSON.stringify(locked.license?.evidence)
    ) {
      fail(`${sourceId}: committed license evidence does not chain back to the lock`);
    }
  }

  let outputBytes = 0;
  for (const [key, record] of Object.entries(manifest.keys ?? {})) {
    if (typeof record.fallback !== "string" || record.fallback.length === 0) {
      fail(`${key}: missing procedural fallback name`);
    }
    const locked = lock.sources[record.source?.id];
    if (!locked || !sources[record.source?.id]) {
      fail(`${key}: source ${String(record.source?.id)} is not locked and recorded`);
    } else {
      const expectedRevision = locked.kind === "github-commit" ? locked.commit : locked.archive.sha256;
      if (record.source.revision !== expectedRevision) fail(`${key}: source revision differs from the lock`);
      if (typeof record.source.path !== "string" || record.source.path.length === 0) {
        fail(`${key}: missing genuine source path`);
      }
    }
    if (record.output === null || record.output === undefined) {
      if (record.intentionalFallbackOnly !== true) {
        fail(`${key}: no curated output and not marked intentionalFallbackOnly`);
      }
      continue;
    }
    const output = record.output;
    if (
      typeof output.path !== "string"
      || !output.path.startsWith(`assets/curated/${record.source?.id}/`)
      || !HEX64.test(output.sha256 ?? "")
      || !Number.isInteger(output.bytes)
      || output.bytes <= 0
    ) {
      fail(`${key}: curated output record is incomplete`);
    } else {
      if (extensionRule && !extensionRule.test(output.path)) {
        fail(`${key}: output ${output.path} has a forbidden ${domain} format`);
      }
      outputBytes += output.bytes;
    }
    if (!Array.isArray(record.inputs) || record.inputs.length === 0
      || record.inputs.some((input) => !HEX64.test(input.sha256 ?? "") || !Number.isInteger(input.bytes))) {
      fail(`${key}: curated inputs lack full hash provenance`);
    }
  }
  if (manifest.totalOutputBytes !== outputBytes) {
    fail(`totalOutputBytes is ${manifest.totalOutputBytes}, but key outputs sum to ${outputBytes}`);
  }
  return violations;
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

// Inert XML namespace identifiers are not network requests. This mirrors the
// allowlist in scripts/audit/no-network-scan.mjs, which owns the production
// network scan.
const INERT_NAMESPACE_URLS = [
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/2000/xmlns/",
];

export function runtimeReferenceViolations(path, source) {
  const violations = [];
  let masked = source;
  for (const namespace of INERT_NAMESPACE_URLS) {
    masked = masked.replaceAll(namespace, " ".repeat(namespace.length));
  }
  if (/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/iu.test(masked)) {
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
