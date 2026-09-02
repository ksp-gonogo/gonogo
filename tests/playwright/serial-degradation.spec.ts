/**
 * Graceful-degradation coverage for Web Serial.
 *
 * In Firefox/WebKit `navigator.serial` does not exist at all, the app must
 * render `WebSerialBanner` (packages/serial/src/SerialDevicesMenu/index.tsx)
 * rather than throw. Serial device management now lives inside the Settings
 * modal's "Devices" tab (the standalone joystick FAB was retired when
 * settings were folded into one tabbed modal; see SettingsFab.tsx), so this
 * opens Settings → Devices the same way data-source-status.spec.ts opens
 * Settings → Data Sources, and asserts the unsupported-browser banner text
 * that `getWebSerialSupport()` actually renders.
 *
 * Skipped in Chromium, where Web Serial is present and the banner never
 * renders, that engine is covered by the (currently nonexistent) real
 * Web Serial specs, which would be tagged `@chromium-only`.
 */
import { expect, test } from "@playwright/test";

const MAIN_URL = "/";

test.describe("Serial devices: graceful degradation", () => {
  test("Devices tab shows the unsupported-browser banner instead of throwing", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName === "chromium", "Web Serial is present in chromium");

    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await context.addInitScript(() => {
      try {
        // Pre-answer analytics consent so the blocking boot modal doesn't
        // sit over the screen and intercept the FAB click.
        localStorage.setItem("gonogo.analytics.consent", "disabled");
        // The first-run setup host auto-opens the Settings modal on a fresh
        // browser (own component coverage in FirstRunSetupHost.test.tsx):
        // mark it already-seen so it doesn't
        // race the manual Settings-FAB open this spec drives below.
        localStorage.setItem("gonogo.uplinkHubWizard.firstRunSeen", "1");
      } catch {
        /* private mode / quota: ignore; the seed just won't apply */
      }
    });

    // Empty `?uplinkLoaderIds=` → loader loads nothing, no consent modal.
    await page.goto(`${MAIN_URL}?uplinkLoaderIds=`);

    // Open Settings from the FAB. Secondary FABs are hidden
    // (pointer-events:none) until the cluster is active; focusing the button
    // fires the cluster's onFocus to reveal it, then the click opens the
    // modal. The aria-label gains a " (something needs attention)" suffix
    // when a source is legitimately down in this env, so match on the
    // stable "Settings" prefix.
    const fab = page.getByRole("button", { name: /^Settings/ });
    await expect(fab).toBeAttached({ timeout: 30_000 });
    await fab.focus();
    await fab.click();

    await page.getByRole("tab", { name: "Devices" }).click();

    // getWebSerialSupport() returns reason "unsupported-browser" here (the
    // page is served over http://localhost, a secure context, so it isn't
    // the "insecure-context" branch): this is the exact string
    // WebSerialBanner renders for that reason.
    await expect(
      page.getByText(/web serial is not available in this browser/i),
    ).toBeVisible({ timeout: 10_000 });

    // Ignore a camera sidecar probe: the main screen eagerly connects every
    // registered data source on boot (MainScreen.tsx), and a camera source
    // has no sidecar to reach in CI, so the probe fails on every spec and
    // every engine. WebKit is simply the one engine that surfaces the
    // resulting network rejection as a page-level error instead of
    // swallowing it silently. The Uplink that registers that source now
    // lives outside this repo and this spec loads no Uplinks, so the filter
    // should be inert: it stays because it costs nothing and the failure it
    // absorbs is a boot-order fact rather than anything Serial does. Real
    // regressions in the Serial degradation path show up as a *different*
    // message, so filter this one known signature out rather than assert on
    // a strictly empty array.
    const unexpectedErrors = pageErrors.filter(
      (msg) => !/:8088\/offer/.test(msg),
    );
    expect(unexpectedErrors).toEqual([]);
  });
});
