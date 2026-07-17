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

function assertProtectedReleaseJob(workflowJob, label) {
  invariant(workflowJob.environment === "gooby-release", `${label}: must use the protected gooby-release environment`);
  invariant(typeof workflowJob.if === "string", `${label}: trusted event gate is missing`);
  invariant(workflowJob.if.includes("workflow_dispatch"), `${label}: protected manual release gate is missing`);
  invariant(workflowJob.if.includes("gooby-v"), `${label}: release tag prefix gate is missing`);
  invariant(workflowJob.if.includes("github.ref_protected"), `${label}: release tags must be protected`);
}

const webFile = await loadWorkflow("gooby-web-ci.yml");
const iosFile = await loadWorkflow("gooby-ios.yml");
const web = mapping(parseWorkflowYaml(webFile.source, "gooby-web-ci.yml"), "web workflow");
const ios = mapping(parseWorkflowYaml(iosFile.source, "gooby-ios.yml"), "iOS workflow");
const packageJson = JSON.parse(await readFile(resolve(repository, "GOOBY/package.json"), "utf8"));

assertPathFilters(web, "web workflow");
assertPathFilters(ios, "iOS workflow");
assertPinnedActions(webFile.source, "gooby-web-ci.yml");
assertPinnedActions(iosFile.source, "gooby-ios.yml");

for (const script of ["root", "ui", "city", "bubble"]) {
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
  "npm run assets:audit",
  "npm run audit:asset-size",
  "npm run audit:no-network",
  "npm run build",
  "npm run audit:bundle",
  "npm run audit:production",
  "npm run audit:perf",
  "npm run ci:native-check",
  "npm run ci:workflow-check",
]) {
  hasRun(webJob, "web", command);
}
const perfAudit = namedStep(webJob, "web", "Audit adaptive quality and scene disposal");
invariant(
  mapping(perfAudit.env, "performance audit environment").GOOBY_ARTIFACTS === "playwright-report/perf-artifacts",
  "Performance audit artifacts must be included in the uploaded Playwright report",
);
assertActionlintInstall(webJob, "web");
const webUpload = steps(webJob, "web").find((step) => step.uses?.startsWith("actions/upload-artifact@"));
invariant(webUpload, "Web CI must upload an artifact");
const webUploadPath = mapping(webUpload.with, "web artifact options").path;
invariant(typeof webUploadPath === "string" && webUploadPath.includes("GOOBY/dist") && webUploadPath.includes("GOOBY/playwright-report"), "Web artifact must include dist and Playwright report");

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

const releaseGates = job(ios, "release-gates");
invariant(releaseGates["runs-on"] === "ubuntu-latest", "Protected release gates must not consume a macOS runner");
assertProtectedReleaseJob(releaseGates, "release-gates");
const gateStep = namedStep(releaseGates, "release-gates", "Evaluate protected secret availability");
const gateEnvironment = mapping(gateStep.env, "release-gates environment");
for (const secret of [
  "IOS_CERT_P12_BASE64",
  "IOS_CERT_PASSWORD",
  "IOS_PROVISIONING_PROFILE_BASE64",
  "APPLE_TEAM_ID",
  "ASC_API_KEY_ID",
  "ASC_API_ISSUER_ID",
  "ASC_API_KEY_P8_BASE64",
]) {
  invariant(typeof gateEnvironment[secret] === "string" && gateEnvironment[secret].includes(`secrets.${secret}`), `Protected release gates are missing ${secret}`);
}
invariant(mapping(releaseGates.outputs, "release-gates outputs").signed_ready?.includes("steps.gates.outputs.signed_ready"), "signed_ready protected output is missing");
invariant(mapping(releaseGates.outputs, "release-gates outputs").testflight_ready?.includes("steps.gates.outputs.testflight_ready"), "testflight_ready protected output is missing");

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

