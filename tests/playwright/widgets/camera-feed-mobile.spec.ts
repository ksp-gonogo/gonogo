import { test } from "@playwright/test";
import { bootstrapPair, expect, teardownPair } from "../helpers";

/**
 * Mobile sizing regression — CameraFeed at full mobile width.
 *
 * The 2026-05-18 self-test surfaced a regression where the camera widget
 * rendered as a flat ~2:0.5 band on portrait phones instead of a useful
 * box. Root cause: a missing `mobileHeight` on the component
 * registration, so MobileDashboard falls back to
 * `defaultSize.h * ROW_HEIGHT` (5 * 25 = 125px) — far too short for a
 * 16:9 hullcam frame. The kerbcast CameraFeed sets `mobileHeight: 280`.
 *
 * This spec catches that regression by booting a touch-emulated context
 * (which routes through MobileDashboard rather than the responsive grid)
 * and asserting the widget's mobile cell actually gets the height it asks
 * for. It doesn't exercise the WebRTC media pipe or the relay — the
 * sizing holds whether or not a stream arrives (the kerbcast vitest suite
 * drives the sidecar protocol).
 */

// MobileDashboard renders each widget in a `MobileCell` whose height is
// `def.mobileHeight` (280) plus the per-row chrome (reorder / width /
// height toggle header). Lower bound 180 sits well above the 125-px
// regression band; upper bound 420 catches a hypothetical mobileHeight
// mistake that would push the widget off a short viewport.
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 420;

const MOBILE_VIEWPORT = { width: 375, height: 812 } as const;
// `dashboardWithWidget` (helpers) ids the placed widget `widget-<id>`.
const CELL_SELECTOR = '[data-i="widget-camera-feed"]';

test.describe("CameraFeed mobile sizing", () => {
  test("renders at the registered mobileHeight on host + station", async ({
    browser,
    browserName,
  }) => {
    // Firefox's Playwright driver rejects `isMobile` in newContext() outright
    // (unsupported by the engine, not a gonogo bug) — bootstrapPair below
    // passes it straight through via contextOptions. Chromium and WebKit both
    // support it, so this is a Firefox-only skip, not a `@chromium-only` tag.
    test.skip(
      browserName === "firefox",
      "Firefox does not support the isMobile context option",
    );

    const pair = await bootstrapPair(browser, "camera-feed", {
      widget: {
        config: {
          // No sidecar in CI — the widget shows its empty state, but the
          // cell still gets the mobileHeight box regardless of content.
          flightId: null,
        },
      },
      contextOptions: {
        viewport: MOBILE_VIEWPORT,
        hasTouch: true,
        // The gonogo isTouch detector is `'ontouchstart' in window`, so
        // `hasTouch: true` is enough to route through MobileDashboard;
        // `isMobile` is set so the context reads as a real phone.
        isMobile: true,
      },
      waitForMain: async (page) => {
        await page.waitForSelector(CELL_SELECTOR, { timeout: 30_000 });
      },
    });

    for (const page of [pair.main, pair.station]) {
      // Measure the widget's mobile cell directly — its rendered height
      // reflects the registered `mobileHeight`. A cell ~125px tall is the
      // squish regression; ~280px+ is correct.
      const height = await page.evaluate((sel) => {
        const cell = document.querySelector(sel) as HTMLElement | null;
        return cell ? cell.getBoundingClientRect().height : null;
      }, CELL_SELECTOR);

      expect(height, `widget cell height on ${page.url()}`).not.toBeNull();
      expect(height ?? 0).toBeGreaterThanOrEqual(MIN_HEIGHT);
      expect(height ?? 0).toBeLessThanOrEqual(MAX_HEIGHT);
    }

    await teardownPair(pair);
  });
});
