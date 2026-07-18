/**
 * Dependency-free glTF 2.0 helpers: GLB container parsing, geometry metadata
 * extraction for the catalog, and deterministic embedding of external
 * buffers/images into a single self-contained GLB for curation.
 */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function parseGlb(bytes, label = "GLB") {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${label}: invalid GLB magic`);
  if (bytes.readUInt32LE(4) !== 2) throw new Error(`${label}: unsupported GLB version`);
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error(`${label}: invalid GLB length`);
  let cursor = 12;
  let json = null;
  let bin = null;
  while (cursor + 8 <= bytes.length) {
    const chunkLength = bytes.readUInt32LE(cursor);
    const chunkType = bytes.readUInt32LE(cursor + 4);
    const body = bytes.subarray(cursor + 8, cursor + 8 + chunkLength);
    if (chunkType === CHUNK_JSON) json = JSON.parse(body.toString("utf8"));
    else if (chunkType === CHUNK_BIN) bin = Buffer.from(body);
    cursor += 8 + chunkLength + (chunkLength % 4 === 0 ? 0 : 4 - (chunkLength % 4));
  }
  if (!json) throw new Error(`${label}: missing GLB JSON chunk`);
  return { json, bin };
}

const align4 = (length) => (length % 4 === 0 ? length : length + (4 - (length % 4)));

export function buildGlb(json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc(align4(jsonBytes.length) - jsonBytes.length, 0x20)]);
  const chunks = [jsonPadded];
  const binPadded = bin && bin.length > 0
    ? Buffer.concat([bin, Buffer.alloc(align4(bin.length) - bin.length, 0)])
    : null;
  let totalLength = 12 + 8 + jsonPadded.length + (binPadded ? 8 + binPadded.length : 0);
  const output = Buffer.alloc(totalLength);
  output.writeUInt32LE(GLB_MAGIC, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(jsonPadded.length, 12);
  output.writeUInt32LE(CHUNK_JSON, 16);
  jsonPadded.copy(output, 20);
  if (binPadded) {
    const binHeader = 20 + jsonPadded.length;
    output.writeUInt32LE(binPadded.length, binHeader);
    output.writeUInt32LE(CHUNK_BIN, binHeader + 4);
    binPadded.copy(output, binHeader + 8);
  }
  return output;
}

export function externalUris(json) {
  return [...(json.buffers ?? []), ...(json.images ?? [])]
    .map(({ uri }) => uri)
    .filter((uri) => typeof uri === "string" && !uri.startsWith("data:"))
    .map((uri) => decodeURIComponent(uri));
}

/** Geometry metadata for the searchable catalog, from glTF JSON alone. */
export function geometryMetadata(json) {
  const accessors = json.accessors ?? [];
  let triangles = 0;
  const aabb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let hasBounds = false;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const mode = primitive.mode ?? 4;
      const position = accessors[primitive.attributes?.POSITION ?? -1];
      if (mode === 4) {
        const vertexCount = primitive.indices !== undefined
          ? accessors[primitive.indices]?.count ?? 0
          : position?.count ?? 0;
        triangles += Math.floor(vertexCount / 3);
      }
      if (Array.isArray(position?.min) && Array.isArray(position?.max)) {
        hasBounds = true;
        for (let axis = 0; axis < 3; axis += 1) {
          aabb.min[axis] = Math.min(aabb.min[axis], position.min[axis]);
          aabb.max[axis] = Math.max(aabb.max[axis], position.max[axis]);
        }
      }
    }
  }
  return {
    meshCount: (json.meshes ?? []).length,
    triangles,
    aabb: hasBounds ? aabb : null,
    materials: (json.materials ?? []).map((material, index) => material.name ?? `material-${index}`),
  };
}

const IMAGE_MIME = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
]);

function decodeDataUri(uri) {
  const match = uri.match(/^data:([^;,]*)(;base64)?,(.*)$/u);
  if (!match) throw new Error("unsupported data URI");
  return Buffer.from(decodeURIComponent(match[3]), match[2] ? "base64" : "utf8");
}

/**
 * Deterministically embeds every external buffer and image into a single
 * self-contained GLB. Structure and key order of the source document are
 * preserved; no timestamps or environment-dependent data are introduced, so
 * identical inputs always produce identical output bytes.
 */
export function embedToGlb(document, binChunk, resolveResource) {
  const json = structuredClone(document);
  const parts = [];
  let offset = 0;
  const append = (bytes) => {
    const start = offset;
    parts.push(bytes);
    offset += bytes.length;
    if (offset % 4 !== 0) {
      const padding = Buffer.alloc(4 - (offset % 4), 0);
      parts.push(padding);
      offset += padding.length;
    }
    return start;
  };

  const bufferStarts = (json.buffers ?? []).map((buffer, index) => {
    let bytes;
    if (typeof buffer.uri === "string") {
      bytes = buffer.uri.startsWith("data:") ? decodeDataUri(buffer.uri) : resolveResource(decodeURIComponent(buffer.uri));
    } else {
      if (!binChunk) throw new Error(`buffer ${index} has no URI and no GLB BIN chunk`);
      bytes = binChunk;
    }
    if (bytes.length < (buffer.byteLength ?? 0)) {
      throw new Error(`buffer ${index} resolves to ${bytes.length} bytes, below the declared byteLength`);
    }
    return append(bytes);
  });
  for (const view of json.bufferViews ?? []) {
    view.byteOffset = (view.byteOffset ?? 0) + bufferStarts[view.buffer];
    view.buffer = 0;
  }

  for (const image of json.images ?? []) {
    if (typeof image.uri !== "string") continue;
    const uri = decodeURIComponent(image.uri);
    const bytes = image.uri.startsWith("data:") ? decodeDataUri(image.uri) : resolveResource(uri);
    const extension = uri.slice(uri.lastIndexOf(".")).toLowerCase();
    const mimeType = image.mimeType ?? IMAGE_MIME.get(extension);
    if (!mimeType) throw new Error(`image "${uri}" has no known MIME type`);
    const byteOffset = append(bytes);
    json.bufferViews = json.bufferViews ?? [];
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length });
    image.bufferView = json.bufferViews.length - 1;
    image.mimeType = mimeType;
    delete image.uri;
  }

  const bin = Buffer.concat(parts);
  json.buffers = bin.length > 0 ? [{ byteLength: bin.length }] : [];
  if (json.buffers.length === 0) delete json.buffers;
  return buildGlb(json, bin);
}
