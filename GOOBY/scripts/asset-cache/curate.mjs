import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { curateModels } from "./curate-lib.mjs";
import {
  CURATED_DOCUMENT_PATH,
  CURATED_LICENSE_ROOT,
  CURATED_MODEL_SPECS,
  CURATED_MODELS_MANIFEST_PATH,
  RUNTIME_ASSET_BUDGET_BYTES,
} from "./curation-spec.mjs";
import { readLock } from "./lock.mjs";
import { CACHE_SOURCE_DIR, CACHE_STATE_DIR, LOCK_PATH, SOURCES } from "./sources.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

async function assertSourcesReady(lock, sourceIds) {
  for (const sourceId of sourceIds) {
    const source = SOURCES.find(({ id }) => id === sourceId);
    const record = lock.sources[sourceId];
    if (!source || !record) throw new Error(`${sourceId}: undeclared or unlocked source`);
    let state;
    try {
      state = JSON.parse(await readFile(join(ROOT, CACHE_STATE_DIR, `${sourceId}.json`), "utf8"));
    } catch {
      throw new Error(`${sourceId}: source is not cached; run "npm run assets:cache" first`);
    }
    if (state.archiveSha256 !== record.archive.sha256 || state.contentDigest !== record.contentDigest) {
      throw new Error(`${sourceId}: cached extraction does not match the lock; re-run "npm run assets:cache"`);
    }
  }
}

async function currentBytes(path) {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function main() {
  const check = process.argv.includes("--check");
  const lock = await readLock(join(ROOT, LOCK_PATH));
  if (!lock) throw new Error(`Missing ${LOCK_PATH}; run "npm run assets:cache" first.`);
  const specSource = await readFile(join(ROOT, "scripts/asset-cache/curation-spec.mjs"));
  const specSha256 = createHash("sha256").update(specSource).digest("hex");
  await assertSourcesReady(lock, [...new Set(CURATED_MODEL_SPECS.map(({ sourceId }) => sourceId))]);

  const result = await curateModels({
    root: ROOT,
    sourceDir: CACHE_SOURCE_DIR,
    lock,
    specs: CURATED_MODEL_SPECS,
    specSha256,
    licenseRoot: CURATED_LICENSE_ROOT,
    manifestPath: CURATED_MODELS_MANIFEST_PATH,
    budgetBytes: RUNTIME_ASSET_BUDGET_BYTES,
  });

  const planned = new Map([
    ...[...result.outputs].map(([path, bytes]) => [join("public", path), bytes]),
    ...result.licenses,
    [CURATED_MODELS_MANIFEST_PATH, Buffer.from(`${JSON.stringify(result.manifest, null, 2)}\n`)],
    [CURATED_DOCUMENT_PATH, Buffer.from(result.document)],
  ].map(([path, bytes]) => [path, bytes]));

  let changed = 0;
  for (const [path, bytes] of planned) {
    const existing = await currentBytes(join(ROOT, path));
    if (!existing || !existing.equals(bytes)) changed += 1;
  }
  if (check) {
    if (changed > 0) {
      console.error(`Curation is stale: ${changed} file(s) differ from a deterministic re-run.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Curation is deterministic and current: ${planned.size} files verified byte-identical.`);
    return;
  }

  // Atomic replacement of both curated trees prevents partially-updated
  // outputs; unrelated vendor assets are never touched.
  const stageRoot = join(ROOT, ".asset-cache", "curate-stage");
  await rm(stageRoot, { recursive: true, force: true });
  for (const [path, bytes] of planned) {
    const staged = join(stageRoot, path);
    await mkdir(dirname(staged), { recursive: true });
    await writeFile(staged, bytes);
  }
  for (const directory of ["public/assets/curated", CURATED_LICENSE_ROOT]) {
    await rm(join(ROOT, directory), { recursive: true, force: true });
  }
  const moves = [
    ["public/assets/curated", "public/assets/curated"],
    [CURATED_LICENSE_ROOT, CURATED_LICENSE_ROOT],
  ];
  for (const [from, to] of moves) {
    await mkdir(dirname(join(ROOT, to)), { recursive: true });
    await rename(join(stageRoot, from), join(ROOT, to));
  }
  await writeFile(join(ROOT, CURATED_MODELS_MANIFEST_PATH), planned.get(CURATED_MODELS_MANIFEST_PATH));
  await writeFile(join(ROOT, CURATED_DOCUMENT_PATH), planned.get(CURATED_DOCUMENT_PATH));
  await rm(stageRoot, { recursive: true, force: true });

  console.log(
    `Curated ${Object.keys(result.manifest.keys).length} planned keys from `
    + `${Object.keys(result.manifest.sources).length} locked sources: `
    + `${result.manifest.totalOutputBytes} output bytes, ${changed === 0 ? "unchanged (deterministic)" : `${changed} file(s) updated`}.`,
  );
}

await main();
