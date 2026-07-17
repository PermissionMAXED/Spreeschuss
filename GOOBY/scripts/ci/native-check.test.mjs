import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCanonicalProductMetadata,
  assertSleepNotificationIntegration,
} from "./native-check.mjs";

const PRODUCT_TITLE = "Gooby’s Cozy Burrow";

function notificationIntegration(overrides = {}) {
  return {
    platformContract: `
      export interface NotificationRequest {
        readonly id: number;
        readonly title: string;
        readonly body: string;
        readonly at: number;
        readonly policy?: NotificationPolicy;
      }
    `,
    notificationPolicy: `
      export function createSleepCompletionNotification(
        completesAt: number,
        policy: NotificationPolicy,
      ): NotificationRequest {
        return {
          id: SLEEP_NOTIFICATION_ID,
          title: "Gooby is rested!",
          body: "Your fluffy friend is awake and ready to play.",
          at: completesAt,
          policy,
        };
      }
    `,
    app: `
      import { createSleepCompletionNotification } from "./notification-policy";

      export class GoobyApp {
        private scheduleSleepCompletionNotification(completesAt: number): void {
          void this.platform.notifications.schedule(
            createSleepCompletionNotification(
              completesAt,
              this.requireState().notificationPolicy,
            ),
          );
        }

        private startSleep(sleep: { completesAt: number }): void {
          this.scheduleSleepCompletionNotification(sleep.completesAt);
        }
      }
    `,
    nativeAdapter: `
      export class NativeNotificationsAdapter {
        async schedule(request: NotificationRequest): Promise<void> {
          if (shouldSuppressNotification(request.policy, this.isForeground)) return;
          const at = nextAllowedNotificationTime(
            request.at,
            request.policy?.quietHours ?? null,
          );
          await this.notifications.schedule({
            notifications: [{
              id: request.id,
              title: request.title,
              body: request.body,
              schedule: { at: new Date(at) },
            }],
          });
        }
      }
    `,
    ...overrides,
  };
}

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

test("sleep notification fixture preserves the policy-aware native schedule contract", () => {
  assert.doesNotThrow(() => assertSleepNotificationIntegration(notificationIntegration()));
});

test("sleep notification fixture fails when App bypasses the request helper", () => {
  const fixture = notificationIntegration();
  fixture.app = fixture.app.replace(
    /createSleepCompletionNotification\([\s\S]*?this\.requireState\(\)\.notificationPolicy,\s*\)/u,
    `{
      id: 301,
      title: "Gooby is rested!",
      body: "Your fluffy friend is awake and ready to play.",
      at: completesAt,
      policy: this.requireState().notificationPolicy,
    }`,
  );
  assert.throws(
    () => assertSleepNotificationIntegration(fixture),
    /must schedule sleep completion through createSleepCompletionNotification/u,
  );
});

test("sleep notification fixture fails when the helper loses the completion timestamp", () => {
  const fixture = notificationIntegration();
  fixture.notificationPolicy = fixture.notificationPolicy.replace(
    "at: completesAt,",
    "at: policy.quietHours?.endHour ?? 0,",
  );
  assert.throws(
    () => assertSleepNotificationIntegration(fixture),
    /must preserve the exact completion timestamp as request\.at/u,
  );
});

test("sleep notification fixture fails without the canonical App policy", () => {
  const fixture = notificationIntegration();
  fixture.app = fixture.app.replace(
    "this.requireState().notificationPolicy,",
    "{ quietHours: null, suppressWhenForeground: false },",
  );
  assert.throws(
    () => assertSleepNotificationIntegration(fixture),
    /must pass requireState\(\)\.notificationPolicy/u,
  );
});

test("sleep notification fixture fails when native quiet-hours handling is removed", () => {
  const fixture = notificationIntegration();
  fixture.nativeAdapter = fixture.nativeAdapter.replace(
    "request.policy?.quietHours ?? null,",
    "null,",
  );
  assert.throws(
    () => assertSleepNotificationIntegration(fixture),
    /must apply request\.policy quiet hours to request\.at/u,
  );
});

test("sleep notification fixture rejects unsupported native plugin fields", () => {
  const fixture = notificationIntegration();
  fixture.nativeAdapter = fixture.nativeAdapter.replace(
    "body: request.body,",
    "body: request.body,\n              policy: request.policy,",
  );
  assert.throws(
    () => assertSleepNotificationIntegration(fixture),
    /plugin payload must contain exactly: body, id, schedule, title/u,
  );
});
