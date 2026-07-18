/**
 * Declaration of every approved official asset source for the offline
 * source-cache-first pipeline. Nothing outside this list may be downloaded,
 * and nothing may be locked without genuine license evidence.
 */

export const CACHE_ROOT = ".asset-cache";
// Extracted third-party trees live under a directory literally named "vendor"
// so repository hygiene checks (which exempt vendor directories) never scan
// verbatim upstream text files such as CRLF License.txt copies.
export const CACHE_ARCHIVE_DIR = `${CACHE_ROOT}/archives`;
export const CACHE_SOURCE_DIR = `${CACHE_ROOT}/vendor`;
export const CACHE_STATE_DIR = `${CACHE_ROOT}/state`;
export const CACHE_PREVIEW_DIR = `${CACHE_ROOT}/previews`;
export const CACHE_CATALOG_PATH = `${CACHE_ROOT}/catalog/catalog.json`;
export const LOCK_PATH = "assets/sources.lock.json";

export const APPROVED_DOWNLOAD_HOSTS = ["kenney.nl", "codeload.github.com"];
export const APPROVED_PAGE_HOSTS = ["kenney.nl"];

export const EXTRACTION_LIMITS = {
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalBytes: 3 * 1024 * 1024 * 1024,
  maxEntries: 60_000,
  // A total expansion beyond this ratio on a non-trivial archive is treated
  // as a decompression bomb.
  maxTotalCompressionRatio: 200,
  minBytesForRatioCheck: 50 * 1024 * 1024,
};

const KAYKIT_OWNER = "KayKit-Game-Assets";

const kenney = (id, title) => ({
  id: `kenney-${id}`,
  kind: "kenney-pack",
  creator: "Kenney",
  title,
  packId: id,
  pageUrl: `https://kenney.nl/assets/${id}`,
  license: {
    spdx: "CC0-1.0",
    // Markers that must all appear in the genuine archive License.txt before
    // the source may be locked. Never fabricated: these are the phrases the
    // official Kenney notices use (newer packs spell out "Creative Commons
    // Zero"; older packs say "License (CC0)" with the canonical URL).
    requiredEvidence: [
      ["Creative Commons Zero", "License (CC0)", "creativecommons.org/publicdomain/zero"],
      "kenney",
    ],
  },
});

const kaykit = (repo, title, commit) => ({
  id: `kaykit-${repo.toLowerCase().replace(/-1\.0$/u, "").replace(/^kaykit-/u, "")}`,
  kind: "github-commit",
  creator: "Kay Lousberg",
  title,
  owner: KAYKIT_OWNER,
  repo,
  commit,
  repoUrl: `https://github.com/${KAYKIT_OWNER}/${repo}`,
  downloadUrl: `https://codeload.github.com/${KAYKIT_OWNER}/${repo}/zip/${commit}`,
  license: {
    spdx: "CC0-1.0",
    requiredEvidence: ["Creative Commons Zero", "Kay Lousberg"],
  },
});

export const SOURCES = [
  // Kenney packs already vendored by scripts/assets-fetch.mjs.
  kenney("city-kit-commercial", "City Kit (Commercial)"),
  kenney("city-kit-suburban", "City Kit (Suburban)"),
  kenney("car-kit", "Car Kit"),
  // Additional complete Kenney source zips.
  kenney("food-kit", "Food Kit"),
  kenney("furniture-kit", "Furniture Kit"),
  kenney("city-kit-roads", "City Kit (Roads)"),
  kenney("mini-market", "Mini Market"),
  kenney("platformer-kit", "Platformer Kit"),
  kenney("mini-arcade", "Mini Arcade"),
  kenney("ui-pack", "UI Pack"),
  kenney("input-prompts", "Input Prompts"),
  kenney("game-icons-expansion", "Game Icons Expansion"),
  kenney("particle-pack", "Particle Pack"),
  kenney("interface-sounds", "Interface Sounds"),
  kenney("impact-sounds", "Impact Sounds"),
  kenney("music-jingles", "Music Jingles"),
  // KayKit official CC0 packs pinned to reviewed commits.
  kaykit("KayKit-Furniture-Bits-1.0", "KayKit Furniture Bits", "96d5930a8dbdb363409bbc2d3341718b00e17c9c"),
  kaykit("KayKit-Restaurant-Bits-1.0", "KayKit Restaurant Bits", "153c8a7535b48237854cb54ff6890679f8c574d1"),
  kaykit("KayKit-City-Builder-Bits-1.0", "KayKit City Builder Bits", "63976910ca04d16f0fc531b9c614244be8128713"),
  kaykit("KayKit-Prototype-Bits-1.0", "KayKit Prototype Bits", "bb159596f4f5106b663741d002c8eb45c80c0f41"),
];

export function sourceById(id) {
  return SOURCES.find((source) => source.id === id) ?? null;
}
