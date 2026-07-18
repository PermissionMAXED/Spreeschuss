import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readZipEntries } from "./ziputil.mjs";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const WINDOWS_DRIVE = /^[a-z]:/iu;

function unsafeNameReason(name) {
  if (name.length === 0) return "empty entry name";
  if (name.includes("\\")) return "backslash path separator";
  if (name.includes("\u0000")) return "NUL byte in entry name";
  if (name.startsWith("/") || WINDOWS_DRIVE.test(name)) return "absolute path";
  const segments = name.split("/");
  if (segments.includes("..")) return "path traversal";
  return null;
}

/**
 * Validates ZIP central-directory metadata before extraction. Rejects path
 * traversal, absolute paths, symbolic links, and decompression bombs.
 */
export function archiveEntryViolations(entries, limits) {
  const violations = [];
  if (entries.length > limits.maxEntries) {
    violations.push(`archive declares ${entries.length} entries, above the ${limits.maxEntries} limit`);
  }
  let totalUncompressed = 0;
  let totalCompressed = 0;
  for (const entry of entries) {
    const reason = unsafeNameReason(entry.name);
    if (reason) violations.push(`unsafe entry "${entry.name}": ${reason}`);
    if (entry.isSymlink) violations.push(`unsafe entry "${entry.name}": symbolic link`);
    if (entry.isDirectory) continue;
    if (entry.uncompressedBytes > limits.maxEntryBytes) {
      violations.push(`unsafe entry "${entry.name}": declares ${entry.uncompressedBytes} bytes, above the per-file limit`);
    }
    totalUncompressed += entry.uncompressedBytes;
    totalCompressed += entry.compressedBytes;
  }
  if (totalUncompressed > limits.maxTotalBytes) {
    violations.push(`archive declares ${totalUncompressed} total bytes, above the ${limits.maxTotalBytes} limit`);
  }
  if (
    totalUncompressed > limits.minBytesForRatioCheck
    && totalCompressed > 0
    && totalUncompressed / totalCompressed > limits.maxTotalCompressionRatio
  ) {
    violations.push(`archive expands ${Math.round(totalUncompressed / totalCompressed)}x, above the bomb threshold`);
  }
  return violations;
}

/** True when every entry lives below one shared top-level directory. */
function sharedRootPrefix(entries) {
  let prefix = null;
  for (const entry of entries) {
    const root = entry.name.split("/")[0];
    if (!root) return null;
    if (prefix === null) prefix = root;
    else if (prefix !== root) return null;
    if (entry.name === root && !entry.isDirectory) return null;
  }
  return prefix;
}

async function walkExtracted(root, relativePrefix = "") {
  const files = [];
  const names = (await readdir(root, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  for (const name of names) {
    const path = join(root, name);
    const stats = await lstat(path);
    const relative = relativePrefix ? `${relativePrefix}/${name}` : name;
    if (stats.isSymbolicLink()) {
      throw new Error(`extraction produced a symbolic link: ${relative}`);
    }
    if (stats.isDirectory()) {
      files.push(...await walkExtracted(path, relative));
    } else {
      files.push({ path: relative, bytes: stats.size });
    }
  }
  return files;
}

/**
 * Safely extracts a validated archive into destinationRoot (atomically
 * replacing it). Returns the sorted file inventory with content hashes.
 * GitHub commit archives have their single shared top-level directory
 * stripped so cached trees mirror the repository layout.
 */
export async function safeExtractArchive(archivePath, destinationRoot, limits, { stripSharedRoot = false } = {}) {
  const archive = await readFile(archivePath);
  if (archive.length > limits.maxArchiveBytes) {
    throw new Error(`archive is ${archive.length} bytes, above the ${limits.maxArchiveBytes} limit`);
  }
  const entries = readZipEntries(archive);
  const violations = archiveEntryViolations(entries, limits);
  if (violations.length > 0) {
    throw new Error(`unsafe archive ${archivePath}:\n${violations.map((item) => `- ${item}`).join("\n")}`);
  }

  const parent = dirname(destinationRoot);
  await mkdir(parent, { recursive: true });
  const workRoot = await mkdtemp(join(parent, ".extract-"));
  try {
    const result = spawnSync("unzip", ["-qq", "-o", archivePath, "-d", workRoot], { encoding: "utf8" });
    // Info-ZIP exits 1 for recoverable filename-encoding warnings.
    if (result.status === null || result.status > 1) {
      throw new Error(`unzip failed for ${archivePath}: ${result.stderr.trim()}`);
    }
    let contentRoot = workRoot;
    if (stripSharedRoot) {
      const prefix = sharedRootPrefix(entries.filter(({ name }) => name.length > 0));
      if (!prefix) throw new Error(`${archivePath}: expected a single shared top-level directory`);
      contentRoot = join(workRoot, prefix);
    }
    const inventory = await walkExtracted(contentRoot);
    let totalBytes = 0;
    const files = [];
    for (const file of inventory) {
      totalBytes += file.bytes;
      if (file.bytes > limits.maxEntryBytes) {
        throw new Error(`extracted file ${file.path} is ${file.bytes} bytes, above the per-file limit`);
      }
      const bytes = await readFile(join(contentRoot, file.path));
      files.push({ path: file.path, bytes: file.bytes, sha256: sha256(bytes) });
    }
    if (totalBytes > limits.maxTotalBytes) {
      throw new Error(`extraction produced ${totalBytes} bytes, above the ${limits.maxTotalBytes} limit`);
    }
    await rm(destinationRoot, { recursive: true, force: true });
    await rename(contentRoot, destinationRoot);
    return { files, totalBytes };
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

export function extractZipEntry(archivePath, entryName, maxBytes) {
  return execFileSync("unzip", ["-p", archivePath, entryName], {
    encoding: "buffer",
    maxBuffer: maxBytes,
  });
}
