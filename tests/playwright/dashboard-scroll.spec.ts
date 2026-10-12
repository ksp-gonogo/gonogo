/**
 * A dashboard taller than the viewport must scroll while the pointer is over a
 * diagram, unless the wheel turn began on the diagram.
 *
 * A trackpad two-finger scroll is a stream of `wheel` events, so a diagram that
 * swallowed every one made the page immovable under a pointer parked on the map
 * (the biggest widget on most dashboards). The rule now is that a wheel turn
 * belongs to the diagram only if it began with the pointer inside it, and a
 * pinch (a wheel with `ctrlKey` set) always does.
 *
 * The gesture here is trackpad-shaped, many small deltas rather than one
 * discrete notch. A unit test can pin `defaultPrevented`, only a browser can
 * say whether the page moved.
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
  test("the page keeps scrolling when a gesture that began on the dashboard crosses the map, and a gesture that begins on the map zooms it", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 900, height: 360 },
    });
    await seedContext(context, "gonogo:dashboard:main", DASHBOARD);
    const page = await context.newPage();
    await page.goto("/?uplinkLoaderIds=");

    // The map binds its wheel listener once the container has been measured, which is when the canvas wrapper gets an inline width.
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

    // What the page sees of each wheel event over the map, after the map has had its turn.
    await page.evaluate(() => {
      const taken = { over: 0, swallowed: 0 };
      (window as unknown as { __mapWheel: typeof taken }).__mapWheel = taken;
      window.addEventListener("wheel", (e) => {
        const map = document.querySelector(
          '[data-testid="map-view-base-canvas"]',
        );
        if (map?.parentElement?.contains(e.target as Node)) {
          taken.over++;
          if (e.defaultPrevented) taken.swallowed++;
        }
      });
    });
    const mapWheel = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __mapWheel: { over: number; swallowed: number };
            }
          ).__mapWheel,
      );

    // Scrolled to the bottom, the pointer rests on the widget below the map, and the page scrolls up so the map arrives under it.
    await page.evaluate((y) => window.scrollTo(0, y), range);
    const mapBox = await canvasWrap.boundingBox();
    if (!mapBox) throw new Error("map canvas has no box");
    // Low enough that the map is above it when the page is scrolled down, and the map reaches it before the page is back at the top.
    const pointerY = Math.round(mapBox.y + mapBox.height + range * 0.6);
    await page.mouse.move(Math.round(mapBox.x + mapBox.width / 2), pointerY);
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, -12);
      await page.waitForTimeout(16);
    }
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
      .toBe(0);
    const crossed = await mapWheel();
    expect(
      crossed.over,
      "the map must have passed under the pointer",
    ).toBeGreaterThan(0);
    expect(
      crossed.swallowed,
      "the map must not take a gesture that began elsewhere",
    ).toBe(0);

    // A turn that begins with the pointer moved onto the map belongs to the map.
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await canvasWrap.boundingBox();
    if (!box) throw new Error("map canvas has no box");
    const over = {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    };
    await page.mouse.move(over.x - 40, over.y);
    await page.mouse.move(over.x, over.y);
    await page.waitForTimeout(400);
    const taken0 = (await mapWheel()).swallowed;
    await page.mouse.wheel(0, -100);
    await expect
      .poll(async () => (await mapWheel()).swallowed, { timeout: 5_000 })
      .toBeGreaterThan(taken0);

    // ...and the pinch gesture always belongs to the map.
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
