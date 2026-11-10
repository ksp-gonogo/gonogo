/**
 * On a touch screen the cluster opens by tapping the dashboard controls toggle,
 * shows every name once open and closes on a second tap, on a tap outside or
 * after a button is chosen. A mouse screen keeps the names tucked away until
 * the cluster is hovered or focused.
 */

import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import { dashboardWithWidget, expect, seedContext } from "./helpers";

/** The cluster's own label span; opacity 0 still counts as visible to Playwright, so the tests read the opacity. */
const settingsLabel = (page: Page) =>
  page.locator('span[aria-hidden="true"]', { hasText: /^Settings/ });

test.describe("fab cluster names", () => {
  test("a touch screen opens the names with the toggle and closes them again", async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "firefox",
      "Firefox has no isMobile emulation",
    );
    const context = await browser.newContext({
      viewport: { width: 820, height: 1180 },
      hasTouch: true,
      isMobile: true,
    });
    await seedContext(
      context,
      "gonogo:dashboard:main",
      dashboardWithWidget("orbit-view"),
    );
    const page = await context.newPage();
    await page.goto("/?uplinkLoaderIds=");

    const toggle = page.getByRole("button", { name: "Dashboard controls" });
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(settingsLabel(page)).toHaveCSS("opacity", "0");

    await toggle.tap();
    await expect(settingsLabel(page)).toHaveCSS("opacity", "1");
    await expect(page.getByRole("button", { name: /^Settings/ })).toHaveCSS(
      "pointer-events",
      "auto",
    );

    await toggle.tap();
    await expect(settingsLabel(page)).toHaveCSS("opacity", "0");
    await context.close();
  });

  test("a mouse screen keeps the names hidden until the cluster is hovered", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await seedContext(
      context,
      "gonogo:dashboard:main",
      dashboardWithWidget("orbit-view"),
    );
    const page = await context.newPage();
    await page.goto("/?uplinkLoaderIds=");

    const toggle = page.getByRole("button", { name: "Dashboard controls" });
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(settingsLabel(page)).toHaveCSS("opacity", "0");

    await toggle.hover();
    await expect(settingsLabel(page)).toHaveCSS("opacity", "1");
    await context.close();
  });
});
