import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function text(path) {
  return readFile(resolve(root, path), "utf8");
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function parsePlist(source, label) {
  const tokens = [...source.matchAll(/<[^>]+>|[^<]+/gu)]
    .map(([token]) => token.trim())
    .filter((token) => token && !token.startsWith("<?") && !token.startsWith("<!"));
  let cursor = 0;

  function take(expected) {
    const token = tokens[cursor];
    invariant(token === expected, `${label}: expected ${expected}, received ${token ?? "end of file"}`);
    cursor += 1;
  }

  function parseValue() {
    const token = tokens[cursor];
    invariant(token !== undefined, `${label}: unexpected end of plist`);
    cursor += 1;
    if (token === "<dict/>") return {};
    if (token === "<array/>") return [];
    if (token === "<true/>") return true;
    if (token === "<false/>") return false;
    if (token === "<dict>") {
      const result = {};
      while (tokens[cursor] !== "</dict>") {
        take("<key>");
        const key = decodeXml(tokens[cursor] ?? "");
        cursor += 1;
        take("</key>");
        invariant(!(key in result), `${label}: duplicate dictionary key ${key}`);
        result[key] = parseValue();
      }
      take("</dict>");
      return result;
    }
    if (token === "<array>") {
      const result = [];
      while (tokens[cursor] !== "</array>") result.push(parseValue());
      take("</array>");
      return result;
    }
    const match = /^<(string|integer|real|date|data)>$/u.exec(token);
    invariant(match, `${label}: unsupported plist token ${token}`);
    const kind = match[1];
    const raw = decodeXml(tokens[cursor] ?? "");
    cursor += 1;
    take(`</${kind}>`);
    if (kind === "integer" || kind === "real") {
      const number = Number(raw);
      invariant(Number.isFinite(number), `${label}: invalid ${kind} value`);
      return number;
    }
    return raw;
  }

  take('<plist version="1.0">');
  const result = parseValue();
  take("</plist>");
  invariant(cursor === tokens.length, `${label}: unparsed plist content`);
  return result;
}

function parseOpenStep(source, label) {
  const input = source
    .replace(/^\/\/.*$/gmu, "")
    .replace(/\/\*[\s\S]*?\*\//gu, "");
  let cursor = 0;

  function skipSpace() {
    while (/\s/u.test(input[cursor] ?? "")) cursor += 1;
  }

  function token() {
    skipSpace();
    const character = input[cursor];
    invariant(character !== undefined, `${label}: unexpected end of file`);
    if ("{}()=;,".includes(character)) {
      cursor += 1;
      return character;
    }
    if (character === '"') {
      cursor += 1;
      let value = "";
      while (input[cursor] !== '"') {
        const next = input[cursor];
        invariant(next !== undefined, `${label}: unterminated quoted string`);
        cursor += 1;
        if (next === "\\") {
          const escaped = input[cursor];
          invariant(escaped !== undefined, `${label}: unterminated escape`);
          cursor += 1;
          value += escaped === "n" ? "\n" : escaped;
        } else {
          value += next;
        }
      }
      cursor += 1;
      return value;
    }
    const start = cursor;
    while (input[cursor] !== undefined && !/\s/u.test(input[cursor]) && !"{}()=;,".includes(input[cursor])) {
      cursor += 1;
    }
    invariant(cursor > start, `${label}: invalid token at offset ${cursor}`);
    return input.slice(start, cursor);
  }

  function value(first = token()) {
    if (first === "{") {
      const result = {};
      let next = token();
      while (next !== "}") {
        const key = next;
        invariant(token() === "=", `${label}: expected '=' after ${key}`);
        invariant(!(key in result), `${label}: duplicate dictionary key ${key}`);
        result[key] = value();
        invariant(token() === ";", `${label}: expected ';' after ${key}`);
        next = token();
      }
      return result;
    }
    if (first === "(") {
      const result = [];
      let next = token();
      while (next !== ")") {
        result.push(value(next));
        next = token();
        if (next === ",") next = token();
      }
      return result;
    }
    return first;
  }

  const result = value();
  skipSpace();
  invariant(cursor === input.length, `${label}: unparsed content at offset ${cursor}`);
  return result;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  throw new Error("capacitor.config.ts: unsupported property name");
}

function evaluateTsLiteral(node) {
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(evaluateTsLiteral);
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.map((property) => {
      invariant(ts.isPropertyAssignment(property), "capacitor.config.ts: only literal properties are allowed");
      return [propertyName(property.name), evaluateTsLiteral(property.initializer)];
    }));
  }
  throw new Error(`capacitor.config.ts: unsupported value ${ts.SyntaxKind[node.kind]}`);
}

