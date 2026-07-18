import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  ASSET_KEY_MAP,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  PACKS,
} from "./assets/catalog.mjs";
import {
  LICENSE_NOTICE_BUNDLED_PATH,
  LICENSE_NOTICE_CANONICAL_PATH,
  licenseNoticeDocument,
  licenseNoticeRecord,
} from "./assets/license-notice.mjs";
import { readLock } from "./asset-cache/lock.mjs";
import { CACHE_ARCHIVE_DIR, LOCK_PATH } from "./asset-cache/sources.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const ASSETS_ROOT = join(ROOT, "assets");
const PUBLIC_ROOT = join(ROOT, "public");
const MANIFEST_PATH = join(ASSETS_ROOT, "manifest.json");
const ZIP_LIMIT_BYTES = 40 * 1024 * 1024;
const DOWNLOAD_PATTERN = /https:\/\/kenney\.nl\/media\/pages\/assets\/[^'"><\s]+\.zip/gu;
const AUDIO_OUTPUTS = new Set([".m4a", ".mp3", ".wav"]);

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const posix = (path) => path.replaceAll("\\", "/");
const extension = (path) => path.slice(path.lastIndexOf(".")).toLowerCase();

async function fetchBytes(url, limit = ZIP_LIMIT_BYTES) {
  const response = await fetch(url, {
    headers: { "user-agent": "Gooby offline asset vendor/1.0" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > limit) throw new Error(`Download exceeds ${limit} bytes`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) throw new Error(`Download exceeds ${limit} bytes`);
  return bytes;
}

async function resolveDownload(pack) {
  const html = (await fetchBytes(pack.pageUrl, 2 * 1024 * 1024)).toString("utf8");
  const candidates = html.match(DOWNLOAD_PATTERN) ?? [];
  const downloadUrl = candidates.find((candidate) => candidate.includes(`/assets/${pack.id}/`));
  if (!downloadUrl) throw new Error(`Official page contains no ZIP URL for ${pack.id}`);
  const parsed = new URL(downloadUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== "kenney.nl") {
    throw new Error(`Refusing non-Kenney download URL for ${pack.id}`);
  }
  return downloadUrl;
}

function archiveEntries(archivePath) {
  return execFileSync("unzip", ["-Z1", archivePath], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).split(/\r?\n/u).filter(Boolean);
}

function extractEntry(archivePath, entry) {
  return execFileSync("unzip", ["-p", archivePath, entry], {
    encoding: "buffer",
    maxBuffer: MAX_FILE_BYTES + 1024,
  });
}

function hasFfmpeg() {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

async function transcodeOgg(source, workDirectory) {
  if (!hasFfmpeg()) throw new Error("ffmpeg is required to transcode selected OGG audio");
  const inputPath = join(workDirectory, "source.ogg");
  const outputPath = join(workDirectory, "output.wav");
  await writeFile(inputPath, source);
  execFileSync(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "44100",
      "-c:a",
      "pcm_s16le",
      outputPath,
    ],
    { stdio: "pipe" },
  );
  return readFile(outputPath);
}

async function outputBytes(archivePath, file, workDirectory) {
  const source = extractEntry(archivePath, file.source);
  if (file.transform === "ogg-to-wav") {
    if (extension(file.output) !== ".wav") throw new Error(`Audio output must be WAV: ${file.output}`);
    return transcodeOgg(source, workDirectory);
  }
  return source;
}

async function writeStagedFile(stageRoot, relativePath, bytes) {
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`${relativePath} exceeds the 10 MB file limit`);
  const destination = join(stageRoot, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return {
    path: posix(relativePath),
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

/**
 * Source-cache-first resolution: when the shared source cache already holds
 * this pack's archive and it matches the committed lock, vendor from the
 * cache with zero network traffic; otherwise fall back to the official page.
 */
async function cachedArchive(pack, lock) {
  const record = lock?.sources?.[`kenney-${pack.id}`];
  if (!record) return null;
  try {
    const bytes = await readFile(join(ROOT, CACHE_ARCHIVE_DIR, `kenney-${pack.id}.zip`));
    if (bytes.length !== record.archive.bytes || sha256(bytes) !== record.archive.sha256) return null;
    return { downloadUrl: record.downloadUrl, archive: bytes };
  } catch {
    return null;
  }
}

async function vendorPack(pack, stageRoot, workRoot, lock, offline) {
  const cached = await cachedArchive(pack, lock);
  if (offline && !cached) {
    throw new Error("Offline mode requested and the source cache has no verified archive; using checksummed vendored files");
  }
  const downloadUrl = cached?.downloadUrl ?? await resolveDownload(pack);
  const archive = cached?.archive ?? await fetchBytes(downloadUrl);
  const archivePath = join(workRoot, `${pack.id}.zip`);
  await writeFile(archivePath, archive);
  const archiveTest = spawnSync("unzip", ["-tqq", archivePath], { encoding: "utf8" });
  // Info-ZIP exits 1 for recoverable filename-encoding warnings (not corrupt data).
  if (archiveTest.status === null || archiveTest.status > 1) {
    throw new Error(`Archive validation failed for ${pack.id}: ${archiveTest.stderr.trim()}`);
  }
  const entries = archiveEntries(archivePath);
  const licenseEntry = entries.find((entry) => /(^|\/)license\.txt$/iu.test(entry));
  if (!licenseEntry) throw new Error(`${pack.id} archive has no genuine License.txt`);

  for (const file of pack.files) {
    if (!entries.includes(file.source)) throw new Error(`${pack.id} is missing curated file: ${file.source}`);
    if (file.kind === "audio" && !AUDIO_OUTPUTS.has(extension(file.output))) {
      throw new Error(`Unsupported runtime audio format: ${file.output}`);
    }
  }

  const licenseBytes = extractEntry(archivePath, licenseEntry);
  const license = await writeStagedFile(
    stageRoot,
    `assets/vendor/${pack.id}/License.txt`,
    licenseBytes,
  );
  const files = [];
  for (const [index, file] of pack.files.entries()) {
    const transformRoot = join(workRoot, `${pack.id}-${index}`);
    await mkdir(transformRoot, { recursive: true });
    const bytes = await outputBytes(archivePath, file, transformRoot);
    const written = await writeStagedFile(stageRoot, `public/${file.output}`, bytes);
    files.push({
      ...written,
      path: file.output,
      sourceEntry: file.source,
      kind: file.kind,
      purpose: file.purpose,
      ...(file.transform ? { transform: file.transform } : {}),
      ...(file.consumers ? { consumers: file.consumers } : {}),
    });
  }

  return {
    id: pack.id,
    title: pack.title,
    status: "vendored",
    pageUrl: pack.pageUrl,
    downloadUrl,
    archiveBytes: archive.length,
    archiveSha256: sha256(archive),
    license: {
      path: license.path,
      bytes: license.bytes,
      sha256: license.sha256,
      archiveEntry: licenseEntry,
    },
    files,
  };
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function validPreviousPack(pack, previous) {
  if (!previous || !["vendored", "retained"].includes(previous.status) || !previous.license) return false;
  const licensePath = join(ROOT, previous.license.path);
  if (!await pathExists(licensePath) || sha256(await readFile(licensePath)) !== previous.license.sha256) return false;
  const previousFiles = new Map((previous.files ?? []).map((record) => [record.path, record]));
  for (const file of pack.files) {
    const record = previousFiles.get(file.output);
    if (!record) return false;
    const path = join(PUBLIC_ROOT, record.path);
    if (!await pathExists(path) || sha256(await readFile(path)) !== record.sha256) return false;
  }
  return true;
}

async function retainPreviousPack(pack, previous, stageRoot, error) {
  if (!await validPreviousPack(pack, previous)) {
    return {
      id: pack.id,
      title: pack.title,
      status: "failed",
      pageUrl: pack.pageUrl,
      error,
      files: [],
    };
  }
  const licenseDestination = join(stageRoot, previous.license.path);
  await mkdir(dirname(licenseDestination), { recursive: true });
  await cp(join(ROOT, previous.license.path), licenseDestination, {
    recursive: false,
  });
  const previousFiles = new Map(previous.files.map((record) => [record.path, record]));
  const files = [];
  for (const file of pack.files) {
    const previousFile = previousFiles.get(file.output);
    const destination = join(stageRoot, "public", file.output);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(PUBLIC_ROOT, file.output), destination, { recursive: false });
    files.push({
      ...previousFile,
      sourceEntry: file.source,
      kind: file.kind,
      purpose: file.purpose,
      ...(file.transform ? { transform: file.transform } : {}),
      ...(file.consumers ? { consumers: file.consumers } : {}),
    });
  }
  return {
    ...previous,
    title: pack.title,
    pageUrl: pack.pageUrl,
    status: "retained",
    error,
    files,
  };
}

function vendoredDocument(packs) {
  const sections = packs.map((pack) => {
    if (pack.status === "failed") {
      return `## ${pack.title}\n\n- Status: failed; procedural fallbacks remain active.\n- Reason: ${pack.error}\n- Source: ${pack.pageUrl}`;
    }
    const files = pack.files.map((file) =>
      `- \`${file.path}\` — ${file.purpose}; ${file.bytes} bytes; SHA-256 \`${file.sha256}\`${file.transform ? `; ${file.transform}` : ""}`
    );
    const retained = pack.status === "retained" ? `\n- Latest refresh error: ${pack.error}` : "";
    return `## ${pack.title}

- Status: ${pack.status}
- Official page: ${pack.pageUrl}
- Resolved ZIP: ${pack.downloadUrl}
- Archive SHA-256: \`${pack.archiveSha256}\`
- License: \`${pack.license.path}\` (verbatim archive entry \`${pack.license.archiveEntry}\`)${retained}
${files.join("\n")}`;
  });
  return `# Vendored asset inventory

Only the curated files listed here are shipped. The complete source archives are checksummed in \`assets/manifest.json\` but are not committed.

${sections.join("\n\n")}
`;
}

async function replaceDirectory(stagePath, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  if (await pathExists(stagePath)) await rename(stagePath, destination);
  else await mkdir(destination, { recursive: true });
}

async function previousManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const offline = process.argv.includes("--offline");
  let lock = null;
  try {
    lock = await readLock(join(ROOT, LOCK_PATH));
  } catch {
    lock = null;
  }
  const previous = await previousManifest();
  const previousById = new Map((previous?.packs ?? []).map((pack) => [pack.id, pack]));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "gooby-assets-"));
  const stageRoot = join(temporaryRoot, "stage");
  const workRoot = join(temporaryRoot, "work");
  await mkdir(stageRoot, { recursive: true });
  await mkdir(workRoot, { recursive: true });

  const results = [];
  try {
    for (const pack of PACKS) {
      try {
        const result = await vendorPack(pack, stageRoot, workRoot, lock, offline);
        results.push(result);
        console.log(`Vendored ${pack.title}: ${result.files.length} curated file(s)`);
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        const result = await retainPreviousPack(pack, previousById.get(pack.id), stageRoot, error);
        results.push(result);
        console.warn(`${result.status === "retained" ? "Retained" : "Skipped"} ${pack.title}: ${error}`);
      }
    }

    const available = new Set(results.flatMap((pack) => pack.files.map((file) => file.path)));
    const keys = Object.fromEntries(Object.entries(ASSET_KEY_MAP).map(([key, mapping]) => [
      key,
      {
        fallback: mapping.fallback,
        vendored: (mapping.vendored ?? []).filter(({ path }) => available.has(path)),
      },
    ]));
    const totalBytes = results.reduce((sum, pack) =>
      sum + (pack.license?.bytes ?? 0) + pack.files.reduce((files, file) => files + file.bytes, 0), 0);
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Curated asset output exceeds the 150 MB total limit");
    const licenseSources = new Map(await Promise.all(results
      .filter(({ license }) => license)
      .map(async (pack) => [
        pack.id,
        await readFile(join(stageRoot, pack.license.path), "utf8"),
      ])));
    const licenseDocument = licenseNoticeDocument(results, licenseSources);

    const manifest = {
      schemaVersion: 1,
      generator: "scripts/assets-fetch.mjs",
      constraints: {
        maxTotalBytes: MAX_TOTAL_BYTES,
        maxFileBytes: MAX_FILE_BYTES,
        runtimeAudioExtensions: [...AUDIO_OUTPUTS],
      },
      totalBytes,
      packs: results,
      keys,
      notices: [licenseNoticeRecord(licenseDocument, results)],
    };

    await replaceDirectory(join(stageRoot, "assets/vendor"), join(ASSETS_ROOT, "vendor"));
    await replaceDirectory(join(stageRoot, "public/assets/vendor"), join(PUBLIC_ROOT, "assets/vendor"));
    await mkdir(dirname(join(ROOT, LICENSE_NOTICE_CANONICAL_PATH)), { recursive: true });
    await mkdir(dirname(join(PUBLIC_ROOT, LICENSE_NOTICE_BUNDLED_PATH)), { recursive: true });
    await writeFile(join(ROOT, LICENSE_NOTICE_CANONICAL_PATH), licenseDocument);
    await writeFile(join(PUBLIC_ROOT, LICENSE_NOTICE_BUNDLED_PATH), licenseDocument);
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(ASSETS_ROOT, "VENDORED.md"), vendoredDocument(results));

    const failed = results.filter(({ status }) => status === "failed");
    console.log(`Asset fetch complete: ${results.length - failed.length}/${results.length} packs available, ${totalBytes} bytes`);
    if (failed.length > 0 && process.argv.includes("--strict")) process.exitCode = 1;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
