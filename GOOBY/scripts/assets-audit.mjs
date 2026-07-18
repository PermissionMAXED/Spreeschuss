import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { ASSET_KEY_MAP, MAX_FILE_BYTES, MAX_TOTAL_BYTES, PACKS } from "./assets/catalog.mjs";
import {
  buildAssetConsumerAudit,
  compareExactKeys,
  curatedDomainViolations,
  extractAssetKeys,
  extractManifestKeys,
  extractPlannedManifestKeys,
  extractRuntimeAssetRequests,
  fileSizeViolations,
  glbResourceUris,
  isAllowedRuntimeAudio,
  licenseMetadataViolations,
  plannedVendoredViolations,
  runtimeReferenceViolations,
  sha256,
} from "./assets/audit-lib.mjs";
import {
  LICENSE_NOTICE_BUNDLED_PATH,
  licenseNoticeDocument,
  licenseNoticeRecord,
  licenseNoticeViolations,
} from "./assets/license-notice.mjs";
import {
  CURATED_DOCUMENT_PATH,
  CURATED_MODEL_SPECS,
  CURATED_MODELS_MANIFEST_PATH,
  RUNTIME_ASSET_BUDGET_BYTES,
} from "./asset-cache/curation-spec.mjs";
import { lockRecordViolations, readLock } from "./asset-cache/lock.mjs";
import { APPROVED_DOWNLOAD_HOSTS, SOURCES } from "./asset-cache/sources.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const PUBLIC_ROOT = join(ROOT, "public");
const ASSET_ROOT = join(ROOT, "assets");
const RUNTIME_TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs", ".ts", ".tsx"]);
// Test and dev-harness files never ship in the production bundle; they use
// fixture origins (including deliberately-rejected external URLs) to prove
// runtime network refusal. This mirrors scripts/audit/no-network-scan.mjs,
// which owns the same exclusion for its production source/build scans.
const EXCLUDED_DEV_FILE = /(?:^|\/)(?:[^/]*\.(?:test|spec|e2e)\.[^/]+|[^/]*harness[^/]*|[^/]*playwright[^/]*config[^/]*|(?:vite[^/]*|[^/]*\.vite)\.config\.[^/]+)$/u;
const forbiddenAudioExtensions = new Set([".aac", ".flac", ".ogg", ".oga", ".opus"]);

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) return [{ path, symbolicLink: true }];
    if (entry.isDirectory()) return filesBelow(path);
    return [{ path, symbolicLink: false }];
  }));
  return nested.flat();
}

