import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".css") ? [path] : [];
  }));
  return nested.flat();
}

const violations = [];
for (const path of await sourceFiles("src")) {
  const source = await readFile(path, "utf8");
  if (/https?:\/\//u.test(source)) violations.push(path);
}

if (violations.length > 0) {
  console.error(`Runtime network asset references found:\n${violations.join("\n")}`);
  process.exit(1);
}
console.log("Asset audit passed: runtime source has no network URLs.");
