import path from "node:path";
import { MIB, fileSize, formatBytes, printRows, relative, walkFiles } from "./lib.mjs";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const requestedRoot = process.argv[2];
const assetRoot = path.resolve(projectRoot, requestedRoot ?? "public/assets");
const limit = 150 * MIB;
const files = await walkFiles(assetRoot);

if (files.length === 0) {
  console.error(`No runtime assets found under ${relative(projectRoot, assetRoot)}.`);
  process.exitCode = 1;
} else {
  const packs = new Map();
  const entries = [];
  let total = 0;
  for (const file of files) {
    const bytes = await fileSize(file);
    const local = relative(assetRoot, file);
    const segments = local.split("/");
    const pack = segments[0] === "vendor" ? (segments[1] ?? "vendor") : (segments[0] ?? "root");
    packs.set(pack, (packs.get(pack) ?? 0) + bytes);
    entries.push({ file: relative(projectRoot, file), bytes });
    total += bytes;
  }
  const packRows = [...packs.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([pack, bytes]) => `${formatBytes(bytes)}  ${pack}`);
  entries.sort((left, right) => right.bytes - left.bytes);
  printRows("Runtime asset packs:", packRows);
  printRows("Largest runtime assets:", entries.slice(0, 15).map(({ file, bytes }) =>
    `${formatBytes(bytes)}  ${file}`));
  console.log(`Runtime asset total: ${formatBytes(total)}`);
  console.log(`Budget: ${formatBytes(limit)}`);
  if (total > limit) {
    console.error(`FAIL: runtime assets exceed the 150 MiB budget by ${formatBytes(total - limit)}.`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: runtime assets have ${formatBytes(limit - total)} headroom.`);
  }
}
