import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  contentDigest,
  licenseEvidence,
  lockRecordViolations,
  LOCK_SCHEMA_VERSION,
  readLock,
  writeLockIfChanged,
} from "./lock.mjs";
import { safeExtractArchive, sha256 } from "./safe-extract.mjs";

const KENNEY_ZIP_PATTERN = /https:\/\/kenney\.nl\/media\/pages\/assets\/[^'"><\s]+\.zip/gu;

export async function defaultFetchBytes(url, limit) {
  const response = await fetch(url, {
    headers: { "user-agent": "Gooby offline asset cache/1.0" },
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > limit) throw new Error(`${url} exceeds ${limit} bytes`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) throw new Error(`${url} exceeds ${limit} bytes`);
  return bytes;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertApprovedUrl(url, approvedHosts, purpose) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !approvedHosts.includes(parsed.hostname)) {
    throw new Error(`refusing ${purpose} from unapproved host: ${url}`);
  }
  return url;
}

async function resolveKenneyDownloadUrl(source, fetchBytes, approvedHosts, pageHosts) {
  assertApprovedUrl(source.pageUrl, pageHosts, "official page resolution");
  const html = (await fetchBytes(source.pageUrl, 4 * 1024 * 1024)).toString("utf8");
  const candidates = html.match(KENNEY_ZIP_PATTERN) ?? [];
  const downloadUrl = candidates.find((candidate) => candidate.includes(`/assets/${source.packId}/`));
  if (!downloadUrl) throw new Error(`${source.id}: official page contains no ZIP URL`);
  return assertApprovedUrl(downloadUrl, approvedHosts, "archive download");
}

async function hashTree(root, files) {
  const hashed = [];
  for (const file of files) {
    const bytes = await readFile(join(root, file.path));
    hashed.push({ path: file.path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return hashed;
}

async function walkFiles(root, prefix = "") {
  const files = [];
  const entries = (await readdir(root, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`cached source contains a symbolic link: ${relative}`);
    if (entry.isDirectory()) files.push(...await walkFiles(join(root, entry.name), relative));
    else files.push({ path: relative });
  }
  return files;
}

/**
 * Finds the genuine license notice shipped inside the source tree: the
 * shallowest (root-most) file named License.txt, searched breadth-first so a
 * root notice always wins over nested per-addon copies.
 */
async function findGenuineLicense(sourceRoot) {
  let level = [""];
  while (level.length > 0) {
    const nextLevel = [];
    for (const prefix of level) {
      const entries = (await readdir(join(sourceRoot, prefix), { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isFile() && /^license\.txt$/iu.test(entry.name)) return relative;
        if (entry.isDirectory()) nextLevel.push(relative);
      }
    }
    level = nextLevel;
  }
  return null;
}

/**
 * Ensures every declared source is fully cached and locked:
 * - resolves official pages and downloads archives only when the cache lacks
 *   them (a complete locked cache performs zero downloads),
 * - verifies archive bytes, extracted trees, and genuine license evidence
 *   against the lock and fails loudly on any mutation,
 * - safely extracts archives (traversal/symlink/bomb rejection), and
 * - locks URLs, commits, hashes, byte counts, and license evidence.
 */
export async function cacheSources({
  root,
  sources,
  limits,
  approvedDownloadHosts,
  approvedPageHosts,
  lockPath,
  archiveDir,
  sourceDir,
  stateDir,
  fetchBytes = defaultFetchBytes,
  offline = false,
  repair = false,
  log = console.log,
}) {
  const absoluteLockPath = join(root, lockPath);
  const lock = await readLock(absoluteLockPath);
  const records = {};
  let downloads = 0;

  for (const source of sources) {
    const locked = lock?.sources?.[source.id] ?? null;
    if (locked) {
      const structural = lockRecordViolations(source.id, locked, source, approvedDownloadHosts);
      if (structural.length > 0) {
        throw new Error(`lock integrity failure:\n${structural.map((item) => `- ${item}`).join("\n")}`);
      }
    }

    const archivePath = join(root, archiveDir, `${source.id}.zip`);
    let archiveBytes = null;
    let downloadUrl = locked?.downloadUrl ?? null;
    // A cached Kenney archive without a lock record has unverifiable download
    // provenance (the exact resolved page URL is unknown), so it must be
    // refreshed from the official page instead of guessed. Pinned GitHub
    // commits have a deterministic codeload URL and may be reused.
    let reusableArchive = await pathExists(archivePath);
    if (reusableArchive && !locked) {
      if (source.kind === "kenney-pack") reusableArchive = false;
      else downloadUrl = source.downloadUrl;
    }
    if (reusableArchive) {
      archiveBytes = await readFile(archivePath);
      if (locked && sha256(archiveBytes) !== locked.archive.sha256) {
        throw new Error(
          `${source.id}: cached archive hash does not match the lock; `
          + "the cache was mutated. Delete .asset-cache/archives to re-download.",
        );
      }
    } else {
      if (offline) throw new Error(`${source.id}: archive is not cached and --offline forbids downloads`);
      if (!downloadUrl) {
        downloadUrl = source.kind === "github-commit"
          ? assertApprovedUrl(source.downloadUrl, approvedDownloadHosts, "archive download")
          : await resolveKenneyDownloadUrl(source, fetchBytes, approvedDownloadHosts, approvedPageHosts);
      } else {
        assertApprovedUrl(downloadUrl, approvedDownloadHosts, "locked archive download");
      }
      log(`Downloading ${source.title} from ${downloadUrl}`);
      archiveBytes = await fetchBytes(downloadUrl, limits.maxArchiveBytes);
      downloads += 1;
      if (locked && sha256(archiveBytes) !== locked.archive.sha256) {
        throw new Error(
          `${source.id}: downloaded archive hash differs from the locked provenance; `
          + "refusing to update the lock automatically.",
        );
      }
      await mkdir(dirname(archivePath), { recursive: true });
      const stagingPath = `${archivePath}.download`;
      await writeFile(stagingPath, archiveBytes);
      await rename(stagingPath, archivePath);
    }
    const archiveSha = sha256(archiveBytes);
    downloadUrl = downloadUrl ?? locked?.downloadUrl;

    const sourceRoot = join(root, sourceDir, source.id);
    const statePath = join(root, stateDir, `${source.id}.json`);
    let state = null;
    try {
      state = JSON.parse(await readFile(statePath, "utf8"));
    } catch {
      state = null;
    }

    let files;
    let totalBytes;
    const extract = async () => {
      log(`Extracting ${source.title} (${archiveBytes.length} bytes)`);
      const extraction = await safeExtractArchive(archivePath, sourceRoot, limits, {
        stripSharedRoot: source.kind === "github-commit",
      });
      files = extraction.files;
      totalBytes = extraction.totalBytes;
    };
    if (!await pathExists(sourceRoot) || state?.archiveSha256 !== archiveSha) {
      await extract();
    } else {
      files = await hashTree(sourceRoot, await walkFiles(sourceRoot));
      totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
    }

    let digest = contentDigest(files);
    if (locked && digest !== locked.contentDigest) {
      if (!repair) {
        throw new Error(
          `${source.id}: extracted source tree digest does not match the lock; `
          + "the cache was mutated. Re-run with --repair to re-extract from the verified archive.",
        );
      }
      await extract();
      digest = contentDigest(files);
      if (digest !== locked.contentDigest) {
        throw new Error(`${source.id}: repaired extraction still differs from the locked content digest`);
      }
    }

    const licenseEntry = await findGenuineLicense(sourceRoot);
    if (!licenseEntry) throw new Error(`${source.id}: extracted source has no genuine License.txt`);
    const licenseBytes = await readFile(join(sourceRoot, licenseEntry));
    const evidence = licenseEvidence(
      source.id,
      licenseBytes.toString("utf8"),
      source.license.requiredEvidence,
    );
    if (evidence.violations.length > 0) {
      throw new Error(`refusing to lock without genuine license evidence:\n${
        evidence.violations.map((item) => `- ${item}`).join("\n")}`);
    }
    const licenseSha = sha256(licenseBytes);
    if (locked && licenseSha !== locked.license.sha256) {
      throw new Error(`${source.id}: genuine license hash differs from the locked evidence`);
    }

    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify({
      archiveSha256: archiveSha,
      contentDigest: digest,
      fileCount: files.length,
      totalBytes,
    }, null, 2)}\n`);

    records[source.id] = {
      kind: source.kind,
      title: source.title,
      creator: source.creator,
      ...(source.kind === "kenney-pack" ? { pageUrl: source.pageUrl } : {}),
      ...(source.kind === "github-commit" ? { repoUrl: source.repoUrl, commit: source.commit } : {}),
      downloadUrl,
      archive: { bytes: archiveBytes.length, sha256: archiveSha },
      fileCount: files.length,
      totalBytes,
      contentDigest: digest,
      license: {
        entry: licenseEntry,
        bytes: licenseBytes.length,
        sha256: licenseSha,
        spdx: source.license.spdx,
        evidence: evidence.matched,
      },
    };
    log(`Cached ${source.title}: ${files.length} files, ${totalBytes} bytes, license ${licenseEntry} verified`);
  }

  const nextLock = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    generator: "scripts/asset-cache/cache.mjs",
    sources: records,
  };
  const changed = await writeLockIfChanged(absoluteLockPath, nextLock);
  return { downloads, lockChanged: changed, lock: nextLock };
}