const signed = job(ios, "signed");
invariant(signed["runs-on"] === "macos-15", "Signed archive must run on macos-15");
assertProtectedReleaseJob(signed, "signed");
invariant(signed.if.includes("needs.release-gates.outputs.signed_ready == 'true'"), "Signed job must use protected signed_ready");
for (const command of ["npm ci", "npm run assets:audit", "npm run audit:no-network", "npm run build", "npx cap sync ios", "pod install", "xcodebuild archive"]) {
  hasRun(signed, "signed", command);
}
assertCommandBefore(signed, "signed", "npm run assets:audit", "xcodebuild archive");
assertCommandBefore(signed, "signed", "npm run audit:no-network", "xcodebuild archive");
invariant(
  runScripts(signed, "signed").some((run) =>
    run.includes('PROFILE_APP_ID" == "$APPLE_TEAM_ID.com.gooby.pet"')
    && run.includes('PROFILE_TEAM_ID" == "$APPLE_TEAM_ID"')),
  "Signed job must validate the profile bundle and team identifiers",
);
const signedCleanup = namedStep(signed, "signed", "Clean signing material");
invariant(signedCleanup.if === "always()", "Signed cleanup must always run");
invariant(signedCleanup.run.includes("security delete-keychain") && signedCleanup.run.includes("Provisioning Profiles"), "Signed cleanup must remove keychain and profile");

const pushTags = sequence(mapping(mapping(ios.on, "iOS triggers").push, "iOS push trigger").tags, "iOS tags");
invariant(pushTags.includes("gooby-v*"), "TestFlight tag trigger must be gooby-v*");
const testflight = job(ios, "testflight");
invariant(testflight["runs-on"] === "macos-15", "TestFlight release must run on macos-15");
assertProtectedReleaseJob(testflight, "testflight");
invariant(testflight.if.includes("needs.release-gates.outputs.testflight_ready == 'true'"), "TestFlight job must use protected testflight_ready");
invariant(testflight.if.includes("inputs.release_to_testflight == true"), "Manual TestFlight uploads must be explicit");
invariant(testflight.if.includes("inputs.marketing_version != ''"), "Manual TestFlight uploads require a version");
for (const command of ["npm ci", "npm run assets:audit", "npm run audit:no-network", "npm run build", "npx cap sync ios", "pod install", "xcodebuild archive", "xcodebuild -exportArchive", "xcrun altool --upload-app"]) {
  hasRun(testflight, "testflight", command);
}
assertCommandBefore(testflight, "testflight", "npm run assets:audit", "xcodebuild archive");
assertCommandBefore(testflight, "testflight", "npm run audit:no-network", "xcodebuild archive");
invariant(
  runScripts(testflight, "testflight").some((run) =>
    run.includes('PROFILE_APP_ID" == "$APPLE_TEAM_ID.com.gooby.pet"')
    && run.includes('PROFILE_TEAM_ID" == "$APPLE_TEAM_ID"')),
  "TestFlight job must validate the profile bundle and team identifiers",
);
const uploadStep = namedStep(testflight, "testflight", "Upload to TestFlight");
const uploadEnvironment = mapping(uploadStep.env, "TestFlight upload environment");
for (const secret of ["ASC_API_KEY_ID", "ASC_API_ISSUER_ID", "ASC_API_KEY_P8_BASE64"]) {
  invariant(typeof uploadEnvironment[secret] === "string" && uploadEnvironment[secret].includes(`secrets.${secret}`), `TestFlight upload is missing ${secret}`);
}
const testflightCleanup = namedStep(testflight, "testflight", "Clean signing and App Store Connect material");
invariant(testflightCleanup.if === "always()", "TestFlight cleanup must always run");
invariant(testflightCleanup.run.includes("security delete-keychain") && testflightCleanup.run.includes("gooby-asc-key-path"), "TestFlight cleanup must remove signing and API material");

for (const workflowJobName of ["preflight", "release-gates", "unsigned", "signed", "testflight"]) {
  for (const run of runScripts(job(ios, workflowJobName), workflowJobName)) {
    invariant(!run.includes("${{ secrets."), `${workflowJobName}: secrets must enter scripts through masked environment variables`);
  }
}

const actionlint = spawnSync("actionlint", [webFile.path, iosFile.path], { encoding: "utf8" });
invariant(actionlint.error?.code !== "ENOENT", "actionlint is required but was not found on PATH");
invariant(actionlint.status === 0, `actionlint failed:\n${actionlint.stdout}${actionlint.stderr}`);
console.log("actionlint passed.");
console.log("Workflow check passed: pinned actions, complete web gates, zero-secret unsigned builds, protected releases, audits, and cleanup.");
