import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { cacheSources } from "./cache-lib.mjs";
import { buildCatalog, classifyKind, pathTags, searchCatalog } from "./catalog-lib.mjs";
import { curateModels } from "./curate-lib.mjs";
import { externalUris, parseGlb } from "./gltf.mjs";
import { licenseEvidence, lockRecordViolations, stableLockDocument } from "./lock.mjs";
import { encodePng } from "./png.mjs";
import { archiveEntryViolations, safeExtractArchive, sha256 } from "./safe-extract.mjs";
import { readZipEntries, writeStoredZip } from "./ziputil.mjs";

const LIMITS = {
  maxArchiveBytes: 8 * 1024 * 1024,
  maxEntryBytes: 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxEntries: 100,
  maxTotalCompressionRatio: 200,
  minBytesForRatioCheck: 1024 * 1024,
};

const KENNEY_LICENSE = [
  "Test Pack by Kenney Vleugels (www.kenney.nl)",
  "License: Creative Commons Zero (CC0)",
  "http://creativecommons.org/publicdomain/zero/1.0/",
  "You may use these assets in personal and commercial projects.",
].join("\n\n");

function fixtureGltf() {
  const bin = Buffer.alloc(36);
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  positions.forEach((value, index) => bin.writeFloatLE(value, index * 4));
  const texture = encodePng(2, 2, Buffer.alloc(16, 0xff));
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [0, 0, 0],
      max: [1, 1, 0],
    }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ uri: "model.bin", byteLength: 36 }],
    materials: [{ name: "mat", pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ uri: "tex.png" }],
  };
  return { json, bin, texture };
}

function fixtureWav() {
  const sampleCount = 800;
  const data = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    data.writeInt16LE(Math.round(Math.sin(index / 10) * 12000), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function kenneyArchive({ license = KENNEY_LICENSE } = {}) {
  const { json, bin, texture } = fixtureGltf();
  const files = [
    { name: "Models/model.gltf", data: Buffer.from(JSON.stringify(json)) },
    { name: "Models/model.bin", data: bin },
    { name: "Models/tex.png", data: texture },
    { name: "Audio/blip.wav", data: fixtureWav() },
  ];
  if (license !== null) files.unshift({ name: "License.txt", data: Buffer.from(license) });
  return writeStoredZip(files);
}

function fixtureSource(overrides = {}) {
  return {
    id: "kenney-test-pack",
    kind: "kenney-pack",
    creator: "Kenney",
    title: "Test Pack",
    packId: "test-pack",
    pageUrl: "https://kenney.nl/assets/test-pack",
    license: {
      spdx: "CC0-1.0",
      requiredEvidence: [["Creative Commons Zero", "License (CC0)"], "kenney"],
    },
    ...overrides,
  };
}

const PAGE_HTML = "<a href=\"https://kenney.nl/media/pages/assets/test-pack/abc-123/kenney_test-pack.zip\">Download</a>";

function fakeFetcher(archive) {
  const calls = [];
  const fetchBytes = (url) => {
    calls.push(url);
    if (url === "https://kenney.nl/assets/test-pack") return Promise.resolve(Buffer.from(PAGE_HTML));
    if (url.endsWith("kenney_test-pack.zip")) return Promise.resolve(archive());
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  };
  return { calls, fetchBytes };
}

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "gooby-cache-test-"));
  await mkdir(join(root, "assets"), { recursive: true });
  return root;
}

function runCache(root, fetchBytes, overrides = {}) {
  return cacheSources({
    root,
    sources: [fixtureSource()],
    limits: LIMITS,
    approvedDownloadHosts: ["kenney.nl", "codeload.github.com"],
    approvedPageHosts: ["kenney.nl"],
    lockPath: "assets/sources.lock.json",
    archiveDir: ".asset-cache/archives",
    sourceDir: ".asset-cache/vendor",
    stateDir: ".asset-cache/state",
    fetchBytes,
    log: () => {},
    ...overrides,
  });
}

test("safe extraction rejects traversal, symlinks, bombs, and honors declared metadata", () => {
  const traversal = readZipEntries(writeStoredZip([{ name: "../evil.txt", data: Buffer.from("x") }]));
  assert.ok(archiveEntryViolations(traversal, LIMITS).some((violation) => violation.includes("path traversal")));

  const absolute = readZipEntries(writeStoredZip([{ name: "/etc/passwd", data: Buffer.from("x") }]));
  assert.ok(archiveEntryViolations(absolute, LIMITS).some((violation) => violation.includes("absolute path")));

  const symlink = readZipEntries(writeStoredZip([{ name: "link", data: Buffer.from("target"), unixMode: 0o120777 }]));
  assert.ok(archiveEntryViolations(symlink, LIMITS).some((violation) => violation.includes("symbolic link")));

  const oversized = readZipEntries(writeStoredZip([{ name: "big.bin", data: Buffer.alloc(64) }]));
  assert.ok(
    archiveEntryViolations(oversized, { ...LIMITS, maxEntryBytes: 16 })
      .some((violation) => violation.includes("per-file limit")),
  );
  const bomb = [{
    name: "bomb.bin",
    isDirectory: false,
    isSymlink: false,
    compressedBytes: 10_000,
    uncompressedBytes: 3 * 1024 * 1024,
  }];
  assert.ok(
    archiveEntryViolations(bomb, { ...LIMITS, minBytesForRatioCheck: 1024, maxTotalCompressionRatio: 100 })
      .some((violation) => violation.includes("bomb threshold")),
  );
});

