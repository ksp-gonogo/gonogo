/**
 * A tile being dragged follows the pointer continuously while the placement
 * box shows the cell it would land in, snapping from cell to cell.
 */
import { test } from "@playwright/test";
import { expect, seedContext } from "./helpers";

const A = "widget-orbit-view";
const B = "widget-crew-status";

const tile = (i: string, x: number, y: number, w: number, h: number) => ({
  i,
  x,
  y,
  w,
  h,
  moved: false,
  static: false,
});

test.describe("dashboard drag", () => {
  test("the dragged tile follows the pointer while the placement box snaps to cells", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
    });
    await seedContext(context, "gonogo:dashboard:main", {
      items: [
        { i: A, componentId: "orbit-view" },
        { i: B, componentId: "crew-status" },
      ],
      layout: [tile(A, 0, 0, 12, 8), tile(B, 14, 0, 9, 6)],
    });
    const page = await context.newPage();
    await page.goto("/?uplinkLoaderIds=");
    const tileA = page.locator(`.dashboard-grid > [data-i="${A}"]`);
    await expect(tileA).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);

    await tileA.hover();
    const grab = await tileA.locator(".drag-handle").boundingBox();
    if (!grab) throw new Error("no drag handle");
    const startX = grab.x + grab.width / 2;
    const startY = grab.y + grab.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();

    const rect = async () => {
      const box = await tileA.boundingBox();
      if (!box) throw new Error("tile gone");
      return box;
    };
    const first = await rect();
    const lag: number[] = [];
    const boxes = new Set<number>();
    // Steps of 7 px are far smaller than a grid column, so a tile that tracks the pointer moves in steps of 7 px and a snapping one in steps of a whole column.
    for (let step = 1; step <= 40; step++) {
      await page.mouse.move(startX + step * 7, startY + step * 3);
      await page.waitForTimeout(30);
      const now = await rect();
      lag.push(Math.abs(now.x - first.x - step * 7));
      boxes.add(Math.round(now.x));
    }
    const placeholderX = await page
      .locator(".react-grid-placeholder")
      .evaluate((el) => el.getBoundingClientRect().x);
    await page.mouse.up();

    expect(Math.max(...lag)).toBeLessThanOrEqual(3);
    expect(boxes.size).toBeGreaterThan(20);
    expect(placeholderX).toBeGreaterThan(first.x);
  });
});
