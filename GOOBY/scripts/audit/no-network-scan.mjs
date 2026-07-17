import path from "node:path";
import { pathToFileURL } from "node:url";
import { printRows, relative, text, walkFiles } from "./lib.mjs";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const sourceRoot = path.join(projectRoot, "src");
const builtRoot = path.join(projectRoot, "dist");
const sourceExtensions = /\.(?:ts|tsx|js|jsx|mjs|html|css)$/u;
const builtExtensions = /\.(?:js|mjs|html|css)$/u;
const excludedDevFile = /(?:^|\/)(?:[^/]*\.(?:test|spec|e2e)\.[^/]+|[^/]*harness[^/]*|[^/]*playwright[^/]*config[^/]*|(?:vite[^/]*|[^/]*\.vite)\.config\.[^/]+)$/u;
const patterns = [
  { kind: "fetch", expression: /\bfetch\s*\(/gu, sourceOnly: true },
  { kind: "XMLHttpRequest", expression: /\bXMLHttpRequest\b/gu, sourceOnly: true },
  { kind: "WebSocket", expression: /\bWebSocket\b/gu, sourceOnly: true },
  { kind: "EventSource", expression: /\bEventSource\s*\(/gu, sourceOnly: true },
  { kind: "sendBeacon", expression: /\bsendBeacon\s*\(/gu, sourceOnly: true },
  {
    kind: "external image/media source",
    expression: /(?:new\s+(?:Image|Audio)\s*\([^)]*|(?:src|poster)\s*=\s*|<(?:img|audio|video|source)\b[^>]*(?:src|poster)\s*=\s*)["'`](?:https?:)?\/\/[^"'`)>\s]+/giu,
  },
  {
    kind: "external form action",
    expression: /(?:<form\b[^>]*\baction\s*=\s*|(?:formAction|\.action)\s*=\s*)["'`](?:https?:)?\/\/[^"'`>\s]+/giu,
  },
  {
    kind: "external executable/frame source",
    expression: /<(?:script|iframe|link)\b[^>]*(?:src|href)\s*=\s*["'`](?:https?:)?\/\/[^"'`>\s]+/giu,
  },
  {
    kind: "built external request",
    expression: /\b(?:fetch|WebSocket|EventSource|sendBeacon)\s*\(\s*["'`](?:https?:)?\/\/[^"'`)\s]+/giu,
    builtOnly: true,
  },
  {
    kind: "external URL",
    expression: /(?:https?:)?\/\/[a-z0-9][^\s"'`)<]*/giu,
    sourceOnly: true,
  },
];

const inertNamespaceUrls = [
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/2000/xmlns/",
];

function maskInertNamespaces(source) {
  let masked = source;
  for (const namespace of inertNamespaceUrls) {
    masked = masked.replaceAll(namespace, " ".repeat(namespace.length));
  }
  return masked;
}

function lineDetails(source, offset) {
  const line = source.slice(0, offset).split(/\r?\n/u).length;
  const start = source.lastIndexOf("\n", offset - 1) + 1;
  const end = source.indexOf("\n", offset);
  const preview = source.slice(start, end === -1 ? source.length : end).trim();
  return { line, preview: preview.length > 180 ? `${preview.slice(0, 177)}...` : preview };
}

export function networkReferenceViolations(local, source, { built = false } = {}) {
  const violations = [];
  const masked = maskInertNamespaces(source);
  const seen = new Set();
  for (const { kind, expression, sourceOnly, builtOnly } of patterns) {
    if ((built && sourceOnly) || (!built && builtOnly)) continue;
    expression.lastIndex = 0;
    for (const match of masked.matchAll(expression)) {
      if (
        kind === "external URL"
        && /^(?:https?:)?\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::(?:\d+|\*))?(?:[/?#]|$)/iu.test(match[0])
      ) {
        continue;
      }
      const offset = match.index ?? 0;
      const { line, preview } = lineDetails(source, offset);
      const identity = `${line}\0${kind}\0${match[0]}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      violations.push(`${local}:${line} [${kind}] ${preview}`);
    }
  }
  return violations;
}

async function main() {
  const sourceFiles = await walkFiles(sourceRoot, (file) => sourceExtensions.test(file));
  const builtFiles = await walkFiles(builtRoot, (file) => builtExtensions.test(file));
  const topLevelFiles = ["index.html", "capacitor.config.ts", "vite.config.ts"]
    .map((file) => path.join(projectRoot, file));
  const candidates = [
    ...sourceFiles.map((file) => ({ file, built: false })),
    ...topLevelFiles.map((file) => ({ file, built: false })),
    ...builtFiles.map((file) => ({ file, built: true })),
  ];
  const violations = [];
  let scannedSource = 0;
  let scannedBuilt = 0;
  let excluded = 0;

  for (const { file, built } of candidates) {
    const local = relative(projectRoot, file);
    if (!built && excludedDevFile.test(local)) {
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
    if (built) scannedBuilt += 1;
    else scannedSource += 1;
    violations.push(...networkReferenceViolations(local, content, { built }));
  }

  console.log(
    `Scanned ${scannedSource} runtime source files and ${scannedBuilt} built files; `
    + `excluded ${excluded} test/dev harness files.`,
  );
  console.log("Explicitly exempt acquisition/dev scripts: scripts/assets-fetch.mjs, scripts/assets/**, scripts/full-flow-walkthrough.mjs.");
  if (violations.length > 0) {
    printRows("FAIL: network-capable runtime references:", violations);
    process.exitCode = 1;
  } else {
    console.log(
      "PASS: no fetch/XHR/WebSocket/EventSource/sendBeacon/external URL, "
      + "media/image source, or form-action references in production source/build output.",
    );
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
