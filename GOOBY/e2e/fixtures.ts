import {
  expect,
  test as base,
  type ConsoleMessage,
  type Page,
} from "@playwright/test";

const APP_ORIGIN = "http://127.0.0.1:4519";

export interface AppDiagnostics {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly externalRequests: string[];
}

export const test = base.extend<{ appDiagnostics: AppDiagnostics }>({
  appDiagnostics: async ({ page }, use, testInfo) => {
    const diagnostics: AppDiagnostics = {
      consoleErrors: [],
      pageErrors: [],
      externalRequests: [],
    };
    const onConsole = (message: ConsoleMessage): void => {
      if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
    };
    const onPageError = (error: Error): void => {
      diagnostics.pageErrors.push(error.stack ?? error.message);
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    await page.routeWebSocket(/.*/u, (socket) => {
      const url = new URL(socket.url());
      if (url.origin !== APP_ORIGIN) diagnostics.externalRequests.push(url.href);
      // Keeping Vite's local HMR socket mocked prevents unrelated parallel source edits
      // from reloading a browser in the middle of an interaction.
    });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== APP_ORIGIN) {
        diagnostics.externalRequests.push(url.href);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    await use(diagnostics);

    if (
      testInfo.status !== testInfo.expectedStatus
      || diagnostics.consoleErrors.length > 0
      || diagnostics.pageErrors.length > 0
      || diagnostics.externalRequests.length > 0
    ) {
      await testInfo.attach("app-diagnostics", {
        body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
        contentType: "application/json",
      });
    }
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  },
});

test.afterEach(({ appDiagnostics }) => {
  expect(appDiagnostics.externalRequests, "the offline app requested an external URL").toEqual([]);
  expect(appDiagnostics.pageErrors, "the page emitted an uncaught error").toEqual([]);
  expect(appDiagnostics.consoleErrors, "the app logged a console error").toEqual([]);
});

export { expect, type Page };
