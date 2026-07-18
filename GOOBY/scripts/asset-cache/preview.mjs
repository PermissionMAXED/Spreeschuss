import { execFileSync } from "node:child_process";
import { encodePng } from "./png.mjs";

const COMPONENT_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT_READERS = new Map([
  [5120, (view, offset) => view.readInt8(offset)],
  [5121, (view, offset) => view.readUInt8(offset)],
  [5122, (view, offset) => view.readInt16LE(offset)],
  [5123, (view, offset) => view.readUInt16LE(offset)],
  [5125, (view, offset) => view.readUInt32LE(offset)],
  [5126, (view, offset) => view.readFloatLE(offset)],
]);
const COMPONENT_BYTES = new Map([[5120, 1], [5121, 1], [5122, 2], [5123, 2], [5125, 4], [5126, 4]]);

function readAccessor(json, accessorIndex, buffers) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const buffer = buffers[view.buffer];
  const componentCount = COMPONENT_COUNTS[accessor.type];
  const componentBytes = COMPONENT_BYTES.get(accessor.componentType);
  const read = COMPONENT_READERS.get(accessor.componentType);
  const stride = view.byteStride ?? componentCount * componentBytes;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const values = [];
  for (let index = 0; index < accessor.count; index += 1) {
    const element = [];
    for (let component = 0; component < componentCount; component += 1) {
      element.push(read(buffer, base + index * stride + component * componentBytes));
    }
    values.push(componentCount === 1 ? element[0] : element);
  }
  return values;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      for (let k = 0; k < 4; k += 1) {
        out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
      }
    }
  }
  return out;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(matrix, [x, y, z]) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

/** Collects world-space triangles (with material base colors) from a glTF document. */
export function collectTriangles(json, buffers, maxTriangles = 200_000) {
  const triangles = [];
  const visit = (nodeIndex, parentMatrix) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    const matrix = multiply(parentMatrix, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of json.meshes[node.mesh].primitives ?? []) {
        if ((primitive.mode ?? 4) !== 4 || primitive.attributes?.POSITION === undefined) continue;
        const positions = readAccessor(json, primitive.attributes.POSITION, buffers)
          .map((point) => transformPoint(matrix, point));
        const indices = primitive.indices !== undefined
          ? readAccessor(json, primitive.indices, buffers)
          : positions.map((_, index) => index);
        const factor = json.materials?.[primitive.material]?.pbrMetallicRoughness?.baseColorFactor ?? [0.72, 0.72, 0.75, 1];
        for (let index = 0; index + 2 < indices.length && triangles.length < maxTriangles; index += 3) {
          triangles.push({
            a: positions[indices[index]],
            b: positions[indices[index + 1]],
            c: positions[indices[index + 2]],
            color: factor,
          });
        }
      }
    }
    for (const child of node.children ?? []) visit(child, matrix);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  for (const nodeIndex of scene?.nodes ?? []) visit(nodeIndex, IDENTITY);
  return triangles;
}

const normalize = ([x, y, z]) => {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
};
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Deterministic software rasterizer: renders triangles from a fixed isometric
 * orthographic camera with flat shading into an RGBA thumbnail.
 */
