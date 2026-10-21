/**
 * Switching dashboard layouts must leave every widget where it was on screen,
 * a drag saves into the current layout only, and Undo puts the tile back.
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

const CURRENT_PROFILE = {
  id: "seeded",
  name: "Mine",
  screen: "main",
  items: ITEMS,
  layout: SCREEN_LAYOUT,
  updatedAt: 2,
};

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
) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  await seedContext(context, "gonogo:dashboard:main", {
    items: ITEMS,
    layout: SCREEN_LAYOUT,
  });
  await context.addInitScript((profiles) => {
    try {
      localStorage.setItem(
        "gonogo.missionProfiles.main",
        JSON.stringify(profiles),
      );
    } catch {
      /* ignore */
    }
  }, profiles);
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

async function switchToOther(page: Page) {
  await openLayouts(page);
  await page
    .getByRole("button", { name: "Switch to", disabled: false })
    .click();
  await page.waitForTimeout(500);
}

async function openSeeded(
  browser: Parameters<Parameters<typeof test>[2]>[0]["browser"],
) {
  const context = await seed(browser, [CURRENT_PROFILE, OLD_PROFILE]);
  const page = await context.newPage();
  await page.goto("/?uplinkLoaderIds=");
  await expect(page.locator(".dashboard-grid > [data-i]")).toHaveCount(3, {
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
  return page;
}

async function dragTileA(page: Page) {
  const tileA = page.locator(`.dashboard-grid > [data-i="${A}"]`);
  await tileA.hover();
  const grab = await tileA.locator(".drag-handle").boundingBox();
  if (!grab) throw new Error("no drag handle");
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(grab.x + 300, grab.y + 400, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.describe("dashboard layouts", () => {
  test("switching to another layout and back keeps every tile where it was", async ({
    browser,
  }) => {
    const page = await openSeeded(browser);
    const before = await cells(page);

    await switchToOther(page);
    expect(await cells(page)).not.toEqual(before);
    await switchToOther(page);

    expect(await cells(page)).toEqual(before);
  });

  test("a drag saves into the current layout and leaves the other one alone", async ({
    browser,
  }) => {
    const page = await openSeeded(browser);
    const before = await cells(page);

    await dragTileA(page);
    const dragged = await cells(page);
    expect(dragged).not.toEqual(before);

    await switchToOther(page);
    const other = await cells(page);
    expect(other[B].x).toBe(6);
    expect(other[B].y).toBe(other[A].y);
    await switchToOther(page);

    expect(await cells(page)).toEqual(dragged);
  });

  test("Undo puts a dragged tile back and Redo moves it again", async ({
    browser,
  }) => {
    const page = await openSeeded(browser);
    const before = await cells(page);

    await dragTileA(page);
    const dragged = await cells(page);
    await page.getByRole("button", { name: "Undo" }).click();
    await page.waitForTimeout(500);
    expect(await cells(page)).toEqual(before);

    await page.getByRole("button", { name: "Redo" }).click();
    await page.waitForTimeout(500);
    expect(await cells(page)).toEqual(dragged);
  });

  test("a key bound to a layout switches to it, says so, and Undo reverses it", async ({
    browser,
  }) => {
    const context = await seed(browser, [
      CURRENT_PROFILE,
      {
        ...OLD_PROFILE,
        inputBinding: { deviceId: "keyboard", inputId: "KeyK" },
      },
    ]);
    const page = await context.newPage();
    await page.goto("/?uplinkLoaderIds=");
    await expect(page.locator(".dashboard-grid > [data-i]")).toHaveCount(3, {
      timeout: 30_000,
    });
    await page.waitForTimeout(500);
    const before = await cells(page);

    await page.keyboard.press("k");

    await expect(page.getByText("Switched to Orbit (key K)")).toBeVisible();
    await expect.poll(() => cells(page)).not.toEqual(before);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => cells(page)).toEqual(before);
  });
});
