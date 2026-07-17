import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { ASSET_KEY_MAP, MAX_FILE_BYTES, MAX_TOTAL_BYTES, PACKS } from "./assets/catalog.mjs";
import {
  compareExactKeys,
  extractAssetKeys,
  extractManifestKeys,
  fileSizeViolations,
  glbResourceUris,
  isAllowedRuntimeAudio,
  licenseMetadataViolations,
  runtimeReferenceViolations,
  sha256,
} from "./assets/audit-lib.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const PUBLIC_ROOT = join(ROOT, "public");
const ASSET_ROOT = join(ROOT, "assets");
const RUNTIME_TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs", ".ts", ".tsx"]);
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

  for (const document of ["LICENSES.md", "VENDORED.md"]) {
    const source = await readFile(join(ASSET_ROOT, document), "utf8");
    for (const pack of manifest.packs ?? []) {
      if (!source.includes(pack.title) || !source.includes(pack.pageUrl)) {
        violations.push(`assets/${document}: missing ${pack.title} provenance`);
      }
    }
  }

  const runtimeFiles = [
    ...await filesBelow(join(ROOT, "src")),
    ...publicFiles,
  ];
  for (const file of runtimeFiles) {
    if (file.symbolicLink || !RUNTIME_TEXT_EXTENSIONS.has(extname(file.path).toLowerCase())) continue;
    const source = await readFile(file.path, "utf8");
    const displayPath = relative(ROOT, file.path).replaceAll("\\", "/");
    violations.push(...runtimeReferenceViolations(displayPath, source));
  }

  if (violations.length > 0) {
    console.error(`Asset audit failed with ${violations.length} violation(s):\n${violations.map((item) => `- ${item}`).join("\n")}`);
    process.exitCode = 1;
    return;
  }

  const vendoredCount = (manifest.packs ?? []).filter(({ status }) => status !== "failed").length;
  console.log(
    `Asset audit passed: ${contractKeys.length} keys mapped, ${vendoredCount}/${PACKS.length} packs available, `
    + `${expectedPublicFiles.size} curated files, ${actualTotalBytes} bytes, offline runtime enforced.`,
  );
}

await main();
