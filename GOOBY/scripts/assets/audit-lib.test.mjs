import assert from "node:assert/strict";
import test from "node:test";
import {
  compareExactKeys,
  extractAssetKeys,
  extractManifestKeys,
  fileSizeViolations,
  isAllowedRuntimeAudio,
  licenseMetadataViolations,
  runtimeReferenceViolations,
} from "./audit-lib.mjs";

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
