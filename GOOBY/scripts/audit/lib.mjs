import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const MIB = 1024 * 1024;

export async function walkFiles(root, predicate = () => true) {
  const files = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && predicate(absolute)) files.push(absolute);
    }
  }
  try {
    await visit(root);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return files.sort();
}

export async function fileSize(file) {
  return (await stat(file)).size;
}

export async function text(file) {
  return readFile(file, "utf8");
}

export function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MIB) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / MIB).toFixed(2)} MiB`;
}

export function printRows(title, rows) {
  console.log(title);
  for (const row of rows) console.log(`  ${row}`);
}
