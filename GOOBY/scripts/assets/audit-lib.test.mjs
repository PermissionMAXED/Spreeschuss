import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssetConsumerAudit,
  compareExactKeys,
  curatedDomainViolations,
  extractAssetKeys,
  extractManifestKeys,
  extractPlannedManifestKeys,
  extractRuntimeAssetRequests,
  fileSizeViolations,
  isAllowedRuntimeAudio,
  licenseMetadataViolations,
  plannedVendoredViolations,
  runtimeReferenceViolations,
} from "./audit-lib.mjs";
import { PACKS } from "./catalog.mjs";
import {
  domainNoticeProvenanceViolations,
  licenseNoticeDocument,
  licenseNoticeRecord,
  licenseNoticeViolations,
} from "./license-notice.mjs";
import { networkReferenceViolations } from "../audit/no-network-scan.mjs";

const MODEL = "assets/vendor/pack/model.glb";
const TEXTURE = "assets/vendor/pack/Textures/colormap.png";
const CONSUMER = {
  assetKey: "city.car",
  path: "src/scenes/city/world.ts",
  marker: 'assets.clone("city.car")',
};

function consumerFixture(overrides = {}) {
  return {
    files: [
      { path: MODEL, consumers: [CONSUMER] },
      { path: TEXTURE },
    ],
    availablePaths: [MODEL, TEXTURE],
    modelDependencies: [{ model: MODEL, dependency: TEXTURE }],
    runtimeRequests: new Map([["city.car", new Set(["src/scenes/city/assets.ts"])]]),
    sourceFiles: new Map([["src/scenes/city/world.ts", 'assets.clone("city.car")']]),
    declaredAssetKeys: new Map([[MODEL, new Set(["city.car"])]]),
    ...overrides,
  };
}

const NOTICE_PACKS = [{
  id: "test-pack",
  title: "Test Pack",
  pageUrl: "https://kenney.nl/assets/test-pack",
  archiveSha256: "a".repeat(64),
  license: {
    archiveEntry: "License.txt",
    sha256: "b".repeat(64),
  },
  files: [{
    path: "assets/vendor/test-pack/model.glb",
    sourceEntry: "Models/model.glb",
    sha256: "c".repeat(64),
  }],
}];
const NOTICE_DOCUMENT = licenseNoticeDocument(
  NOTICE_PACKS,
  new Map([["test-pack", "License: Creative Commons Zero (CC0)"]]),
);
const NOTICE_RECORD = licenseNoticeRecord(NOTICE_DOCUMENT, NOTICE_PACKS);

function noticeFixture(overrides = {}) {
  return {
    expectedDocument: NOTICE_DOCUMENT,
    expectedRecord: NOTICE_RECORD,
    canonicalDocument: NOTICE_DOCUMENT,
    bundledDocument: NOTICE_DOCUMENT,
    manifestNotices: [NOTICE_RECORD],
    runtimeManifestSource:
      'export const ASSET_LICENSE_NOTICE = { path: "assets/LICENSES.md", packCount: 1, fileCount: 1 };',
    viteConfigSource: "export default defineConfig({ build: {} });",
    requiredPackIds: ["test-pack"],
    requiredFiles: ["assets/vendor/test-pack/model.glb"],
    ...overrides,
  };
}

test("key extraction and exact coverage detect missing mappings", () => {
  const contract = 'export const ASSET_KEYS = [\n  "food.apple",\n  "audio.tap",\n] as const;';
  const runtime = 'export const ASSET_MANIFEST = {\n  "food.apple": {},\n} as const satisfies X;';
  const expected = extractAssetKeys(contract);
  const actual = extractManifestKeys(runtime);
  assert.deepEqual(expected, ["food.apple", "audio.tap"]);
  assert.deepEqual(actual, ["food.apple"]);
  assert.deepEqual(compareExactKeys(expected, actual, "fixture"), [
    'fixture is missing AssetKey "audio.tap"',
  ]);
});

test("runtime references reject CDN URLs and OGG load paths", () => {
  assert.deepEqual(
    runtimeReferenceViolations("fixture.ts", 'load("https://cdn.example/a.ogg")'),
    [
      "fixture.ts: external runtime URL",
      "fixture.ts: OGG runtime load path",
    ],
  );
  assert.deepEqual(runtimeReferenceViolations("fixture.ts", 'load("assets/audio/tap.wav")'), []);
  assert.deepEqual(
    runtimeReferenceViolations("fixture.ts", '<svg xmlns="http://www.w3.org/2000/svg">'),
    [],
  );
  assert.deepEqual(
    runtimeReferenceViolations("fixture.ts", 'xmlns="http://www.w3.org/2000/svg" src="https://cdn.example/x.png"'),
    ["fixture.ts: external runtime URL"],
  );
});

