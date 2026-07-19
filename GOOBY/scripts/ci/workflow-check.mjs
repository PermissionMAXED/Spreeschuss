import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repository = resolve(import.meta.dirname, "../../..");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadWorkflow(name) {
  const path = resolve(repository, ".github/workflows", name);
  return { path, source: await readFile(path, "utf8") };
}

function parseScalar(value) {
  const trimmed = value.replace(/\s+#.*$/u, "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseWorkflowYaml(source, label) {
  invariant(!source.includes("\t"), `${label}: tabs are not valid indentation`);
  const rawLines = source.split(/\r?\n/u);
  const lines = rawLines.map((raw, index) => ({
    raw,
    index: index + 1,
    indent: raw.length - raw.trimStart().length,
    content: raw.trim(),
  }));
  let cursor = 0;

  function skipEmpty() {
    while (cursor < lines.length && (!lines[cursor].content || lines[cursor].content.startsWith("#"))) {
      cursor += 1;
    }
  }

  function parseBlock(indent) {
    skipEmpty();
    const line = lines[cursor];
    invariant(line && line.indent === indent, `${label}:${line?.index ?? "EOF"}: expected indentation ${indent}`);
    return line.content.startsWith("- ") ? parseSequence(indent) : parseMapping(indent);
  }

  function parseBlockScalar(parentIndent) {
    const collected = [];
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line.content && line.indent <= parentIndent) break;
      collected.push(line.raw.slice(Math.min(line.raw.length, parentIndent + 2)));
      cursor += 1;
    }
    return collected.join("\n");
  }

  function parseEntry(content, line, parentIndent) {
    const match = /^([A-Za-z_][A-Za-z0-9_.-]*):(?:\s*(.*))?$/u.exec(content);
    invariant(match, `${label}:${line.index}: invalid mapping entry`);
    const key = match[1];
    const remainder = match[2] ?? "";
    if (remainder === "|" || remainder === ">") return [key, parseBlockScalar(parentIndent)];
    if (remainder) return [key, parseScalar(remainder)];
    skipEmpty();
    const next = lines[cursor];
    return next && next.indent > parentIndent
      ? [key, parseBlock(next.indent)]
      : [key, null];
  }

  function parseMapping(indent) {
    const result = {};
    while (cursor < lines.length) {
      skipEmpty();
      const line = lines[cursor];
      if (!line || line.indent < indent) break;
      invariant(line.indent === indent, `${label}:${line.index}: unexpected indentation`);
      invariant(!line.content.startsWith("- "), `${label}:${line.index}: mixed mapping and sequence`);
      cursor += 1;
      const [key, value] = parseEntry(line.content, line, indent);
      invariant(!(key in result), `${label}:${line.index}: duplicate key ${key}`);
      result[key] = value;
    }
    return result;
  }

  function parseSequence(indent) {
    const result = [];
    while (cursor < lines.length) {
      skipEmpty();
      const line = lines[cursor];
      if (!line || line.indent < indent) break;
      invariant(line.indent === indent && line.content.startsWith("- "), `${label}:${line.index}: invalid sequence item`);
      const remainder = line.content.slice(2).trim();
      cursor += 1;
      const mappingMatch = /^([A-Za-z_][A-Za-z0-9_.-]*):(?:\s*(.*))?$/u.exec(remainder);
      if (mappingMatch) {
        const item = {};
        const [key, value] = parseEntry(remainder, line, indent);
        item[key] = value;
        skipEmpty();
        const continuation = lines[cursor];
        if (continuation && continuation.indent > indent) {
          const additional = parseMapping(continuation.indent);
          for (const [additionalKey, additionalValue] of Object.entries(additional)) {
            invariant(!(additionalKey in item), `${label}:${continuation.index}: duplicate sequence key ${additionalKey}`);
            item[additionalKey] = additionalValue;
          }
        }
        result.push(item);
      } else {
        invariant(remainder.length > 0, `${label}:${line.index}: empty sequence entries are unsupported`);
        result.push(parseScalar(remainder));
      }
    }
    return result;
  }

  const parsed = parseBlock(0);
  skipEmpty();
  invariant(cursor === lines.length, `${label}:${lines[cursor]?.index ?? "EOF"}: unparsed workflow content`);
  return parsed;
}

