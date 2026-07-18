import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

export const LOCK_SCHEMA_VERSION = 1;

const digest = (value) => createHash("sha256").update(value).digest("hex");

/**
 * Deterministic digest over an extracted source tree: sorted relative path,
 * SHA-256, and byte count of every file.
 */
export function contentDigest(files) {
  const lines = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${file.path}\n${file.sha256}\n${file.bytes}\n`);
  return digest(lines.join(""));
}

/**
 * License evidence is never guessed: the genuine notice text must contain
 * every required marker (case-insensitive; each marker may list acceptable
 * alternative phrasings) and a plausible length before a source may be
 * locked. Returns the exact phrases that were matched, so the lock records
 * observed evidence rather than an assumption.
 */
export function licenseEvidence(sourceId, licenseText, requiredEvidence) {
  const violations = [];
  const matched = [];
  if (typeof licenseText !== "string" || licenseText.length < 100) {
    violations.push(`${sourceId}: license text is missing or implausibly short`);
    return { violations, matched };
  }
  const haystack = licenseText.toLowerCase();
  for (const marker of requiredEvidence) {
    const alternatives = Array.isArray(marker) ? marker : [marker];
    const found = alternatives.find((alternative) => haystack.includes(alternative.toLowerCase()));
    if (found) matched.push(found);
    else violations.push(`${sourceId}: genuine license text lacks required evidence ${JSON.stringify(alternatives)}`);
  }
  return { violations, matched };
}

export function stableLockDocument(lock) {
  const sources = Object.fromEntries(
    Object.keys(lock.sources).sort((left, right) => left.localeCompare(right))
      .map((id) => [id, lock.sources[id]]),
  );
  return `${JSON.stringify({ ...lock, sources }, null, 2)}\n`;
}

export async function readLock(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const lock = JSON.parse(raw);
  if (lock.schemaVersion !== LOCK_SCHEMA_VERSION) {
    throw new Error(`${path}: unsupported lock schemaVersion ${String(lock.schemaVersion)}`);
  }
  return lock;
}

export async function writeLockIfChanged(path, lock) {
  const document = stableLockDocument(lock);
  let previous = null;
  try {
    previous = await readFile(path, "utf8");
  } catch {
    previous = null;
  }
  if (previous === document) return false;
  await writeFile(path, document);
  return true;
}

const HEX64 = /^[a-f0-9]{64}$/u;
const HEX40 = /^[a-f0-9]{40}$/u;

/** Structural validation shared by the cache command and the asset audit. */
export function lockRecordViolations(sourceId, record, source, approvedHosts) {
  const violations = [];
  const fail = (message) => violations.push(`${sourceId}: ${message}`);
  if (!record) {
    fail("missing lock record");
    return violations;
  }
  if (record.kind !== source.kind) fail(`lock kind "${String(record.kind)}" differs from the declared source`);
  if (record.title !== source.title) fail("lock title differs from the declared source");
  let url = null;
  try {
    url = new URL(record.downloadUrl);
  } catch {
    fail("locked download URL is unparseable");
  }
  if (url) {
    if (url.protocol !== "https:") fail("locked download URL is not HTTPS");
    if (!approvedHosts.includes(url.hostname)) fail(`locked download host "${url.hostname}" is not approved`);
  }
  if (source.kind === "kenney-pack") {
    if (
      typeof record.downloadUrl !== "string"
      || !record.downloadUrl.startsWith(`https://kenney.nl/media/pages/assets/${source.packId}/`)
      || !record.downloadUrl.endsWith(".zip")
    ) {
      fail("locked download is not an official Kenney ZIP URL for this pack");
    }
    if (record.pageUrl !== source.pageUrl) fail("locked page URL differs from the declared official page");
  }
  if (source.kind === "github-commit") {
    if (record.commit !== source.commit || !HEX40.test(record.commit ?? "")) {
      fail("locked commit differs from the pinned official commit");
    }
    if (record.repoUrl !== source.repoUrl) fail("locked repository URL differs from the declared source");
    if (record.downloadUrl !== source.downloadUrl) fail("locked download URL differs from the pinned codeload archive");
  }
  if (!Number.isInteger(record.archive?.bytes) || record.archive.bytes <= 0) fail("locked archive byte count is missing");
  if (!HEX64.test(record.archive?.sha256 ?? "")) fail("locked archive SHA-256 is missing");
  if (!HEX64.test(record.contentDigest ?? "")) fail("locked extraction content digest is missing");
  if (!Number.isInteger(record.fileCount) || record.fileCount <= 0) fail("locked file count is missing");
  const license = record.license;
  if (
    !license
    || typeof license.entry !== "string"
    || !/license\.txt$/iu.test(license.entry)
    || !HEX64.test(license.sha256 ?? "")
    || !Number.isInteger(license.bytes)
    || license.bytes < 100
    || license.spdx !== "CC0-1.0"
    || !Array.isArray(license.evidence)
    || license.evidence.length === 0
  ) {
    fail("locked license evidence is missing or not genuine");
  }
  return violations;
}
