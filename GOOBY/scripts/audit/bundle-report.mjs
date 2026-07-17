import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { MIB, fileSize, formatBytes, printRows, relative, walkFiles } from "./lib.mjs";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const distRoot = path.resolve(projectRoot, process.argv[2] ?? "dist");
const limit = 5 * MIB;
const jsFiles = await walkFiles(distRoot, (file) => /\.(?:js|mjs)$/u.test(file));

if (jsFiles.length === 0) {
  console.error(`No JavaScript bundles found under ${relative(projectRoot, distRoot)}. Run npm run build first.`);
  process.exitCode = 1;
} else {
  const chunks = [];
  const modules = [];
  let totalRaw = 0;
  let totalGzip = 0;

  for (const file of jsFiles) {
    const bytes = await readFile(file);
    const gzipBytes = gzipSync(bytes, { level: 9 }).byteLength;
    totalRaw += bytes.byteLength;
    totalGzip += gzipBytes;
    chunks.push({
      file: relative(projectRoot, file),
      rawBytes: bytes.byteLength,
      gzipBytes,
    });

    try {
      const sourceMap = JSON.parse(await readFile(`${file}.map`, "utf8"));
      for (let index = 0; index < sourceMap.sources.length; index += 1) {
        const source = sourceMap.sources[index];
        const content = sourceMap.sourcesContent?.[index];
        if (typeof source === "string" && typeof content === "string") {
          modules.push({ source, bytes: Buffer.byteLength(content) });
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  chunks.sort((left, right) => right.gzipBytes - left.gzipBytes);
  modules.sort((left, right) => right.bytes - left.bytes);
  printRows("Largest JavaScript chunks (gzip / raw):", chunks.slice(0, 12).map((chunk) =>
    `${formatBytes(chunk.gzipBytes)} / ${formatBytes(chunk.rawBytes)}  ${chunk.file}`));
  if (modules.length > 0) {
    printRows("Largest source modules (source-map source size):", modules.slice(0, 15).map((module) =>
      `${formatBytes(module.bytes)}  ${module.source}`));
  }
  console.log(`JavaScript total: ${formatBytes(totalGzip)} gzip / ${formatBytes(totalRaw)} raw`);
  console.log(`Budget: ${formatBytes(limit)} gzip`);

  const missingMaps = await Promise.all(jsFiles.map(async (file) => {
    try {
      await fileSize(`${file}.map`);
      return null;
    } catch {
      return relative(projectRoot, file);
    }
  }));
  const withoutMaps = missingMaps.filter(Boolean);
  if (withoutMaps.length > 0) {
    console.log(`Production source maps are disabled for all ${withoutMaps.length} chunk(s).`);
  }
  if (totalGzip > limit) {
    console.error(`FAIL: JavaScript gzip size exceeds the 5 MiB budget by ${formatBytes(totalGzip - limit)}.`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: JavaScript gzip size has ${formatBytes(limit - totalGzip)} headroom.`);
  }
}
