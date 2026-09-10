/**
 * A dashboard taller than the viewport must scroll wherever the pointer is.
 *
 * The operator reported (2026-09-09) that on the main screen, with widgets
 * below the fold, the page would not scroll. The cause was MapView's wheel
 * handler calling `preventDefault()` on every wheel event so it could zoom:
 * a trackpad two-finger scroll is a stream of `wheel` events, so parking the
 * pointer over the map (the biggest widget on most dashboards) made the page
 * immovable. Zoom now takes the pinch gesture, which arrives as a wheel with
 * `ctrlKey` set.
 *
 * The gesture here is trackpad-shaped, many small deltas rather than one
 * discrete notch, because that is what the operator was doing. A unit test
 * can pin `defaultPrevented`, only a browser can say whether the page moved.
 */
import { test } from "@playwright/test";
import { expect, seedContext } from "./helpers";

const MAP = "widget-map-view";

/** map-view up top, a second widget below it, in a viewport too short for both. */
const DASHBOARD = {
  items: [
    { i: MAP, componentId: "map-view" },
    { i: "widget-current-orbit", componentId: "current-orbit" },
  ],
  layouts: Object.fromEntries(
    ([12, 10, 8, 6, 4] as const).map((cols, idx) => [
      ["lg", "md", "sm", "xs", "xxs"][idx],
      [
        { i: MAP, x: 0, y: 0, w: cols, h: 8, moved: false, static: false },
        {
          i: "widget-current-orbit",
          x: 0,
          y: 8,
          w: cols,
          h: 8,
          moved: false,
          static: false,
        },
      ],
    ]),
  ),
};

test.describe("dashboard scrolling", () => {
  test("the page scrolls under a trackpad gesture over the map, and pinch still zooms", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 900, height: 500 },
    });
    await seedContext(context, "gonogo:dashboard:main", DASHBOARD);
    const page = await context.newPage();
    await page.goto("/?uplinkLoaderIds=");

    // The map binds its wheel listener once the container has been measured,
    // which is when the canvas wrapper gets an inline width.
    const canvasWrap = page
      .getByTestId("map-view-base-canvas")
      .locator("xpath=..");
    await expect(canvasWrap).toHaveAttribute("style", /width/, {
      timeout: 30_000,
    });

    const range = await page.evaluate(
      () =>
        document.documentElement.scrollHeight -
        document.documentElement.clientHeight,
    );
    expect(range, "the dashboard must overflow the viewport").toBeGreaterThan(
      100,
    );

    const box = await canvasWrap.boundingBox();
    if (!box) throw new Error("map canvas has no box");
    const over = {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    };

    await page.mouse.move(over.x, over.y);
    // A trackpad flick: many small deltas, not one notch.
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, 12);
      await page.waitForTimeout(16);
    }
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
      .toBeGreaterThan(0);

    // ...and the zoom gesture still belongs to the map.
    await page.evaluate(() => window.scrollTo(0, 0));
    const pinchTaken = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) throw new Error("nothing under the map point");
        const ev = new WheelEvent("wheel", {
          deltaY: -120,
          ctrlKey: true,
          cancelable: true,
          bubbles: true,
          clientX: x,
          clientY: y,
        });
        el.dispatchEvent(ev);
        return ev.defaultPrevented;
      },
      [over.x, over.y],
    );
    expect(pinchTaken, "pinch must still reach the map's zoom").toBe(true);

    await context.close();
  });
});
