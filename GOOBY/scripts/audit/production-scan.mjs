import path from "node:path";
import { fileSize, formatBytes, printRows, relative, text, walkFiles } from "./lib.mjs";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const distRoot = path.resolve(projectRoot, process.argv[2] ?? "dist");
const bundles = await walkFiles(distRoot, (file) => /\.(?:js|mjs)$/u.test(file));
const forbidden = [
  ["debugger statement", /\bdebugger\b/u],
  ["console debug/trace", /\bconsole\.(?:debug|trace)\s*\(/u],
  ["development harness", /dev-harness|browser-harness|full-flow-walkthrough/u],
  ["test time mutation", /advanceMinigameTime|grantProgressionXp|completeCityLeg|inspectShopItem|clearSave/u],
  ["performance dev controls", /simulateGovernor|markResourceBaseline|GOOBY PERF|perf-overlay/u],
];
const failures = [];
const warnings = [];

if (bundles.length === 0) {
  failures.push(`No production JavaScript found under ${relative(projectRoot, distRoot)}.`);
}
for (const file of bundles) {
  const local = relative(projectRoot, file);
  const content = await text(file);
  for (const [label, expression] of forbidden) {
    if (expression.test(content)) failures.push(`${local}: ${label}`);
  }
  if (/sourceMappingURL=/u.test(content)) {
    warnings.push(`${local}: publishes a source-map reference`);
  }
}

const maps = await walkFiles(distRoot, (file) => file.endsWith(".map"));
if (maps.length > 0) {
  const bytes = (await Promise.all(maps.map(fileSize))).reduce((sum, value) => sum + value, 0);
  warnings.push(`${maps.length} source map(s) emitted (${formatBytes(bytes)}); control map upload/exposure at deploy time`);
}

if (warnings.length > 0) printRows("Production scan notes:", warnings);
if (failures.length > 0) {
  printRows("FAIL: production harness/debug findings:", failures);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${bundles.length} production bundle(s) contain no harness, mutation hook, debugger, or perf-control markers.`);
}