export function renderModelThumbnail(triangles, size = 192) {
  const view = normalize([1, -0.75, 1]);
  const right = normalize(cross([0, 1, 0], view));
  const up = normalize(cross(view, right));
  const light = normalize([0.4, 1, 0.6]);

  const projected = triangles.map(({ a, b, c, color }) => ({
    color,
    normal: normalize(cross(subtract(b, a), subtract(c, a))),
    points: [a, b, c].map((point) => [dot(point, right), dot(point, up), dot(point, view)]),
  }));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const triangle of projected) {
    for (const [x, y] of triangle.points) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const rgba = Buffer.alloc(size * size * 4);
  for (let index = 0; index < size * size; index += 1) {
    rgba[index * 4] = 24; rgba[index * 4 + 1] = 26; rgba[index * 4 + 2] = 32; rgba[index * 4 + 3] = 255;
  }
  if (projected.length === 0 || !Number.isFinite(minX)) return encodePng(size, size, rgba);
  const margin = size * 0.08;
  const scale = (size - margin * 2) / Math.max(maxX - minX, maxY - minY, 1e-6);
  const offsetX = (size - (maxX - minX) * scale) / 2;
  const offsetY = (size - (maxY - minY) * scale) / 2;
  const depth = new Float32Array(size * size).fill(-Infinity);

  for (const triangle of projected) {
    const screen = triangle.points.map(([x, y, z]) => [
      (x - minX) * scale + offsetX,
      size - ((y - minY) * scale + offsetY),
      z,
    ]);
    const [p0, p1, p2] = screen;
    const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (Math.abs(area) < 1e-9) continue;
    const shade = Math.max(0.25, Math.abs(dot(triangle.normal, light)));
    const startX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
    const endX = Math.min(size - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const startY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
    const endY = Math.min(size - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const w0 = ((p1[0] - p0[0]) * (y + 0.5 - p0[1]) - (x + 0.5 - p0[0]) * (p1[1] - p0[1])) / area;
        const w1 = ((p2[0] - p1[0]) * (y + 0.5 - p1[1]) - (x + 0.5 - p1[0]) * (p2[1] - p1[1])) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = p0[2] * w1 + p1[2] * w2 + p2[2] * w0;
        const pixel = y * size + x;
        if (z <= depth[pixel]) continue;
        depth[pixel] = z;
        rgba[pixel * 4] = Math.min(255, Math.round(triangle.color[0] * 255 * shade));
        rgba[pixel * 4 + 1] = Math.min(255, Math.round(triangle.color[1] * 255 * shade));
        rgba[pixel * 4 + 2] = Math.min(255, Math.round(triangle.color[2] * 255 * shade));
        rgba[pixel * 4 + 3] = 255;
      }
    }
  }
  return encodePng(size, size, rgba);
}

/** Decodes audio to mono PCM via ffmpeg and draws a min/max waveform PNG. */
export function renderWaveform(audioPath, width = 192, height = 96) {
  const pcm = execFileSync(
    "ffmpeg",
    ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", audioPath, "-f", "s16le", "-ac", "1", "-ar", "8000", "-"],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  const samples = pcm.length >> 1;
  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba[index * 4] = 24; rgba[index * 4 + 1] = 26; rgba[index * 4 + 2] = 32; rgba[index * 4 + 3] = 255;
  }
  const window = Math.max(1, Math.floor(samples / width));
  for (let x = 0; x < width; x += 1) {
    let minimum = 0;
    let maximum = 0;
    for (let sample = x * window; sample < Math.min(samples, (x + 1) * window); sample += 1) {
      const value = pcm.readInt16LE(sample * 2) / 32768;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    const top = Math.max(0, Math.round((1 - (maximum + 1) / 2) * (height - 1)));
    const bottom = Math.min(height - 1, Math.round((1 - (minimum + 1) / 2) * (height - 1)));
    for (let y = top; y <= bottom; y += 1) {
      const pixel = y * width + x;
      rgba[pixel * 4] = 94; rgba[pixel * 4 + 1] = 214; rgba[pixel * 4 + 2] = 156; rgba[pixel * 4 + 3] = 255;
    }
  }
  return encodePng(width, height, rgba);
}

/** ffprobe-backed audio metadata (dev-time only; never used at runtime). */
export function audioMetadata(audioPath) {
  const raw = execFileSync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", audioPath],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw);
  const stream = (parsed.streams ?? []).find(({ codec_type: type }) => type === "audio");
  if (!stream) return null;
  return {
    codec: stream.codec_name ?? null,
    sampleRate: Number(stream.sample_rate ?? 0) || null,
    channels: stream.channels ?? null,
    durationSeconds: Number(parsed.format?.duration ?? stream.duration ?? 0) || null,
  };
}

/** Downscales an image with ffmpeg when it exceeds the thumbnail size. */
export function renderImageThumbnail(imagePath, maxSize = 192) {
  return execFileSync(
    "ffmpeg",
    [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-i", imagePath,
      "-vf", `scale='min(${maxSize},iw)':'min(${maxSize},ih)':force_original_aspect_ratio=decrease`,
      "-f", "image2", "-c:v", "png", "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
}
