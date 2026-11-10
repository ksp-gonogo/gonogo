/**
 * The FAB tower sits above the dashboard grid. Its secondaries are collapsed
 * (pointer-events: none) until the cluster is hovered, so the tower is
 * reached through the dashboard controls toggle, and once open the topmost element at each
 * secondary's centre must be that secondary rather than a grid item.
 */

import { test } from "@playwright/test";
import { dashboardWithWidget, expect, seedContext } from "./helpers";

test.describe("fab tower over the dashboard grid", () => {
  test("Invite is topmost and clickable once the cluster is open, with widgets under it", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    await seedContext(
      context,
      "gonogo:dashboard:main",
      dashboardWithWidget("orbit-view", { size: { w: 12, h: 6 } }),
    );
    const page = await context.newPage();
    await page.goto("/?uplinkLoaderIds=");

    const toggle = page.getByRole("button", { name: "Menu" });
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".react-grid-item").first()).toBeVisible();

    const station = page.getByRole("button", { name: "Invite" });
    await expect(station).toHaveCSS("pointer-events", "none");

    await toggle.hover();
    await expect(station).toHaveCSS("pointer-events", "auto");
    const topmost = await station.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return hit === el || el.contains(hit);
    });
    expect(topmost).toBe(true);

    await station.click();
    const invite = page.getByRole("dialog", { name: "Invite" });
    await expect(invite.getByRole("link", { name: /\/join\?/ })).toBeVisible();
    await expect(
      invite.locator("svg", {
        has: page.locator("title", { hasText: "QR code for the join address" }),
      }),
    ).toBeVisible();
    await expect(invite.getByLabel(/^Join code /)).toBeVisible();
    await context.close();
  });
});
