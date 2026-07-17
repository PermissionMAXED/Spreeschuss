import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssetConsumerAudit,
  compareExactKeys,
  extractAssetKeys,
  extractManifestKeys,
  extractRuntimeAssetRequests,
  fileSizeViolations,
  isAllowedRuntimeAudio,
  licenseMetadataViolations,
  runtimeReferenceViolations,
} from "./audit-lib.mjs";
import { PACKS } from "./catalog.mjs";
import {
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

test("no-network scan allows local media and inert DOM namespaces", () => {
  const source = `
const namespace = "http://www.w3.org/2000/svg";
const localDevelopmentOrigins = "http://localhost:* ws://127.0.0.1:*";
const image = new Image();
image.src = "/assets/vendor/local.png";
`;
  assert.deepEqual(networkReferenceViolations("fixture.ts", source), []);
});
