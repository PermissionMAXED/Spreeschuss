import { resolve } from "node:path";
import { cacheSources } from "./cache-lib.mjs";
import {
  APPROVED_DOWNLOAD_HOSTS,
  APPROVED_PAGE_HOSTS,
  CACHE_ARCHIVE_DIR,
  CACHE_SOURCE_DIR,
  CACHE_STATE_DIR,
  EXTRACTION_LIMITS,
  LOCK_PATH,
  SOURCES,
} from "./sources.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

async function main() {
  const offline = process.argv.includes("--offline");
  const repair = process.argv.includes("--repair");
  const result = await cacheSources({
    root: ROOT,
    sources: SOURCES,
    limits: EXTRACTION_LIMITS,
    approvedDownloadHosts: APPROVED_DOWNLOAD_HOSTS,
    approvedPageHosts: APPROVED_PAGE_HOSTS,
    lockPath: LOCK_PATH,
    archiveDir: CACHE_ARCHIVE_DIR,
    sourceDir: CACHE_SOURCE_DIR,
    stateDir: CACHE_STATE_DIR,
    offline,
    repair,
  });
  console.log(
    `Asset cache complete: ${SOURCES.length} sources verified, `
    + `${result.downloads} download(s) performed, lock ${result.lockChanged ? "updated" : "unchanged"}.`,
  );
}

await main();
