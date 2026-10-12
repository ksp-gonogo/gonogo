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

    // The pointer goes on a point of the map as it is with the page at the top, and the page is then scrolled far enough down that the map is above that point. The point is found by asking the page what is drawn there, since the dashboard's tiles settle their sizes after they first draw and another widget can overlap part of the map.
    const scrolledTo = async (y: number) => {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await expect
        .poll(() => page.evaluate(() => Math.round(window.scrollY)))
        .toBe(y);
    };
    const mapRect = () =>
      canvasWrap.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
    await scrolledTo(0);
    let seen = await mapRect();
    await expect
      .poll(async () => {
        const again = await mapRect();
        const still = JSON.stringify(again) === JSON.stringify(seen);
        seen = again;
        await page.waitForTimeout(250);
        return still;
      }, "the layout holds still")
      .toBe(true);
    // Every point of the map that is drawn there, lowest first.
    const onMap = await canvasWrap.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const points: { x: number; y: number }[] = [];
      for (let fy = 0.95; fy > 0.05; fy -= 0.1) {
        for (const fx of [0.5, 0.3, 0.7, 0.1, 0.9]) {
          const x = Math.round(r.x + r.width * fx);
          const y = Math.round(r.y + r.height * fy);
          if (el.contains(document.elementFromPoint(x, y)))
            points.push({ x, y });
        }
      }
      return points;
    });
    await scrolledTo(range);
    const rest = await mapRect();
    // With the page scrolled down, the pointer rests on something empty: a readout under it would open a hover note that takes the wheel.
    const point = await canvasWrap.evaluate((el, candidates) => {
      const r = el.getBoundingClientRect();
      return (
        candidates.find((c) => {
          const under = document.elementFromPoint(c.x, c.y);
          return (
            under !== null &&
            !el.contains(under) &&
            c.y > r.bottom &&
            c.y < window.innerHeight &&
            (under.textContent ?? "").trim() === "" &&
            under.getAttribute("title") === null
          );
        }) ?? null
      );
    }, onMap);
    if (!point) throw new Error("no empty point is under the map's way down");
    expect(rest.y + rest.h, "the map starts above the pointer").toBeLessThan(
      point.y,
    );
    await page.mouse.move(point.x, point.y);
    // Keep turning the wheel until the page is back at the top, however slowly the browser scrolls, then a little more with the map under the pointer.
    for (let i = 0; i < 200; i++) {
      const y = await page.evaluate(() => window.scrollY);
      if (y === 0 && i > 0) break;
      await page.mouse.wheel(0, -12);
      await page.waitForTimeout(16);
    }
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -12);
      await page.waitForTimeout(16);
    }
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
      .toBe(0);
    const crossed = await mapWheel();
    // Firefox keeps the target of the first wheel event for the whole turn of the wheel, so the events it sends do not name the map even once the page has carried it under the pointer; what the page draws at the pointer is the same in every browser.
    expect(
      await page.evaluate(
        ([x, y]) =>
          document
            .querySelector('[data-testid="map-view-base-canvas"]')
            ?.parentElement?.contains(document.elementFromPoint(x, y)) ?? false,
        [point.x, point.y],
      ),
      "the map must have passed under the pointer",
    ).toBe(true);
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
