import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { externalUris, geometryMetadata, parseGlb } from "./gltf.mjs";
import { imageDimensions } from "./png.mjs";
import {
  audioMetadata,
  collectTriangles,
  renderImageThumbnail,
  renderModelThumbnail,
  renderWaveform,
} from "./preview.mjs";

export const CATALOG_SCHEMA_VERSION = 1;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const KIND_BY_EXTENSION = new Map([
  [".glb", "model"], [".gltf", "model"], [".fbx", "model"], [".obj", "model"],
  [".bin", "buffer"],
  [".png", "texture"], [".jpg", "texture"], [".jpeg", "texture"], [".webp", "texture"],
  [".svg", "texture"], [".tga", "texture"],
  [".ogg", "audio"], [".mp3", "audio"], [".wav", "audio"], [".m4a", "audio"], [".flac", "audio"],
]);

export function classifyKind(path) {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return { kind: KIND_BY_EXTENSION.get(extension) ?? null, extension };
}

export function pathTags(path) {
  const segments = path.toLowerCase().split("/");
  const fileName = segments.pop() ?? "";
  const stem = fileName.replace(/\.[^.]+$/u, "");
  const tokens = new Set(segments.filter((segment) => segment.length > 1));
  for (const token of stem.split(/[^a-z0-9]+/u)) {
    if (token.length > 1) tokens.add(token);
  }
  return [...tokens].sort((left, right) => left.localeCompare(right));
}