test("runtime audio allowlist accepts only m4a, mp3, and wav", () => {
  assert.equal(isAllowedRuntimeAudio("tap.wav"), true);
  assert.equal(isAllowedRuntimeAudio("song.MP3"), true);
  assert.equal(isAllowedRuntimeAudio("loop.m4a"), true);
  assert.equal(isAllowedRuntimeAudio("legacy.ogg"), false);
  assert.equal(isAllowedRuntimeAudio("lossless.flac"), false);
});

test("missing genuine licenses and oversized files are fatal violations", () => {
  assert.deepEqual(licenseMetadataViolations("food-kit", undefined), [
    "food-kit: missing genuine archive License.txt record",
  ]);
  assert.deepEqual(licenseMetadataViolations("food-kit", {
    path: "assets/vendor/food-kit/License.txt",
    archiveEntry: "License.txt",
    sha256: "a".repeat(64),
  }), []);
  assert.deepEqual(fileSizeViolations("huge.glb", 10 * 1024 * 1024 + 1, 10 * 1024 * 1024), [
    "huge.glb: exceeds 10 MB",
  ]);
});

test("license notice generation covers genuine three-pack, seven-file provenance", () => {
  const packs = PACKS.map((pack, packIndex) => ({
    ...pack,
    archiveSha256: String(packIndex + 1).repeat(64),
    license: {
      archiveEntry: "License.txt",
      sha256: String(packIndex + 4).repeat(64),
    },
    files: pack.files.map((file, fileIndex) => ({
      ...file,
      path: file.output,
      sourceEntry: file.source,
      sha256: String(packIndex + fileIndex + 7).repeat(64),
    })),
  }));
  const sources = new Map(packs.map(({ id }) => [
    id,
    "License: Creative Commons Zero (CC0)\nSupport by crediting Kenney (this is not a requirement)",
  ]));
  const document = licenseNoticeDocument(packs, sources);
  assert.match(document, /Provenance: \*\*3 packs \/ 7 curated files\*\*/u);
  assert.match(document, /attribution is not required/u);
  for (const pack of packs) {
    assert.match(document, new RegExp(pack.title.replace(/[()]/gu, "\\$&"), "u"));
    for (const file of pack.files) assert.ok(document.includes(file.path));
  }
});

test("license notice generation merges domain sections deterministically", () => {
  const sources = new Map([["test-pack", "License: Creative Commons Zero (CC0)"]]);
  const merged = licenseNoticeDocument(NOTICE_PACKS, sources, [
    { id: "audio", markdown: "## Audio\n\nAudio provenance body.\n" },
    { id: "stickers", markdown: "## Stickers\n\nSticker provenance body.\n" },
  ]);
  assert.ok(merged.startsWith(NOTICE_DOCUMENT.trimEnd()));
  assert.ok(merged.indexOf("## Audio") < merged.indexOf("## Stickers"));
  assert.ok(merged.endsWith("Sticker provenance body.\n"));
  const repeated = licenseNoticeDocument(NOTICE_PACKS, sources, [
    { id: "audio", markdown: "## Audio\n\nAudio provenance body.\n" },
    { id: "stickers", markdown: "## Stickers\n\nSticker provenance body.\n" },
  ]);
  assert.equal(merged, repeated);
  assert.equal(
    licenseNoticeDocument(NOTICE_PACKS, sources, [{ id: "audio", markdown: "  \n" }]),
    NOTICE_DOCUMENT,
  );
});

test("domain provenance checks require lock titles, hashes, and sticker sheets", () => {
  const audioLock = {
    sources: {
      pack: { title: "Pack Title", archive: { sha256: "1".repeat(64) }, license: { sha256: "2".repeat(64) } },
      firstParty: { title: "First Party", sha256: "3".repeat(64), license: {} },
    },
  };
  const stickerManifest = {
    license: "original first-party artwork",
    sourceSheets: [{ page: "home-life", sha256: "4".repeat(64) }],
  };
  const complete = `Pack Title ${"1".repeat(64)} ${"2".repeat(64)} First Party ${"3".repeat(64)} `
    + `original first-party artwork ${"4".repeat(64)}`;
  assert.deepEqual(
    domainNoticeProvenanceViolations({ document: complete, audioLock, stickerManifest }),
    [],
  );
  const missing = domainNoticeProvenanceViolations({ document: "empty", audioLock, stickerManifest });
  assert.equal(missing.length, 7);
  assert.ok(missing.every((violation) => violation.startsWith("assets/LICENSES.md: missing")));
  assert.deepEqual(domainNoticeProvenanceViolations({ document: "empty" }), []);
});

test("license notice audit rejects missing and stale bundled copies", () => {
  assert.ok(licenseNoticeViolations(noticeFixture({ bundledDocument: null }))
    .some((violation) => violation.includes("bundled license notice is missing")));
  assert.ok(licenseNoticeViolations(noticeFixture({ bundledDocument: `${NOTICE_DOCUMENT}stale` }))
    .some((violation) => violation.includes("bundled license notice is stale")));
});