function mapping(value, label) {
  invariant(typeof value === "object" && value !== null && !Array.isArray(value), `${label}: expected mapping`);
  return value;
}

function sequence(value, label) {
  invariant(Array.isArray(value), `${label}: expected sequence`);
  return value;
}

function job(workflow, name) {
  return mapping(mapping(workflow.jobs, "jobs")[name], `job ${name}`);
}

function steps(workflowJob, label) {
  return sequence(workflowJob.steps, `${label} steps`).map((value, index) => mapping(value, `${label} step ${index + 1}`));
}

function runScripts(workflowJob, label) {
  return steps(workflowJob, label)
    .map((step) => step.run)
    .filter((run) => typeof run === "string");
}

function hasRun(workflowJob, label, snippet) {
  invariant(runScripts(workflowJob, label).some((run) => run.includes(snippet)), `${label}: missing command ${snippet}`);
}

function namedStep(workflowJob, label, name) {
  const result = steps(workflowJob, label).find((step) => step.name === name);
  invariant(result, `${label}: missing step "${name}"`);
  return result;
}

function assertPathFilters(workflow, label) {
  const triggers = mapping(workflow.on, `${label} triggers`);
  for (const event of ["push", "pull_request"]) {
    const paths = sequence(mapping(triggers[event], `${label} ${event}`).paths, `${label} ${event} paths`);
    invariant(paths.includes("GOOBY/**"), `${label}: ${event} must filter GOOBY`);
    invariant(paths.includes(".github/workflows/gooby-web-ci.yml"), `${label}: ${event} must include web workflow changes`);
    invariant(paths.includes(".github/workflows/gooby-ios.yml"), `${label}: ${event} must include iOS workflow changes`);
  }
  invariant("workflow_dispatch" in triggers, `${label}: workflow_dispatch is missing`);
}

function assertCommandBefore(workflowJob, label, first, second) {
  const commands = runScripts(workflowJob, label);
  const firstIndex = commands.findIndex((run) => run.includes(first));
  const secondIndex = commands.findIndex((run) => run.includes(second));
  invariant(firstIndex >= 0, `${label}: missing command ${first}`);
  invariant(secondIndex >= 0, `${label}: missing command ${second}`);
  invariant(firstIndex < secondIndex, `${label}: ${first} must run before ${second}`);
}

