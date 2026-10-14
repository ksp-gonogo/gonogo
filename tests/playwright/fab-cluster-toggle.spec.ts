/**
 * The FAB cluster opens by click and by keyboard, not only by hover: the
 * toggle is a real button that holds the cluster open, Escape closes it and
 * returns focus, and the toggle itself no longer opens the widget picker.
 */

import { test } from "@playwright/test";
import { dashboardWithWidget, expect, seedContext } from "./helpers";

async function openMain(browser: import("@playwright/test").Browser) {
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
  return { context, page };
}

test.describe("fab cluster toggle", () => {
  test("a click holds the cluster open without hover, and does not open the widget picker", async ({
    browser,
  }) => {
    const { context, page } = await openMain(browser);
    const toggle = page.getByRole("button", { name: "Dashboard controls" });
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await page.mouse.move(10, 10);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const layouts = page.getByRole("button", { name: "Dashboard layouts" });
    await expect(layouts).toHaveCSS("pointer-events", "auto");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Add component" }).click();
    await expect(
      page.getByRole("dialog", { name: "Add a component" }),
    ).toBeVisible();
    await context.close();
  });

  test("Add component is the button nearest the toggle and follows it in tab order", async ({
    browser,
  }) => {
    const { context, page } = await openMain(browser);
    const toggle = page.getByRole("button", { name: "Dashboard controls" });
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await toggle.click();
    await page.mouse.move(10, 10);

    const toggleBox = await toggle.boundingBox();
    const addBox = await page
      .getByRole("button", { name: "Add component" })
      .boundingBox();
    const layoutsBox = await page
      .getByRole("button", { name: "Dashboard layouts" })
      .boundingBox();
    expect(toggleBox && addBox && layoutsBox).toBeTruthy();
    expect(addBox!.y).toBeLessThan(toggleBox!.y);
    expect(toggleBox!.y - addBox!.y).toBeLessThan(80);
    expect(addBox!.y).toBeGreaterThan(layoutsBox!.y);

    await toggle.focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Add component" }),
    ).toBeFocused();
    await context.close();
  });

  test("the keyboard opens it with Enter and Escape closes it, returning focus", async ({
    browser,
  }) => {
    const { context, page } = await openMain(browser);
    const toggle = page.getByRole("button", { name: "Dashboard controls" });
    await expect(toggle).toBeVisible({ timeout: 30_000 });

    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Tab does not reach buttons in WebKit by default, so the next control is focused directly.
    const add = page.getByRole("button", { name: "Add component" });
    await add.focus();
    await expect(add).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await context.close();
  });
});
