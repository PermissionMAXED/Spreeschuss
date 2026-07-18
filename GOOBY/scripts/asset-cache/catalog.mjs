import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildCatalog, searchCatalog } from "./catalog-lib.mjs";
import { readLock } from "./lock.mjs";
import {
  CACHE_CATALOG_PATH,
  CACHE_PREVIEW_DIR,
  CACHE_SOURCE_DIR,
  CACHE_STATE_DIR,
  LOCK_PATH,
  SOURCES,
} from "./sources.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index !== -1 ? process.argv[index + 1] ?? null : null;
}

async function assertCacheReady(lock) {
  const problems = [];
  for (const source of SOURCES) {
    const record = lock.sources[source.id];
    if (!record) {
      problems.push(`${source.id}: not locked`);
      continue;
    }
    try {
      const state = JSON.parse(await readFile(join(ROOT, CACHE_STATE_DIR, `${source.id}.json`), "utf8"));
      if (state.archiveSha256 !== record.archive.sha256 || state.contentDigest !== record.contentDigest) {
        problems.push(`${source.id}: cached extraction does not match the lock`);
      }
    } catch {
      problems.push(`${source.id}: not cached`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Source cache is incomplete; run "npm run assets:cache" first:\n${
      problems.map((item) => `- ${item}`).join("\n")}`);
  }
}

function describe(entry) {
  const details = [];
  if (entry.gltf) {
    details.push(`${entry.gltf.triangles} tris`, `${entry.gltf.materials.length} materials`);
    if (entry.gltf.dependencies.length > 0) details.push(`deps: ${entry.gltf.dependencies.join(", ")}`);
  }
  if (entry.image) details.push(`${entry.image.width}x${entry.image.height}`);
  if (entry.audio?.durationSeconds) details.push(`${entry.audio.durationSeconds.toFixed(2)}s`);
  if (entry.preview) details.push(`preview: ${entry.preview.path}`);
  return `${entry.sourceId} ${entry.path} [${entry.kind}] ${entry.bytes}B${
    details.length > 0 ? ` (${details.join("; ")})` : ""}`;
}

async function main() {
  const lock = await readLock(join(ROOT, LOCK_PATH));
  if (!lock) throw new Error(`Missing ${LOCK_PATH}; run "npm run assets:cache" first.`);
  await assertCacheReady(lock);

  const catalogPath = join(ROOT, CACHE_CATALOG_PATH);
  const query = {
    text: argument("--search"),
    kind: argument("--kind"),
    source: argument("--source"),
    tag: argument("--tag"),
  };
  const isQuery = Object.values(query).some((value) => value !== null);

  let existing = null;
  try {
    existing = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch {
    existing = null;
  }

  let catalog = existing;
  if (!isQuery || !existing) {
    const result = await buildCatalog({
      root: ROOT,
      sourceDir: CACHE_SOURCE_DIR,
      previewDir: CACHE_PREVIEW_DIR,
      lock,
      previousEntries: existing?.entries ?? [],
      previews: !process.argv.includes("--no-previews"),
    });
    catalog = result.catalog;
    await mkdir(dirname(catalogPath), { recursive: true });
    await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    console.log(
      `Catalog written to ${CACHE_CATALOG_PATH}: ${catalog.entries.length} entries (${
        Object.entries(catalog.stats).map(([kind, count]) => `${count} ${kind}`).join(", ")})`,
    );
  }

  if (isQuery) {
    const matches = searchCatalog(catalog.entries, query);
    const limit = Number(argument("--limit") ?? 50);
    for (const entry of matches.slice(0, limit)) console.log(describe(entry));
    console.log(`${matches.length} match(es).`);
  }
}

await main();