function parseCapacitorConfig(source) {
  const file = ts.createSourceFile("capacitor.config.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "config" && declaration.initializer) {
        return evaluateTsLiteral(declaration.initializer);
      }
    }
  }
  throw new Error("capacitor.config.ts: config literal was not found");
}

async function pngMetadata(path) {
  const data = await readFile(resolve(root, path));
  invariant(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${path}: not a PNG`);
  invariant(data.toString("ascii", 12, 16) === "IHDR", `${path}: missing IHDR`);
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bitDepth: data[24],
    colorType: data[25],
  };
}

function asObject(value, label) {
  invariant(typeof value === "object" && value !== null && !Array.isArray(value), `${label}: expected object`);
  return value;
}

function documentedNativeMetadata(source) {
  const match = /bundle identifier is\s+`([^`\r\n]+)`\s*,\s*the display name is\s+(?:`([^`\r\n]+)`|([^,\r\n]+))/iu.exec(source);
  invariant(match, "ios/README.md must document the native bundle identifier and display name");
  return {
    appId: match[1],
    appName: (match[2] ?? match[3]).trim(),
  };
}

export function assertCanonicalProductMetadata({
  config,
  info,
  target,
  configurations,
  nativeDocumentation,
}) {
  invariant(
    typeof config.appName === "string"
      && config.appName.length > 0
      && config.appName === config.appName.trim()
      && config.appName === config.appName.normalize("NFC")
      && !/[\p{Cc}\p{Cf}]/u.test(config.appName),
    "Capacitor appName must be a non-empty, trimmed NFC product title without control characters",
  );
  const productTitle = config.appName;
  invariant(
    info.CFBundleDisplayName === productTitle,
    `Info.plist CFBundleDisplayName must match Capacitor appName "${productTitle}"`,
  );
  invariant(
    info.CFBundleName === productTitle,
    `Info.plist CFBundleName must match Capacitor appName "${productTitle}"`,
  );
  invariant(target.productType === "com.apple.product-type.application", "App target must produce an application bundle");
  invariant(target.productName === "App", "App target product name must remain App");
  for (const { name, settings } of configurations) {
    invariant(settings.INFOPLIST_FILE === "App/Info.plist", `${name} must use App/Info.plist`);
    invariant(settings.GENERATE_INFOPLIST_FILE !== "YES", `${name} must not generate a competing Info.plist`);
    for (const key of ["INFOPLIST_KEY_CFBundleDisplayName", "INFOPLIST_KEY_CFBundleName"]) {
      invariant(
        !(key in settings) || settings[key] === productTitle,
        `${name} ${key} must not override the canonical product title`,
      );
    }
  }
  const documented = documentedNativeMetadata(nativeDocumentation);
  invariant(
    documented.appId === config.appId,
    `ios/README.md bundle identifier "${documented.appId}" must match Capacitor appId "${config.appId}"`,
  );
  invariant(
    documented.appName === productTitle,
    `ios/README.md display name "${documented.appName}" must match Capacitor appName "${productTitle}"`,
  );
  return productTitle;
}

export async function runNativeCheck() {
const config = parseCapacitorConfig(await text("capacitor.config.ts"));
invariant(config.appId === "com.gooby.pet", "Capacitor appId must be com.gooby.pet");
invariant(config.webDir === "dist", "Capacitor webDir must be dist");
invariant(!("server" in config), "Capacitor config must not contain a server URL");

const info = asObject(parsePlist(await text("ios/App/App/Info.plist"), "Info.plist"), "Info.plist");
invariant(info.CFBundleIdentifier === "$(PRODUCT_BUNDLE_IDENTIFIER)", "Info.plist must use the Xcode bundle setting");
invariant(info.ITSAppUsesNonExemptEncryption === false, "Export-compliance encryption declaration must be false");
invariant(info.UIRequiresFullScreen === true, "Portrait-only iPad support requires full-screen mode");
for (const key of ["UISupportedInterfaceOrientations", "UISupportedInterfaceOrientations~ipad"]) {
  invariant(
    JSON.stringify(info[key]) === JSON.stringify(["UIInterfaceOrientationPortrait"]),
    `${key} must contain portrait only`,
  );
}
invariant(!("NSAppTransportSecurity" in info), "Info.plist must not contain ATS exceptions");

const privacy = asObject(
  parsePlist(await text("ios/App/App/PrivacyInfo.xcprivacy"), "PrivacyInfo.xcprivacy"),
  "PrivacyInfo.xcprivacy",
);
invariant(privacy.NSPrivacyTracking === false, "Privacy manifest must disable tracking");
invariant(Array.isArray(privacy.NSPrivacyTrackingDomains) && privacy.NSPrivacyTrackingDomains.length === 0, "Tracking domains must be empty");
invariant(Array.isArray(privacy.NSPrivacyCollectedDataTypes) && privacy.NSPrivacyCollectedDataTypes.length === 0, "Collected data types must be empty");
invariant(Array.isArray(privacy.NSPrivacyAccessedAPITypes) && privacy.NSPrivacyAccessedAPITypes.length === 1, "Only one required-reason API is expected");
const requiredApi = asObject(privacy.NSPrivacyAccessedAPITypes[0], "required-reason API");
invariant(requiredApi.NSPrivacyAccessedAPIType === "NSPrivacyAccessedAPICategoryUserDefaults", "Only UserDefaults may be declared");
invariant(JSON.stringify(requiredApi.NSPrivacyAccessedAPITypeReasons) === JSON.stringify(["CA92.1"]), "Preferences must use reason CA92.1");

const project = parseOpenStep(await text("ios/App/App.xcodeproj/project.pbxproj"), "project.pbxproj");
const objects = asObject(project.objects, "project objects");
const targetEntry = Object.entries(objects).find(([, value]) => {
  const object = asObject(value, "Xcode object");
  return object.isa === "PBXNativeTarget" && object.name === "App";
});
invariant(targetEntry, "App native target was not found");
const target = asObject(targetEntry[1], "App target");
const configurationList = asObject(objects[target.buildConfigurationList], "target configuration list");
invariant(Array.isArray(configurationList.buildConfigurations), "Target build configurations are missing");
const targetConfigurations = [];
for (const id of configurationList.buildConfigurations) {
  const configuration = asObject(objects[id], `build configuration ${id}`);
  const settings = asObject(configuration.buildSettings, `${configuration.name} build settings`);
  targetConfigurations.push({ name: configuration.name, settings });
  invariant(settings.PRODUCT_BUNDLE_IDENTIFIER === config.appId, `${configuration.name} bundle ID does not match Capacitor`);
  invariant(settings.TARGETED_DEVICE_FAMILY === "1,2", `${configuration.name} must target iPhone and iPad`);
}
const resources = target.buildPhases
  .map((id) => objects[id])
  .map((value) => asObject(value, "build phase"))
  .find((phase) => phase.isa === "PBXResourcesBuildPhase");
invariant(resources && Array.isArray(resources.files), "Resources build phase was not found");
const resourcePaths = resources.files.map((id) => {
  const buildFile = asObject(objects[id], `resource build file ${id}`);
  const reference = asObject(objects[buildFile.fileRef], `resource reference ${buildFile.fileRef}`);
  return reference.path;
});
invariant(resourcePaths.includes("PrivacyInfo.xcprivacy"), "PrivacyInfo.xcprivacy is not in the Resources phase");

const iconContents = JSON.parse(await text("ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json"));
const expectedIconSlots = new Map([
  ["ipad:20x20:1x", 20], ["iphone:20x20:2x", 40], ["ipad:20x20:2x", 40],
  ["iphone:20x20:3x", 60], ["ipad:29x29:1x", 29], ["iphone:29x29:2x", 58],
  ["ipad:29x29:2x", 58], ["iphone:29x29:3x", 87], ["ipad:40x40:1x", 40],
  ["iphone:40x40:2x", 80], ["ipad:40x40:2x", 80], ["iphone:40x40:3x", 120],
  ["iphone:60x60:2x", 120], ["iphone:60x60:3x", 180], ["ipad:76x76:1x", 76],
  ["ipad:76x76:2x", 152], ["ipad:83.5x83.5:2x", 167], ["ios-marketing:1024x1024:1x", 1024],
]);
invariant(Array.isArray(iconContents.images) && iconContents.images.length === expectedIconSlots.size, "App icon slot count is incomplete");
for (const image of iconContents.images) {
  const slot = `${image.idiom}:${image.size}:${image.scale}`;
  const expectedPixels = expectedIconSlots.get(slot);
  invariant(expectedPixels !== undefined, `Unexpected app icon slot ${slot}`);
  invariant(typeof image.filename === "string" && image.filename.length > 0, `${slot} has no file`);
  const metadata = await pngMetadata(`ios/App/App/Assets.xcassets/AppIcon.appiconset/${image.filename}`);
  invariant(metadata.width === expectedPixels && metadata.height === expectedPixels, `${image.filename} has incorrect dimensions`);
  invariant(metadata.bitDepth === 8 && metadata.colorType === 2, `${image.filename} must be opaque 8-bit RGB`);
  expectedIconSlots.delete(slot);
}
invariant(expectedIconSlots.size === 0, `Missing app icon slots: ${[...expectedIconSlots.keys()].join(", ")}`);

const splashContents = JSON.parse(await text("ios/App/App/Assets.xcassets/Splash.imageset/Contents.json"));
invariant(Array.isArray(splashContents.images) && splashContents.images.length === 3, "Splash must fill 1x, 2x, and 3x slots");
invariant(new Set(splashContents.images.map((image) => image.scale)).size === 3, "Splash scale slots must be unique");
for (const image of splashContents.images) {
  const metadata = await pngMetadata(`ios/App/App/Assets.xcassets/Splash.imageset/${image.filename}`);
  invariant(metadata.width === 2732 && metadata.height === 2732, `${image.filename} must be 2732 square`);
  invariant(metadata.bitDepth === 8 && metadata.colorType === 2, `${image.filename} must be opaque 8-bit RGB`);
}

const podfile = await text("ios/App/Podfile");
for (const pod of [
  "Capacitor",
  "CapacitorApp",
  "CapacitorHaptics",
  "CapacitorLocalNotifications",
  "CapacitorPreferences",
  "CapacitorSplashScreen",
  "CapacitorStatusBar",
]) {
  invariant(podfile.includes(`pod '${pod}'`), `Podfile is missing ${pod}`);
}
invariant(podfile.includes("use_frameworks!"), "CocoaPods framework integration is missing");

const packageJson = JSON.parse(await text("package.json"));
for (const dependency of [
  "@capacitor/app",
  "@capacitor/cli",
  "@capacitor/core",
  "@capacitor/haptics",
  "@capacitor/ios",
  "@capacitor/local-notifications",
  "@capacitor/preferences",
  "@capacitor/splash-screen",
  "@capacitor/status-bar",
]) {
  const range = packageJson.dependencies?.[dependency] ?? packageJson.devDependencies?.[dependency];
  invariant(typeof range === "string" && /^\^?8\./u.test(range), `${dependency} must remain on Capacitor 8`);
}
const foundationVersions = ["@capacitor/cli", "@capacitor/core", "@capacitor/ios"].map((dependency) => {
  const range = packageJson.dependencies?.[dependency] ?? packageJson.devDependencies?.[dependency];
  return range.replace(/^[~^]/u, "");
});
invariant(new Set(foundationVersions).size === 1, "Capacitor CLI, core, and iOS versions must be aligned");
const packageLock = JSON.parse(await text("package-lock.json"));
for (const [dependency, expectedVersion] of [
  ["@capacitor/cli", foundationVersions[0]],
  ["@capacitor/core", foundationVersions[0]],
  ["@capacitor/ios", foundationVersions[0]],
]) {
  invariant(
    packageLock.packages?.[`node_modules/${dependency}`]?.version === expectedVersion,
    `${dependency} lockfile version must match package.json`,
  );
}

const nativeAdapter = await text("src/platform/native/index.ts");
for (const contract of [
  "this.preferences.migrate()",
  "this.preferences.removeOld()",
  "schedule: { at: new Date(at) }",
  "this.permissionVersion !== version",
  "this.cancellationVersion += 1",
  "HapticsPort",
  '"appStateChange"',
  "handlers.onBackground()",
  "handlers.onForeground()",
]) {
  invariant(nativeAdapter.includes(contract), `Native adapter contract is missing: ${contract}`);
}
const app = await text("src/app/App.ts");
invariant(app.includes("at: sleep.completesAt"), "Sleep notification must use the exact completion timestamp");
invariant(
  app.match(/this\.cancelSleepNotification\(\)/gu)?.length === 3,
  "Sleep completion, early wake, and notification opt-out must cancel notifications",
);
invariant(
  /onForeground:\s*\(\)\s*=>\s*\{[^}]*this\.platform\.notifications\.setForeground\(true\);[^}]*this\.resumeSimulation\(\);[^}]*\}/u.test(app),
  "Native foregrounding must restore notification policy and run simulation catch-up",
);

const trackedArtifacts = execFileSync(
  "git",
  ["-C", resolve(root, ".."), "ls-files", "-z", "--", "GOOBY/ios/App/Pods/**", "GOOBY/ios/App/build/**", "GOOBY/ios/App/App/public/**"],
  { encoding: "utf8" },
);
invariant(trackedArtifacts.length === 0, "Pods, build output, and copied public assets must not be committed");

assertCanonicalProductMetadata({
  config,
  info,
  target,
  configurations: targetConfigurations,
  nativeDocumentation: await text("ios/README.md"),
});

console.log("Native check passed: Capacitor 8, CocoaPods, metadata, privacy, assets, adapters, and clean artifacts.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runNativeCheck();
}
