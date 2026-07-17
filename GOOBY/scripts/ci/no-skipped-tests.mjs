import { readdir, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
const ignoredDirectories = new Set([
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);
const disabledModifiers = new Set(["skip", "skipIf", "fixme", "only"]);
const disabledIdentifiers = new Set(["xit", "xtest", "xdescribe"]);
const testRoots = new Set(["test", "it", "describe"]);

function isTestFile(path) {
  return /(?:^|\/)(?:e2e\/.*|[^/]+\.(?:test|spec|e2e))\.(?:[cm]?[jt]s)$/u.test(path);
}

async function testFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await testFiles(resolve(directory, entry.name)));
    } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      const relative = resolve(directory, entry.name).slice(root.length + 1);
      if (isTestFile(relative)) files.push(resolve(directory, entry.name));
    }
  }
  return files;
}

function expressionPath(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) return [...expressionPath(node.expression), node.name.text];
  if (
    ts.isElementAccessExpression(node)
    && node.argumentExpression
    && ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return [...expressionPath(node.expression), node.argumentExpression.text];
  }
  return [];
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return null;
}

function location(sourceFile, node) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${sourceFile.fileName.slice(root.length + 1)}:${line + 1}:${character + 1}`;
}

const files = await testFiles(root);
const failures = [];
for (const path of files) {
  const source = await readFile(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".ts") || path.endsWith(".mts") || path.endsWith(".cts")
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS,
  );
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const chain = expressionPath(node.expression);
      if (disabledIdentifiers.has(chain[0] ?? "")) {
        failures.push(`${location(sourceFile, node)}: disabled test alias ${chain[0]}`);
      } else if (
        chain.length > 1
        && disabledModifiers.has(chain.at(-1) ?? "")
        && (testRoots.has(chain[0] ?? "") || chain.at(-1) !== "only")
      ) {
        failures.push(`${location(sourceFile, node)}: disabled test modifier ${chain.join(".")}`);
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (
        (name === "skip" || name === "fixme" || name === "only" || name === "disabled")
        && node.initializer.kind === ts.SyntaxKind.TrueKeyword
      ) {
        failures.push(`${location(sourceFile, node)}: disabled test metadata ${name}: true`);
      }
      if (
        name === "mode"
        && ts.isStringLiteralLike(node.initializer)
        && node.initializer.text === "skip"
      ) {
        failures.push(`${location(sourceFile, node)}: disabled test metadata mode: "skip"`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

if (failures.length > 0) {
  throw new Error(`Skipped, focused, or disabled test coverage is forbidden:\n${failures.join("\n")}`);
}

console.log(`No-skips check passed across ${files.length} test files.`);