function assertPinnedActions(source, label) {
  const actionLines = source.split(/\r?\n/u)
    .map((line, index) => ({ line: index + 1, match: /^\s*uses:\s*([^\s#]+)(?:\s+#\s*(\S+))?\s*$/u.exec(line) }))
    .filter(({ match }) => match);
  invariant(actionLines.length > 0, `${label}: no third-party actions found`);
  for (const { line, match } of actionLines) {
    const reference = match[1];
    const version = match[2];
    if (reference.startsWith("./")) continue;
    invariant(/^[^@]+@[0-9a-f]{40}$/u.test(reference), `${label}:${line}: action must use a full commit SHA`);
    invariant(/^v\d+\.\d+\.\d+$/u.test(version ?? ""), `${label}:${line}: pinned action needs an exact version comment`);
  }
}

function assertActionlintInstall(workflowJob, label) {
  const install = namedStep(workflowJob, label, "Install pinned actionlint");
  const environment = mapping(install.env, `${label} actionlint environment`);
  invariant(environment.ACTIONLINT_VERSION === "1.7.7", `${label}: actionlint version must be fixed at 1.7.7`);
  invariant(
    environment.ACTIONLINT_SHA256 === "023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757",
    `${label}: actionlint checksum is not the reviewed v1.7.7 linux_amd64 digest`,
  );
  invariant(
    install.run.includes("actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz")
      && install.run.includes("sha256sum --check --status")
      && install.run.includes('test -x "$RUNNER_TEMP/actionlint-bin/actionlint"'),
    `${label}: actionlint install must download, checksum, and verify the fixed binary`,
  );
  const workflowCheck = namedStep(workflowJob, label, "Check Gooby workflow structure");
  invariant(workflowCheck.run.includes("command -v actionlint"), `${label}: missing fatal actionlint availability check`);
}

function numericConstant(source, name, label) {
  const match = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*([0-9][0-9_]*)\\s*;`, "u").exec(source);
  invariant(match, `${label}: missing numeric constant ${name}`);
  return Number(match[1].replaceAll("_", ""));
}

function assertRealInputTimeoutPolicy(cityActionsSource, playwrightConfigSource) {
  const legTimeout = numericConstant(cityActionsSource, "CITY_LEG_TIMEOUT_MS", "city actions");
  const progressTimeout = numericConstant(cityActionsSource, "CITY_PROGRESS_TIMEOUT_MS", "city actions");
  const maxSteerHold = numericConstant(cityActionsSource, "CITY_MAX_STEER_HOLD_MS", "city actions");
  const stuckRecovery = numericConstant(cityActionsSource, "CITY_STUCK_RECOVERY_MS", "city actions");
  const rootTimeout = numericConstant(playwrightConfigSource, "ROOT_E2E_TIMEOUT_MS", "root Playwright config");
  const ciWorkers = numericConstant(playwrightConfigSource, "ROOT_E2E_CI_WORKERS", "root Playwright config");
  const requiredMargin = numericConstant(
    playwrightConfigSource,
    "ROOT_E2E_CITY_TIMEOUT_MARGIN_MS",
    "root Playwright config",
  );

  invariant(cityActionsSource.includes("page.keyboard.down("), "City routing must hold real keyboard input");
  invariant(cityActionsSource.includes("page.keyboard.up("), "City routing must release real keyboard input");
  invariant(!cityActionsSource.includes("completeCityLeg"), "City routing must not use the city completion hook");
  invariant(!cityActionsSource.includes("__gooby.test"), "City routing must not use core-action test hooks");
  invariant(cityActionsSource.includes("progressDeadline"), "City routing must enforce a rolling progress deadline");
  invariant(progressTimeout < legTimeout, "City progress timeout must expire before the leg timeout");
  invariant(maxSteerHold <= 250, "City steering cadence must remain at or below 250ms");
  invariant(stuckRecovery <= 2_000, "City stuck recovery must begin within two seconds");
  invariant(requiredMargin >= 30_000, "Root City E2E timeout margin must be at least 30 seconds");
  invariant(
    rootTimeout - legTimeout * 2 >= requiredMargin,
    "Root E2E timeout must cover two bounded City legs plus the required margin",
  );
  invariant(
    playwrightConfigSource.includes("timeout: ROOT_E2E_TIMEOUT_MS"),
    "Root Playwright config must use the audited E2E timeout constant",
  );
  invariant(ciWorkers <= 2, "Root City E2E must use at most two CI workers");
  invariant(
    playwrightConfigSource.includes("workers: ROOT_E2E_CI_WORKERS"),
    "Root Playwright config must use the audited CI worker limit",
  );
}

const PLAYWRIGHT_SUITE_CONFIGS = [
  "GOOBY/playwright.config.ts",
  "GOOBY/src/ui/playwright.config.ts",
  "GOOBY/src/scenes/city/playwright.config.ts",
  "GOOBY/src/minigames/bubble-bath-blast/playwright.config.mjs",
  "GOOBY/src/minigames/burrow-dig/playwright.config.mjs",
  "GOOBY/src/minigames/cake-atelier/playwright.config.mjs",
  "GOOBY/src/minigames/carrot-catch/playwright.config.mjs",
  "GOOBY/src/minigames/cloud-bounce/playwright.config.mjs",
  "GOOBY/src/minigames/firefly-lantern/playwright.config.mjs",
  "GOOBY/src/minigames/honey-drizzle/playwright.config.mjs",
  "GOOBY/src/minigames/library-stack/playwright.config.mjs",
  "GOOBY/src/minigames/market-scales/playwright.config.mjs",
  "GOOBY/src/minigames/memory-meadow/playwright.config.mjs",
  "GOOBY/src/minigames/picnic-packer/playwright.config.mjs",
  "GOOBY/src/minigames/pond-fishing/playwright.config.mjs",
  "GOOBY/src/minigames/puddle-hopper/playwright.config.mjs",
  "GOOBY/src/minigames/rhythm-hop/playwright.config.mjs",
  "GOOBY/src/minigames/shopping-surf/playwright.config.mjs",
  "GOOBY/src/minigames/snail-mail/playwright.config.mjs",
  "GOOBY/src/minigames/topiary-trim/playwright.config.mjs",
];

/** Every browser suite must own a fresh, unique, fail-fast dev server port. */
async function assertFreshUniqueBrowserServers() {
  const portOwners = new Map();
  for (const relative of PLAYWRIGHT_SUITE_CONFIGS) {
    const source = await readFile(resolve(repository, relative), "utf8");
    invariant(
      !/reuseExistingServer:\s*true/u.test(source),
      `${relative}: browser suites must never reuse an existing dev server`,
    );
    const port = /--port (\d{4,5})\b/u.exec(source)?.[1];
    invariant(port, `${relative}: suite dev server must pin an explicit --port`);
    invariant(source.includes("--strictPort"), `${relative}: suite dev server must fail fast on an occupied port`);
    const owner = portOwners.get(port);
    invariant(!owner, `${relative}: port ${port} is already claimed by ${owner}`);
    portOwners.set(port, relative);
  }
}

const webFile = await loadWorkflow("gooby-web-ci.yml");
const iosFile = await loadWorkflow("gooby-ios.yml");
const web = mapping(parseWorkflowYaml(webFile.source, "gooby-web-ci.yml"), "web workflow");
const ios = mapping(parseWorkflowYaml(iosFile.source, "gooby-ios.yml"), "iOS workflow");
const packageJson = JSON.parse(await readFile(resolve(repository, "GOOBY/package.json"), "utf8"));
const cityActionsSource = await readFile(resolve(repository, "GOOBY/e2e/city-actions.ts"), "utf8");
const playwrightConfigSource = await readFile(resolve(repository, "GOOBY/playwright.config.ts"), "utf8");

assertPathFilters(web, "web workflow");
assertPathFilters(ios, "iOS workflow");
assertPinnedActions(webFile.source, "gooby-web-ci.yml");
assertPinnedActions(iosFile.source, "gooby-ios.yml");
assertRealInputTimeoutPolicy(cityActionsSource, playwrightConfigSource);
await assertFreshUniqueBrowserServers();

for (const script of ["root", "ui", "city", "bubble", "cake", "surf"]) {
  invariant(
    packageJson.scripts["test:e2e"].includes(`npm run test:e2e:${script}`),
    `test:e2e must aggregate the ${script} browser suite`,
  );
  invariant(
    packageJson.scripts[`test:e2e:${script}`]?.includes("--forbid-only"),
    `test:e2e:${script} must reject focused tests`,
  );
}
for (const script of ["ci:diff-check", "ci:no-skipped-tests"]) {
  invariant(typeof packageJson.scripts[script] === "string", `${script} package script is missing`);
}

const webJob = job(web, "web");
invariant(webJob["runs-on"] === "ubuntu-latest", "Web CI must run on Linux");
const setupNode = steps(webJob, "web").find((step) => step.uses?.startsWith("actions/setup-node@"));
invariant(setupNode, "Web CI must configure Node");
invariant(mapping(setupNode.with, "web setup-node options")["node-version-file"] === "GOOBY/.nvmrc", "Web CI must read GOOBY/.nvmrc");
for (const command of [
  "npm ci",
  "npx playwright install --with-deps chromium",
  "npm run ci:diff-check",
  "npm run lint",
  "npm run typecheck",
  "npm run test:unit",
  "npm run test:specialists",
  "npm run ci:no-skipped-tests",
  "npm run test:e2e:root",
  "npm run test:e2e:ui",
  "npm run test:e2e:city",
  "npm run test:e2e:bubble",
  "npm run test:e2e:cake",
  "npm run test:e2e:surf",
  "npm run assets:audit",
  "npm run audit:asset-size",
  "npm run audit:no-network",
  "npm run build",
  "npm run audit:bundle",
  "npm run audit:production",
  "npm run ci:native-check",
  "npm run ci:workflow-check",
]) {
  hasRun(webJob, "web", command);
}
invariant(
  !runScripts(webJob, "web").some((run) => run.includes("npm run audit:perf")),
  "Web browser job must not run the performance audit after the browser suites",
);
assertActionlintInstall(webJob, "web");
const webUpload = steps(webJob, "web").find((step) => step.uses?.startsWith("actions/upload-artifact@"));
invariant(webUpload, "Web CI must upload an artifact");
const webUploadPath = mapping(webUpload.with, "web artifact options").path;
invariant(typeof webUploadPath === "string" && webUploadPath.includes("GOOBY/dist") && webUploadPath.includes("GOOBY/playwright-report"), "Web artifact must include dist and Playwright report");

const performance = job(web, "performance");
invariant(performance["runs-on"] === "ubuntu-latest", "Performance CI must run on a fresh Linux runner");
invariant(!("needs" in performance), "Performance CI must be an independent required job");
invariant(!("if" in performance), "Performance CI must run on every workflow invocation");
invariant(performance["timeout-minutes"] === "15", "Performance CI timeout must remain 15 minutes");
invariant(
  mapping(mapping(performance.defaults, "performance defaults").run, "performance run defaults")["working-directory"] === "GOOBY",
  "Performance CI commands must run from GOOBY",
);
const performanceSteps = steps(performance, "performance");
const expectedPerformanceSteps = [
  "Check out repository",
  "Use repository Node version",
  "Install locked dependencies",
  "Install Playwright Chromium",
  "Audit adaptive quality and scene disposal",
  "Upload performance report",
];
invariant(
  performanceSteps.map((step) => step.name).join("\n") === expectedPerformanceSteps.join("\n"),
  "Performance CI must contain only the reviewed checkout, setup, install, audit, and upload steps in order",
);
const performanceCheckout = namedStep(performance, "performance", "Check out repository");
invariant(
  performanceCheckout.uses?.startsWith("actions/checkout@"),
  "Performance CI must check out the repository with actions/checkout",
);
const performanceSetupNode = namedStep(performance, "performance", "Use repository Node version");
invariant(
  performanceSetupNode.uses?.startsWith("actions/setup-node@"),
  "Performance CI must configure Node with actions/setup-node",
);
const performanceNodeOptions = mapping(performanceSetupNode.with, "performance setup-node options");
invariant(
  performanceNodeOptions["node-version-file"] === "GOOBY/.nvmrc",
  "Performance CI must read GOOBY/.nvmrc",
);
invariant(
  performanceNodeOptions.cache === "npm"
    && performanceNodeOptions["cache-dependency-path"] === "GOOBY/package-lock.json",
  "Performance CI must use the reviewed npm dependency cache",
);
invariant(
  namedStep(performance, "performance", "Install locked dependencies").run === "npm ci",
  "Performance CI must install a fresh locked dependency tree",
);
invariant(
  namedStep(performance, "performance", "Install Playwright Chromium").run
    === "npx playwright install --with-deps chromium",
  "Performance CI must install Chromium and its system dependencies",
);
const perfAudit = namedStep(performance, "performance", "Audit adaptive quality and scene disposal");
invariant(perfAudit.run === "npm run audit:perf", "Performance CI must run only the unchanged performance audit");
invariant(
  mapping(perfAudit.env, "performance audit environment").GOOBY_ARTIFACTS === "playwright-report/perf-artifacts",
  "Performance audit must write its report to the uploaded artifact directory",
);
const performanceUpload = namedStep(performance, "performance", "Upload performance report");
invariant(
  performanceUpload.if === "always()",
  "Performance report upload must run after audit success or failure",
);
invariant(
  performanceUpload.uses?.startsWith("actions/upload-artifact@"),
  "Performance report must use actions/upload-artifact",
);
const performanceArtifactOptions = mapping(performanceUpload.with, "performance artifact options");
invariant(
  performanceArtifactOptions.name === "gooby-performance-report"
    && performanceArtifactOptions.path === "GOOBY/playwright-report/perf-artifacts"
    && performanceArtifactOptions["if-no-files-found"] === "warn"
    && performanceArtifactOptions["retention-days"] === "14",
  "Performance report artifact must keep the reviewed path, failure policy, and 14-day retention",
);

const preflight = job(ios, "preflight");
invariant(preflight["runs-on"] === "ubuntu-latest", "iOS validation must run on Linux without release secrets");
invariant(!JSON.stringify(preflight).includes("secrets."), "iOS preflight must not map or probe secrets");
for (const command of [
  "npm ci",
  "npm run ci:diff-check",
  "npm run assets:audit",
  "npm run audit:no-network",
  "npm run ci:native-check",
  "npm run ci:workflow-check",
]) {
  hasRun(preflight, "preflight", command);
}
assertActionlintInstall(preflight, "preflight");

const iosJobs = mapping(ios.jobs, "iOS jobs");
invariant(
  Object.keys(iosJobs).sort().join(",") === "preflight,unsigned",
  "iOS workflow must contain only always-on preflight and unsigned jobs",
);
invariant(!iosFile.source.includes("${{ secrets."), "iOS workflow must not reference GitHub secrets");
for (const secretName of [
  "IOS_CERT_P12_BASE64",
  "IOS_CERT_PASSWORD",
  "IOS_PROVISIONING_PROFILE_BASE64",
  "APPLE_TEAM_ID",
  "ASC_API_KEY_ID",
  "ASC_API_ISSUER_ID",
  "ASC_API_KEY_P8_BASE64",
]) {
  invariant(!iosFile.source.includes(secretName), `iOS workflow must not reference ${secretName}`);
}
for (const [jobName, workflowJob] of Object.entries(iosJobs)) {
  invariant(!("environment" in mapping(workflowJob, `iOS job ${jobName}`)), `${jobName}: unsigned workflow jobs must not assume a protected environment`);
}

const unsigned = job(ios, "unsigned");
invariant(unsigned["runs-on"] === "macos-15", "Unsigned archive must run on macos-15");
invariant(unsigned.needs === "preflight" && !("if" in unsigned), "Unsigned job must run after validation on every workflow invocation");
invariant(!JSON.stringify(unsigned).includes("secrets."), "Unsigned job must have zero secret mappings");
for (const command of ["npm ci", "npm run assets:audit", "npm run audit:no-network", "npm run build", "npx cap sync ios", "pod install", "xcodebuild archive"]) {
  hasRun(unsigned, "unsigned", command);
}
assertCommandBefore(unsigned, "unsigned", "npm run assets:audit", "xcodebuild archive");
assertCommandBefore(unsigned, "unsigned", "npm run audit:no-network", "xcodebuild archive");
const unsignedArchive = namedStep(unsigned, "unsigned", "Archive without code signing").run;
for (const setting of [
  "CODE_SIGNING_ALLOWED=NO",
  "CODE_SIGNING_REQUIRED=NO",
  'CODE_SIGN_IDENTITY=""',
  'DEVELOPMENT_TEAM=""',
]) {
  invariant(unsignedArchive.includes(setting), `Unsigned archive must set ${setting}`);
}
const unsignedPackage = namedStep(unsigned, "unsigned", "Package unsigned IPA").run;
invariant(unsignedPackage.includes("Payload/App.app") && unsignedPackage.includes("Gooby-unsigned.ipa"), "Unsigned IPA packaging contract is missing");
const summary = namedStep(unsigned, "unsigned", "Explain unsigned artifact").run;
invariant(summary.includes("requires re-signing"), "Unsigned step summary must explicitly require re-signing");
invariant(
  summary.includes("protected GitHub environment"),
  "Unsigned step summary must defer optional signed jobs until external protection exists",
);
const pushTags = sequence(mapping(mapping(ios.on, "iOS triggers").push, "iOS push trigger").tags, "iOS tags");
invariant(pushTags.includes("gooby-v*"), "Unsigned release tag trigger must be gooby-v*");

const actionlint = spawnSync("actionlint", [webFile.path, iosFile.path], { encoding: "utf8" });
invariant(actionlint.error?.code !== "ENOENT", "actionlint is required but was not found on PATH");
invariant(actionlint.status === 0, `actionlint failed:\n${actionlint.stdout}${actionlint.stderr}`);
console.log("actionlint passed.");
console.log("Workflow check passed: pinned actions, isolated performance CI, complete web gates, bounded real-input routing, audits, and always-on zero-secret unsigned builds.");
