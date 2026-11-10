/**
 * A station asks to join while the Add station panel is open: Approve and
 * Refuse answer with a real pointer click, because the modal's overlay covers
 * everything outside the dialog.
 */

import { test } from "@playwright/test";
import { dashboardWithWidget, expect, seedContext } from "./helpers";

async function ask(page: import("@playwright/test").Page, name: string) {
  await page.evaluate((stationName) => {
    const host = (
      window as unknown as {
        peerHostService: { setPending(n: unknown[]): void };
      }
    ).peerHostService;
    host.setPending([{ peerId: `p-${stationName}`, name: stationName }]);
  }, name);
}

test.describe("station approval with the Add station panel open", () => {
  test("Approve and Refuse take a click", async ({ browser }, info) => {
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
    await toggle.hover();
    await page.getByRole("button", { name: "Add station" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });

    await ask(page, "Flight");
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `.renders/station-approve-1209/${process.env.RENDER_TAG ?? "after"}-${info.project.name}.png`,
    });
    const approve = dialog.getByRole("button", {
      name: "Approve station Flight",
    });
    await expect(approve).toBeVisible();
    await approve.click({ timeout: 5_000 });
    await expect(approve).toHaveCount(0);

    await ask(page, "Capcom");
    await dialog
      .getByRole("button", { name: "Refuse station Capcom" })
      .click({ timeout: 5_000 });
    await expect(
      dialog.getByRole("button", { name: "Refuse station Capcom" }),
    ).toHaveCount(0);
    await context.close();
  });
});