function safePath(root, path) {
  const resolved = resolve(root, path);
  const rel = relative(root, resolved);
  if (rel.startsWith(`..${sep}`) || rel === ".." || resolve(root) === resolved) return null;
  return resolved;
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function optionalText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

const CURATED_DOMAIN_MANIFESTS = [
  { domain: "models", manifestPath: CURATED_MODELS_MANIFEST_PATH, required: CURATED_MODEL_SPECS.length > 0 },
  { domain: "audio", manifestPath: "assets/curated/audio.manifest.json", required: false },
  { domain: "stickers", manifestPath: "assets/curated/stickers.manifest.json", required: false },
];

/**
 * Audits the source-cache lock plus every curated domain manifest that is
 * present (models always; audio/stickers when added): lock/consumer/license/
 * hash/size chains, deterministic spec provenance, GLB self-containment,
 * exact key coverage in PLANNED_ASSET_MANIFEST, and untracked-file detection.
 */
async function auditCuratedDomains({ violations, publicFiles, assetFiles, runtimeManifestSource }) {
  let lock = null;
  try {
    lock = await readLock(join(ASSET_ROOT, "sources.lock.json"));
  } catch (error) {
    violations.push(`assets/sources.lock.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (lock) {
    violations.push(...compareExactKeys(
      SOURCES.map(({ id }) => id),
      Object.keys(lock.sources ?? {}),
      "assets/sources.lock.json sources",
    ).map((violation) => violation.replaceAll("AssetKey", "source")));
    for (const source of SOURCES) {
      if (!lock.sources?.[source.id]) continue;
      violations.push(...lockRecordViolations(source.id, lock.sources[source.id], source, APPROVED_DOWNLOAD_HOSTS));
    }
  }

  const domains = [];
  for (const { domain, manifestPath, required } of CURATED_DOMAIN_MANIFESTS) {
    const raw = await optionalText(join(ROOT, manifestPath));
    if (raw === null) {
      if (required) violations.push(`${manifestPath}: curated ${domain} manifest is missing; run "npm run assets:curate"`);
      continue;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      violations.push(`${manifestPath}: unreadable curated manifest`);
      continue;
    }
    if (!lock) {
      violations.push(`${manifestPath}: present without assets/sources.lock.json`);
      continue;
    }
    violations.push(...curatedDomainViolations({ domain, manifest: parsed, lock }));
    domains.push({ domain, manifestPath, manifest: parsed });
  }

  // The models domain must be the exact deterministic product of the
  // checked-in curation spec.
  const models = domains.find(({ domain }) => domain === "models")?.manifest;
  if (models) {
    const specBytes = await readFile(join(ROOT, "scripts/asset-cache/curation-spec.mjs"));
    if (models.spec?.sha256 !== createHash("sha256").update(specBytes).digest("hex")) {
      violations.push("curated models: manifest was not regenerated after the curation spec changed");
    }
    violations.push(...compareExactKeys(
      CURATED_MODEL_SPECS.map(({ key }) => key),
      Object.keys(models.keys ?? {}),
      "curated models manifest keys",
    ));
    for (const spec of CURATED_MODEL_SPECS) {
      const record = models.keys?.[spec.key];
      if (!record) continue;
      if (
        record.source?.id !== spec.sourceId
        || record.source?.path !== spec.sourcePath
        || record.output?.path !== spec.output
        || record.fallback !== spec.fallback
        || record.mode !== spec.mode
        || record.purpose !== spec.purpose
      ) {
        violations.push(`${spec.key}: curated manifest record differs from the checked-in curation spec`);
      }
    }
  }

  const expectedOutputs = new Map();
  const expectedLicenses = new Map();
  const domainKeyRecords = new Map();
  for (const { domain, manifest } of domains) {
    for (const [sourceId, source] of Object.entries(manifest.sources ?? {})) {
      if (source.license?.path) expectedLicenses.set(source.license.path, source.license);
      if (!runtimeManifestSource.includes(`packId: "${sourceId}"`)) {
        violations.push(`${sourceId}: missing from CURATED_ASSET_CREDITS in src/data/assetManifest.ts`);
      }
    }
    for (const [key, record] of Object.entries(manifest.keys ?? {})) {
      if (domainKeyRecords.has(key)) violations.push(`${key}: declared by multiple curated domains`);
      domainKeyRecords.set(key, record);
      if (record.output?.path) expectedOutputs.set(record.output.path, { domain, key, output: record.output });
    }
  }

  for (const [path, { domain, key, output }] of expectedOutputs) {
    const filePath = safePath(PUBLIC_ROOT, path);
    if (!filePath) {
      violations.push(`${path}: unsafe curated runtime path`);
      continue;
    }
    let bytes;
    try {
      bytes = await readFile(filePath);
    } catch {
      violations.push(`${path}: curated manifest points to a missing runtime file`);
      continue;
    }
    if (bytes.length !== output.bytes) violations.push(`${path}: byte count mismatch`);
    if (sha256(bytes) !== output.sha256) violations.push(`${path}: checksum mismatch`);
    violations.push(...fileSizeViolations(path, bytes.length, MAX_FILE_BYTES));
    if (domain === "models") {
      try {
        const uris = glbResourceUris(bytes, path);
        if (uris.length > 0) {
          violations.push(`${path}: curated GLB must be self-contained but references ${uris.join(", ")}`);
        }
      } catch (error) {
        violations.push(error instanceof Error ? error.message : `${path}: invalid curated GLB`);
      }
    }
    if (domain === "audio" && !isAllowedRuntimeAudio(path)) {
      violations.push(`${path}: curated runtime audio must be m4a, mp3, or wav`);
    }
    void key;
  }

  for (const [path, license] of expectedLicenses) {
    const filePath = safePath(ROOT, path);
    if (!filePath) {
      violations.push(`${path}: unsafe curated license path`);
      continue;
    }
    try {
      const bytes = await readFile(filePath);
      if (bytes.length !== license.bytes) violations.push(`${path}: license byte count mismatch`);
      if (sha256(bytes) !== license.sha256) violations.push(`${path}: license checksum mismatch`);
    } catch {
      violations.push(`${path}: missing verbatim curated license file`);
    }
  }

  const actualPublicCurated = new Set(publicFiles
    .map(({ path }) => relative(PUBLIC_ROOT, path).replaceAll("\\", "/"))
    .filter((path) => path.startsWith("assets/curated/")));
  for (const path of sorted(actualPublicCurated)) {
    if (!expectedOutputs.has(path)) violations.push(`${path}: untracked curated runtime file`);
  }
  const expectedCuratedTree = new Set([
    ...expectedLicenses.keys(),
    ...domains.map(({ manifestPath }) => manifestPath),
    CURATED_DOCUMENT_PATH,
  ]);
  const actualCuratedTree = new Set(assetFiles
    .map(({ path }) => relative(ROOT, path).replaceAll("\\", "/"))
    .filter((path) => path.startsWith("assets/curated/")));
  for (const path of sorted(actualCuratedTree)) {
    if (!expectedCuratedTree.has(path)) violations.push(`${path}: untracked curated asset file`);
  }
  for (const path of sorted(expectedCuratedTree)) {
    if (domains.length > 0 && !actualCuratedTree.has(path)) violations.push(`${path}: missing curated asset file`);
  }

  if (domains.length > 0) {
    const document = await optionalText(join(ROOT, CURATED_DOCUMENT_PATH));
    for (const { manifest } of domains) {
      for (const source of Object.values(manifest.sources ?? {})) {
        if (document !== null && (!document.includes(source.title) || !document.includes(source.archiveSha256))) {
          violations.push(`${CURATED_DOCUMENT_PATH}: missing ${source.title} provenance`);
        }
      }
    }
  }

  const plannedKeys = extractPlannedManifestKeys(runtimeManifestSource);
  if (domains.length > 0 || plannedKeys.length > 0) {
    violations.push(...compareExactKeys(
      [...domainKeyRecords.keys()],
      plannedKeys,
      "src/data/assetManifest.ts PLANNED_ASSET_MANIFEST",
    ));
    for (const [key, record] of domainKeyRecords) {
      violations.push(...plannedVendoredViolations(
        runtimeManifestSource,
        key,
        record.output?.path ?? null,
        record.intentionalFallbackOnly === true,
      ));
    }
  }

  return {
    domains: domains.map(({ domain }) => domain),
    curatedKeys: domainKeyRecords.size,
    curatedFiles: expectedOutputs.size,
    lockSources: lock ? Object.keys(lock.sources ?? {}).length : 0,
  };
}

async function main() {
  const violations = [];
  const manifestPath = join(ASSET_ROOT, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    console.error(`Asset audit failed: cannot read assets/manifest.json: ${String(error)}`);
    process.exitCode = 1;
    return;
  }

  const contractSource = await readFile(join(ROOT, "src/core/contracts/assets.ts"), "utf8");
  const runtimeManifestSource = await readFile(join(ROOT, "src/data/assetManifest.ts"), "utf8");
  const contractKeys = extractAssetKeys(contractSource);
  const catalogKeys = Object.keys(ASSET_KEY_MAP);
  const machineKeys = Object.keys(manifest.keys ?? {});
  const runtimeKeys = extractManifestKeys(runtimeManifestSource);
  if (contractKeys.length === 0) violations.push("Could not parse the frozen ASSET_KEYS contract");
  violations.push(...compareExactKeys(contractKeys, catalogKeys, "scripts/assets/catalog.mjs"));
  violations.push(...compareExactKeys(contractKeys, machineKeys, "assets/manifest.json"));
  violations.push(...compareExactKeys(contractKeys, runtimeKeys, "src/data/assetManifest.ts"));

  if (manifest.schemaVersion !== 1) violations.push("assets/manifest.json has an unsupported schemaVersion");
  if (manifest.constraints?.maxFileBytes !== MAX_FILE_BYTES) violations.push("Manifest per-file limit differs from the audit limit");
  if (manifest.constraints?.maxTotalBytes !== MAX_TOTAL_BYTES) violations.push("Manifest total limit differs from the audit limit");
  if (!sameJson(manifest.constraints?.runtimeAudioExtensions, [".m4a", ".mp3", ".wav"])) {
    violations.push("Manifest runtime audio allowlist must be .m4a, .mp3, and .wav");
  }

  const expectedPackIds = PACKS.map(({ id }) => id);
  const actualPackIds = (manifest.packs ?? []).map(({ id }) => id);
  violations.push(...compareExactKeys(expectedPackIds, actualPackIds, "assets/manifest.json packs"));
  const manifestPacks = new Map((manifest.packs ?? []).map((pack) => [pack.id, pack]));
  const availablePaths = new Set();
  const expectedPublicFiles = new Set();
  const expectedLicenseFiles = new Set();
  const modelDependencies = [];
  const licenseSources = new Map();
  let recordedBytes = 0;

  for (const pack of PACKS) {
    const record = manifestPacks.get(pack.id);
    if (!record) continue;
    if (!["vendored", "retained", "failed"].includes(record.status)) {
      violations.push(`${pack.id}: invalid status "${String(record.status)}"`);
      continue;
    }
    if (record.pageUrl !== pack.pageUrl) violations.push(`${pack.id}: official page URL does not match catalog`);

    if (record.status === "failed") {
      if ((record.files ?? []).length > 0 || record.license) {
        violations.push(`${pack.id}: failed packs cannot claim vendored files or a license`);
      }
      if (typeof record.error !== "string" || record.error.length === 0) {
        violations.push(`${pack.id}: failed pack must record a reason`);
      }
      continue;
    }

    if (
      typeof record.downloadUrl !== "string"
      || !record.downloadUrl.startsWith(`https://kenney.nl/media/pages/assets/${pack.id}/`)
      || !record.downloadUrl.endsWith(".zip")
    ) {
      violations.push(`${pack.id}: resolved download is not an official Kenney ZIP URL`);
    }
    if (!/^[a-f0-9]{64}$/u.test(record.archiveSha256 ?? "")) {
      violations.push(`${pack.id}: missing archive SHA-256 provenance`);
    }

    const licenseViolations = licenseMetadataViolations(pack.id, record.license);
    violations.push(...licenseViolations);
    if (licenseViolations.length === 0) {
      const licensePath = safePath(ROOT, record.license.path);
      expectedLicenseFiles.add(record.license.path);
      if (!licensePath) {
        violations.push(`${pack.id}: unsafe license path`);
      } else {
        try {
          const bytes = await readFile(licensePath);
          recordedBytes += bytes.length;
          if (bytes.length < 100) violations.push(`${pack.id}: License.txt is unexpectedly short`);
          if (bytes.length !== record.license.bytes) violations.push(`${pack.id}: License.txt byte count mismatch`);
          if (sha256(bytes) !== record.license.sha256) violations.push(`${pack.id}: License.txt checksum mismatch`);
          licenseSources.set(pack.id, bytes.toString("utf8"));
        } catch {
          violations.push(`${pack.id}: missing License.txt`);
        }
      }
    }

    const expectedFiles = new Map(pack.files.map((file) => [file.output, file]));
    const actualPaths = (record.files ?? []).map(({ path }) => path);
    violations.push(...compareExactKeys([...expectedFiles.keys()], actualPaths, `${pack.id} curated files`));
    for (const fileRecord of record.files ?? []) {
      const expected = expectedFiles.get(fileRecord.path);
      if (!expected) continue;
      expectedPublicFiles.add(fileRecord.path);
      availablePaths.add(fileRecord.path);
      if (
        fileRecord.sourceEntry !== expected.source
        || fileRecord.kind !== expected.kind
        || fileRecord.purpose !== expected.purpose
        || (fileRecord.transform ?? null) !== (expected.transform ?? null)
        || !sameJson(fileRecord.consumers ?? [], expected.consumers ?? [])
      ) {
        violations.push(`${fileRecord.path}: metadata differs from curated catalog`);
      }
      if (fileRecord.kind === "audio" && !isAllowedRuntimeAudio(fileRecord.path)) {
        violations.push(`${fileRecord.path}: runtime audio must be m4a, mp3, or wav`);
      }
      const filePath = safePath(PUBLIC_ROOT, fileRecord.path);
      if (!filePath) {
        violations.push(`${fileRecord.path}: unsafe runtime path`);
        continue;
      }
      try {
        const bytes = await readFile(filePath);
        recordedBytes += bytes.length;
        violations.push(...fileSizeViolations(fileRecord.path, bytes.length, MAX_FILE_BYTES));
        if (bytes.length !== fileRecord.bytes) violations.push(`${fileRecord.path}: byte count mismatch`);
        if (sha256(bytes) !== fileRecord.sha256) violations.push(`${fileRecord.path}: checksum mismatch`);
        if (fileRecord.kind === "model") {
          try {
            for (const uri of glbResourceUris(bytes, fileRecord.path)) {
              if (/^(?:[a-z]+:|\/\/|\/)/iu.test(uri)) {
                violations.push(`${fileRecord.path}: external GLB dependency "${uri}"`);
                continue;
              }
              const dependency = normalize(join(dirname(fileRecord.path), decodeURIComponent(uri))).replaceAll("\\", "/");
              if (dependency === ".." || dependency.startsWith("../")) {
                violations.push(`${fileRecord.path}: unsafe GLB dependency "${uri}"`);
              } else {
                modelDependencies.push({ model: fileRecord.path, dependency });
              }
            }
          } catch (error) {
            violations.push(error instanceof Error ? error.message : `${fileRecord.path}: invalid GLB`);
          }
        }
      } catch {
        violations.push(`${fileRecord.path}: missing vendored file`);
      }
    }
  }

  if (recordedBytes !== manifest.totalBytes) {
    violations.push(`Manifest totalBytes is ${manifest.totalBytes}, but recorded vendored output is ${recordedBytes}`);
  }
  for (const { model, dependency } of modelDependencies) {
    if (!expectedPublicFiles.has(dependency)) {
      violations.push(`${model}: untracked or missing local GLB dependency "${dependency}"`);
    }
  }

  for (const [key, expected] of Object.entries(ASSET_KEY_MAP)) {
    const machine = manifest.keys?.[key];
    if (!machine || typeof machine.fallback !== "string" || machine.fallback.length === 0) {
      violations.push(`${key}: missing procedural fallback mapping`);
      continue;
    }
    if (machine.fallback !== expected.fallback) violations.push(`${key}: fallback mapping differs from catalog`);
    const expectedVendored = (expected.vendored ?? []).filter(({ path }) => availablePaths.has(path));
    if (!sameJson(machine.vendored, expectedVendored)) violations.push(`${key}: vendored mapping differs from available files`);
    for (const reference of expected.vendored ?? []) {
      if (!runtimeManifestSource.includes(`"${reference.path}"`)) {
        violations.push(`${key}: runtime manifest omits ${reference.path}`);
      }
    }
  }

  const publicFiles = await filesBelow(join(PUBLIC_ROOT, "assets"));
  const assetFiles = await filesBelow(ASSET_ROOT);
  let actualTotalBytes = 0;
  for (const file of [...publicFiles, ...assetFiles]) {
    const displayPath = relative(ROOT, file.path).replaceAll("\\", "/");
    if (file.symbolicLink) {
      violations.push(`${displayPath}: symbolic links are not allowed in offline assets`);
      continue;
    }
    const metadata = await stat(file.path);
    actualTotalBytes += metadata.size;
    violations.push(...fileSizeViolations(displayPath, metadata.size, MAX_FILE_BYTES));
    if (forbiddenAudioExtensions.has(extname(file.path).toLowerCase())) {
      violations.push(`${displayPath}: forbidden runtime audio format`);
    }
  }
  if (actualTotalBytes > MAX_TOTAL_BYTES) {
    violations.push(`assets/ plus public/assets/ total ${actualTotalBytes} bytes, exceeding 150 MB`);
  }

  const actualPublicVendor = new Set(publicFiles
    .map(({ path }) => relative(PUBLIC_ROOT, path).replaceAll("\\", "/"))
    .filter((path) => path.startsWith("assets/vendor/")));
  const actualLicenses = new Set(assetFiles
    .map(({ path }) => relative(ROOT, path).replaceAll("\\", "/"))
    .filter((path) => path.startsWith("assets/vendor/")));
  for (const path of sorted(actualPublicVendor)) {
    if (!expectedPublicFiles.has(path)) violations.push(`${path}: untracked vendored runtime file`);
  }
  for (const path of sorted(expectedPublicFiles)) {
    if (!actualPublicVendor.has(path)) violations.push(`${path}: manifest points to a missing runtime file`);
  }
  for (const path of sorted(actualLicenses)) {
    if (!expectedLicenseFiles.has(path)) violations.push(`${path}: untracked license file`);
  }
  for (const path of sorted(expectedLicenseFiles)) {
    if (!actualLicenses.has(path)) violations.push(`${path}: missing genuine license file`);
  }

  // --- Source-cache lock and curated domain manifests -----------------------
  const curatedSummary = await auditCuratedDomains({
    violations,
    publicFiles,
    assetFiles,
    runtimeManifestSource,
  });
  if (actualTotalBytes > RUNTIME_ASSET_BUDGET_BYTES) {
    // The combined committed asset payload must stay within the runtime
    // target even before the frozen 150 MB ceiling applies.
    violations.push(
      `assets/ plus public/assets/ total ${actualTotalBytes} bytes, exceeding the ${RUNTIME_ASSET_BUDGET_BYTES} byte runtime target`,
    );
  }

  for (const document of ["VENDORED.md"]) {
    const source = await readFile(join(ASSET_ROOT, document), "utf8");
    for (const pack of manifest.packs ?? []) {
      if (!source.includes(pack.title) || !source.includes(pack.pageUrl)) {
        violations.push(`assets/${document}: missing ${pack.title} provenance`);
      }
    }
  }

  let expectedLicenseDocument = "";
  try {
    expectedLicenseDocument = licenseNoticeDocument(manifest.packs ?? [], licenseSources);
  } catch (error) {
    violations.push(`Cannot generate the bundled license notice: ${error instanceof Error ? error.message : String(error)}`);
  }
  const expectedLicenseRecord = licenseNoticeRecord(expectedLicenseDocument, manifest.packs ?? []);
  const distRoot = join(ROOT, "dist");
  const nativeRoot = join(ROOT, "ios/App/App/public");
  const builtDocument = await isDirectory(distRoot)
    ? await optionalText(join(distRoot, LICENSE_NOTICE_BUNDLED_PATH))
    : process.argv.includes("--require-built") ? null : undefined;
  const nativeDocument = await isDirectory(nativeRoot)
    ? await optionalText(join(nativeRoot, LICENSE_NOTICE_BUNDLED_PATH))
    : process.argv.includes("--require-native") ? null : undefined;
  violations.push(...licenseNoticeViolations({
    expectedDocument: expectedLicenseDocument,
    expectedRecord: expectedLicenseRecord,
    canonicalDocument: await optionalText(join(ROOT, expectedLicenseRecord.canonicalPath)),
    bundledDocument: await optionalText(join(PUBLIC_ROOT, expectedLicenseRecord.bundledPath)),
    manifestNotices: manifest.notices,
    runtimeManifestSource,
    viteConfigSource: await readFile(join(ROOT, "vite.config.ts"), "utf8"),
    requiredPackIds: expectedPackIds,
    requiredFiles: PACKS.flatMap((pack) => pack.files.map(({ output }) => output)),
    builtDocument,
    nativeDocument,
  }));

  const sourceRuntimeFiles = await filesBelow(join(ROOT, "src"));
  const runtimeFiles = [
    ...sourceRuntimeFiles,
    ...publicFiles,
  ];
  const sourceFiles = new Map();
  for (const file of runtimeFiles) {
    if (file.symbolicLink || !RUNTIME_TEXT_EXTENSIONS.has(extname(file.path).toLowerCase())) continue;
    const source = await readFile(file.path, "utf8");
    const displayPath = relative(ROOT, file.path).replaceAll("\\", "/");
    if (displayPath.startsWith("src/")) sourceFiles.set(displayPath, source);
    if (EXCLUDED_DEV_FILE.test(displayPath)) continue;
    violations.push(...runtimeReferenceViolations(displayPath, source));
  }

  const declaredAssetKeys = new Map();
  for (const [key, mapping] of Object.entries(manifest.keys ?? {})) {
    for (const reference of mapping.vendored ?? []) {
      const keys = declaredAssetKeys.get(reference.path) ?? new Set();
      keys.add(key);
      declaredAssetKeys.set(reference.path, keys);
    }
  }
  const runtimeRequests = extractRuntimeAssetRequests(sourceFiles, contractKeys);
  const consumerAudit = buildAssetConsumerAudit({
    files: (manifest.packs ?? []).flatMap((pack) => pack.files ?? []),
    availablePaths: actualPublicVendor,
    modelDependencies,
    runtimeRequests,
    sourceFiles,
    declaredAssetKeys,
  });
  violations.push(...consumerAudit.violations);

  if (violations.length > 0) {
    console.error(`Asset audit failed with ${violations.length} violation(s):\n${violations.map((item) => `- ${item}`).join("\n")}`);
    process.exitCode = 1;
    return;
  }

  console.log("Asset consumer audit:");
  for (const entry of consumerAudit.entries) {
    const dependency = entry.dependenciesOf.length > 0
      ? `transitive GLB dependency of ${entry.dependenciesOf.join(", ")}`
      : "not transitive";
    const request = entry.runtimeRequests.length > 0
      ? entry.runtimeRequests
        .map(({ assetKey, paths }) => `${assetKey} from ${paths.join(", ")}`)
        .join("; ")
      : "none (resolved through a parent GLB)";
    const consumer = entry.sourceConsumers.length > 0
      ? entry.sourceConsumers
        .map(({ path, marker }) => `${path} :: ${marker}`)
        .join("; ")
      : "none (parent model is the source consumer)";
    console.log(`- ${entry.path}: declaration=yes; ${dependency}; runtime request=${request}; source consumer=${consumer}`);
  }
  const vendoredCount = (manifest.packs ?? []).filter(({ status }) => status !== "failed").length;
  console.log(
    `Asset audit passed: ${contractKeys.length} keys mapped, ${vendoredCount}/${PACKS.length} packs available, `
    + `${expectedPublicFiles.size} curated files, bundled license notice verified, `
    + `${actualTotalBytes} bytes, offline runtime enforced.`,
  );
  console.log(
    `Curated domains passed: [${curatedSummary.domains.join(", ")}], ${curatedSummary.curatedKeys} planned keys, `
    + `${curatedSummary.curatedFiles} curated outputs, ${curatedSummary.lockSources} locked sources, `
    + `runtime payload within the ${RUNTIME_ASSET_BUDGET_BYTES} byte target.`,
  );
}

await main();
