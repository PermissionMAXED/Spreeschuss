import path from "node:path";
import { printRows, relative, text, walkFiles } from "./lib.mjs";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const sourceRoot = path.join(projectRoot, "src");
const sourceExtensions = /\.(?:ts|tsx|js|jsx|mjs|html|css)$/u;
const excludedDevFile = /(?:^|\/)(?:[^/]*\.(?:test|spec|e2e)\.[^/]+|[^/]*harness[^/]*|[^/]*playwright[^/]*config[^/]*|[^/]*\.vite\.config\.[^/]+)$/u;
const patterns = [
  { kind: "fetch", expression: /\bfetch\s*\(/gu },
  { kind: "XMLHttpRequest", expression: /\bXMLHttpRequest\b/gu },
  { kind: "WebSocket", expression: /\bWebSocket\b/gu },
  { kind: "external URL", expression: /(?:https?:)?\/\/[a-z0-9][^\s"'`)<]*/giu },
];

const sourceFiles = await walkFiles(sourceRoot, (file) => sourceExtensions.test(file));
const topLevelFiles = ["index.html", "capacitor.config.ts", "vite.config.ts"]
  .map((file) => path.join(projectRoot, file));
const candidates = [...sourceFiles, ...topLevelFiles];
const violations = [];
let scanned = 0;
let excluded = 0;

for (const file of candidates) {
  const local = relative(projectRoot, file);
  if (excludedDevFile.test(local)) {
    excluded += 1;
    continue;
  }
  let content;
  try {
    content = await text(file);
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  scanned += 1;
  const lines = content.split(/\r?\n/u);
  for (const [lineIndex, line] of lines.entries()) {
    for (const { kind, expression } of patterns) {
      expression.lastIndex = 0;
      if (expression.test(line)) {
        violations.push(`${local}:${lineIndex + 1} [${kind}] ${line.trim()}`);
      }
    }
  }
}

console.log(`Scanned ${scanned} runtime files; excluded ${excluded} test/dev harness files.`);
console.log("Explicitly exempt acquisition/dev scripts: scripts/assets-fetch.mjs, scripts/assets/**, scripts/full-flow-walkthrough.mjs.");
if (violations.length > 0) {
  printRows("FAIL: network-capable runtime references:", violations);
  process.exitCode = 1;
} else {
  console.log("PASS: no fetch/XHR/WebSocket/external URL references in production runtime sources.");
}
