/**
 * The names behind the + control must be readable on a touch screen, where
 * there is no hover to open the cluster. A mouse screen keeps them tucked away
 * until the cluster is hovered or focused.
 */

import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import { dashboardWithWidget, expect, seedContext } from "./helpers";

/** The cluster's own label span; opacity 0 still counts as visible to Playwright, so the tests read the opacity. */
const settingsLabel = (page: Page) =>
  page.locator('span[aria-hidden="true"]', { hasText: /^Settings/ });

test.describe("fab cluster names", () => {
  test("a touch screen shows every name without any gesture", async ({
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
      dashboardWithWidget("current-orbit"),
    );
    const page = await context.newPage();
    await page.goto("/?uplinkLoaderIds=");

    await expect(settingsLabel(page)).toHaveCSS("opacity", "1", {
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: /^Settings/ })).toHaveCSS(
      "pointer-events",
      "auto",
    );
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
      dashboardWithWidget("current-orbit"),
    );
    const page = await context.newPage();
    await page.goto("/?uplinkLoaderIds=");

    const add = page.getByRole("button", { name: "Add component" });
    await expect(add).toBeVisible({ timeout: 30_000 });
    await expect(settingsLabel(page)).toHaveCSS("opacity", "0");

    await add.hover();
    await expect(settingsLabel(page)).toHaveCSS("opacity", "1");
    await context.close();
  });
});
