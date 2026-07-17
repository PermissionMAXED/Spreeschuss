import assert from "node:assert/strict";
import test from "node:test";
import { assertCanonicalProductMetadata } from "./native-check.mjs";

const PRODUCT_TITLE = "Gooby’s Cozy Burrow";

function metadata(overrides = {}) {
  return {
    config: {
      appId: "com.gooby.pet",
      appName: PRODUCT_TITLE,
    },
    info: {
      CFBundleDisplayName: PRODUCT_TITLE,
      CFBundleName: PRODUCT_TITLE,
    },
    target: {
      productName: "App",
      productType: "com.apple.product-type.application",
    },
    configurations: [
      {
        name: "Debug",
        settings: {
          INFOPLIST_FILE: "App/Info.plist",
          PRODUCT_BUNDLE_IDENTIFIER: "com.gooby.pet",
        },
      },
      {
        name: "Release",
        settings: {
          INFOPLIST_FILE: "App/Info.plist",
          PRODUCT_BUNDLE_IDENTIFIER: "com.gooby.pet",
        },
      },
    ],
    nativeDocumentation: `The bundle identifier is \`com.gooby.pet\`, the display name is \`${PRODUCT_TITLE}\`, and dist is copied during sync.`,
    ...overrides,
  };
}

test("Capacitor supplies the canonical product title without a checker constant", () => {
  const futureTitle = "A Future Cozy Title";
  assert.equal(assertCanonicalProductMetadata(metadata({
    config: { appId: "com.gooby.pet", appName: futureTitle },
    info: {
      CFBundleDisplayName: futureTitle,
      CFBundleName: futureTitle,
    },
    nativeDocumentation: `The bundle identifier is \`com.gooby.pet\`, the display name is \`${futureTitle}\`, and dist is copied during sync.`,
  })), futureTitle);
});

test("stale legacy bundle title fails against the canonical release title", () => {
  assert.throws(
    () => assertCanonicalProductMetadata(metadata({
      info: {
        CFBundleDisplayName: "Gooby",
        CFBundleName: "Gooby",
      },
    })),
    /CFBundleDisplayName must match Capacitor appName "Gooby’s Cozy Burrow"/u,
  );
});

test("stale documented display title fails while character naming stays independent", () => {
  assert.throws(
    () => assertCanonicalProductMetadata(metadata({
      nativeDocumentation: "The bundle identifier is `com.gooby.pet`, the display name is Gooby, and dist is copied during sync.",
    })),
    /ios\/README\.md display name "Gooby" must match Capacitor appName "Gooby’s Cozy Burrow"/u,
  );
});

test("Xcode cannot select or generate competing bundle-title metadata", () => {
  assert.throws(
    () => assertCanonicalProductMetadata(metadata({
      configurations: [{
        name: "Release",
        settings: {
          GENERATE_INFOPLIST_FILE: "YES",
          INFOPLIST_FILE: "App/Info.plist",
        },
      }],
    })),
    /Release must not generate a competing Info\.plist/u,
  );
});

test("stale Xcode bundle-title overrides fail against Capacitor", () => {
  assert.throws(
    () => assertCanonicalProductMetadata(metadata({
      configurations: [{
        name: "Release",
        settings: {
          INFOPLIST_FILE: "App/Info.plist",
          INFOPLIST_KEY_CFBundleDisplayName: "Gooby",
        },
      }],
    })),
    /Release INFOPLIST_KEY_CFBundleDisplayName must not override the canonical product title/u,
  );
});