async function walkFiles(root, prefix = "") {
  const files = [];
  const entries = (await readdir(root, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walkFiles(join(root, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

async function gltfDocument(sourceRoot, path, bytes) {
  if (path.toLowerCase().endsWith(".glb")) {
    const { json, bin } = parseGlb(bytes, path);
    return { json, bin };
  }
  return { json: JSON.parse(bytes.toString("utf8")), bin: null };
}

async function resolveGltfBuffers(sourceRoot, path, json, bin) {
  const buffers = [];
  for (const buffer of json.buffers ?? []) {
    if (typeof buffer.uri === "string" && !buffer.uri.startsWith("data:")) {
      const uri = decodeURIComponent(buffer.uri);
      const resolved = join(dirname(path), uri);
      if (resolved.split("/").includes("..")) throw new Error(`unsafe buffer URI "${uri}" in ${path}`);
      buffers.push(await readFile(join(sourceRoot, resolved)));
    } else if (typeof buffer.uri === "string") {
      const match = buffer.uri.match(/^data:[^;,]*(;base64)?,(.*)$/u);
      buffers.push(Buffer.from(decodeURIComponent(match?.[2] ?? ""), match?.[1] ? "base64" : "utf8"));
    } else {
      buffers.push(bin ?? Buffer.alloc(0));
    }
  }
  return buffers;
}

function previewPathFor(previewDir, sourceId, path) {
  return join(previewDir, sourceId, `${path}.png`);
}

/**
 * Builds the searchable cache-only catalog: every model, texture, buffer, and
 * audio file in every cached source, with provenance, hashes, glTF geometry
 * metadata, audio metadata, and generated thumbnails/waveforms.
 */
export async function buildCatalog({
  root,
  sourceDir,
  previewDir,
  lock,
  previousEntries = [],
  previews = true,
  log = console.log,
}) {
  const previousByIdentity = new Map(previousEntries.map((entry) => [`${entry.sourceId}\0${entry.path}`, entry]));
  const entries = [];
  const warnings = [];
  const sourceIds = Object.keys(lock.sources).sort((left, right) => left.localeCompare(right));

  for (const sourceId of sourceIds) {
    const record = lock.sources[sourceId];
    const revision = record.kind === "github-commit" ? record.commit : record.archive.sha256;
    const sourceRoot = join(root, sourceDir, sourceId);
    const files = await walkFiles(sourceRoot);
    let catalogued = 0;
    for (const path of files) {
      const { kind, extension } = classifyKind(path);
      if (!kind) continue;
      const bytes = await readFile(join(sourceRoot, path));
      const hash = sha256(bytes);
      const identity = `${sourceId}\0${path}`;
      const previous = previousByIdentity.get(identity);
      const absolutePreview = previewPathFor(join(root, previewDir), sourceId, path);
      if (previous && previous.sha256 === hash) {
        let previewReady = previous.preview === null || previous.preview.generated === false;
        if (!previewReady) {
          try {
            await readFile(absolutePreview);
            previewReady = true;
          } catch {
            previewReady = false;
          }
        }
        if (previewReady) {
          entries.push(previous);
          catalogued += 1;
          continue;
        }
      }

      const entry = {
        sourceId,
        revision,
        path,
        sha256: hash,
        bytes: bytes.length,
        kind,
        format: extension.slice(1),
        tags: pathTags(path),
        preview: null,
      };
      try {
        if (kind === "model" && (extension === ".glb" || extension === ".gltf")) {
          const { json, bin } = await gltfDocument(sourceRoot, path, bytes);
          entry.gltf = {
            dependencies: externalUris(json),
            ...geometryMetadata(json),
          };
          if (previews) {
            const buffers = await resolveGltfBuffers(sourceRoot, path, json, bin);
            const thumbnail = renderModelThumbnail(collectTriangles(json, buffers));
            await mkdir(dirname(absolutePreview), { recursive: true });
            await writeFile(absolutePreview, thumbnail);
            entry.preview = { path: `${previewDir}/${sourceId}/${path}.png`, generated: true };
          }
        } else if (kind === "texture") {
          const dimensions = imageDimensions(bytes);
          if (dimensions) entry.image = dimensions;
          if (previews && dimensions && (extension === ".png" || extension === ".jpg" || extension === ".jpeg")) {
            if (dimensions.width <= 192 && dimensions.height <= 192) {
              entry.preview = { path: `${sourceDir}/${sourceId}/${path}`, generated: false };
            } else {
              const thumbnail = renderImageThumbnail(join(sourceRoot, path));
              await mkdir(dirname(absolutePreview), { recursive: true });
              await writeFile(absolutePreview, thumbnail);
              entry.preview = { path: `${previewDir}/${sourceId}/${path}.png`, generated: true };
            }
          }
        } else if (kind === "audio") {
          const metadata = audioMetadata(join(sourceRoot, path));
          if (metadata) entry.audio = metadata;
          if (previews) {
            const waveform = renderWaveform(join(sourceRoot, path));
            await mkdir(dirname(absolutePreview), { recursive: true });
            await writeFile(absolutePreview, waveform);
            entry.preview = { path: `${previewDir}/${sourceId}/${path}.png`, generated: true };
          }
        }
      } catch (error) {
        warnings.push(`${sourceId}/${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      entries.push(entry);
      catalogued += 1;
    }
    log(`Catalogued ${sourceId}: ${catalogued} media files`);
  }

  entries.sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId) || left.path.localeCompare(right.path));
  const byKind = {};
  for (const entry of entries) byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  return {
    catalog: {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      generator: "scripts/asset-cache/catalog.mjs",
      stats: Object.fromEntries(Object.entries(byKind).sort(([a], [b]) => a.localeCompare(b))),
      entries,
    },
    warnings,
  };
}

/** Case-insensitive search over path, tags, kind, and source. */
export function searchCatalog(entries, { text = null, kind = null, source = null, tag = null } = {}) {
  const needle = text?.toLowerCase() ?? null;
  return entries.filter((entry) => {
    if (kind && entry.kind !== kind) return false;
    if (source && entry.sourceId !== source) return false;
    if (tag && !entry.tags.includes(tag.toLowerCase())) return false;
    if (needle) {
      const haystack = `${entry.sourceId} ${entry.path} ${entry.tags.join(" ")}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}