test("safe extraction refuses to write a malicious archive to disk", async () => {
  const root = await makeRoot();
  try {
    const archivePath = join(root, "evil.zip");
    await writeFile(archivePath, writeStoredZip([{ name: "../../escape.txt", data: Buffer.from("x") }]));
    await assert.rejects(
      safeExtractArchive(archivePath, join(root, "out"), LIMITS),
      /unsafe archive/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unapproved hosts are rejected before any download", async () => {
  const root = await makeRoot();
  try {
    const source = fixtureSource({
      id: "evil-pack",
      kind: "github-commit",
      commit: "a".repeat(40),
      repoUrl: "https://evil.example/repo",
      downloadUrl: "https://evil.example/repo/zip/aaa",
    });
    await assert.rejects(
      runCache(root, () => Promise.reject(new Error("must not fetch")), { sources: [source] }),
      /unapproved host/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cold cache downloads once, locks provenance, and a locked second run downloads nothing", async () => {
  const root = await makeRoot();
  try {
    const { calls, fetchBytes } = fakeFetcher(kenneyArchive);
    const first = await runCache(root, fetchBytes);
    assert.equal(first.downloads, 1);
    assert.equal(first.lockChanged, true);
    assert.ok(calls.length >= 2, "cold run must resolve the official page and download the zip");

    const lockDocument = await readFile(join(root, "assets/sources.lock.json"), "utf8");
    const lock = JSON.parse(lockDocument);
    const record = lock.sources["kenney-test-pack"];
    assert.match(record.archive.sha256, /^[a-f0-9]{64}$/u);
    assert.match(record.license.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(record.license.spdx, "CC0-1.0");
    assert.deepEqual(record.license.evidence, ["Creative Commons Zero", "kenney"]);
    assert.deepEqual(
      lockRecordViolations("kenney-test-pack", record, fixtureSource(), ["kenney.nl", "codeload.github.com"]),
      [],
    );

    calls.length = 0;
    const second = await runCache(root, fetchBytes);
    assert.equal(second.downloads, 0);
    assert.equal(second.lockChanged, false);
    assert.deepEqual(calls, [], "a fully locked cache must perform zero network requests");
    assert.equal(await readFile(join(root, "assets/sources.lock.json"), "utf8"), lockDocument);

    const offline = await runCache(root, () => Promise.reject(new Error("network disabled")), { offline: true });
    assert.equal(offline.downloads, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mutated archives, extracted trees, and hash drift fail loudly without relocking", async () => {
  const root = await makeRoot();
  try {
    const { fetchBytes } = fakeFetcher(kenneyArchive);
    await runCache(root, fetchBytes);
    const lockDocument = await readFile(join(root, "assets/sources.lock.json"), "utf8");

    const archivePath = join(root, ".asset-cache/archives/kenney-test-pack.zip");
    const archiveBytes = await readFile(archivePath);
    await writeFile(archivePath, Buffer.concat([archiveBytes, Buffer.from("x")]));
    await assert.rejects(runCache(root, fetchBytes), /cached archive hash does not match the lock/u);
    await writeFile(archivePath, archiveBytes);

    const extractedModel = join(root, ".asset-cache/vendor/kenney-test-pack/Models/model.bin");
    const modelBytes = await readFile(extractedModel);
    await writeFile(extractedModel, Buffer.concat([modelBytes, Buffer.from("x")]));
    await assert.rejects(runCache(root, fetchBytes), /digest does not match the lock/u);
    const repaired = await runCache(root, fetchBytes, { repair: true });
    assert.equal(repaired.downloads, 0);

    await rm(archivePath);
    const { fetchBytes: driftedFetch } = fakeFetcher(() =>
      kenneyArchive({ license: `${KENNEY_LICENSE}\nrevised` }));
    await assert.rejects(runCache(root, driftedFetch), /differs from the locked provenance/u);
    assert.equal(
      await readFile(join(root, "assets/sources.lock.json"), "utf8"),
      lockDocument,
      "a failed refresh must never rewrite the lock",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sources without genuine license evidence are never locked", async () => {
  const root = await makeRoot();
  try {
    const { fetchBytes } = fakeFetcher(() => kenneyArchive({ license: null }));
    await assert.rejects(runCache(root, fetchBytes), /no genuine License\.txt/u);

    const proprietary = "All rights reserved. Redistribution of this package is strictly prohibited without written permission from the publisher.";
    const { fetchBytes: badLicenseFetch } = fakeFetcher(() => kenneyArchive({ license: proprietary }));
    await rm(join(root, ".asset-cache"), { recursive: true, force: true });
    await assert.rejects(runCache(root, badLicenseFetch), /license evidence/u);
    await assert.rejects(readFile(join(root, "assets/sources.lock.json")), /ENOENT/u);

    const evidence = licenseEvidence("x", KENNEY_LICENSE, [["Creative Commons Zero", "License (CC0)"], "kenney"]);
    assert.deepEqual(evidence.violations, []);
    assert.deepEqual(evidence.matched, ["Creative Commons Zero", "kenney"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function cacheFixtureForDerivedSteps(root) {
  const { fetchBytes } = fakeFetcher(kenneyArchive);
  await runCache(root, fetchBytes);
  return JSON.parse(await readFile(join(root, "assets/sources.lock.json"), "utf8"));
}

test("catalog covers every cached model, texture, buffer, and audio file and is searchable", async () => {
  const root = await makeRoot();
  try {
    const lock = await cacheFixtureForDerivedSteps(root);
    const { catalog } = await buildCatalog({
      root,
      sourceDir: ".asset-cache/vendor",
      previewDir: ".asset-cache/previews",
      lock,
      previews: true,
      log: () => {},
    });
    const paths = catalog.entries.map((entry) => entry.path).sort();
    assert.deepEqual(paths, ["Audio/blip.wav", "Models/model.bin", "Models/model.gltf", "Models/tex.png"]);
    for (const entry of catalog.entries) {
      assert.equal(entry.sourceId, "kenney-test-pack");
      assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
      assert.ok(entry.bytes > 0);
      assert.ok(entry.tags.length > 0);
      assert.equal(entry.revision, lock.sources["kenney-test-pack"].archive.sha256);
    }
    const model = catalog.entries.find((entry) => entry.path === "Models/model.gltf");
    assert.deepEqual(model.gltf.dependencies, ["model.bin", "tex.png"]);
    assert.equal(model.gltf.triangles, 1);
    assert.deepEqual(model.gltf.aabb, { min: [0, 0, 0], max: [1, 1, 0] });
    assert.deepEqual(model.gltf.materials, ["mat"]);
    assert.ok(model.preview?.generated, "glTF models must get a rendered thumbnail");
    await readFile(join(root, model.preview.path));

    const audio = catalog.entries.find((entry) => entry.path === "Audio/blip.wav");
    assert.equal(audio.kind, "audio");
    if (spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0) {
      assert.equal(audio.audio.channels, 1);
      assert.equal(audio.audio.sampleRate, 8000);
      assert.ok(audio.preview?.generated, "audio entries must get a waveform preview");
    }

    assert.equal(searchCatalog(catalog.entries, { text: "model", kind: "model" }).length, 1);
    assert.equal(searchCatalog(catalog.entries, { tag: "audio" }).length, 1);
    assert.equal(searchCatalog(catalog.entries, { source: "other" }).length, 0);
    assert.equal(classifyKind("a/b.GLB").kind, "model");
    assert.deepEqual(pathTags("Models/road_straight.gltf"), ["models", "road", "straight"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("curation is deterministic: two runs produce byte-identical outputs and manifests", async () => {
  const root = await makeRoot();
  try {
    const lock = await cacheFixtureForDerivedSteps(root);
    const specs = [{
      key: "test.model",
      fallback: "test-model",
      sourceId: "kenney-test-pack",
      sourcePath: "Models/model.gltf",
      purpose: "Deterministic curation fixture",
      mode: "embed",
      output: "assets/curated/kenney-test-pack/test-model.glb",
    }];
    const run = () => curateModels({
      root,
      sourceDir: ".asset-cache/vendor",
      lock,
      specs,
      specSha256: "f".repeat(64),
      licenseRoot: "assets/curated/vendor",
      manifestPath: "assets/curated/manifest.json",
      budgetBytes: 1024 * 1024,
    });
    const first = await run();
    const second = await run();
    const output = first.outputs.get("assets/curated/kenney-test-pack/test-model.glb");
    assert.ok(output.equals(second.outputs.get("assets/curated/kenney-test-pack/test-model.glb")));
    assert.equal(JSON.stringify(first.manifest), JSON.stringify(second.manifest));
    assert.equal(first.document, second.document);

    const { json } = parseGlb(output, "curated");
    assert.deepEqual(externalUris(json), [], "curated GLB must embed all buffers and images");
    assert.equal(json.images[0].mimeType, "image/png");
    const record = first.manifest.keys["test.model"];
    assert.equal(record.output.sha256, sha256(output));
    assert.deepEqual(record.inputs.map(({ path }) => path), ["Models/model.gltf", "Models/model.bin", "Models/tex.png"]);
    assert.equal(record.source.revision, lock.sources["kenney-test-pack"].archive.sha256);
    const license = first.licenses.get("assets/curated/vendor/kenney-test-pack/License.txt");
    assert.equal(sha256(license), lock.sources["kenney-test-pack"].license.sha256);
    assert.equal(stableLockDocument({ sources: {} }).endsWith("\n"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