test("license notice audit rejects unlisted and build-excluded notices", () => {
  assert.ok(licenseNoticeViolations(noticeFixture({ manifestNotices: [] }))
    .some((violation) => violation.includes("must list exactly one")));
  assert.ok(licenseNoticeViolations(noticeFixture({
    runtimeManifestSource: '// path: "assets/LICENSES.md"',
  })).some((violation) => violation.includes("does not list")));
  assert.ok(licenseNoticeViolations(noticeFixture({
    viteConfigSource: "export default { build: { copyPublicDir: false } };",
    builtDocument: null,
  })).some((violation) => violation.includes("production build excluded")));
});

test("manifest-only references never count as source consumers", () => {
  const proof = {
    ...CONSUMER,
    path: "src/data/assetManifest.ts",
    marker: '"city.car"',
  };
  const result = buildAssetConsumerAudit(consumerFixture({
    files: [{ path: MODEL, consumers: [proof] }],
    availablePaths: [MODEL],
    modelDependencies: [],
    sourceFiles: new Map([["src/data/assetManifest.ts", '"city.car"']]),
  }));
  assert.ok(result.violations.some((violation) => violation.includes("not a source consumer")));
  assert.ok(result.violations.some((violation) => violation.includes("no transitive GLB dependency")));
});

test("transitive GLB textures inherit a real parent model consumer", () => {
  const result = buildAssetConsumerAudit(consumerFixture());
  assert.deepEqual(result.violations, []);
  const texture = result.entries.find(({ path }) => path === TEXTURE);
  assert.deepEqual(texture?.dependenciesOf, [MODEL]);
  assert.deepEqual(texture?.sourceConsumers, []);
});

test("duplicate source consumer proofs are rejected", () => {
  const result = buildAssetConsumerAudit(consumerFixture({
    files: [
      { path: MODEL, consumers: [CONSUMER, CONSUMER] },
      { path: TEXTURE },
    ],
  }));
  assert.ok(result.violations.some((violation) => violation.includes("duplicate source consumer proof")));
});

test("missing retained files are rejected even with a valid consumer", () => {
  const result = buildAssetConsumerAudit(consumerFixture({
    availablePaths: [TEXTURE],
  }));
  assert.ok(result.violations.includes(`${MODEL}: manifest points to a missing runtime file`));
});

test("runtime request extraction follows preloaded AssetKey arrays", () => {
  const source = `const CITY_ASSET_KEYS = [
  "city.car",
  "icon.coin",
] as const;
await loader.preload(CITY_ASSET_KEYS);`;
  const requests = extractRuntimeAssetRequests(
    new Map([["src/scenes/city/assets.ts", source]]),
    ["city.car", "icon.coin"],
  );
  assert.deepEqual([...requests.get("city.car") ?? []], ["src/scenes/city/assets.ts"]);
  assert.deepEqual([...requests.get("icon.coin") ?? []], ["src/scenes/city/assets.ts"]);
});

test("no-network scan rejects EventSource, beacon, media/image, and external forms", () => {
  const source = `
const events = new EventSource("/events");
navigator.sendBeacon("/collect", payload);
const audio = new Audio("https://media.example/song.mp3");
const image = new Image();
image.src = "//images.example/gooby.png";
document.body.innerHTML = '<form action="https://forms.example/submit"></form>';
`;
  const violations = networkReferenceViolations("fixture.ts", source);
  for (const kind of [
    "EventSource",
    "sendBeacon",
    "external image/media source",
    "external form action",
    "external URL",
  ]) {
    assert.ok(violations.some((violation) => violation.includes(`[${kind}]`)), kind);
  }
});

const CURATED_LOCK = {
  sources: {
    "kenney-test-pack": {
      kind: "kenney-pack",
      downloadUrl: "https://kenney.nl/media/pages/assets/test-pack/a/kenney_test-pack.zip",
      archive: { bytes: 10, sha256: "a".repeat(64) },
      license: {
        entry: "License.txt",
        sha256: "b".repeat(64),
        spdx: "CC0-1.0",
        evidence: ["Creative Commons Zero", "kenney"],
      },
    },
  },
};

function curatedManifestFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    domain: "models",
    spec: { path: "scripts/asset-cache/curation-spec.mjs", sha256: "c".repeat(64) },
    budget: { maxRuntimeBytes: 1024 },
    totalOutputBytes: 42,
    sources: {
      "kenney-test-pack": {
        archiveSha256: "a".repeat(64),
        downloadUrl: "https://kenney.nl/media/pages/assets/test-pack/a/kenney_test-pack.zip",
        license: {
          path: "assets/curated/vendor/kenney-test-pack/License.txt",
          sourceEntry: "License.txt",
          sha256: "b".repeat(64),
          spdx: "CC0-1.0",
          evidence: ["Creative Commons Zero", "kenney"],
        },
      },
    },
    keys: {
      "test.model": {
        fallback: "test-model",
        source: { id: "kenney-test-pack", path: "Models/model.gltf", revision: "a".repeat(64) },
        inputs: [{ path: "Models/model.gltf", bytes: 5, sha256: "d".repeat(64) }],
        output: { path: "assets/curated/kenney-test-pack/test-model.glb", bytes: 42, sha256: "e".repeat(64) },
      },
    },
    ...overrides,
  };
}

test("curated domain audit chains lock, license, hash, and size evidence", () => {
  assert.deepEqual(
    curatedDomainViolations({ domain: "models", manifest: curatedManifestFixture(), lock: CURATED_LOCK }),
    [],
  );
  assert.ok(curatedDomainViolations({ domain: "models", manifest: curatedManifestFixture(), lock: null })
    .some((violation) => violation.includes("sources.lock.json is missing")));

  const wrongArchive = curatedManifestFixture();
  wrongArchive.sources["kenney-test-pack"].archiveSha256 = "f".repeat(64);
  assert.ok(curatedDomainViolations({ domain: "models", manifest: wrongArchive, lock: CURATED_LOCK })
    .some((violation) => violation.includes("archive hash differs from the lock")));

  const wrongLicense = curatedManifestFixture();
  wrongLicense.sources["kenney-test-pack"].license.sha256 = "f".repeat(64);
  assert.ok(curatedDomainViolations({ domain: "models", manifest: wrongLicense, lock: CURATED_LOCK })
    .some((violation) => violation.includes("does not chain back to the lock")));

  const wrongTotal = curatedManifestFixture({ totalOutputBytes: 41 });
  assert.ok(curatedDomainViolations({ domain: "models", manifest: wrongTotal, lock: CURATED_LOCK })
    .some((violation) => violation.includes("key outputs sum to")));

  const oggOutput = curatedManifestFixture({ domain: "audio" });
  oggOutput.keys["test.model"].output.path = "assets/curated/kenney-test-pack/test.ogg";
  assert.ok(curatedDomainViolations({
    domain: "audio",
    manifest: { ...oggOutput, domain: "audio" },
    lock: CURATED_LOCK,
  }).some((violation) => violation.includes("forbidden audio format")));
});

test("curated keys without outputs must be intentional fallback-only decisions", () => {
  const fallbackOnly = curatedManifestFixture({ totalOutputBytes: 0 });
  fallbackOnly.keys["test.model"] = {
    ...fallbackOnly.keys["test.model"],
    output: null,
  };
  assert.ok(curatedDomainViolations({ domain: "models", manifest: fallbackOnly, lock: CURATED_LOCK })
    .some((violation) => violation.includes("not marked intentionalFallbackOnly")));
  fallbackOnly.keys["test.model"].intentionalFallbackOnly = true;
  assert.deepEqual(
    curatedDomainViolations({ domain: "models", manifest: fallbackOnly, lock: CURATED_LOCK }),
    [],
  );
});

test("planned manifest extraction and intentional empty-vendored enforcement", () => {
  const source = `export const PLANNED_ASSET_MANIFEST = {
  "city.road-straight": {
    fallback: "road-straight",
    vendored: [file("assets/curated/kenney-city-kit-roads/city-road-straight.glb")],
  },
  "city.sidewalk": {
    fallback: "sidewalk",
    vendored: [],
  },
} as const satisfies X;`;
  assert.deepEqual(extractPlannedManifestKeys(source), ["city.road-straight", "city.sidewalk"]);
  assert.deepEqual(
    plannedVendoredViolations(source, "city.road-straight", "assets/curated/kenney-city-kit-roads/city-road-straight.glb", false),
    [],
  );
  assert.ok(plannedVendoredViolations(source, "city.road-straight", "assets/curated/other.glb", false)
    .some((violation) => violation.includes("does not reference curated output")));
  assert.ok(plannedVendoredViolations(source, "city.sidewalk", null, false)
    .some((violation) => violation.includes("not marked as intentional")));
  assert.deepEqual(plannedVendoredViolations(source, "city.sidewalk", null, true), []);
  assert.deepEqual(plannedVendoredViolations(source, "missing.key", null, true), ["missing.key: missing from PLANNED_ASSET_MANIFEST"]);
});

test("no-network scan allows local media and inert DOM namespaces", () => {
  const source = `
const namespace = "http://www.w3.org/2000/svg";
const localDevelopmentOrigins = "http://localhost:* ws://127.0.0.1:*";
const image = new Image();
image.src = "/assets/vendor/local.png";
`;
  assert.deepEqual(networkReferenceViolations("fixture.ts", source), []);
});
