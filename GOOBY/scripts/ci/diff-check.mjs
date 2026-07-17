import { readdir, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "../../..");
const gooby = resolve(repository, "GOOBY");
const workflows = [
  resolve(repository, ".github/workflows/gooby-web-ci.yml"),
  resolve(repository, ".github/workflows/gooby-ios.yml"),
];
const ignoredDirectories = new Set([
  "build",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "Pods",
  "test-results",
  "vendor",
]);
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".plist",
  ".pbxproj",
  ".ts",
  ".txt",
  ".xcprivacy",
  ".xml",
  ".yml",
  ".yaml",
]);

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name) && !(entry.name === "public" && directory.endsWith("/ios/App/App"))) {
        files.push(...await sourceFiles(resolve(directory, entry.name)));
      }
    } else if (
      entry.isFile()
      && textExtensions.has(extname(entry.name))
      && !(entry.name === "config.xml" && directory.endsWith("/ios/App/App"))
      && !(entry.name === "Contents.json" && directory.includes("/ios/App/App/Assets.xcassets"))
    ) {
      files.push(resolve(directory, entry.name));
    }
  }
  return files;
}

const failures = [];
for (const path of [...await sourceFiles(gooby), ...workflows]) {
  const source = await readFile(path, "utf8");
  const label = path.slice(repository.length + 1);
  if (source.includes("\r")) failures.push(`${label}: contains CRLF or bare carriage returns`);
  if (source.length > 0 && !source.endsWith("\n")) failures.push(`${label}: missing final newline`);
  for (const [index, line] of source.split("\n").entries()) {
    if (/[ \t]+$/u.test(line)) failures.push(`${label}:${index + 1}: trailing whitespace`);
    if (/^(?:<{7}|={7}|>{7})(?: |$)/u.test(line)) failures.push(`${label}:${index + 1}: merge-conflict marker`);
  }
}

if (failures.length > 0) {
  throw new Error(`Diff hygiene check failed:\n${failures.join("\n")}`);
}

console.log("Diff hygiene check passed: no trailing whitespace, CRLF, conflict markers, or missing final newlines.");
