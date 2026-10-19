/**
 * Saving over a dashboard layout and loading it back must leave every widget
 * where it was on screen, and the saved copy must not follow later drags.
 */
import type { Page } from "@playwright/test";
import { test } from "@playwright/test";
import { expect, seedContext } from "./helpers";

const A = "widget-orbit-view";
const B = "widget-ground-track";
const C = "widget-crew-status";

const ITEMS = [
  { i: A, componentId: "orbit-view" },
  { i: B, componentId: "ground-track" },
  { i: C, componentId: "crew-status" },
];

const tile = (i: string, x: number, y: number, w: number, h: number) => ({
  i,
  x,
  y,
  w,
  h,
  moved: false,
  static: false,
});

/** A layout with a gap above and beside tiles, the shape a hand-arranged dashboard ends up in. */
const SCREEN_LAYOUT = [
  tile(A, 0, 0, 12, 8),
  tile(B, 14, 3, 10, 8),
  tile(C, 4, 14, 9, 6),
];

const OLD_PROFILE = {
  id: "p1",
  name: "Orbit",
  screen: "main",
  items: ITEMS,
  layout: [tile(A, 0, 0, 6, 6), tile(B, 6, 0, 6, 6), tile(C, 12, 0, 6, 6)],
  updatedAt: 1,
};

async function seed(
  browser: Parameters<Parameters<typeof test>[2]>[0]["browser"],
  profiles: unknown[],
  profileOpts: { autoSwitch?: boolean } = {},
) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  await seedContext(context, "gonogo:dashboard:main", {
    items: ITEMS,
    layout: SCREEN_LAYOUT,
  });
  await context.addInitScript(
    ({ profiles, opts }) => {
      try {
        localStorage.setItem(
          "gonogo.missionProfiles.main",
          JSON.stringify(profiles.map((p) => ({ ...(p as object), ...opts }))),
        );
      } catch {
        /* ignore */
      }
    },
    { profiles, opts: profileOpts },
  );
  return context;
}

/** Where each tile sits in the grid, in grid cells, read from the DOM. */
async function cells(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector(".dashboard-grid") as HTMLElement;
    const width = grid.getBoundingClientRect().width;
    const colPitch = (width + 20) / 36;
    const out: Record<string, { x: number; y: number }> = {};
    for (const el of Array.from(
      grid.querySelectorAll<HTMLElement>(":scope > [data-i]"),
    )) {
      const r = el.getBoundingClientRect();
      const g = grid.getBoundingClientRect();
      out[el.dataset.i as string] = {
        x: Math.round((r.left - g.left) / colPitch),
        y: Math.round(r.top - g.top),
      };
    }
    return out;
  });
}

async function openLayouts(page: Page) {
  await page.getByRole("button", { name: "Dashboard controls" }).click();
  await page.mouse.move(10, 10);
  await page.getByRole("button", { name: "Dashboard layouts" }).click();
}

test.describe("dashboard layouts", () => {
  test("overwriting a saved layout and loading it back keeps every tile where it was", async ({
    browser,
  }) => {
    const context = await seed(browser, [OLD_PROFILE]);
    const page = await context.newPage();
    await page.goto("/?uplinkLoaderIds=");
    await expect(page.locator(".dashboard-grid > [data-i]")).toHaveCount(3, {
      timeout: 30_000,
    });
    await page.waitForTimeout(500);
    const before = await cells(page);

    await openLayouts(page);
    await page.getByRole("button", { name: "Overwrite" }).click();
    await page.getByRole("button", { name: "Load", exact: true }).click();
    await page.getByRole("button", { name: "Confirm load" }).click();
    await page.waitForTimeout(500);

    expect(await cells(page)).toEqual(before);
  });

  test("dragging a tile after overwriting a layout does not change the saved copy", async ({
    browser,
  }) => {
    const context = await seed(browser, [OLD_PROFILE]);
    const page = await context.newPage();
    await page.goto("/?uplinkLoaderIds=");
    await expect(page.locator(".dashboard-grid > [data-i]")).toHaveCount(3, {
      timeout: 30_000,
    });
    await page.waitForTimeout(500);
    const before = await cells(page);

    await openLayouts(page);
    await page.getByRole("button", { name: "Overwrite" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const tileA = page.locator(`.dashboard-grid > [data-i="${A}"]`);
    await tileA.hover();
    const grab = await tileA.locator(".drag-handle").boundingBox();
    if (!grab) throw new Error("no drag handle");
    await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
    await page.mouse.down();
    await page.mouse.move(grab.x + 300, grab.y + 400, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await cells(page)).not.toEqual(before);

    await openLayouts(page);
    await page.getByRole("button", { name: "Load", exact: true }).click();
    await page.getByRole("button", { name: "Confirm load" }).click();
    await page.waitForTimeout(500);

    expect(await cells(page)).toEqual(before);
  });
});
